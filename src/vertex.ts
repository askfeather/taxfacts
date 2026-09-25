import { lastMs, postJson } from './http';
import { answersFrom, SYSTEM, schemaFor } from './llm';
import type { AskResult, DecisionBackend, Question } from './types';

/**
 * Vertex AI, so the current Gemini models can be measured without a gateway
 * balance. Same system prompt, same schema and the same confidence formula as
 * every other engine.
 *
 * Two endpoint shapes, because Google serves them differently: the 3.x Flash
 * models are published to the `us` multi-region on the global host, and the
 * 2.5 models to a single region on that region's host. Anything else 404s with
 * an HTML page rather than an API error.
 */
const MULTI_REGION = new Set([
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
]);

export function vertexUrl(project: string, model: string): string {
  return MULTI_REGION.has(model)
    ? `https://aiplatform.googleapis.com/v1/projects/${project}/locations/us/publishers/google/models/${model}:generateContent`
    : `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/${model}:generateContent`;
}

/** Vertex rejects `additionalProperties`, which our shared schema sets. */
function vertexSchema(questions: Record<string, Question>) {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (n && typeof n === 'object') {
      const { additionalProperties: _drop, ...rest } = n as Record<
        string,
        unknown
      >;
      return Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k, strip(v)]),
      );
    }
    return n;
  };
  return strip(schemaFor(questions));
}

export class VertexBackend implements DecisionBackend {
  constructor(
    private readonly accessToken: string,
    private readonly model: string,
    private readonly project: string,
  ) {
    if (!accessToken.trim()) throw new Error('access token is empty');
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const res = await postJson(
      vertexUrl(this.project, this.model),
      this.accessToken,
      {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: state }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8000,
          responseMimeType: 'application/json',
          responseSchema: vertexSchema(questions),
          // The 3.x Flash models reason by default. No other engine here
          // reasons at all, so leaving it on would compare two things.
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    );

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

    let raw: Record<string, Record<string, number>> = {};
    try {
      raw = JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
    } catch {
      // Truncated output. No answers means every path abstains, which is the
      // honest reading: the engine did not answer.
      return { answers: {}, inputTokens, outputTokens };
    }

    return {
      answers: answersFrom(raw, questions),
      inputTokens,
      outputTokens,
      ms: lastMs,
    };
  }
}
