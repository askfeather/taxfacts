/**
 * Pick the gate with data instead of taste.
 *
 * Calls the model once per fixture per run and caches the raw answers, then
 * replays them offline at every candidate gate. Sweeping against one cache
 * matters: confidence moves between identical calls, so re-calling per gate
 * would measure that noise rather than the threshold.
 *
 *   npx tsx scripts/bench.ts --engine jev    # re-score published data, free
 *   OPENROUTER_API_KEY=... npx tsx scripts/bench.ts --live --runs 3 --engine jev
 *
 * Every response we measured is committed under bench-data/, so the tables in
 * the README can be reproduced without an API key and without trusting us.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AnthropicBackend, OpenAiBackend } from '../src/direct';
import { extract } from '../src/extract';
import { JevBackend } from '../src/jev';
import { LlmBackend } from '../src/llm';
import { FILER_PATHS } from '../src/paths';
import { add, EMPTY, type Fixture, type Score, scoreOne } from '../src/score';
import type { AskResult, DecisionBackend } from '../src/types';

/**
 * Three engines, so the comparison can separate model CLASS from model SIZE.
 * If a bigger general model abstains properly, the finding is about scale.
 * If it does not, the finding is about what kind of model this is.
 */
const ENGINES: Record<string, string | null> = {
  jev: null,
  'flash-lite': 'google/gemini-2.5-flash-lite',
  flash: 'google/gemini-2.5-flash',
  'flash-3.8': 'google/gemini-3.8-flash',
  'sonnet-5': 'anthropic/claude-sonnet-5',
};

/** Called at the origin instead of through the gateway, using the provider's
 *  own key. Same prompt, same schema, same confidence formula. */
const DIRECT: Record<string, { env: string; model: string }> = {
  'sonnet-5-direct': { env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5' },
  'opus-5-direct': { env: 'ANTHROPIC_API_KEY', model: 'claude-opus-5' },
  'haiku-direct': { env: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5' },
  // OpenAI's entry in the same tier: gpt-6-luna matches Flash-Lite's price
  // point, gpt-5-nano is the cheapest thing in the bracket.
  'luna-direct': { env: 'OPENAI_API_KEY', model: 'gpt-6-luna' },
  'nano-direct': { env: 'OPENAI_API_KEY', model: 'gpt-5-nano' },
  'astra-direct': { env: 'OPENAI_API_KEY', model: 'gpt-6-astra' },
};
const engineArg = process.argv.indexOf('--engine');
const ENGINE = engineArg > -1 ? (process.argv[engineArg + 1] ?? 'jev') : 'jev';
if (!(ENGINE in ENGINES) && !(ENGINE in DIRECT))
  throw new Error(`unknown engine: ${ENGINE}`);
const NAMES: Record<string, string> = {
  jev: 'jev',
  'flash-lite': 'gemini-2.5-flash-lite',
  flash: 'gemini-2.5-flash',
  'flash-3.8': 'gemini-3.8-flash',
  'sonnet-5': 'claude-sonnet-5',
  'sonnet-5-direct': 'claude-sonnet-5',
  'opus-5-direct': 'claude-opus-5',
  'haiku-direct': 'claude-haiku-4.5',
  'luna-direct': 'gpt-6-luna',
  'nano-direct': 'gpt-5-nano',
  'astra-direct': 'gpt-6-astra',
};
const CACHE = `bench-data/${NAMES[ENGINE] ?? ENGINE}.json`;
const GATES = [0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995];

const fixtures: Fixture[] = readdirSync('fixtures')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8')));

const live = process.argv.includes('--live');
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 3;

type Cache = Record<string, AskResult[]>;
let cache: Cache = {};

/** Persist after every case. A run can die on a rate limit or an exhausted
 *  balance, and losing paid-for responses to an exception is not acceptable -
 *  a resumed run skips whatever is already on disk. */
const persist = () => writeFileSync(CACHE, JSON.stringify(cache, null, 2));

if (live) {
  const direct = DIRECT[ENGINE];
  const key = direct ? process.env[direct.env] : process.env.OPENROUTER_API_KEY;
  if (!key)
    throw new Error(`${direct?.env ?? 'OPENROUTER_API_KEY'} is not set`);

  const backend = direct
    ? direct.env === 'ANTHROPIC_API_KEY'
      ? new AnthropicBackend(key, direct.model)
      : new OpenAiBackend(key, direct.model)
    : ENGINES[ENGINE]
      ? new LlmBackend(key, ENGINES[ENGINE] as string)
      : new JevBackend(key, { route: 'openrouter' });
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
  // Frontier models take 8-17s per call against Jev's 0.4s, so serial
  // collection is hours. Fixtures are independent, so this changes wall clock
  // only - each case still gets its `runs` calls in sequence. Kept low because
  // a new OpenRouter account is capped at 20 requests per minute per model,
  // with src/http.ts backing off on top.
  // Resume: anything already cached with the right number of runs is skipped.
  if (existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  const todo = fixtures.filter((f) => (cache[f.id]?.length ?? 0) < runs);
  if (todo.length < fixtures.length)
    console.log(`resuming: ${fixtures.length - todo.length} already cached`);

  let spent = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (;;) {
        const f = queue.shift();
        if (!f) return;
        const got: AskResult[] = [];
        for (let i = 0; i < runs; i++) {
          got.push(await backend.ask(f.prose, withScreen as never));
        }
        spent += got.reduce((a, r) => a + (r.cost ?? 0), 0);
        cache[f.id] = got;
        persist();
        process.stdout.write('.');
      }
    }),
  );
  persist();
  console.log(
    `\n${todo.length} fixtures x ${runs} runs, $${spent.toFixed(6)}\n`,
  );
} else {
  cache = JSON.parse(readFileSync(CACHE, 'utf8'));
}

/** Replays a cached call. The harness builds the same questions every time. */
const replay = (r: AskResult): DecisionBackend => ({
  async ask() {
    return r;
  },
});

console.log(`\nengine: ${ENGINE}`);
console.log('gate     correct  wrongVal  missed  overreach   flaky');
for (const gate of GATES) {
  let total: Score = { ...EMPTY };
  let flaky = 0;
  for (const f of fixtures) {
    const shapes = new Set<string>();
    for (const r of cache[f.id] ?? []) {
      const out = await extract(f.prose, { backend: replay(r), gate });
      total = add(total, scoreOne(f, out));
      shapes.add(
        out.facts
          .filter((x) => x.status === 'complete')
          .map((x) => x.path)
          .sort()
          .join(','),
      );
    }
    if (shapes.size > 1) flaky++;
  }
  console.log(
    `${gate.toFixed(3).padEnd(8)} ${String(total.correct).padStart(7)}  ${String(
      total.wrongValue,
    ).padStart(8)}  ${String(total.missed).padStart(6)}  ${String(
      total.overreach,
    ).padStart(9)}   ${String(flaky).padStart(2)}/${fixtures.length}`,
  );
}
