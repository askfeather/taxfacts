import { postJson } from './http';
import type { AskResult, DecisionBackend, Question } from './types';

/**
 * TypeSafe direct, and OpenRouter. The path and the body are identical, and
 * the probe confirmed OpenRouter returns TypeSafe's own response verbatim -
 * same `probabilities`, same `confidence`, plus a `cost`. OpenRouter matters
 * because TypeSafe paused new signups on 2026-09-22 while staying reachable
 * through gateways, so this is the only route a new user has today.
 */
export const ROUTES = {
  typesafe: {
    url: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/systemone',
    model: 'typesafe/jev-1.13',
  },
} as const;

export type RouteName = keyof typeof ROUTES;

export interface JevOptions {
  route?: RouteName;
  /** Overrides the route's default, e.g. to pin a dated build. */
  model?: string;
}

/**
 * Hand-rolled rather than using @typesafe-ai/sdk: that client echoes the full
 * API key into exception messages, which then land in logs (typesafe-sdk-js#14).
 * A key is the only credential here, so it must never be in a thrown string.
 */
export class JevBackend implements DecisionBackend {
  private readonly url: string;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    opts: JevOptions = {},
  ) {
    if (!apiKey.trim()) throw new Error('api key is empty');
    const route = ROUTES[opts.route ?? 'openrouter'];
    this.url = route.url;
    this.model = opts.model ?? route.model;
  }

  async ask(
    state: string,
    questions: Record<string, Question>,
  ): Promise<AskResult> {
    const res = await postJson(this.url, this.apiKey, {
      state,
      model: this.model,
      questions,
    });

    const json = (await res.json()) as {
      answers: AskResult['answers'];
      usage?: { input_tokens?: number; cost?: number };
    };
    return {
      answers: json.answers,
      inputTokens: json.usage?.input_tokens ?? 0,
      cost: json.usage?.cost,
    };
  }
}
