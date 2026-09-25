import { FILER_PATHS, NOT_STATED, type PathSpec } from './paths';
import type {
  Answer,
  DecisionBackend,
  Extraction,
  Fact,
  Needed,
  Question,
} from './types';

/**
 * Published evaluations report that the model does not abstain unless an
 * out-of-scope option is supplied, scoring a cake recipe at 0.94 confidence
 * when asked a technical question. With the explicit not-stated option this
 * harness adds, the same recipe scores 0.01 in domain.
 *
 * 0.95 is the top of the plateau: overreach first reaches its floor of 3 and
 * the reported fact set stops varying between runs. 0.99 discards 37 of Jev's
 * 282 correct facts and flaps, because confidence is quantized to 0.01 and 0.99
 * sits on a rounding boundary. Chosen on Jev, on this corpus, with no held-out
 * split.
 */
export const GATE = 0.95;

/**
 * Measured on the fixture corpus: a recipe scores 0.01 and an invoice sales-tax
 * question 0.17, against 0.31 for the weakest genuine filer sentence. 0.30
 * leaves a margin of 0.01, which is thin, and one genuine fixture
 * (c-vision-unclear) scores 0.03 and is screened out. Removing this floor
 * changes no engine's over-assertion count on this corpus, so it is a guard
 * rather than a load-bearing mechanism.
 */
export const IN_DOMAIN_FLOOR = 0.3;

/** Cheap in-domain screen, because the model will answer anything. */
const IN_DOMAIN =
  "The text describes a real person's tax, income, family or housing situation.";

const IN_DOMAIN_KEY = '__in_domain';

export interface ExtractOptions {
  backend: DecisionBackend;
  specs?: PathSpec[];
  gate?: number;
}

function buildQuestions(specs: PathSpec[]): Record<string, Question> {
  const qs: Record<string, Question> = {
    [IN_DOMAIN_KEY]: { type: 'noul', instructions: IN_DOMAIN },
  };
  for (const s of specs) if (s.question) qs[s.path] = s.question;
  return qs;
}

/**
 * Below this a `noul` is a confident no, which is silence. Measured, an
 * unmentioned fact comes back at 0.02 to 0.03 rather than 0, so this floor sits
 * at 0.1 rather than mirroring the gate as `1 - gate`, which would call every
 * silent fact ambiguous. Ambiguity is a middle band, not the complement of
 * certainty.
 */
export const SILENCE = 0.1;

/** Reads one answer through the gate. Returns undefined when it does not pass. */
function gated(answer: Answer | undefined, gate: number) {
  if (!answer) return undefined;
  if (answer.type === 'noul')
    return answer.noul >= gate
      ? { value: true, p: answer.noul }
      : { value: false, p: 1 - answer.noul, weak: answer.noul >= SILENCE };
  if (answer.type === 'choice')
    return answer.confidence >= gate
      ? { value: answer.choice, p: answer.confidence }
      : undefined;
  return undefined;
}

export async function extract(
  text: string,
  opts: ExtractOptions,
): Promise<Extraction> {
  const specs = opts.specs ?? FILER_PATHS;
  const gate = opts.gate ?? GATE;
  const facts: Fact[] = [];
  const needs: Needed[] = [];

  // Deterministic first. Money, dates and identifiers never come from the
  // model: the vendor documents it as not a calculator, and as reading dates
  // as text rather than ordered quantities.
  const matched = new Set<string>();
  for (const s of specs) {
    if (s.via !== 'regex' || !s.match) continue;
    const value = s.match(text);
    if (value !== undefined) {
      facts.push({ status: 'complete', path: s.path, value, p: 1 });
      matched.add(s.path);
    }
  }

  const asked = specs.filter((s) => s.via === 'jev');
  const { answers, inputTokens, cost } = await opts.backend.ask(
    text,
    buildQuestions(asked),
  );

  const domain = answers[IN_DOMAIN_KEY];
  if (domain?.type === 'noul' && domain.noul < IN_DOMAIN_FLOOR) {
    return {
      facts,
      needs: [
        {
          path: '*',
          kind: 'domain',
          why: 'the text does not read as a tax situation, so no fact was attempted',
        },
      ],
      inputTokens,
      cost,
    };
  }

  for (const s of asked) {
    const g = gated(answers[s.path], gate);
    if (g === undefined) {
      needs.push({
        path: s.path,
        kind: s.kind,
        options:
          s.question?.type === 'choice'
            ? Object.keys(s.question.criteria).filter((k) => k !== NOT_STATED)
            : undefined,
        cite: s.cite,
        why: `below the ${gate} confidence gate`,
      });
      continue;
    }
    if (g.value === NOT_STATED || g.value === false) {
      // Silence is a real answer only when the model is sure of the silence.
      if (!('weak' in g) || !g.weak) continue;
      needs.push({
        path: s.path,
        kind: s.kind,
        cite: s.cite,
        why: 'the text is ambiguous rather than silent',
      });
      continue;
    }
    facts.push({ status: 'complete', path: s.path, value: g.value, p: g.p });
  }

  for (const s of specs) {
    if (s.via !== 'narrative') continue;
    needs.push({ path: s.path, kind: s.kind, why: s.gap ?? 'not attempted' });
  }
  for (const s of specs) {
    if (s.via === 'regex' && !matched.has(s.path))
      needs.push({
        path: s.path,
        kind: s.kind,
        why: 'no literal match in the text',
      });
  }

  return { facts, needs, inputTokens, cost };
}
