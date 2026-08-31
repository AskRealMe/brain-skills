# Writing contract

Use this contract when deciding what belongs in an AskRealMe brain and when
writing its public pages.

## Unit of an answer

Every useful answer pairs one reproducible practice with the real incident that
produced it.

- A practice without an incident becomes unsupported generic advice.
- An incident without a usable practice remains an anecdote.

The practice contains:

1. the action rule: what the owner does or avoids;
2. the tool and method: what they use and how they use it;
3. the decision test: how they verify the result and when they trust it.

The incident reconstructs, when supported:

- what work was delegated;
- which tool performed it;
- when and how the owner checked it;
- what the owner expected and what actually happened;
- the cause established by the source;
- how long recovery took.

## Precision

Cards preserve the maximum source precision, including timestamps and commit
identifiers. Public answers lower that precision to how a person would naturally
recall the event several days later.

| Detail | Public answer | Too vague | Too precise |
|---|---|---|---|
| Time | time of day and approximate hour | "at night" | `03:12:47` |
| Duration | nearest half hour | "for a while" | `147 minutes` |
| Work | feature or screen | "a feature" | function and file names |
| Symptom | what the user observed | "it was broken" | stack trace and error code |
| Cause | one supported causal sentence | no cause | diff narration |
| Tool | product name | "the AI" | model ID and version |

Never increase precision. If the source says only "at night," do not invent an
hour.

Workflow details are the exception. A reusable prompt structure, approval
sequence, or verification loop is something the reader may copy. Restate it in
structured prose with the supported goal, repetition condition, time contract,
validation, and stopping condition. Do not quote the user's original wording.

## Evidence and voice

- Use only facts found in approved source material.
- Preserve who performed each action. Do not attribute AI or third-party work
  to the brain owner.
- A later method does not prove that an earlier method failed.
- Do not combine separate rejections into one broad principle unless the owner
  actually expressed that principle.
- When a required detail is unknown, omit it or state the bounded unknown.
- Product and tool names are useful evidence; write them accurately.
- Explain an internal project name on first use and include it only when the
  incident would otherwise be unclear.

## Public-safety filter

The output may be read by strangers. Preserve the useful technique and facts,
but omit or neutrally reframe material that could unfairly harm the owner:

- self-deprecation, insults, profanity, or emotional outbursts;
- confessions framed as laziness, neglect, or recklessness;
- motives that read as vanity without changing the practical lesson;
- disparaging claims about another person or company;
- copied third-party conversations or identifying details.

Ask whether the sentence would be fair and useful if read by a hiring manager.
Neutral reframing must not change the underlying fact.

## Deliverable voice

The brain is the product. Its pages describe experiences, findings, and usable
practices. They do not narrate how the files were generated, which alternatives
were discarded, or what the producing agent plans to do next.
