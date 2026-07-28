---
name: animecard-failure-report
description: Produce concise, remediation-oriented Markdown reports from Animecards conversion manifests and audit artifacts. Use when reviewing an Animecards dry run, inventorying unconverted sourced cards, or explaining why individual notes failed without dumping generated card fields and contexts.
---

# Animecard Failure Report

Turn the converter's machine-oriented artifacts into a short engineering backlog. The reader should understand the failing invariant, likely cause, and next action for every relevant note.

## Workflow

1. Locate the latest manifest and its generated audit artifacts under `anki_updater_prototype/generated/`.
1. Exclude successfully applied notes and cards whose only blocker is the intentionally empty/no-source queue, unless the user asks for them.
1. Correlate each remaining note across `candidates`, `skipped`, resolution objects, and report details. Inspect source EPUB or JMDict data when the recorded error is not self-explanatory.
1. Group notes by shared root cause and remediation, not by pipeline stage alone. Useful groups include deterministic code bugs, retryable AI output, EPUB matching, pending JMDict data, multi-reading support, upstream furigana data, and malformed Animecards.
1. Write the report to a descriptive ignored path under `anki_updater_prototype/generated/`.

## Content Rules

- Start with a compact count of unresolved sourced notes and category totals.
- Give each note a heading containing the recognition target and Anki note ID.
- State the exact failed invariant or error. Never write only “generated fields failed deterministic validation.”
- Follow with the diagnosis and concrete next action in one or two short paragraphs or bullets.
- Include a context excerpt, source location, candidate entry list, or generated value only when it explains the failure.
- Distinguish observed facts from inferences.
- If the cause is unknown, say what was checked and what evidence is still missing.
- Prefer one shared explanation plus a compact note list when several notes have the same cause.

## Omit

- Successful or already-applied conversions.
- Full generated card payloads, dictionary HTML, source metadata, and before/after fields that do not explain a failure.
- Giant tables. Use prose headings and short bullets so the report remains readable without horizontal scrolling.
- Vague dispositions that merely restate the status.

## Final Check

Verify that every included note answers:

- What exact condition failed?
- Why is it believed to have failed?
- Is the next action code, retry, JMDict, multi-reading, upstream data, or a manual Animecard repair?
