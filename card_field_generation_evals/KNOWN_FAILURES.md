# Known focused-operation failures

This file records active limitations that are not adequately represented by a passing output validator or aggregate score. Resolved predecessor failures live in the eval fixtures rather than accumulating here. The predecessor review log is preserved verbatim at [`archive/card_creator_evals/KNOWN_FAILURES.md`](archive/card_creator_evals/KNOWN_FAILURES.md) so fixture provenance remains auditable.

## Acquisition policy

### タイト

JMDict entry 1075880 sense 1 covers both a physically close-fitting garment (`このスカートはタイトで動きにくい`) and a packed schedule (`今日はスケジュールがタイトな一日だ`). Focused sense selection truthfully selects the same sense for both, while hint generation only runs after acquisition policy has decided that a same-spelling contrast exists. The current pipeline therefore cannot detect that this broad single sense still needs an association-level hint or defer decision.

## Hint generation

No unresolved hint-generation issue is recorded here.
