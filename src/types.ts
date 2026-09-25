/** Jev wire shapes (POST /v1/systemone) and this library's own result types. */

export type Question =
  | { type: 'noul'; instructions: string }
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice';
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { type: 'score'; score: number; confidence: number };

export interface AskResult {
  answers: Record<string, Answer>;
  inputTokens: number;
  /** Generated tokens. Zero for Jev, which emits no text at all, and the
   *  reason the two routes cost different amounts for the same decision. */
  outputTokens?: number;
  /** Gateways report it; TypeSafe direct does not. */
  cost?: number;
  /** Wall clock for the call, including network. Not comparable across
   *  engines reached by different routes - see BENCHMARK.md. */
  ms?: number;
}

/** One method, so the model behind it can be swapped. */
export interface DecisionBackend {
  ask(state: string, questions: Record<string, Question>): Promise<AskResult>;
}

export type FactValue = string | number | boolean;

/**
 * Three-valued, matching the IRS Fact Graph and our own engine. There is no
 * fourth "probably" state: below the gate a fact is missing, not guessed.
 */
export type Fact =
  | { status: 'complete'; path: string; value: FactValue; p: number }
  | { status: 'incomplete'; path: string; reason: string };

/** A fact we could not attempt, with the authority a human would need. */
export interface Needed {
  path: string;
  kind: string;
  options?: string[];
  cite?: string;
  why: string;
}

export interface Extraction {
  facts: Fact[];
  needs: Needed[];
  inputTokens: number;
  cost?: number;
}
