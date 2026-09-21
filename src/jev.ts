import type { AskResult, DecisionBackend, Question } from './types';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/**
 * Hand-rolled rather than using @typesafe-ai/sdk: that client echoes the full
 * API key into exception messages, which then land in logs (typesafe-sdk-js#14).
 * A key is the only credential here, so it must never be in a thrown string.
 */
export class JevBackend implements DecisionBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'jev-latest',
  ) {
    if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is empty');
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state, model: this.model, questions }),
    });

    if (!res.ok) {
      // Documented codes do not match observed ones: a bad key returns 403
      // where the spec says 401, and body validation returns 400 for 422.
      // So branch on the number, never on a documented error name.
      const body = await res.text().catch(() => '');
      throw new Error(`jev ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      answers: AskResult['answers'];
      usage?: { input_tokens?: number };
    };
    return {
      answers: json.answers,
      inputTokens: json.usage?.input_tokens ?? 0,
    };
  }
}
