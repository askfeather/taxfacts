/**
 * Live call against the real API. Prints what came back so the response shape can be
 * judged on observed behaviour rather than on the vendor's documentation.
 *
 *   TYPESAFE_API_KEY=... pnpm spike "I got married in June and bought a house"
 */
import { extract } from '../src/extract';
import { JevBackend } from '../src/jev';

// TypeSafe paused signups on 2026-09-22, so OpenRouter is the route that
// works for a new account today. Prefer a direct key when one exists.
const direct = process.env.TYPESAFE_API_KEY;
const key = direct ?? process.env.OPENROUTER_API_KEY;
const route = direct ? 'typesafe' : 'openrouter';
if (!key) {
  console.error('Set TYPESAFE_API_KEY or OPENROUTER_API_KEY.');
  process.exit(1);
}

const text =
  process.argv.slice(2).join(' ') ||
  'I got married in June and bought a house in Denver. I am 42.';

const started = Date.now();
const out = await extract(text, {
  backend: new JevBackend(key, { route }),
});
const ms = Date.now() - started;

console.log(`\n"${text}"\n`);
console.log(
  `via ${route} - ${ms}ms, ${out.inputTokens} input tokens` +
    (out.cost === undefined ? '' : `, $${out.cost.toFixed(8)}`) +
    '\n',
);

console.log('facts');
for (const f of out.facts)
  console.log(
    f.status === 'complete'
      ? `  ${f.path} = ${String(f.value)}  p=${f.p}`
      : `  ${f.path} incomplete: ${f.reason}`,
  );

console.log('\nneeds');
for (const n of out.needs) console.log(`  ${n.path}: ${n.why}`);
