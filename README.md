# taxfacts

**Spike.** Turn a taxpayer's own words into typed tax facts, using a System One
decision model for the semantic routing and nothing else.

This repository exists to find problems early. It is not a library yet, it is
not published, and the findings below are the point of it.

```bash
pnpm install
pnpm test                                    # no API key needed
TYPESAFE_API_KEY=... pnpm spike "I got married in June and bought a house"
```

```ts
import { extract, JevBackend } from './src';

const out = await extract('We got married in June. I am 42 and I live in Colorado.', {
  backend: new JevBackend(process.env.TYPESAFE_API_KEY!),
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

**1. The model can only fill a quarter of the target paths.** It returns a
choice, a score or a probability. It cannot return a string, ever. So every
name, street and city is out of reach by construction, not by omission. A
prose-to-facts library is therefore a hybrid of three mechanisms, and the
decision model is the smallest of the three by path count. This is the finding
that most changes the shape of the real thing.

**2. Abstention has to be built.** The model never refuses. An independent
pre-registered run fed it thirty out-of-scope inputs and it flagged none of
them, scoring a cake recipe at 0.94 and random letters at 0.97. Its confidence
is also uninformative between 0.50 and 0.95. So this spike adds three layers
the model does not provide: an explicit `not_stated` option on every choice, a
confidence gate at 0.99, and an in-domain screen before anything is asked.

**3. Silence and uncertainty are different answers.** A confident `not_stated`
means the text genuinely does not say, and the path is simply absent. A
low-confidence anything means we could not tell, and the path goes to `needs`
with its citation and its option list. Collapsing the two would be the easiest
way to make this dangerous.

**4. Numbers never come from the model.** The vendor documents it as not a
calculator, and as reading dates as text rather than as ordered quantities. Age,
SSN and ZIP are read deterministically here, and money and dates would be too.

**5. The published error codes are wrong.** A missing key returns 403 where the
spec says 401, and body validation returns 400 where it says 422. The client
here branches on the number and never on a documented error name.

**6. Do not use the official JS SDK.** It echoes the full API key into exception
messages, which then land in logs, and it is already a version behind the Python
client. The API is two endpoints, so this uses `fetch`.

## Open questions this spike has not answered

- Whether the 0.99 gate is right for tax work, or whether it abstains so often
  the output is useless. That needs a labelled corpus, which is next.
- What the model does with a long narrative rather than one sentence. Accuracy
  is documented to degrade as irrelevant detail grows.
- Whether a second backend behind the same interface produces comparable
  answers. The interface is here; the second implementation is not.

## Layout

```
src/types.ts    wire shapes, the backend interface, the three-valued result
src/jev.ts      the one backend, hand-rolled fetch
src/paths.ts    the sixteen paths and how each can be filled
src/extract.ts  the abstention harness
tests/          runs without an API key
scripts/spike.ts  one live call, prints what came back
```

## Disclaimer

This does not provide tax advice and is not a substitute for a qualified tax
professional. It is a spike, it has not been audited, and it must not be used
to prepare a real return. It is not affiliated with, endorsed by or connected to
TypeSafe AI or the IRS.
