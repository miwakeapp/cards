export interface ApplyRestrictions {
  dryRun: boolean;
  limit: number | undefined;
}

/** Explains why a run cannot write to Anki, or returns `undefined` when Apply is allowed. */
export function applyRestrictionReason(restrictions: ApplyRestrictions): string | undefined {
  const reasons: string[] = [];
  if (restrictions.dryRun) {
    reasons.push("This run was started with --dry-run.");
  }
  if (restrictions.limit !== undefined) {
    reasons.push(
      `This run used --limit=${restrictions.limit}; duplicate-key safety requires a complete scan. Restart without --limit to apply.`,
    );
  }
  return reasons.length === 0 ? undefined : `Apply is disabled. ${reasons.join(" ")}`;
}
