# taxfacts

**Spike.** Turn a taxpayer's own words into typed tax facts, using a System One
decision model for the semantic routing and nothing else.

This repository exists to find problems early. It is not a library yet, it is
not published, and the findings below are the point of it.

```bash
pnpm install
pnpm test                                    # no API key needed
OPENROUTER_API_KEY=... pnpm spike "I got married in June and bought a house"
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
One call is **~400ms, 857 input tokens, $0.000036**.

**1. The gate is not reproducible, which is the opposite of what was promised.**
Eight identical runs of the same sentence:

| path | min | max | passed the 0.99 gate |
|---|---|---|---|
| `/filer/address/state` | 0.980 | 0.990 | **5 of 8** |
| `/filer/filingStatus` | 0.480 | 0.550 | 0 of 8 |
| `/filer/blind` | 0.020 | 0.020 | 0 of 8 |
| `/spouse/blind` | 0.030 | 0.030 | 0 of 8 |

Inferring Colorado from "Denver" is semantically trivial, and it lands on the
gate rather than above it, so **the same input produces a different fact set
across runs.** The model is not uniformly noisy - the two `noul` answers are
identical to three decimals every time. The variance is concentrated at the
decision boundary, which is exactly where it costs something.

The mechanism is quantization: confidence comes back rounded to 0.01, so a gate
at 0.99 sits on a rounding boundary and anything oscillating between 0.98 and
0.99 flips. Lowering the gate would fix the flapping, but independent work finds
Jev's confidence uninformative between 0.50 and 0.95, so the usable region and
the stable region barely overlap. **A hard threshold is the wrong instrument.**

**2. The model can only fill a quarter of the target paths.** It returns a
choice, a score or a probability. It cannot return a string, ever. So every
name, street and city is out of reach by construction, not by omission. A
prose-to-facts library is a hybrid of three mechanisms, and the decision model
is the smallest of the three by path count.

**3. Silence is not the complement of certainty.** An unmentioned fact comes
back at 0.02 to 0.03, never 0. The first version of this harness defined
ambiguity as `noul > 1 - gate`, i.e. above 0.01, which labelled every silent
fact ambiguous and buried the real gaps. Ambiguity is a middle band and needs
its own floor, here 0.1.

**4. The in-domain screen has almost no headroom.** A sentence that is
unambiguously about marriage, a house purchase and an age scored **0.76** on
"is this a tax situation". The screen aborts below 0.5, so it passed - but if
a clear case only reaches 0.76 there is little room left for a subtle one. This
needs calibration data before it can be trusted.

**5. The gate refuses correctly when it should.** "I got married in June"
yields filing status `mfj` at 0.63 against `not_stated` at 0.37, confidence
0.55. Married is implied; joint versus separate is genuinely undetermined. The
harness declines to guess and returns the path as needed, with its options and
its citation. That is the behaviour the design is for, and it fired on the
first real sentence.

**6. Numbers never come from the model.** The vendor documents it as not a
calculator, and as reading dates as text rather than as ordered quantities. Age
is read deterministically here, and money and dates would be too.

**7. OpenRouter preserves the native shape exactly.** Same `probabilities`,
same `confidence`, plus a `cost` field, and the request body is identical to
TypeSafe's own. `POST /v1/systemone` and `POST /alpha/decisions` both answer;
`/v1/chat/completions` rejects the model outright: *"typesafe/jev-1.13 is a
decisions model and cannot be used with the chat/completions endpoint."* Jev is
also absent from `GET /v1/models`, so model discovery by list-walking misses it.

**8. This route matters more than it looks.** TypeSafe paused new signups on
2026-09-22 at 06:19 UTC, citing demand and GPU supply. Existing keys keep
working and the gateways are unaffected, so **OpenRouter is currently the only
way a new user can reach the model at all.**

**9. Do not use the official JS SDK.** It echoes the full API key into
exception messages, which then land in logs, and it is a version behind the
Python client. The API is two endpoints, so this uses `fetch`.

## Open questions this spike has not answered

- What replaces the hard gate. Hysteresis, a band, repeated sampling, or a
  lower gate plus a second signal. This is now the main open design question.
- Whether abstention is so frequent the output stops being useful. Needs a
  labelled corpus, which is next.
- What the model does with a long narrative rather than one sentence. Accuracy
  is documented to degrade as irrelevant detail grows.
- Whether a second backend behind the same interface produces comparable
  answers. The interface is here; the second implementation is not.

## Layout

```
src/types.ts    wire shapes, the backend interface, the three-valued result
src/jev.ts      the backend, hand-rolled fetch, TypeSafe or OpenRouter
src/paths.ts    the sixteen paths and how each can be filled
src/extract.ts  the abstention harness
tests/          runs without an API key
scripts/spike.ts  one live call, prints what came back
scripts/probe-openrouter.ts  which endpoints answer, and with what shape
```

## Disclaimer

This does not provide tax advice and is not a substitute for a qualified tax
professional. It is a spike, it has not been audited, and it must not be used
to prepare a real return. It is not affiliated with, endorsed by or connected to
TypeSafe AI or the IRS.
