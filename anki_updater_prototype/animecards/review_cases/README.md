# Context-selection review cases

These are potential future eval inputs, not executable fixtures or converter overrides. The accepted contexts illustrate the user's policy; exact wording is not a universal target.

## Full context policy

Normally retain the full source sentence containing the target as a natural usage example. A learner who knows the word should understand why the sentence could appear in a book. They need not reconstruct the dictionary definition, identify every referent, or understand the surrounding story. Expand only in rare cases where an utterance genuinely needs adjacent text, such as an interjection or fragmentary dialogue reply needing the preceding exchange. Long sentences stay intact in Full context and can be shortened separately in Minimized context.

## 2026-10-04: 『辞書を編む』

`context-repairs-2026-10-04.json` records 13 manually reviewed cards: 12 held after the normal pipeline and one ambiguous source-location choice (未詳). **All 13 work with single-sentence Full contexts.** Most original pipeline contexts were already adequate; the manual review mistakenly demanded explanatory context. These are primarily negative examples for over-expansion, not failures to retrieve enough source material.

- 吉報は突然にもたらされました。 is sufficient for 吉報. The news itself need not be explained. The initial claim that this required a cross-chapter source window was wrong.
- 南米 and 生息地 retain their full original sentence, without the following sentence identifying the animal as a capybara. Only the long sentence needs minimization.
- 人相学, 法令遵守, 愚直, 固有名詞, 徹底, 見識, 粉末, and できばえ do not need the added term identification, causal premise, question, dictionary-policy explanation, product identity, or publication announcement. Their original sentences show natural usage.
- この要素は、他のことばにも見出だされます。 is sufficient for 見出だす. Defining この要素 is not necessary to illustrate the verb. The previous claim that the shorter minimization lost a necessary antecedent was wrong.
- 未詳 uses the selected explanatory source occurrence, but only the complete sentence ただし、「語源未詳」とあるのは残念です。 It does not need to identify which word has an unknown etymology.

Only 南米, 生息地, and できばえ currently retain Minimized context. The others use their complete source sentence without a separate minimized version.

## Using the records

Each case includes the original Animecard excerpt, pipeline outputs, broader semantic evidence, current accepted fields, rendering input, rationale, and the excessive manual version for comparison. `pipelineFullContext` and `pipelineMinimizedContext` are observations, not automatic failures. `overexpandedManualFullContext` records an agent mistake, not reference ground truth. Earlier provisional manual judgments have been superseded by the user's clarification.

Source paragraphs retain cleaned HTML, including ruby, with zero-based paragraph indexes among all `<p>` elements of their XHTML file. `selectedHTML`, when present, identifies the currently selected portion; other paragraphs are available evidence, not instructions to include them. 見出だす has the original excerpt and broader evidence rather than a separately recorded source location.

The normal run used Gemini 3.6 Flash for full-context selection and Claude Opus 5 at low effort for minimization. `priorSemanticEvidence` is enrichment evidence, not necessarily the exact input window submitted to context selection. Do not conflate semantic-selection evidence with what must be displayed.

Useful evaluation criteria are natural target usage, verbatim Full context, preservation of sentence boundaries and ruby, and avoidance of unnecessary expansion. Manual minimized contexts are reviewed rewrites, not source quotations or outputs from the normal AI operation. Operational backups remain under ignored `generated/`; these files are research notes only.
