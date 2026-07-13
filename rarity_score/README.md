# Rarity Score

Scores the rarity of a Miwake recognition target on a fixed scale from `0` (most common) to `100` (rarest). Scores are primarily intended for sorting recognition targets from common to rare. This is a corpus-frequency heuristic, not a percentile, probability, or linear measure of difficulty.

```ts
import { scoreRecognitionTarget } from "rarity_score";

const rarity = await scoreRecognitionTarget("身内");
```

## Scale

Corpus frequencies are expressed on a base-10 logarithmic Zipf scale, then mapped linearly from Zipf `6.5` at rarity `0` to Zipf `-1.5` at rarity `100`. Results outside those endpoints are clamped. Every 12.5 rarity points therefore represents a tenfold frequency difference.

| Rarity |        Approximate frequency |
| -----: | ---------------------------: |
|    `0` |          once per 316 tokens |
|   `25` |       once per 31,600 tokens |
|   `50` | once per 3.16 million tokens |
|   `75` |  once per 316 million tokens |
|  `100` | once per 31.6 billion tokens |

The endpoints make the score convenient for sorting frequencies spanning many orders of magnitude. Their numeric values should not be interpreted as saying, for example, that a score of `50` is of median rarity.

## Combining corpora

The scorer consults two complementary sources. NWJC measures exact surface forms in a very large web corpus, while BCCWJ supplies long-unit lemma frequencies from a smaller balanced corpus. Each frequency is converted to occurrences per billion tokens before its Zipf value is calculated.

When both sources contain a target, the scorer uses the higher frequency estimate, producing the lower rarity score. In other words, a target is considered rare only when neither corpus provides evidence that it is common. This avoids making ordinary expressions appear rare merely because one corpus tokenizes them into multiple units, while retaining NWJC's coverage of web vocabulary and surface forms.

This rule is a conservative frequency heuristic, not an attempt to merge the corpora into a single statistical population. Targets absent from both sources return `null` instead of being assumed maximally rare.

Corpus provenance and resource setup belong to the [`data` package](../data/README.md).

Run the package's resource-independent unit tests with `deno test -P rarity_score`.
