# taxfacts

**Spike.** Turn a taxpayer's own words into typed tax facts, using a System One
decision model for the semantic routing and nothing else.

This repository exists to find problems early. It is not a library yet, it is
not published, and the findings below are the point of it.

```bash
pnpm install
pnpm test                                    # no API key needed
npx tsx scripts/bench.ts                     # re-score the cached sweep, no network

OPENROUTER_API_KEY=... pnpm spike "I got married in June and bought a house"
OPENROUTER_API_KEY=... npx tsx scripts/bench.ts --live --runs 3
```

```ts
import { extract, JevBackend } from './src';

const out = await extract('We got married in June. I am 42 and I live in Colorado.', {
  backend: new JevBackend(process.env.OPENROUTER_API_KEY!),
});

out.facts;  // [{ status: 'complete', path: '/filer/filingStatus', value: 'mfj', p: 0.99 }, ...]
out.needs;  // [{ path: '/filer/lastName', why: 'a personal name: ... never a string ...' }, ...]
```

## What it does

Sixteen writable filer and spouse fact paths, spelled the way the preparation
engine declares them. For each one the spike records **how** it can be filled,
and that classification turned out to be the most useful thing in here.

| how | count | paths |
|---|---|---|
| the model decides | 4 | filing status, filer blind, spouse blind, state of residence |
| a regex reads a literal | 3 | age, SSN, ZIP |
| nothing here can do it | 9 | both names, spouse name and SSN, spouse age, street, apt, city |

## Findings so far

Measured live through OpenRouter against `typesafe/jev-1.13`, 2026-09-22.
One call is **~400ms, 857 input tokens, $0.000036**. The whole 20-fixture
sweep, three runs each, costs **$0.0022**.

**1. The corpus picks the gate, and the first guess was wrong.** 60 calls
cached, then replayed offline at every threshold so the sweep measures the
threshold rather than run-to-run noise:

```
gate     correct  wrongVal  missed  overreach   flaky
0.500         97         0       5          4    2/20
0.700         96         0       6          0    0/20
0.800         96         0       6          0    0/20
0.900         96         0       6          0    0/20
0.950         96         0       6          0    0/20      <- chosen
0.980         90         0      12          0    0/20
0.990         83         0      19          0    1/20      <- first guess
0.995         72         0      30          0    0/20
```

**`wrongValue` is zero at every threshold.** When this thing produces a fact,
the value has never once been wrong. Everything the gate controls is the
trade between answering and abstaining, which is the safe direction to be
uncertain in.

Overreach appears only at 0.5 and disappears by 0.7. The plateau from 0.7 to
0.95 is flat, so **0.95 is the most conservative setting that costs nothing.**
The original 0.99 throws away 13 correct facts and starts flapping, because
confidence is quantized to 0.01 and 0.99 lands on a rounding boundary.

**2. Thresholds must be measured, not chosen.** Both numbers in this harness
were picked by taste and both were wrong. The gate, above. And the in-domain
screen, which aborts when the text does not read as a tax situation:

| text | in-domain score |
|---|---|
| a cake recipe | 0.01 |
| a sales-tax question about an invoice | 0.17 |
| "My SSN is 123-45-6789 and my ZIP is 80202. Single filer." | **0.39** |
| a real question about qualified business income | 0.53 |
| "I'm single, no kids, 29 years old." | 0.74 |
| a long narrative with distractors | 0.85 |

The separation is real, but the original 0.5 cut sat *inside* the in-domain
cluster and silently rejected a legitimate filer sentence. The floor now sits
at 0.3, between the two clusters.

**3. Confidence is not reproducible at the boundary.** Eight identical runs of
one sentence: inferring Colorado from "Denver" cleared a 0.99 gate 5 times out
of 8, while both `noul` answers were identical to three decimals every time.
The model is not uniformly noisy - the variance is concentrated exactly at the
decision boundary. This is why the gate sits on a plateau rather than near a
cliff.

**4. The model can only fill a quarter of the target paths.** It returns a
choice, a score or a probability, and never a string. So every name, street and
city is out of reach by construction. A prose-to-facts library is a hybrid of
three mechanisms and the decision model is the smallest by path count.

**5. Silence is not the complement of certainty.** An unmentioned fact comes
back at 0.02 to 0.03, never 0. Defining ambiguity as `noul > 1 - gate` labelled
every silent fact ambiguous and buried the real gaps. Ambiguity is a middle
band with its own floor.

**6. Two fixtures were wrong and the model was right.** It refused to infer
residence from "donated a car to a charity in Salt Lake City", because the city
belongs to the charity and not to the filer. Worth stating plainly: on this
corpus the extractor never asserted a wrong value, while the corpus author did.

**7. Rewording a criterion did not help.** "I am legally blind and I file on my
own" returns `not_stated` for filing status at 0.93. Expanding the `single`
criterion to mention filing alone moved nothing at 0.95. A genuine model limit,
not a prompt problem - recorded because negative results about prompt tuning
are worth as much as positive ones.

**8. The gate refuses correctly when it should.** "I got married in June" gives
`mfj` at 0.63 against `not_stated` at 0.37. Married is implied; joint versus
separate genuinely is not. The path comes back as needed, with its options and
its citation.

**9. Numbers never come from the model.** The vendor documents it as not a
calculator and as reading dates as text. Age is read deterministically, and so
would money and dates be. The regex deliberately refuses a future age ("I turn
65 in November") and a bare number after a comma ("Single, 34") - the second is
a known miss, and the safer failure.

**10. OpenRouter preserves the native shape exactly.** Same `probabilities`,
same `confidence`, plus a `cost` field, with a request body identical to
TypeSafe's own. `POST /v1/systemone` and `POST /alpha/decisions` both answer;
`/v1/chat/completions` rejects the model outright. Jev is absent from
`GET /v1/models`, so discovery by list-walking misses it.

**11. This route is currently the only one.** TypeSafe paused new signups on
2026-09-22 at 06:19 UTC, citing demand and GPU supply. Existing keys keep
working and gateways are unaffected.

**12. Do not use the official JS SDK.** It echoes the full API key into
exception messages, which then land in logs, and it is a version behind the
Python client. The API is two endpoints, so this uses `fetch`.

## Open questions this spike has not answered

- Whether 20 fixtures is enough to trust a threshold. The plateau is wide,
  which is reassuring, but the corpus is small and written by one person.
- Whether a second engine behind the same interface lands on the same plateau.
  If it does not, the gate is a property of the model rather than of the task.
- Everything past the filer. 616 writable paths exist; this covers 16.
- Whether a second backend behind the same interface produces comparable
  answers. The interface is here; the second implementation is not.

## Layout

```
src/types.ts    wire shapes, the backend interface, the three-valued result
src/jev.ts      the backend, hand-rolled fetch, TypeSafe or OpenRouter
src/paths.ts    the sixteen paths and how each can be filled
src/extract.ts  the abstention harness
src/score.ts    fixture scoring, four outcomes kept separate
fixtures/       20 cases: prose in, expected facts and required abstentions
tests/          runs without an API key
scripts/spike.ts  one live call, prints what came back
scripts/bench.ts  the gate sweep; --live to refresh the cache
scripts/probe-openrouter.ts  which endpoints answer, and with what shape
```

## Disclaimer

This does not provide tax advice and is not a substitute for a qualified tax
professional. It is a spike, it has not been audited, and it must not be used
to prepare a real return. It is not affiliated with, endorsed by or connected to
TypeSafe AI or the IRS.
