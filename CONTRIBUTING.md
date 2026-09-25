# Contributing

The most valuable contribution is **one test case**: a sentence a taxpayer
might write, and what it does and does not determine.

You do not need to write TypeScript, clone anything, or install anything.
[Open an issue](../../issues/new?template=fixture.yml) and fill in the form. A
maintainer turns it into a fixture.

## What we are looking for

**Cases we get wrong.** Not cases you invented to be clever, but shapes you
actually see: how people describe a separation, a part-year move, a dependent
who was there for some of the year, a death in the family. The corpus is
currently 59 cases written by one person who does not prepare returns for a
living. That is its biggest weakness and you are the fix for it.

Two kinds are equally welcome, and the second is rarer and more useful:

- a sentence where a fact **is** determined and we miss it
- a sentence where a fact is **not** determined and we assert it anyway

## The one hard rule

**Every case must be invented.** Never paste a real client's words, name, SSN,
EIN, address or anything traceable to a person. The corpus is public domain and
will be copied. Any case that looks like it came from a real return will be
closed without discussion.

## Every case needs an authority

An IRC section, a form line, a Rev. Proc., a publication. "Is this eval
interesting?" cannot be reviewed at volume. "Does the cited authority say what
you claim?" can. The citation is what makes a case checkable by someone who did
not write it.

This is why we do not accept cases that rest only on the contributor's
judgement, and it is the one place we differ from most benchmark repos.

## Machine-written cases

**Say so if a model helped you.** We will take it, provided you verified the
authority yourself and the confirmation box is honest.

An unverified machine-written case is the failure mode that would quietly
destroy this corpus, because a model that generates the test and a model that
takes the test share the same blind spots. A case nobody checked is worse than
no case.

## Sign-off

We use a [DCO](https://developercertificate.org/), not a contributor licence
agreement. Add `-s` to your commit:

```bash
git commit -s -m "fixture: part-year move between two states"
```

That is an assertion you can make yourself. A CLA is an IP assignment your
employer's risk function would have to approve, which for a licensed
practitioner is a different and much larger ask.

## If you do want to touch the code

```bash
pnpm install
pnpm test                                 # no API key needed
npx tsx scripts/bench.ts --engine jev     # re-scores published data, free
```

`pnpm lint`, `pnpm check-types` and `pnpm test` all run in CI, along with the
benchmark re-score, so you see the same numbers a reviewer does.

Adding a fact path means touching `src/paths.ts`, and deciding which of three
mechanisms fills it: the model, a regex, or neither. Read the table at the top
of the README first - the model cannot return a string, so a surprising number
of fields are out of its reach by construction.

## What we will not merge

- A case built from real taxpayer data.
- A case with no authority.
- A change that makes the extractor assert more without evidence that the
  assertions are right. Silence is the recoverable failure here; a confident
  wrong fact becomes a number on a return.
- A new dependency, unless it carries real weight. The runtime currently has
  none.

## Response time

This is maintained alongside other work. We aim to respond to a fixture issue
within a week. If contributions outpace the time to review them properly, we
will say so in the README and stop accepting rather than let a queue rot -
which is what has happened to most community benchmark corpora.
