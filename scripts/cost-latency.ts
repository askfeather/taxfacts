/**
 * Cost and latency for the final roster. Ten calls per engine on one fixed
 * sentence: a median needs ten samples, not 177, and the benchmark's cached
 * responses predate token capture.
 *
 * Cost is measured tokens times the published price, not an estimate of the
 * prompt. Where the gateway also bills the call it reports its own figure and
 * the two are printed side by side.
 *
 * Latency is wall clock including network, over the route you would actually
 * reach each engine through. NOT comparable across engines on that account -
 * three routes are involved. See BENCHMARK.md.
 */
import { writeFileSync } from 'node:fs';
import { AnthropicBackend, OpenAiBackend } from '../src/direct';
import { JevBackend } from '../src/jev';
import { LlmBackend } from '../src/llm';
import { FILER_PATHS } from '../src/paths';
import type { DecisionBackend } from '../src/types';
import { VertexBackend } from '../src/vertex';

const or = process.env.OPENROUTER_API_KEY;
const an = process.env.ANTHROPIC_API_KEY;
const oa = process.env.OPENAI_API_KEY;
const gc = process.env.GOOGLE_ACCESS_TOKEN;
if (!or || !an || !oa || !gc)
  throw new Error(
    'OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY and GOOGLE_ACCESS_TOKEN required',
  );
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set');

/** Published list price per million tokens, read off each vendor's page.
 *  Jev bills input only: it generates nothing. */
const PRICE: Record<string, { in: number; out: number }> = {
  jev: { in: 0.042, out: 0 },
  'gpt-6-luna': { in: 0.1, out: 0.5 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.8-flash': { in: 0.75, out: 3.75 },
  'claude-haiku-4.5': { in: 1.0, out: 5.0 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
};

const ENGINES: [string, string, DecisionBackend][] = [
  ['jev', 'openrouter', new JevBackend(or, { route: 'openrouter' })],
  ['gpt-6-luna', 'openai', new OpenAiBackend(oa, 'gpt-6-luna')],
  [
    'gemini-3.5-flash-lite',
    'vertex',
    new VertexBackend(gc, 'gemini-3.5-flash-lite', project),
  ],
  [
    'gemini-3.8-flash',
    'vertex',
    new VertexBackend(gc, 'gemini-3.8-flash', project),
  ],
  [
    'claude-haiku-4.5',
    'anthropic',
    new AnthropicBackend(an, 'claude-haiku-4-5'),
  ],
  [
    'gemini-2.5-flash',
    'openrouter',
    new LlmBackend(or, 'google/gemini-2.5-flash'),
  ],
  [
    'gemini-2.5-flash-lite',
    'openrouter',
    new LlmBackend(or, 'google/gemini-2.5-flash-lite'),
  ],
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
  'engine'.padEnd(23) +
    'route'.padEnd(11) +
    'in'.padStart(6) +
    'out'.padStart(6) +
    '$/call'.padStart(11) +
    'p50'.padStart(8) +
    'p95'.padStart(8),
);
for (const [name, route, backend] of ENGINES) {
  const ms: number[] = [];
  let inTok = 0;
  let outTok = 0;
  let billed = 0;
  for (let i = 0; i < N; i++) {
    const r = await backend.ask(TEXT, withScreen as never);
    if (r.ms) ms.push(r.ms);
    inTok += r.inputTokens;
    outTok += r.outputTokens ?? 0;
    billed += r.cost ?? 0;
  }
  ms.sort((a, b) => a - b);
  const p = (q: number) =>
    ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
  const price = PRICE[name];
  if (!price) throw new Error(`no published price for ${name}`);
  const perCall =
    ((inTok / N) * price.in + (outTok / N) * price.out) / 1_000_000;
  out[name] = {
    route,
    n: ms.length,
    inputTokens: inTok / N,
    outputTokens: outTok / N,
    priceIn: price.in,
    priceOut: price.out,
    perCall,
    per1k: perCall * 1000,
    gatewayBilledPerCall: billed ? billed / N : null,
    p50: p(0.5),
    p95: p(0.95),
    all: ms,
  };
  console.log(
    name.padEnd(23) +
      route.padEnd(11) +
      String(Math.round(inTok / N)).padStart(6) +
      String(Math.round(outTok / N)).padStart(6) +
      perCall.toExponential(2).padStart(11) +
      `${p(0.5)}ms`.padStart(8) +
      `${p(0.95)}ms`.padStart(8),
  );
}
writeFileSync(
  'bench-data/cost-latency.json',
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log('\nwritten to bench-data/cost-latency.json');
