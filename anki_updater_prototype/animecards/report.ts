/**
 * Writes a compact Markdown audit report for an Animecards conversion manifest.
 *
 * Run with: deno task animecards:report MANIFEST.json [--output=REPORT.md]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { normalizePlainText } from "./html.ts";
import { type ConversionCandidate, type ConversionManifest, deferredReason } from "./types.ts";

interface SourceGroup {
  html: string;
  candidates: ConversionCandidate[];
}

/** Derives the default Markdown report name from a manifest path. */
export function defaultReportPath(manifestPath: string): string {
  const extension = path.extname(manifestPath);
  return `${manifestPath.slice(0, -extension.length)}.report.md`;
}

/** Derives the semi-manual context-review CSV name from a manifest path. */
export function defaultDeferredContextsPath(manifestPath: string): string {
  const extension = path.extname(manifestPath);
  return `${manifestPath.slice(0, -extension.length)}.deferred-contexts.csv`;
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll("`", "\\`").replaceAll("|", "\\|")}\``;
}

function contextText(html: string): string {
  return normalizePlainText(
    html
      .replace(/<\/?mark\b[^>]*>/giu, "")
      .replace(/\[[^\]]+\]/gu, ""),
  ).replace(/\s+/gu, "");
}

function abbreviated(value: string, length = 90): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function sourceURLSummary(candidates: ConversionCandidate[]): string {
  const urls = [...new Set(candidates.map((candidate) => candidate.sourceResolution.url))]
    .filter((url) => url !== null);
  if (urls.length === 0) return "none";

  const allPublic = candidates.every((candidate) => candidate.sourceResolution.urlIsPublic);
  const disposition = allPublic ? "public/linked" : "private or temporary/unlinked";
  return `${disposition}: ${urls.map((url) => inlineCode(url)).join(", ")}`;
}

function CSVCell(value: string | number): string {
  const string = String(value);
  return /[",\r\n]/u.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

/** Builds the actionable input file for a later semi-manual conversion pass. */
export function buildDeferredContextsCSV(manifest: ConversionManifest): string {
  const field = manifest.sourceFields.sentence;
  const rows = manifest.candidates.filter((candidate) => deferredReason(candidate) !== null).map(
    (candidate) =>
      [
        candidate.noteId,
        candidate.recognitionTarget,
        candidate.jmdictId,
        candidate.sourceResolution.name ?? "",
        candidate.sourceResolution.url ?? "",
        typeof field === "string" ? candidate.original.fields[field] ?? "" : "",
        deferredReason(candidate)!,
      ].map(CSVCell).join(","),
  );
  return [
    "note_id,recognition_target,jmdict_id,source,source_url,original_context,reason",
    ...rows,
    "",
  ].join("\n");
}

/** Writes the Markdown audit and companion deferred-context CSV. */
export async function writeConversionAuditArtifacts(
  manifest: ConversionManifest,
  manifestPath: string,
  reportPath = defaultReportPath(manifestPath),
): Promise<void> {
  const deferredContextsPath = defaultDeferredContextsPath(manifestPath);
  await Deno.mkdir(path.dirname(reportPath), { recursive: true });
  await Deno.writeTextFile(reportPath, buildConversionReport(manifest));
  await Deno.writeTextFile(deferredContextsPath, buildDeferredContextsCSV(manifest));
}

/** Builds a human-readable audit of candidate totals, final source HTML, and skip reasons. */
export function buildConversionReport(manifest: ConversionManifest): string {
  const candidates = manifest.candidates.filter((candidate) => deferredReason(candidate) === null);
  const deferredCandidates = manifest.candidates.filter((candidate) =>
    deferredReason(candidate) !== null
  );
  const sourceGroups = new Map<string, SourceGroup>();
  for (const candidate of candidates) {
    const html = candidate.target.fields.Source;
    const group = sourceGroups.get(html) ?? { html, candidates: [] };
    group.candidates.push(candidate);
    sourceGroups.set(html, group);
  }
  const sortedSourceGroups = [...sourceGroups.values()].sort((left, right) =>
    right.candidates.length - left.candidates.length || left.html.localeCompare(right.html)
  );
  const emptySourceCount = sourceGroups.get("")?.candidates.length ?? 0;

  const skipCounts = new Map<string, number>();
  for (const skipped of manifest.skipped) {
    skipCounts.set(skipped.reason, (skipCounts.get(skipped.reason) ?? 0) + 1);
  }
  const sortedSkipCounts = [...skipCounts].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  );

  const sourcedCount =
    candidates.filter((candidate) => candidate.sourceResolution.name !== null).length;
  const sourceMethodCounts = new Map<string, number>();
  const fullContextCounts = new Map<string, number>();
  const fullContextModelCounts = new Map<string, number>();
  const minimizationCounts = new Map<string, number>();
  const minimizationModelCounts = new Map<string, number>();
  const senseCounts = new Map<string, number>();
  const senseModelCounts = new Map<string, number>();
  const failedEnrichments = manifest.candidates.filter((candidate) =>
    candidate.minimizedContextResolution.status === "failed" ||
    candidate.senseResolution.status === "failed"
  );
  for (const candidate of candidates) {
    const method = candidate.sourceResolution.method;
    sourceMethodCounts.set(method, (sourceMethodCounts.get(method) ?? 0) + 1);
    const fullContext = candidate.fullContextResolution;
    const fullContextLabel = fullContext.status === "restored"
      ? `${fullContext.status}/${fullContext.method}`
      : fullContext.status;
    fullContextCounts.set(fullContextLabel, (fullContextCounts.get(fullContextLabel) ?? 0) + 1);
    if (fullContext.status === "restored" && fullContext.method === "ai") {
      fullContextModelCounts.set(
        fullContext.model,
        (fullContextModelCounts.get(fullContext.model) ?? 0) + 1,
      );
    }
    const status = candidate.minimizedContextResolution.status;
    minimizationCounts.set(status, (minimizationCounts.get(status) ?? 0) + 1);
    if (candidate.minimizedContextResolution.status === "generated") {
      minimizationModelCounts.set(
        candidate.minimizedContextResolution.model,
        (minimizationModelCounts.get(candidate.minimizedContextResolution.model) ?? 0) + 1,
      );
    }
    const senseStatus = candidate.senseResolution.status;
    senseCounts.set(senseStatus, (senseCounts.get(senseStatus) ?? 0) + 1);
    if (candidate.senseResolution.status === "generated") {
      senseModelCounts.set(
        candidate.senseResolution.model,
        (senseModelCounts.get(candidate.senseResolution.model) ?? 0) + 1,
      );
    }
  }

  const lines = [
    "# Animecards → Miwake card conversion audit",
    "",
    `- Manifest generated: ${manifest.generatedAt}`,
    `- Query: ${inlineCode(manifest.query)}`,
    `- Eligible conversion candidates: ${candidates.length}`,
    `- Deferred candidates: ${deferredCandidates.length}`,
    `- Skipped notes: ${manifest.skipped.length}`,
    `- Candidates with a source: ${sourcedCount}`,
    `- Candidates without a source: ${candidates.length - sourcedCount}`,
    `- Source methods: ${
      [...sourceMethodCounts].map(([method, count]) => `${method}=${count}`).join(", ")
    }`,
    `- Full-context AI models: ${
      [...fullContextModelCounts].map(([model, count]) => `${model}=${count}`).join(", ") ||
      "none"
    }`,
    `- Full context: ${
      [...fullContextCounts].map(([status, count]) => `${status}=${count}`).join(", ")
    }`,
    `- Minimized context: ${
      [...minimizationCounts].map(([status, count]) => `${status}=${count}`).join(", ")
    }`,
    `- Minimized-context AI models: ${
      [...minimizationModelCounts].map(([model, count]) => `${model}=${count}`).join(", ") ||
      "none"
    }`,
    `- Sense selection: ${
      [...senseCounts].map(([status, count]) => `${status}=${count}`).join(", ")
    }`,
    `- Sense-selection AI models: ${
      [...senseModelCounts].map(([model, count]) => `${model}=${count}`).join(", ") || "none"
    }`,
    `- Failed AI enrichments: ${failedEnrichments.length}`,
    "",
    "## Distinct final Source HTML",
    "",
    `${sortedSourceGroups.length} distinct strings; ${
      emptySourceCount === 0
        ? "none are empty"
        : emptySourceCount === 1
        ? "1 candidate uses the empty string"
        : `${emptySourceCount} candidates use the empty string`
    }. Counts cover every eligible conversion candidate.`,
    "",
    "| Count | Resolution | Final HTML string | Source URL handling | Example note IDs |",
    "| ---: | --- | --- | --- | --- |",
  ];

  for (const group of sortedSourceGroups) {
    const methods = [
      ...new Set(group.candidates.map((candidate) => candidate.sourceResolution.method)),
    ].join(", ");
    const html = group.html === "" ? inlineCode('"" (empty)') : inlineCode(group.html);
    const noteIds = group.candidates.slice(0, 5).map((candidate) => candidate.noteId).join(", ");
    lines.push(
      `| ${group.candidates.length} | ${methods} | ${html} | ${
        sourceURLSummary(group.candidates)
      } | ${noteIds} |`,
    );
  }

  const sentenceField = manifest.sourceFields.sentence;
  const contextChanges = candidates.map((candidate) => {
    const original = sentenceField === undefined
      ? ""
      : contextText(candidate.original.fields[sentenceField] ?? "");
    const final = contextText(candidate.target.fields["Full context"] ?? "");
    return { candidate, original, final, delta: final.length - original.length };
  });
  const expandedContexts = contextChanges.filter((change) => change.delta > 0);
  const expansionDeltas = expandedContexts.map((change) => change.delta).sort((a, b) => a - b);
  const percentile = (fraction: number): number =>
    expansionDeltas[Math.floor((expansionDeltas.length - 1) * fraction)] ?? 0;
  const rubyContextCount =
    candidates.filter((candidate) =>
      /\[[^\]]+\]/u.test(candidate.target.fields["Full context"] ?? "")
    ).length;
  const failedContexts = manifest.candidates.filter((candidate) =>
    candidate.fullContextResolution.status === "failed"
  );
  const largestExpansions = expandedContexts
    .toSorted((left, right) => right.delta - left.delta)
    .slice(0, 15);

  lines.push(
    "",
    "## Full context restoration",
    "",
    `- Expanded source excerpts: ${expandedContexts.length}`,
    `- Unchanged visible text: ${contextChanges.length - expandedContexts.length}`,
    `- Final contexts carrying source furigana: ${rubyContextCount}`,
    `- Expansion size: median +${percentile(0.5)} characters; 95th percentile +${
      percentile(0.95)
    }; maximum +${percentile(1)}`,
    `- Failed restorations: ${failedContexts.length}`,
    "",
    "Largest expansions are listed for outlier review:",
    "",
    "| Added characters | Note ID | Target | Original excerpt | Final context |",
    "| ---: | ---: | --- | --- | --- |",
    ...largestExpansions.map(({ candidate, original, final, delta }) =>
      `| ${delta} | ${candidate.noteId} | ${inlineCode(candidate.recognitionTarget)} | ${
        inlineCode(abbreviated(original))
      } | ${inlineCode(abbreviated(final))} |`
    ),
    "",
    "Failed restorations:",
    "",
    "| Note ID | Target | Error |",
    "| ---: | --- | --- |",
    ...failedContexts.map((candidate) => {
      const resolution = candidate.fullContextResolution;
      return `| ${candidate.noteId} | ${inlineCode(candidate.recognitionTarget)} | ${
        inlineCode(resolution.status === "failed" ? resolution.error : "")
      } |`;
    }),
    "",
    "Failed AI enrichments:",
    "",
    "| Note ID | Target | Error |",
    "| ---: | --- | --- |",
    ...failedEnrichments.map((candidate) => {
      const resolution = candidate.minimizedContextResolution.status === "failed"
        ? candidate.minimizedContextResolution
        : candidate.senseResolution;
      return `| ${candidate.noteId} | ${inlineCode(candidate.recognitionTarget)} | ${
        inlineCode(resolution.status === "failed" ? resolution.error : "")
      } |`;
    }),
  );

  const distinctKeyTargets = candidates.filter((candidate) =>
    candidate.recognitionTarget !== candidate.keyRecognitionTarget
  );
  const sourceWordField = manifest.sourceFields.word;
  const changedSourceTargets = typeof sourceWordField === "string"
    ? candidates.flatMap((candidate) => {
      const original = normalizePlainText(candidate.original.fields[sourceWordField] ?? "");
      return original !== candidate.recognitionTarget ? [{ candidate, original }] : [];
    })
    : [];
  lines.push(
    "",
    "## Original recognition target changes",
    "",
    `${changedSourceTargets.length} candidates change the original Animecards recognition target.`,
    "",
    "| Note ID | Original | Final |",
    "| ---: | --- | --- |",
    ...changedSourceTargets.map(({ candidate, original }) =>
      `| ${candidate.noteId} | ${inlineCode(original)} | ${
        inlineCode(candidate.recognitionTarget)
      } |`
    ),
    "",
    "## Recognition target and key spelling differences",
    "",
    `${distinctKeyTargets.length} candidates intentionally use a visible recognition target that differs from the canonical JMDict spelling in the key.`,
    "",
    "| Note ID | Recognition target | Key spelling | Key |",
    "| ---: | --- | --- | --- |",
    ...distinctKeyTargets.map((candidate) =>
      `| ${candidate.noteId} | ${inlineCode(candidate.recognitionTarget)} | ${
        inlineCode(candidate.keyRecognitionTarget)
      } | ${inlineCode(candidate.target.fields.Key)} |`
    ),
    "",
    "## Deferred for semi-manual review",
    "",
    `${deferredCandidates.length} candidates will remain unchanged. Their note IDs, targets, sources, URLs, original contexts, and reasons are recorded in the companion deferred-contexts CSV file.`,
    "",
    "| Count | Reason |",
    "| ---: | --- |",
    ...Object.entries(
      Object.groupBy(deferredCandidates, (candidate) => deferredReason(candidate)!),
    ).map(
      ([reason, items]) => `| ${items?.length ?? 0} | ${inlineCode(reason)} |`,
    ),
    "",
    "## Skip reasons",
    "",
    "| Count | Reason |",
    "| ---: | --- |",
    ...sortedSkipCounts.map(([reason, count]) => `| ${count} | ${inlineCode(reason)} |`),
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    string: ["output"],
    unknown: (argument) => {
      if (!argument.startsWith("-")) return true;
      throw new Error(`Unknown argument: ${argument}`);
    },
  });
  if (flags._.length !== 1) {
    throw new Error("Usage: deno task animecards:report MANIFEST.json [--output=REPORT.md]");
  }

  const manifestPath = String(flags._[0]);
  const reportPath = flags.output ?? defaultReportPath(manifestPath);
  const deferredContextsPath = defaultDeferredContextsPath(manifestPath);
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as ConversionManifest;
  await writeConversionAuditArtifacts(manifest, manifestPath, reportPath);
  console.error(`Wrote conversion audit report to ${reportPath}`);
  console.error(`Wrote deferred-context review file to ${deferredContextsPath}`);
}

if (import.meta.main) await main();
