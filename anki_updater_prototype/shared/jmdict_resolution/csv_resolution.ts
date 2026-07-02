import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import {
  buildSpellingIndex,
  deriveLookupSpellings,
  findEntriesBySpelling,
  type SpellingIndex,
} from "./recognition_target_lookup.ts";

export interface CSVRow {
  sentence: string;
  source: string;
  recognitionTarget: string;
  jmdictId?: string;
}

export interface ResolvedRow {
  row: CSVRow;
  entry: JMdictWord;
  recognitionTarget: string;
}

export type ResolutionIssueReason =
  | "missing-jmdict-id"
  | "ambiguous-exact"
  | "ambiguous-derived"
  | "multiple-derived"
  | "candidate-no-jmdict"
  | "no-candidates";

export interface CandidateMatch {
  spelling: string;
  entries: JMdictWord[];
}

export interface ResolutionIssue {
  row: CSVRow;
  reason: ResolutionIssueReason;
  candidateSpellings: string[];
  candidateMatches: CandidateMatch[];
}

export interface ResolutionResult {
  resolved: ResolvedRow[];
  issues: ResolutionIssue[];
}

function entryHasSpelling(entry: JMdictWord, spelling: string): boolean {
  return entry.kanji.some((item) => item.text === spelling) ||
    entry.kana.some((item) => item.text === spelling);
}

function entryCanTakeSuru(entry: JMdictWord): boolean {
  return entry.sense.some((sense) =>
    sense.partOfSpeech.some((partOfSpeech) => partOfSpeech.startsWith("vs"))
  );
}

function entryIsExpression(entry: JMdictWord): boolean {
  return entry.sense.some((sense) => sense.partOfSpeech.includes("exp"));
}

function isNonSuruVerbPartOfSpeech(partOfSpeech: string): boolean {
  return partOfSpeech.startsWith("v") &&
    partOfSpeech !== "vi" &&
    partOfSpeech !== "vt" &&
    !partOfSpeech.startsWith("vs");
}

function entryHasNonSuruVerb(entry: JMdictWord): boolean {
  return entry.sense.some((sense) =>
    sense.partOfSpeech.some((partOfSpeech) => isNonSuruVerbPartOfSpeech(partOfSpeech))
  );
}

function shouldPreferSuruEntry(spelling: string, derivedSpellings: string[]): boolean {
  return derivedSpellings.includes(`${spelling}する`) ||
    derivedSpellings.includes(`${spelling}にする`);
}

function isSuruDerivedFromTarget(spelling: string, recognitionTarget: string): boolean {
  return spelling === `${recognitionTarget}する` ||
    spelling === `${recognitionTarget}にする`;
}

function hasContextBeyondTarget(row: CSVRow): boolean {
  return row.sentence !== row.recognitionTarget;
}

function isJapaneseTextCharacter(text: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]$/u.test(text);
}

function isHiragana(text: string): boolean {
  return /^\p{Script=Hiragana}$/u.test(text);
}

function isExpressionLeftBoundary(previousCharacter: string, spelling: string): boolean {
  const firstCharacter = spelling[0];

  return !isJapaneseTextCharacter(previousCharacter) ||
    ["は", "が", "を", "に", "で", "と", "へ", "も", "や", "の"].includes(previousCharacter) ||
    previousCharacter === "お" ||
    previousCharacter === "ご" ||
    (isHiragana(previousCharacter) && !isHiragana(firstCharacter));
}

function sentenceContainsExpressionSpelling(sentence: string, spelling: string): boolean {
  let startIndex = sentence.indexOf(spelling);
  while (startIndex !== -1) {
    if (startIndex === 0) {
      return true;
    }

    const previousCharacter = sentence[startIndex - 1];
    if (isExpressionLeftBoundary(previousCharacter, spelling)) {
      return true;
    }

    startIndex = sentence.indexOf(spelling, startIndex + 1);
  }

  return false;
}

function findContextualExpressionCandidates(
  row: CSVRow,
  spellingIndex: SpellingIndex,
  lookupSpellings: string[],
): Array<{ spelling: string; entry: JMdictWord }> {
  if (!hasContextBeyondTarget(row)) {
    return [];
  }

  const candidates = new Map<string, { spelling: string; entry: JMdictWord }>();
  for (const index of [spellingIndex.kanji, spellingIndex.kana]) {
    for (const [spelling, entries] of index) {
      const matchingLookupSpelling = lookupSpellings.find((lookupSpelling) => {
        if (spelling.length <= lookupSpelling.length || !spelling.includes(lookupSpelling)) {
          return false;
        }

        const surfaceSpelling = spelling.replace(lookupSpelling, row.recognitionTarget);
        return sentenceContainsExpressionSpelling(row.sentence, surfaceSpelling);
      });

      if (!matchingLookupSpelling) continue;

      for (const entry of entries) {
        if (entryIsExpression(entry)) {
          candidates.set(`${entry.id}\0${spelling}`, { spelling, entry });
        }
      }
    }
  }

  return [...candidates.values()];
}

function uniqueLongestCandidate(
  candidates: Array<{ spelling: string; entry: JMdictWord }>,
): { spelling: string; entry: JMdictWord } | undefined {
  const longestLength = Math.max(...candidates.map(({ spelling }) => spelling.length));
  const longest = candidates.filter(({ spelling }) => spelling.length === longestLength);
  const uniqueEntries = new Map(longest.map((candidate) => [candidate.entry.id, candidate]));

  return uniqueEntries.size === 1 ? [...uniqueEntries.values()][0] : undefined;
}

function entrySpellings(entry: JMdictWord): string[] {
  return [
    ...entry.kanji.map((item) => item.text),
    ...entry.kana.map((item) => item.text),
  ];
}

function containedEntrySpelling(entry: JMdictWord, recognitionTarget: string): string | undefined {
  return entrySpellings(entry)
    .filter((spelling) => recognitionTarget.includes(spelling))
    .sort((a, b) => b.length - a.length)[0];
}

function containsKanji(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

function preferredEntrySpelling(entry: JMdictWord, recognitionTarget: string): string {
  const commonKanji = entry.kanji.filter((item) => item.common).map((item) => item.text);
  const otherKanji = entry.kanji.filter((item) => !item.common).map((item) => item.text);
  const commonKana = entry.kana.filter((item) => item.common).map((item) => item.text);
  const otherKana = entry.kana.filter((item) => !item.common).map((item) => item.text);

  const kanjiSpellings = [...commonKanji, ...otherKanji];
  const kanaSpellings = [...commonKana, ...otherKana];
  const scriptPreferred = containsKanji(recognitionTarget)
    ? [...kanjiSpellings, ...kanaSpellings]
    : [...kanaSpellings, ...kanjiSpellings];

  return scriptPreferred[0] ?? recognitionTarget;
}

export async function normalizeRecognitionTarget(
  sentence: string,
  recognitionTarget: string,
  entry: JMdictWord,
): Promise<string> {
  if (entryHasSpelling(entry, recognitionTarget)) {
    return recognitionTarget;
  }

  const derivedSpellings = await deriveLookupSpellings(sentence, recognitionTarget);
  return derivedSpellings.find((spelling) => entryHasSpelling(entry, spelling)) ??
    containedEntrySpelling(entry, recognitionTarget) ??
    preferredEntrySpelling(entry, recognitionTarget);
}

async function resolveRow(
  row: CSVRow,
  entries: Map<string, JMdictWord>,
  spellingIndex: SpellingIndex,
): Promise<ResolvedRow | ResolutionIssue> {
  if (row.jmdictId) {
    const entry = entries.get(row.jmdictId);
    if (!entry) {
      return {
        row,
        reason: "missing-jmdict-id",
        candidateSpellings: [row.recognitionTarget],
        candidateMatches: [],
      };
    }

    return {
      row,
      entry,
      recognitionTarget: await normalizeRecognitionTarget(
        row.sentence,
        row.recognitionTarget,
        entry,
      ),
    };
  }

  const exactMatches = findEntriesBySpelling(spellingIndex, row.recognitionTarget);
  const derivedSpellings = await deriveLookupSpellings(row.sentence, row.recognitionTarget);
  const contextualExpressionCandidate = uniqueLongestCandidate(
    findContextualExpressionCandidates(row, spellingIndex, [
      row.recognitionTarget,
      ...derivedSpellings,
    ]),
  );

  if (
    contextualExpressionCandidate &&
    (exactMatches.length !== 1 || contextualExpressionCandidate.entry.id !== exactMatches[0].id)
  ) {
    return {
      row,
      entry: contextualExpressionCandidate.entry,
      recognitionTarget: contextualExpressionCandidate.spelling,
    };
  }

  const uniqueResolved = new Map<string, { spelling: string; entry: JMdictWord }>();
  const ambiguousDerived: CandidateMatch[] = [];

  for (const spelling of derivedSpellings) {
    const matches = findEntriesBySpelling(spellingIndex, spelling);
    if (matches.length === 1) {
      uniqueResolved.set(matches[0].id, { spelling, entry: matches[0] });
    } else if (matches.length > 1) {
      const suruMatches = shouldPreferSuruEntry(spelling, derivedSpellings)
        ? matches.filter(entryCanTakeSuru)
        : [];
      if (suruMatches.length === 1) {
        uniqueResolved.set(suruMatches[0].id, { spelling, entry: suruMatches[0] });
      } else {
        ambiguousDerived.push({ spelling, entries: matches });
      }
    }
  }

  if (exactMatches.length === 1) {
    const contextualVerbMatches = hasContextBeyondTarget(row)
      ? [...uniqueResolved.values()].filter(({ entry }) =>
        entryHasNonSuruVerb(entry) &&
        !entryHasNonSuruVerb(exactMatches[0])
      )
      : [];

    if (contextualVerbMatches.length === 1) {
      const [{ spelling, entry }] = contextualVerbMatches;
      return { row, entry, recognitionTarget: spelling };
    }

    const contextualSuruMatches = [...uniqueResolved.values()].filter(({ spelling, entry }) =>
      isSuruDerivedFromTarget(spelling, row.recognitionTarget) &&
      entryCanTakeSuru(entry) &&
      !entryCanTakeSuru(exactMatches[0])
    );

    if (contextualSuruMatches.length === 1) {
      const [{ spelling, entry }] = contextualSuruMatches;
      return { row, entry, recognitionTarget: spelling };
    }

    return { row, entry: exactMatches[0], recognitionTarget: row.recognitionTarget };
  }

  if (uniqueResolved.size === 1) {
    const [{ spelling, entry }] = [...uniqueResolved.values()];
    return { row, entry, recognitionTarget: spelling };
  }

  if (uniqueResolved.size > 1) {
    return {
      row,
      reason: "multiple-derived",
      candidateSpellings: derivedSpellings,
      candidateMatches: [...uniqueResolved.values()].map(({ spelling, entry }) => ({
        spelling,
        entries: [entry],
      })),
    };
  }

  if (ambiguousDerived.length > 0) {
    return {
      row,
      reason: "ambiguous-derived",
      candidateSpellings: derivedSpellings,
      candidateMatches: ambiguousDerived,
    };
  }

  if (exactMatches.length > 1) {
    return {
      row,
      reason: "ambiguous-exact",
      candidateSpellings: [row.recognitionTarget],
      candidateMatches: [{ spelling: row.recognitionTarget, entries: exactMatches }],
    };
  }

  return {
    row,
    reason: derivedSpellings.length > 0 ? "candidate-no-jmdict" : "no-candidates",
    candidateSpellings: derivedSpellings,
    candidateMatches: [],
  };
}

export async function resolveCSVRows(
  rows: CSVRow[],
  entries: Map<string, JMdictWord>,
): Promise<ResolutionResult> {
  const spellingIndex = buildSpellingIndex(entries.values());
  const resolved: ResolvedRow[] = [];
  const issues: ResolutionIssue[] = [];

  for (const row of rows) {
    const result = await resolveRow(row, entries, spellingIndex);
    if ("entry" in result) {
      resolved.push(result);
    } else {
      issues.push(result);
    }
  }

  return { resolved, issues };
}

export function formatResolutionIssue(issue: ResolutionIssue): string {
  const { row } = issue;

  switch (issue.reason) {
    case "missing-jmdict-id":
      return `  ⚠ ${row.recognitionTarget}: jmdictId ${row.jmdictId} not found, skipping`;

    case "ambiguous-exact": {
      const [{ entries }] = issue.candidateMatches;
      const ids = entries.map((entry) => entry.id).join(", ");
      return `  ⚠ ${row.recognitionTarget}: ambiguous (${entries.length} matches: ${ids}). ` +
        `Add a jmdictId column to disambiguate. Skipping.`;
    }

    case "ambiguous-derived": {
      const [{ spelling, entries }] = issue.candidateMatches;
      const ids = entries.map((entry) => entry.id).join(", ");
      return `  ⚠ ${row.recognitionTarget}: deinflected to ${spelling} but ambiguous ` +
        `(${entries.length} matches: ${ids}). ` +
        `Add a jmdictId column to disambiguate. Skipping.`;
    }

    case "multiple-derived": {
      const resolutions = issue.candidateMatches
        .map(({ spelling, entries }) =>
          `${spelling} -> ${entries.map((entry) => entry.id).join("/")}`
        )
        .join(", ");
      return `  ⚠ ${row.recognitionTarget}: multiple deinflected candidates resolved ` +
        `(${resolutions}). Add a jmdictId column to disambiguate. Skipping.`;
    }

    case "candidate-no-jmdict":
      return `  ⚠ ${row.recognitionTarget}: deinflected to ${
        issue.candidateSpellings.join(", ")
      } but no JMDict entry found, skipping`;

    case "no-candidates":
      return `  ⚠ ${row.recognitionTarget}: no JMDict entry found, skipping`;
  }
}
