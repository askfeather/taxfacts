/**
 * Latency only. Ten calls per engine on one fixed sentence.
 *
 * Separate from the benchmark on purpose: a median needs ten samples, not 177,
 * and the benchmark's cached responses predate timing capture. Reported as p50
 * and p95 of wall clock including network.
 *
 * NOT comparable across engines reached by different routes - four of these go
 * through a gateway and the Anthropic ones call the origin.
 */
import { writeFileSync } from 'node:fs';
import { AnthropicBackend } from '../src/direct';
import { JevBackend } from '../src/jev';
import { LlmBackend } from '../src/llm';
import { FILER_PATHS } from '../src/paths';
import type { DecisionBackend } from '../src/types';

const or = process.env.OPENROUTER_API_KEY;
const an = process.env.ANTHROPIC_API_KEY;
if (!or || !an)
  throw new Error('OPENROUTER_API_KEY and ANTHROPIC_API_KEY required');

const ENGINES: [string, string, DecisionBackend][] = [
  ['jev', 'openrouter', new JevBackend(or, { route: 'openrouter' })],
  [
    'gemini-2.5-flash-lite',
    'openrouter',
    new LlmBackend(or, 'google/gemini-2.5-flash-lite'),
  ],
  [
    'gemini-2.5-flash',
    'openrouter',
    new LlmBackend(or, 'google/gemini-2.5-flash'),
  ],
  [
    'gemini-3.8-flash',
    'openrouter',
    new LlmBackend(or, 'google/gemini-3.8-flash'),
  ],
  ['claude-haiku-4.5', 'direct', new AnthropicBackend(an, 'claude-haiku-4-5')],
];

const questions = Object.fromEntries(
  FILER_PATHS.filter((s) => s.question).map((s) => [s.path, s.question]),
);
const withScreen = {
  __in_domain: {
    type: 'noul' as const,
    instructions:
      "The text describes a real person's tax, income, family or housing situation.",
  },
  ...questions,
};
const TEXT = 'I got married in June and bought a house in Denver. I am 42.';
const N = 10;

const out: Record<string, unknown> = {};
console.log(
  'engine'.padEnd(24) +
    'route'.padEnd(12) +
    'p50'.padStart(9) +
    'p95'.padStart(9),
);
for (const [name, route, backend] of ENGINES) {
  const ms: number[] = [];
  let spent = 0;
  for (let i = 0; i < N; i++) {
    const r = await backend.ask(TEXT, withScreen as never);
    if (r.ms) ms.push(r.ms);
    spent += r.cost ?? 0;
  }
  ms.sort((a, b) => a - b);
  const p = (q: number) =>
    ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
  out[name] = {
    route,
    n: ms.length,
    p50: p(0.5),
    p95: p(0.95),
    all: ms,
    cost: spent,
  };
  console.log(
    name.padEnd(24) +
      route.padEnd(12) +
      `${p(0.5)}ms`.padStart(9) +
      `${p(0.95)}ms`.padStart(9),
  );
}
writeFileSync('bench-data/latency.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('\nwritten to bench-data/latency.json');
