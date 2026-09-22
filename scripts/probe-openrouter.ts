/**
 * Does Jev's native shape survive OpenRouter?
 *
 * The console is closed to new signups, so OpenRouter is the only way to reach
 * the model. But its public API reference documents only /chat/completions,
 * and Jev is not a chat model: it takes a state plus typed questions and
 * returns a probability per option. If that translation drops `confidence`,
 * the 0.99 gate in src/extract.ts has nothing to read and the design changes.
 *
 * This prints the raw body of both attempts rather than parsing them, because
 * the point is to find out what actually comes back.
 *
 *   OPENROUTER_API_KEY=... npx tsx scripts/probe-openrouter.ts
 */

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is not set.');
  process.exit(1);
}

const BASE = 'https://openrouter.ai/api';
const MODEL = 'typesafe/jev-1.13';
const STATE = 'We got married in June and are filing one return together.';

const QUESTIONS = {
  filingStatus: {
    type: 'choice',
    instructions: "The taxpayer's federal filing status.",
    criteria: {
      single: 'Unmarried.',
      mfj: 'Married, filing jointly.',
      mfs: 'Married, filing separately.',
      not_stated: 'The text does not say.',
    },
  },
};

async function probe(label: string, path: string, body: unknown) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n--- ${label} (${path}) ---`);
  console.log(`${res.status} in ${Date.now() - started}ms`);
  console.log(text.slice(0, 1500));
}

// OpenRouter promoted Jev out of alpha within days, so there are now two
// paths. Try the stable one first: it mirrors TypeSafe's own /v1/systemone,
// which means the official SDK works against it with only a base-url swap.
await probe('systemone (stable)', '/v1/systemone', {
  model: MODEL,
  state: STATE,
  questions: QUESTIONS,
});

// The original alpha path, kept so we learn whether both still answer.
await probe('decisions (alpha)', '/alpha/decisions', {
  model: MODEL,
  state: STATE,
  questions: QUESTIONS,
});

// Confirm the rejection. Jev is also absent from GET /v1/models because of
// its text->decisions modality, so anything that discovers models by walking
// that list will not find it.
await probe('chat completions (expected to fail)', '/v1/chat/completions', {
  model: MODEL,
  messages: [{ role: 'user', content: STATE }],
});

export {};
