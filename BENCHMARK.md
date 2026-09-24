# Benchmark method

Every response we measured is committed under `bench-data/`. You can reproduce
every number in the README with no API key and no network:

```bash
npx tsx scripts/bench.ts --engine jev
npx tsx scripts/bench.ts --engine flash-lite     # gemini-2.5-flash-lite
npx tsx scripts/bench.ts --engine flash          # gemini-2.5-flash
npx tsx scripts/bench.ts --engine flash-3.8      # gemini-3.8-flash
npx tsx scripts/bench.ts --engine sonnet-5-direct
npx tsx scripts/bench.ts --engine opus-5-direct
```

To re-measure against the live APIs, `--live --runs 3` and an
`OPENROUTER_API_KEY`. The full sweep across three engines cost $0.32.

## The question this measures

Not "which model is smarter". **Given a sentence a taxpayer wrote, which model
can be trusted to say what it does not know?**

That is a different question from accuracy, and the two come apart. The most
accurate engine here is also the one that asserts the most things the text
never said.

## The corpus

59 cases in `fixtures/`. Each is a sentence plus two lists:

- `expect` - facts the sentence **does** determine, with their values. Failing
  to produce one is a **miss**. Producing it with the wrong value is a
  **wrong value**.
- `abstain` - facts the sentence does **not** determine. Producing one at all
  is an **overreach**.

106 expected facts and 42 required abstentions, so **72% of the judgements
reward answering and 28% reward refusing.**

That balance is deliberate and it is the first thing to check if you are
suspicious of the result. A corpus weighted toward ambiguity would hand the win
to whichever engine abstains most, regardless of whether it is right to. This
one is weighted the other way, against the conclusion it reaches.

Three groups:

1. **Stated plainly.** Filing status, age, state, blindness, given directly or
   with mild indirection ("I've lived in Boise my whole life").
2. **Traps.** A plausible wrong value is present and adjacent: a sibling's
   state, an employer's headquarters, a spouse's age where the filer's is
   absent, a deceased spouse, a hypothetical marriage, an EIN shaped like an
   SSN, a phone number containing a five-digit run, a prior year's filing
   status stated before the current one, and text that instructs the extractor
   instead of describing a taxpayer.
3. **Genuinely undetermined.** Married but no method chosen, "I live in
   Portland" with no state, a doctor raising the possibility of legal
   blindness, a move that has not completed.

Plus out-of-domain text that should be refused outright.

Every case is synthetic. See `fixtures/LICENSE`.

## What is compared

| engine | lab | route |
|---|---|---|
| `typesafe/jev-1.13` | TypeSafe | OpenRouter |
| `google/gemini-2.5-flash-lite` | Google | OpenRouter |
| `google/gemini-2.5-flash` | Google | OpenRouter |
| `google/gemini-3.8-flash` | Google | OpenRouter |
| `claude-sonnet-5` | Anthropic | direct |
| `claude-opus-5` | Anthropic | direct |

Jev is a decision model: it returns a probability distribution over a
caller-supplied option set and cannot emit a string. The other five are general
models asked for the same distributions under a strict schema.

All six receive the same questions, the same option lists and the same criteria
text. **The route is not common**, so latency and cost are not compared - see
Limitations.

## Making the comparison fair

**One confidence scale.** Jev reports a chance-corrected confidence. We
recovered the formula from its responses - a choice at p=0.63 over 6 options
reports 0.55, and p=0.99 over 52 reports 0.98, both of which fit
`(p_max - 1/K) / (1 - 1/K)` - and compute it identically for the general
models. Without this a single threshold would mean different things on
different scales and the comparison would be meaningless.

**Verbalized probabilities, not logprobs.** The general models are asked to
emit a probability per option under a strict schema. This is the approach
TypeSafe's own reference adapter takes. Token logprobs would be a different and
arguably fairer test, and are not done here - see Limitations.

**Cached, then swept offline.** Each engine is called once per case per run,
the raw responses are stored, and the thresholds are applied afterwards. This
matters: confidence moves between identical calls, so re-calling at each
threshold would measure that drift rather than the threshold.

**Three runs per case**, because an early measurement found the same input
could flip a fact between runs. The `flaky` column counts cases whose fact set
was not identical across all three.

## Scoring at each engine's own threshold

A single shared threshold measures how well an engine happens to be calibrated
to that number, not how well it does the task. So the headline table gives each
engine **the threshold that keeps the most facts** subject to two constraints
it must satisfy: zero wrong values, and an over-assertion budget stated up
front.

Two budgets are reported, 3 and 0, because they select different winners and
publishing only one would be a choice disguised as a measurement.

The full sweep is still printed by the harness, and reading an engine's
over-assertion column down that sweep is how you tell whether its threshold
does anything at all. Gemini 2.5 Flash and Flash-Lite are flat across the
entire range; every other engine moves.

## The sweep

Eight thresholds from 0.50 to 0.995. Four outcomes, deliberately not collapsed
into one score:

- **correct** - an expected fact, produced, right value
- **wrong value** - an expected fact, produced, wrong value
- **missed** - an expected fact, not produced
- **overreach** - a fact the corpus says is not determinable, produced anyway

`missed` and `overreach` are not symmetric and should never be averaged
together. A missed fact becomes a question put to the client. An overreach
becomes a number on a return that nobody was asked to confirm.

## Limitations

**One author.** Every judgement about what a sentence determines is one
person's, and that person does not prepare tax returns for a living. This is
the largest threat to the result and the reason the corpus is the first item on
the roadmap.

**59 cases is small.** Differences of a few counts are not meaningful. The
findings that survive are the large ones: zero versus nine wrong values, three
versus twelve or twenty-one overreaches, and a threshold that moves one engine
and not the others.

**Six engines, three labs**, but one family per lab beyond Gemini. An earlier
version of this document drew a conclusion about model class from two Gemini
models; adding a third Gemini and two Anthropic models refuted it. Treat any
remaining generalisation here the same way.

**Anthropic rejects `temperature`** on these models as deprecated, so those two
are the only engines not running greedy. That is the likeliest source of the
run-to-run variance they show, and it means their non-determinism column is not
strictly comparable with the others.

**Anthropic's schema constrains property keys** to `^[a-zA-Z0-9_.-]{1,64}$`, so
fact paths are flattened on the wire for those two engines and mapped back
before scoring. The question text, options and descriptions are unchanged.

**Cost and latency are not compared.** Providers report cost inconsistently -
Anthropic returns token counts and no price - and two engines call the origin
while four go through a gateway. Any per-call figure would not be like for
like, so none is published.

**Verbalized probabilities are not the only option.** Constrained decoding with
token logprobs might give the general models a better-calibrated signal. If it
does, that changes the conclusion and we would like to know.

**One task.** Sixteen filer-level fields. Nothing here says anything about how
these models behave on document classification, routing, or anything else.

**The prompt was not tuned per engine.** Each gets the same criteria text.
Tuning per model would likely help all three and would make the comparison less
clean.

**Independent benchmarks disagree on the general question.** Published work
this month puts a frontier general model ahead of this decision model on both
accuracy and calibration error. That is consistent with what we found -
the general model here is the most accurate. What we measured is different:
whether the confidence number is usable as a threshold. On this task it is for
one engine and not the others.

## Reproducing, extending, disputing

The harness is about 500 lines. If you think the corpus is loaded, the
thresholds are chosen to flatter, or the schema disadvantages the general
models, the data is in `bench-data/` and the scorer is in `src/score.ts`.

Open an issue with a case we get wrong. That is worth more to us than agreement.
