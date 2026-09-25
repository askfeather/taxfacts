import { lastMs, postJson } from './http';
import { answersFrom, SYSTEM, schemaFor } from './llm';
import type { AskResult, DecisionBackend, Question } from './types';

/**
 * Anthropic and OpenAI called directly rather than through a gateway.
 *
 * Same system prompt, same JSON schema and the same confidence formula as
 * every other engine, so only the transport differs. Going direct also
 * removes the "maybe the gateway translated something" objection to the
 * published numbers - but it does mean latency is no longer comparable across
 * engines, because the network path is no longer shared. Accuracy and
 * overreach are unaffected; see BENCHMARK.md.
 */

const MAX_TOKENS = 8000;

/**
 * Anthropic constrains tool-schema property keys to
 * `^[a-zA-Z0-9_.-]{1,64}$`, and ours are fact paths like
 * `/filer/address/state`. So the schema sees a flattened key and the answers
 * are mapped back before scoring. Only the wire name changes - the question
 * text, the options and their descriptions are identical to every other
 * engine, so the comparison is unaffected.
 */
const flatten = (path: string) => path.replace(/^\//, '').replaceAll('/', '.');

/** Anthropic has no json_schema response format, so a forced tool call is the
 *  supported way to constrain output. Same schema, different envelope. */
export class AnthropicBackend implements DecisionBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-sonnet-5',
  ) {
    if (!apiKey.trim()) throw new Error('api key is empty');
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const wire: Record<string, Question> = {};
    const original = new Map<string, string>();
    for (const [key, q] of Object.entries(questions)) {
      const flat = flatten(key);
      wire[flat] = q;
      original.set(flat, key);
    }

    const res = await postJson(
      'https://api.anthropic.com/v1/messages',
      this.apiKey,
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        // No temperature: this model rejects it as deprecated. The other
        // engines run at 0, so this one is the only non-greedy sampler here -
        // recorded because it is the likeliest source of any run-to-run
        // variance it shows.
        system: SYSTEM,
        messages: [{ role: 'user', content: state }],
        tools: [
          {
            name: 'record_decisions',
            description: 'Record one probability distribution per question.',
            input_schema: schemaFor(wire),
          },
        ],
        tool_choice: { type: 'tool', name: 'record_decisions' },
      },
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
    );

    const json = (await res.json()) as {
      content: { type: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const call = json.content.find((c) => c.type === 'tool_use');
    const flat = (call?.input ?? {}) as Record<string, Record<string, number>>;
    const raw = Object.fromEntries(
      Object.entries(flat).map(([k, v]) => [original.get(k) ?? k, v]),
    );

    return {
      answers: answersFrom(raw, questions),
      inputTokens: json.usage?.input_tokens ?? 0,
      ms: lastMs,
    };
  }
}

/** OpenAI supports json_schema directly, so this is the same body shape the
 *  gateway route uses, pointed at the origin. */
/**
 * The lowest reasoning setting each model accepts. They disagree on the
 * vocabulary for the same idea: gpt-6-luna rejects 'minimal' and wants 'none',
 * gpt-5-nano rejects 'none' and wants 'minimal'.
 */
const NO_REASONING: Record<string, string> = {
  'gpt-6-luna': 'none',
  'gpt-5-nano': 'minimal',
};

export class OpenAiBackend implements DecisionBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-6-astra',
  ) {
    if (!apiKey.trim()) throw new Error('api key is empty');
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const res = await postJson(
      'https://api.openai.com/v1/chat/completions',
      this.apiKey,
      {
        model: this.model,
        max_completion_tokens: MAX_TOKENS,
        // Non-thinking, the convention every published comparison in this
        // space uses for its baseline. Left at the default these models reason
        // for 6-30s on a 52-option schema, where no other engine here reasons
        // at all, so the default would compare two different things. Note
        // gpt-6-luna rejects 'minimal' and wants 'none'.
        ...(NO_REASONING[this.model]
          ? { reasoning_effort: NO_REASONING[this.model] }
          : {}),
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: state },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'decisions',
            strict: true,
            schema: schemaFor(questions),
          },
        },
      },
    );

    const json = (await res.json()) as {
      choices: { message: { content: string | null } }[];
      usage?: { prompt_tokens?: number };
    };
    let raw: Record<string, Record<string, number>> = {};
    try {
      raw = JSON.parse(json.choices[0]?.message.content ?? '{}');
    } catch {
      // Truncated output. No answers means every path abstains, which is the
      // honest reading: the engine did not answer.
      return { answers: {}, inputTokens: json.usage?.prompt_tokens ?? 0 };
    }

    return {
      answers: answersFrom(raw, questions),
      inputTokens: json.usage?.prompt_tokens ?? 0,
      ms: lastMs,
    };
  }
}
