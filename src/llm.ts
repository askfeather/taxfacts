import type { Answer, AskResult, DecisionBackend, Question } from './types';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Chance-corrected, and reverse-engineered from Jev's own responses: a choice
 * at p=0.63 over 6 options reports 0.55, and p=0.99 over 52 reports 0.98.
 * Computing it the same way here is what makes one gate mean the same thing
 * on both engines - otherwise the comparison measures two different scales.
 */
export function confidenceOf(pMax: number, k: number): number {
  if (k <= 1) return pMax;
  return Math.max(0, (pMax - 1 / k) / (1 - 1 / k));
}

const SYSTEM = `You answer typed questions about a text by returning a probability distribution, never prose.
For each question return probabilities over exactly the given options that sum to 1.
Be calibrated: a probability of 0.9 should be right about 90% of the time.
If the text does not state or clearly imply an answer, put the mass on the option that says so.
Never infer a fact from an entity that merely appears nearby - a city named as a charity's location is not where the taxpayer lives.`;

/**
 * A second engine behind the same interface, asking a general model for the
 * same typed distributions. Verbalized probabilities under a strict schema,
 * which is the approach TypeSafe's own reference adapter takes rather than
 * token logprobs. Runs over OpenRouter so both engines share a network path.
 */
export class LlmBackend implements DecisionBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'google/gemini-2.5-flash-lite',
  ) {
    if (!apiKey.trim()) throw new Error('api key is empty');
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, q] of Object.entries(questions)) {
      required.push(key);
      const options =
        q.type === 'choice' ? Object.keys(q.criteria) : ['true', 'false'];
      props[key] = {
        type: 'object',
        description: q.instructions,
        properties: Object.fromEntries(
          options.map((o) => [
            o,
            {
              type: 'number',
              description:
                q.type === 'choice'
                  ? (q.criteria[o] ?? o)
                  : `the answer is ${o}`,
            },
          ]),
        ),
        required: options,
        additionalProperties: false,
      };
    }

    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // A 52-option state question makes the model WRITE 52 numbers. Jev
        // returns that distribution natively, so this ceiling is a cost the
        // general-model route pays and the decision-model route does not.
        max_tokens: 8000,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: state },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'decisions',
            strict: true,
            schema: {
              type: 'object',
              properties: props,
              required,
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!res.ok)
      throw new Error(
        `llm ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
      );

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; cost?: number };
    };
    let raw: Record<string, Record<string, number>> = {};
    try {
      raw = JSON.parse(json.choices[0]?.message.content ?? '{}');
    } catch {
      // Truncated output. Returning no answers makes every path abstain,
      // which is the honest reading: the engine did not answer.
      return { answers: {}, inputTokens: json.usage?.prompt_tokens ?? 0 };
    }

    const answers: Record<string, Answer> = {};
    for (const [key, q] of Object.entries(questions)) {
      const dist = raw[key];
      if (!dist) continue;
      if (q.type === 'noul') {
        answers[key] = { type: 'noul', noul: dist.true ?? 0 };
        continue;
      }
      if (q.type !== 'choice') continue;
      const entries = Object.entries(dist);
      const sum = entries.reduce((a, [, p]) => a + p, 0) || 1;
      const norm = Object.fromEntries(entries.map(([o, p]) => [o, p / sum]));
      const [choice, pMax] = entries.reduce(
        (best, [o, p]) => (p > best[1] ? [o, p] : best),
        ['', -1] as [string, number],
      );
      answers[key] = {
        type: 'choice',
        choice,
        probabilities: norm,
        confidence: confidenceOf(pMax / sum, entries.length),
      };
    }

    return {
      answers,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      cost: json.usage?.cost,
    };
  }
}
