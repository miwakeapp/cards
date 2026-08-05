# Current production model baseline

The current defaults were selected on 2026-07-29 after agents iterated on the tracked development corpus and adjudicated every novel output. This was an engineering study, not a fixed public leaderboard: fixtures and prompts improved during the work, so only runs made against the same prompt and fixture revision are directly comparable. A small blinded user-preference worksheet subsequently found two actionable gaps and one subjective minimization disagreement; the actionable cases now have deterministic or eval regressions. The settings remain an engineering baseline rather than a statistical estimate of user satisfaction.

## Selected configurations

- **Sense selection:** GPT-5.6 Sol at medium reasoning. It was the most reliable at retaining every genuinely applicable sense without collapsing related-but-distinct senses or over-selecting a sense merely evoked by the context.
- **Additional-reading selection:** GPT-5.6 Sol at medium reasoning. It reproduced all five initial user-reviewed decisions, including retaining both common readings of `日本`, omitting the uncommon alternatives on the three corrected live cards, and retaining `あす` but not formal `みょうにち` for casual `明日`. Gemini 3.6 Flash at medium reasoning matched four of five but retained `みょうにち`.
- **Hint generation:** GPT-5.6 Sol at medium reasoning. It was the most consistent at preserving source participants, voice, relationships, spelling, and modality while producing a short phrase. Lower-cost models more often invented generic collocations or copied an unhelpfully long or inflected fragment.
- **Context minimization:** Claude Opus 5 at low effort. In the agent-adjudicated comparison it was the most dependable at retaining antecedents, comparison frames, and necessary adjacent sentences while removing narrative framing. Higher effort did not justify its extra cost on those development cases.

The comparison work included Gemini 3.5 Flash Lite, Gemini 3.6 Flash, Claude Haiku 4.5, Claude Sonnet 5, Claude Opus 5, GPT-5.6 Luna, GPT-5.6 Terra, and GPT-5.6 Sol at multiple supported effort levels. Early broad samples were followed by focused comparisons on disagreements and known failures. The engineering choice favors agent-assessed quality over the cheapest acceptable model because a subtly wrong hint or context is durable learning material.

## Historical development back-test

The historical corpus revision evaluated here contained 232 cases: 89 sense selections, 92 hints, and 51 context-minimization decisions. Exact prompt few-shots remain visible in reports but are excluded from basis-specific metrics. The remaining cases were still development data: known failures shaped the prompts, models were selected on the same corpus, and several references were revised during model review. The current fixture counts live in `README.md` and may grow independently of this frozen historical result.

The following results describe the historical prompt and fixture revision with fixture-set hash `bac7404579fca07a679e10c8f9215e27632fc66d592d0dc5e0f9234b9c053b15`. They are development-reference agreement, not estimates of generalization or user satisfaction:

- Context minimization agreed with the agent-reviewed minimize/keep disposition on 23/23 non-prompt-overlap cases, with 17 exact illustrative-reference matches. It replayed 19/19 corpus dispositions, with 12 exact illustrative-reference matches. No result reproduced a recorded bad context.
- Hint generation agreed with the agent-reviewed generated/not-needed/source-insufficient disposition on 78/78 non-prompt-overlap cases. Of the generated hints, 57 exactly matched a preferred reference, seven matched an acceptable-but-suboptimal reference, and none were novel or recorded bad outputs.
- Sense selection exactly matched 23/23 agent-reviewed, non-prompt-overlap outcomes. It replayed 29/45 corpus outcomes; this separately reported replay evidence was not independently adjudicated.

The only unresolved limitation in the current agent-maintained log is the broad single-sense `タイト` case described in `KNOWN_FAILURES.md`. Its two associations cannot be recovered by a hint operation that is only invoked after acquisition policy has found a lexicographic contrast. This is not a claim that user review would find no other limitations.

## Final candidate validation

The final hint and minimization prompts received complete production-model runs on the expanded corpus. The sense prompt received a complete run immediately before one narrow discourse-act clarification, followed by a 30-case stratified run of the final prompt. These remain development-corpus measurements, but they verify structural reliability, retry behavior, cost, and agreement with explicitly labeled references:

- Context minimization completed 55/55 cases with eight corrective retries at an estimated $0.222724. Among non-prompt-overlap references, its minimize/keep decision agreed with 37/39 agent-reviewed cases and 7/7 corpus-replay cases; no output exactly reproduced a recorded bad context.
- Hint generation completed 94/94 cases with three corrective retries and seven local result-cache hits at an estimated $1.371866. Among non-prompt-overlap references, operation disposition agreed with 3/3 user-reviewed and 76/78 agent-reviewed cases. Agent-reviewed generated wording produced 57 preferred exact matches, two acceptable exact matches, four novel validated outputs requiring review, and zero recorded-bad exact matches.
- Sense selection completed the then-current 92-case corpus without retries at an estimated $0.834176. Non-prompt-overlap exact agreement was 3/3 user-reviewed, 24/26 agent-reviewed, 32/43 corpus-replay, and 2/3 provisional. After the final discourse-act clarification, the stratified 30-case run completed without retries at an estimated $0.259478 and agreed with 4/4 user-reviewed, 19/22 agent-reviewed, 2/2 corpus-replay, and 1/2 provisional references. Two of its agent-reference disagreements were already present before the clarification; the third was a stochastic reversal on an unaffected case.
- Additional-reading selection completed its initial five-case corpus without retries. GPT-5.6 Sol at medium reasoning agreed with 5/5 user-reviewed decisions at an estimated $0.031115; Gemini 3.6 Flash at medium reasoning agreed with 4/5 at an estimated lower bound of $0.017763. The corpus is deliberately small and motivating, so this establishes behavior on the known cases rather than a generalization estimate.

The eight-answer blind worksheet matched exactly on both hints, one of two sense choices, one of two context minimizations, and neither of two contextual mark boundaries. The sense miss led to the general discourse-act rule and now passes without an exact few-shot. The two marking misses led to deterministic boundaries for attached `たり` and following desiderative `たい`; both now pass focused tests. The remaining minimization miss was a reasonable difference in how much supporting context to retain and did not justify prompt specialization. Four exact matches out of eight is not a benchmark, but the exercise usefully found defects that development-reference scoring had missed.

## Cost and caching

The saved development and comparison runs total approximately **$33.24 USD** at the checked-in standard list prices. This includes model exploration, prompt iteration, corrective reruns, the blinded-worksheet follow-up, and several full-corpus validations; it is not the cost of one production batch.

Two cache layers prevent paying for unchanged work:

- `card_field_generation` stores validated results under a content-addressed key covering the operation input, exact prompt, schema, model, and provider settings. Cached raw output is revalidated before reuse.
- Provider prompt caching keeps the stable instructions and few-shots in a reusable prefix: explicit five-minute caching for Anthropic, explicit thirty-minute caching for compatible OpenAI models, and Gemini's implicit caching. One representative full paid run reported 115,699 of 124,529 minimization input tokens, 529,074 of 590,836 hint input tokens, and 355,266 of 417,190 sense-selection input tokens as provider cache reads.

The historical 232-case rescore was 232/232 local result-cache hits, made zero provider attempts, completed in 0.3 seconds, and had an estimated API cost of $0.00. Exact prompt or fixture changes still create new semantic cache keys, while unchanged experiments remain free to replay locally.

## Re-evaluation policy

Change a production default only after running the same development fixtures with the candidate configuration and qualitatively adjudicating every novel result. Exact string agreement is diagnostic for hints and minimized contexts, not sufficient evidence of quality. New failures should first become agent-reviewed development fixtures, then prompt changes and model changes can be compared without losing the motivating example.

The 2026-07-30 preference worksheet is no longer a holdout: its hidden answers were revealed only after the prompt, model, and predictions were frozen, then used to improve the system. Those cases are now development evidence. Another blinded calibration would require newly selected cases whose answers have not influenced prompts, policies, fixtures, or model choice.
