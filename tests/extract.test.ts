import { describe, expect, it } from 'vitest';
import { extract } from '../src/extract';
import { FILER_PATHS, NOT_STATED } from '../src/paths';
import type { Answer, DecisionBackend, Question } from '../src/types';

/** Records what was asked and replays canned answers. No network. */
function stub(answers: Record<string, Answer>) {
  const asked: Record<string, Question> = {};
  const backend: DecisionBackend = {
    async ask(_state, questions) {
      Object.assign(asked, questions);
      return { answers, inputTokens: 1 };
    },
  };
  return { backend, asked };
}

const inDomain: Answer = { type: 'noul', noul: 1 };

const choice = (c: string, confidence: number): Answer => ({
  type: 'choice',
  choice: c,
  confidence,
  probabilities: { [c]: confidence },
});

describe('the confidence gate', () => {
  it('keeps a fact at or above the gate', async () => {
    const out = await extract('We got married and are filing together.', {
      backend: stub({
        __in_domain: inDomain,
        '/filer/filingStatus': choice('mfj', 0.995),
      }).backend,
    });
    expect(out.facts).toContainEqual({
      status: 'complete',
      path: '/filer/filingStatus',
      value: 'mfj',
      p: 0.995,
    });
  });

  it('drops a fact below the gate into needs, with its citation', async () => {
    const out = await extract('It is complicated this year.', {
      backend: stub({
        __in_domain: inDomain,
        '/filer/filingStatus': choice('mfj', 0.83),
      }).backend,
    });
    expect(out.facts.some((f) => f.path === '/filer/filingStatus')).toBe(false);
    const need = out.needs.find((n) => n.path === '/filer/filingStatus');
    expect(need?.cite).toBe('26 U.S.C. §1, §2');
    expect(need?.options).toContain('mfj');
    expect(need?.options).not.toContain(NOT_STATED);
  });

  it('treats a confident not_stated as silence, not as a fact', async () => {
    const out = await extract('I sold some stock.', {
      backend: stub({
        __in_domain: inDomain,
        '/filer/filingStatus': choice(NOT_STATED, 0.999),
      }).backend,
    });
    expect(out.facts.some((f) => f.path === '/filer/filingStatus')).toBe(false);
    expect(out.needs.some((n) => n.path === '/filer/filingStatus')).toBe(false);
  });
});

describe('silence versus ambiguity on a noul', () => {
  // Measured against the live model: an unmentioned fact comes back at
  // 0.02-0.03, never 0. Treating those as ambiguous buried the real needs.
  it('treats a confident no as silence, not as a need', async () => {
    const out = await extract('I got married in June.', {
      backend: stub({
        __in_domain: inDomain,
        '/filer/blind': { type: 'noul', noul: 0.03 },
      }).backend,
    });
    expect(out.needs.some((n) => n.path === '/filer/blind')).toBe(false);
    expect(out.facts.some((f) => f.path === '/filer/blind')).toBe(false);
  });

  it('flags the middle band as ambiguous', async () => {
    const out = await extract('He mentioned his vision is failing.', {
      backend: stub({
        __in_domain: inDomain,
        '/filer/blind': { type: 'noul', noul: 0.45 },
      }).backend,
    });
    const need = out.needs.find((n) => n.path === '/filer/blind');
    expect(need?.why).toMatch(/ambiguous/);
  });
});

describe('the in-domain screen', () => {
  it('attempts nothing when the text is not a tax situation', async () => {
    const out = await extract('Cream the butter and sugar, then fold in.', {
      backend: stub({
        __in_domain: { type: 'noul', noul: 0.02 },
        '/filer/filingStatus': choice('single', 0.97),
      }).backend,
    });
    expect(out.facts).toHaveLength(0);
    expect(out.needs[0]?.kind).toBe('domain');
  });
});

describe('deterministic extraction', () => {
  it('reads identifiers and age without asking the model', async () => {
    const out = await extract(
      'I am 42, my SSN is 123-45-6789 and I live in 80202.',
      { backend: stub({ __in_domain: inDomain }).backend },
    );
    const byPath = Object.fromEntries(
      out.facts.map((f) => [f.path, f.status === 'complete' ? f.value : null]),
    );
    expect(byPath['/filer/age']).toBe(42);
    expect(byPath['/filer/ssn']).toBe('123-45-6789');
    expect(byPath['/filer/address/zip']).toBe('80202');
  });

  it('reports a missing literal rather than inventing one', async () => {
    const out = await extract('I moved house.', {
      backend: stub({ __in_domain: inDomain }).backend,
    });
    expect(out.needs.map((n) => n.path)).toContain('/filer/ssn');
  });
});

describe('what the model is never asked', () => {
  it('asks only the four closed decisions, plus the domain screen', async () => {
    const { backend, asked } = stub({ __in_domain: inDomain });
    await extract('anything', { backend });
    expect(Object.keys(asked).sort()).toEqual(
      [
        '__in_domain',
        '/filer/address/state',
        '/filer/blind',
        '/filer/filingStatus',
        '/spouse/blind',
      ].sort(),
    );
  });

  it('every free-text path is reported as a gap with a reason', async () => {
    const out = await extract('anything', {
      backend: stub({ __in_domain: inDomain }).backend,
    });
    const narrative = FILER_PATHS.filter((s) => s.via === 'narrative');
    expect(narrative).toHaveLength(9);
    for (const s of narrative) {
      const need = out.needs.find((n) => n.path === s.path);
      expect(need?.why).toMatch(/never a string/);
    }
  });
});

describe('the option lists stay inside the model limits', () => {
  it('no choice exceeds 255 options', () => {
    for (const s of FILER_PATHS) {
      if (s.question?.type !== 'choice') continue;
      expect(Object.keys(s.question.criteria).length).toBeLessThanOrEqual(255);
    }
  });

  it('every choice can say the text was silent', () => {
    for (const s of FILER_PATHS) {
      if (s.question?.type !== 'choice') continue;
      expect(Object.keys(s.question.criteria)).toContain(NOT_STATED);
    }
  });
});
