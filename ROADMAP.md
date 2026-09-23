# Roadmap

Public on purpose. Most rejected open-source contributions fail because nobody
outside could see what the project wanted, so this file is the answer to "would
you take this?"

## Now

- **Widen the corpus.** 59 cases written by one person is the weakest part of
  every claim here. Cases from people who prepare returns for a living are the
  single most valuable contribution, and the one thing we cannot write ourselves.
- **Third-party attribution.** Every engine tested fails the same case: someone
  writing in the first person about a client. Probably fixable by asking whose
  facts these are before asking what they are, rather than by tuning.

## Next

- **Past the filer.** 616 writable fact paths exist in a real preparation
  engine; this covers 16. W-2, 1099-NEC, 1099-INT, 1099-DIV and dependents are
  the obvious next families.
- **A two-level router.** Above roughly 255 options a single choice stops being
  possible, so picking the fact family and then the path within it.
- **Fitted calibration.** A flat threshold is the simplest thing that works.
  Independent work suggests a regression fitted on labelled data does better.

## Not planned

- **Computing tax.** This layer produces facts. Engines that turn facts into a
  return already exist and are better than anything we would write.
- **Reading documents.** A W-2 is a different problem with different tools.
  This reads what a person writes.
- **Being a chatbot.** No conversation, no generation. Text in, typed facts out.

## Deliberately undecided

- Whether this becomes a supported library or stays a published experiment.
  That depends on whether the corpus grows.
