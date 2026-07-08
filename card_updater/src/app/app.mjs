/** Client for the Miwake card-updater review app. All data comes from the local server. */

/* ---------- state ---------- */

let meta = null;
let items = [];
const itemsByNoteId = new Map();

let focusNoteId = null;
const working = new Map(); // noteId -> { senses: Set, hint: string }
const expandedRows = new Set();
const undoStack = []; // arrays of { noteId, previous }

const REASON_LABELS = {
  "single-sense": {
    title: "Single-sense entries, wording updated",
    explain: "One sense before and after — the card can't point at the wrong sense.",
  },
  "targets-intact": {
    title: "Changes outside the targeted senses",
    explain: "The targeted senses are word-for-word unchanged at the same numbers.",
  },
  "target-metadata": {
    title: "Tag changes on the targeted senses",
    explain: "Targeted glosses unchanged; only tags or notes around them changed.",
  },
  "targets-renumbered": {
    title: "Same senses, new numbers",
    explain: "The targeted sense text is unchanged but moved; the key is rewritten to follow it.",
  },
  "target-changed": { title: "Targeted sense text changed" },
  "target-gone": { title: "Targeted sense no longer exists" },
  "all-senses-reshaped": { title: "Card tests all senses; the entry changed shape" },
  "entry-deleted": { title: "JMDict entry no longer exists" },
  "invalid-key": { title: "Key is not a valid Miwake key" },
  "spelling-removed": { title: "Spelling removed from the entry" },
  "stored-entry-missing": { title: "Card has no stored dictionary entry" },
  "stored-entry-unparseable": { title: "Stored dictionary entry is unparseable" },
  "target-out-of-range": { title: "Key targets a sense the stored entry lacks" },
};

const ROUTINE_GROUP_ORDER = [
  "single-sense",
  "targets-intact",
  "target-metadata",
  "targets-renumbered",
];

/* ---------- helpers ---------- */

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function segmentsHTML(segments) {
  return segments.map(({ type, text }) => {
    const escaped = escapeHTML(text);
    if (type === "ins") return `<ins>${escaped}</ins>`;
    if (type === "del") return `<del>${escaped}</del>`;
    return escaped;
  }).join("");
}

/** Trims the unchanged stretches of a diff so it fits on one chip line. */
function segmentsSnippetHTML(segments, keep = 18) {
  const trimmed = segments.map((segment, index) => {
    if (segment.type !== "same") return segment;
    let text = segment.text;
    const isFirst = index === 0;
    const isLast = index === segments.length - 1;
    if (text.length > keep * 2 + 2) {
      if (isFirst) text = "…" + text.slice(-keep);
      else if (isLast) text = text.slice(0, keep) + "…";
      else text = text.slice(0, keep) + "…" + text.slice(-keep);
    }
    return { ...segment, text };
  });
  return segmentsHTML(trimmed);
}

function truncate(text, length) {
  return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

function reasonTitle(reason) {
  return REASON_LABELS[reason]?.title ?? reason;
}

/** Renders a note-field's HTML safely: keeps simple inline tags, converts Anki furigana to ruby. */
function renderContextHTML(raw) {
  const doc = new DOMParser().parseFromString(raw || "", "text/html");
  const keep = new Set(["MARK", "B", "I", "RUBY", "RT", "BR"]);
  const walk = (node) => {
    let html = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        html += furiganaToRuby(escapeHTML(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        html += keep.has(child.tagName) ? `<${tag}>${walk(child)}</${tag}>` : walk(child);
      }
    }
    return html;
  };
  return walk(doc.body);
}

function furiganaToRuby(escapedText) {
  return escapedText.replace(
    /(?:^|[  ])([^  \[\]]+)\[([^\]]+)\]/g,
    (_match, base, reading) => `<ruby>${base}<rt>${reading}</rt></ruby>`,
  );
}

/** Client-side mirror of card_creator's `formatMiwakeKey`, for live key previews. */
function computeKey(item, senses) {
  const sorted = [...senses].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === item.totalNewSenses) {
    return `${item.recognitionTarget} | ${item.jmdictId}`;
  }
  return `${item.recognitionTarget} | ${item.jmdictId} | ${sorted.join(",")}`;
}

/** Character-level diff used only for the key transition line. */
function keyDiffHTML(oldKey, newKey) {
  if (oldKey === newKey) return escapeHTML(newKey);
  let prefix = 0;
  while (prefix < oldKey.length && prefix < newKey.length && oldKey[prefix] === newKey[prefix]) {
    ++prefix;
  }
  let suffix = 0;
  while (
    suffix < oldKey.length - prefix && suffix < newKey.length - prefix &&
    oldKey.at(-1 - suffix) === newKey.at(-1 - suffix)
  ) {
    ++suffix;
  }
  const same = escapeHTML(newKey.slice(0, prefix));
  const removed = oldKey.slice(prefix, oldKey.length - suffix);
  const added = newKey.slice(prefix, newKey.length - suffix);
  const tail = escapeHTML(newKey.slice(newKey.length - suffix));
  return same + (removed ? `<del>${escapeHTML(removed)}</del>` : "") +
    (added ? `<ins>${escapeHTML(added)}</ins>` : "") + tail;
}

async function api(pathname, body) {
  const response = await fetch(pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}

/* ---------- buckets ---------- */

function bucket(verdict) {
  return items.filter((item) => item.verdict === verdict);
}

const retargetItems = () => bucket("retarget");
const routineItems = () => bucket("routine");
const normalizeItems = () => bucket("normalize");
const exceptionItems = () => bucket("exception");

function impliedDecision(item) {
  return item.verdict === "routine" || item.verdict === "normalize" ? "accept" : "none";
}

function effectiveDecision(item) {
  return item.decision?.decision ?? impliedDecision(item);
}

/* ---------- decisions ---------- */

async function postDecisions(entries, { toast: message } = {}) {
  undoStack.push(entries.map(({ noteId }) => ({
    noteId,
    previous: itemsByNoteId.get(noteId).decision,
  })));
  for (const { noteId, record } of entries) {
    itemsByNoteId.get(noteId).decision = record;
  }
  renderAll();
  if (message) showToast(message);
  try {
    await api("/api/decisions", { entries });
  } catch (error) {
    showToast(`Saving failed: ${error.message}`);
  }
}

function decide(item, record, { advance = true } = {}) {
  const verb = record === null
    ? "Cleared"
    : { accept: "Accepted", hold: "Held", reject: "Rejected" }[record.decision];
  if (advance && item.verdict === "retarget") {
    focusNoteId = nextUndecidedRetarget(item.noteId)?.noteId ?? null;
  }
  postDecisions([{ noteId: item.noteId, record }], { toast: `${verb} ${item.word}` });
}

async function undo() {
  const batch = undoStack.pop();
  if (!batch) {
    showToast("Nothing to undo");
    return;
  }
  for (const { noteId, previous } of [...batch].reverse()) {
    itemsByNoteId.get(noteId).decision = previous;
    working.delete(noteId);
  }
  const firstItem = itemsByNoteId.get(batch[0].noteId);
  if (firstItem?.verdict === "retarget") {
    focusNoteId = firstItem.noteId;
  }
  renderAll();
  showToast(
    batch.length === 1 ? `Undid ${firstItem?.word ?? ""}` : `Undid ${batch.length} decisions`,
  );
  try {
    await api("/api/decisions", {
      entries: batch.map(({ noteId }) => ({
        noteId,
        record: itemsByNoteId.get(noteId).decision,
      })),
    });
  } catch (error) {
    showToast(`Saving failed: ${error.message}`);
  }
}

function nextUndecidedRetarget(afterNoteId) {
  const list = retargetItems();
  const startIndex = list.findIndex((item) => item.noteId === afterNoteId);
  const rotated = [...list.slice(startIndex + 1), ...list.slice(0, startIndex + 1)];
  return rotated.find((item) => !item.decision && !item.applied);
}

function getWorking(item) {
  if (!working.has(item.noteId)) {
    const initial = item.decision?.senses ?? item.suggestion?.senses ?? item.mappedTargetSenses;
    const hint = item.decision?.hint ?? item.suggestion?.defaultHint ?? (item.hint || null);
    working.set(item.noteId, { senses: new Set(initial), hint: hint ?? "" });
  }
  return working.get(item.noteId);
}

/* ---------- header ---------- */

function renderHeader() {
  const actionable = items.filter((item) => item.verdict !== "exception");
  const total = actionable.length;
  const counts = { applied: 0, accept: 0, ai: 0, hold: 0, reject: 0 };
  let staged = 0;
  for (const item of actionable) {
    if (item.applied) {
      ++counts.applied;
      ++staged;
      continue;
    }
    const decision = effectiveDecision(item);
    if (decision === "accept") {
      ++staged;
      if (item.decision?.resolvedBy?.startsWith("ai")) ++counts.ai;
      else ++counts.accept;
    } else if (decision === "hold") ++counts.hold;
    else if (decision === "reject") ++counts.reject;
  }

  const jmdictVersion = meta.jmdict.remote ?? meta.jmdict.local;
  document.getElementById("brandSub").textContent =
    `${meta.scannedCount.toLocaleString()} cards scanned · ${meta.counts.unchanged.toLocaleString()} already current · ` +
    `JMDict ${jmdictVersion?.version ?? "?"} (${jmdictVersion?.dictDate ?? "?"})` +
    (meta.dryRun ? " · dry run" : "");

  const bar = document.getElementById("progressBar");
  bar.innerHTML = "";
  for (
    const [key, cls] of [
      ["applied", "p-applied"],
      ["accept", "p-accept"],
      ["ai", "p-ai"],
      ["hold", "p-hold"],
      ["reject", "p-reject"],
    ]
  ) {
    const div = document.createElement("div");
    div.className = cls;
    div.style.width = (total === 0 ? 0 : counts[key] / total * 100) + "%";
    bar.append(div);
  }

  const toReview = retargetItems().filter((item) => !item.decision && !item.applied).length;
  document.getElementById("progressCaption").textContent = counts.applied === total && total > 0
    ? `All ${total} applied 🎉`
    : `${staged} / ${total} staged` + (toReview > 0 ? ` · ${toReview} to review` : "");

  document.getElementById("undoButton").disabled = undoStack.length === 0;

  const applyButton = document.getElementById("applyButton");
  const applicable = applyableItems().length;
  applyButton.textContent = meta.dryRun
    ? "Apply (dry run)"
    : `Apply ${applicable} update${applicable === 1 ? "" : "s"}…`;
  applyButton.disabled = meta.dryRun || applicable === 0;
  applyButton.title = meta.dryRun
    ? "This run was started with --dry-run; restart without it to apply."
    : "Write the staged updates to Anki";

  document.getElementById("sectionNav").innerHTML = [
    ["#retarget", "✨ Re-target", retargetItems().length],
    ["#routine", "Routine", routineItems().length],
    ["#normalize", "Normalize", normalizeItems().length],
    ["#exceptions", "Exceptions", exceptionItems().length],
  ].map(([href, label, count]) =>
    `<a href="${href}">${label}<span class="count">${count}</span></a>`
  ).join("");
}

/* ---------- re-target section ---------- */

function renderRetargetBanner() {
  const container = document.getElementById("retargetBanner");
  const list = retargetItems();
  if (list.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-title">Nothing to re-target 🎉</div><p>No card\'s targeted senses were affected by this dictionary update.</p></div>';
    return;
  }

  const byConfidence = { high: [], medium: [], low: [], none: [] };
  for (const item of list) {
    byConfidence[item.suggestion?.confidence ?? "none"].push(item);
  }
  const undecidedHigh = byConfidence.high.filter((item) => !item.decision && !item.applied);
  const parts = [];
  if (byConfidence.high.length) {
    parts.push(`<span class="conf-dot high"></span> ${byConfidence.high.length} high`);
  }
  if (byConfidence.medium.length) {
    parts.push(`<span class="conf-dot medium"></span> ${byConfidence.medium.length} medium`);
  }
  if (byConfidence.low.length) {
    parts.push(`<span class="conf-dot low"></span> ${byConfidence.low.length} low`);
  }
  if (byConfidence.none.length) parts.push(`${byConfidence.none.length} without AI`);

  const suggested = list.filter((item) => item.suggestion).length;
  container.innerHTML = `
    <div class="banner banner-ai">
      <div class="banner-text">
        <strong>✨ ${escapeHTML(meta.modelId)}</strong> pre-worked ${suggested} of ${list.length}
        · ${parts.join(" · ")}
      </div>
      <button class="btn-ai" id="acceptHighButton" ${undecidedHigh.length === 0 ? "disabled" : ""}>
        ✓ Accept ${undecidedHigh.length} high-confidence
      </button>
    </div>`;
  document.getElementById("acceptHighButton")?.addEventListener("click", () => {
    const targets = byConfidence.high.filter((item) => !item.decision && !item.applied);
    const entries = targets.map((item) => ({
      noteId: item.noteId,
      record: {
        decision: "accept",
        senses: item.suggestion.senses,
        hint: item.suggestion.defaultHint,
        resolvedBy: "ai",
        decidedAt: new Date().toISOString(),
      },
    }));
    focusNoteId = null;
    postDecisions(entries, { toast: `Accepted ${targets.length} high-confidence suggestions` });
  });
}

function senseTags(view, item) {
  const tags = [];
  if (view.wasTargeted) {
    tags.push(
      '<span class="chip chip-warn" title="This card was testing this sense"><span class="was-dot"></span>was testing</span>',
    );
  }
  if (view.isNew) tags.push('<span class="chip chip-ok">new</span>');
  else if (view.fromOldSense !== undefined) {
    tags.push(`<span class="chip chip-accent">was S${view.fromOldSense}</span>`);
  }
  if (view.segments) tags.push('<span class="chip">reworded</span>');
  return tags.join("");
}

function renderFocusCard() {
  const container = document.getElementById("focusWrap");
  const list = retargetItems();
  if (list.length === 0) {
    container.innerHTML = "";
    return;
  }
  if (focusNoteId === null || !list.some((item) => item.noteId === focusNoteId)) {
    focusNoteId = list.find((item) => !item.decision && !item.applied)?.noteId ?? null;
  }
  if (focusNoteId === null) {
    container.innerHTML =
      `<div class="section-clear">✓ All ${list.length} re-target cards decided. Apply when ready, or continue below.</div>`;
    return;
  }

  const item = itemsByNoteId.get(focusNoteId);
  const work = getWorking(item);
  const selection = [...work.senses].sort((a, b) => a - b);
  const newKey = computeKey(item, selection);
  const allOrNone = selection.length === 0 || selection.length === item.totalNewSenses;
  const suggestion = item.suggestion;
  const matchesAI = suggestion !== null &&
    JSON.stringify(selection) === JSON.stringify([...suggestion.senses].sort((a, b) => a - b)) &&
    ((allOrNone ? null : work.hint.trim() || null) === suggestion.defaultHint);
  const index = list.indexOf(item);
  const decidedCount = list.filter((entry) => entry.decision || entry.applied).length;

  const senseRows = item.senseViews.map((view) => {
    const selected = work.senses.has(view.number);
    const textHTML = view.segments ? segmentsHTML(view.segments) : escapeHTML(view.text);
    return `
      <label class="sense-option ${selected ? "selected" : ""}" data-sense="${view.number}">
        <input type="checkbox" ${selected ? "checked" : ""} tabindex="-1">
        <span class="sense-num">${view.number}.</span>
        <span class="sense-text">${textHTML}</span>
        <span class="sense-tags">${senseTags(view, item)}</span>
      </label>`;
  }).join("");

  const removedRows = item.removedSenses.map((sense) => `
    <div class="sense-option ghost">
      <span></span>
      <span class="sense-num">✕</span>
      <span class="sense-text">${escapeHTML(sense.text)}</span>
      <span class="sense-tags"><span class="chip chip-bad">removed${
    sense.wasTargeted ? " — was testing" : ""
  }</span></span>
    </div>`).join("");

  const aiPanel = suggestion !== null
    ? `
      <div class="ai-panel ${matchesAI ? "" : "ai-overridden"}">
        <div class="ai-head">
          ✨ AI suggestion ${matchesAI ? "" : '(edited — <a href="#" id="resetToAI">reset</a>)'}
          <span class="chip chip-ai" style="border:0;background:none;padding:0"><span class="conf-dot ${suggestion.confidence}"></span>${suggestion.confidence}</span>
          <span class="ai-model">${escapeHTML(suggestion.modelId)}</span>
        </div>
        <div class="ai-reason">${escapeHTML(suggestion.explanation)}</div>
      </div>`
    : `
      <div class="ai-panel">
        <div class="ai-head">No AI suggestion <a href="#" id="runAI" style="margin-left:auto">✨ run now</a></div>
        <div class="ai-reason">Select the applicable senses manually, or run the AI for this card.</div>
      </div>`;

  const hintDisabled = allOrNone;
  const hintValue = hintDisabled ? "" : work.hint;
  const hintChips = [];
  if (!hintDisabled && suggestion?.aiHint && suggestion.aiHint !== hintValue) {
    hintChips.push(
      `<button type="button" class="chip chip-ai chip-button" id="useAIHint" title="Use the AI-generated hint">✨ <span lang="ja">${
        escapeHTML(suggestion.aiHint)
      }</span></button>`,
    );
  }
  if (!hintDisabled && item.hint && item.hint !== hintValue) {
    hintChips.push(
      `<button type="button" class="chip chip-button" id="useCardHint" title="Restore the hint currently on the card"><span lang="ja">${
        escapeHTML(item.hint)
      }</span></button>`,
    );
  }

  const decisionChip = item.applied
    ? '<span class="chip chip-ok">applied ✓</span>'
    : item.decision
    ? `<span class="chip chip-${
      item.decision.decision === "accept"
        ? "ok"
        : item.decision.decision === "hold"
        ? "warn"
        : "bad"
    }">${item.decision.decision}${item.decision.resolvedBy?.startsWith("ai") ? " ✨" : ""}</span>`
    : "";

  container.innerHTML = `
    <article class="focus-card" id="focusCard">
      <div class="focus-head">
        <h3 class="focus-word" lang="ja">${escapeHTML(item.word)}</h3>
        <div class="focus-chips">
          <span class="chip">${escapeHTML(reasonTitle(item.reason))}</span>
          <span class="chip">${item.oldSenseCount} → ${item.newSenseCount} senses</span>
          ${
    suggestion
      ? `<span class="chip chip-ai"><span class="conf-dot ${suggestion.confidence}"></span>✨ ${suggestion.confidence} confidence</span>`
      : ""
  }
          ${decisionChip}
        </div>
        <span class="focus-counter">${index + 1} of ${list.length} · ${decidedCount} decided</span>
      </div>
      <div class="key-transition">
        <span class="key-old">${escapeHTML(item.key)}</span>
        <span class="key-arrow">→</span>
        <span class="key-new">${
    newKey === item.key
      ? escapeHTML(newKey) + '<span style="color:var(--faint)"> (unchanged)</span>'
      : keyDiffHTML(item.key, newKey)
  }</span>
      </div>
      <div class="evidence">
        <div class="evidence-label">Mined context</div>
        <div class="evidence-context" lang="ja">${
    item.fullContext
      ? renderContextHTML(item.fullContext)
      : '<span style="color:var(--faint);font-size:13px">(no context stored on this card)</span>'
  }</div>
        <div class="evidence-meta">Hint on card: ${
    item.hint ? `<span lang="ja">${escapeHTML(item.hint)}</span>` : "none"
  }</div>
      </div>
      <div class="focus-body">
        <div>
          <div class="panel-label">Senses this card should test <span class="label-extra">(press <kbd>1</kbd>–<kbd>9</kbd>)</span></div>
          <div class="sense-picker">${senseRows}${removedRows}</div>
          <div class="all-senses-note">${
    allOrNone
      ? "<strong>All senses apply</strong> — key gets no sense list, hint is cleared."
      : "&nbsp;"
  }</div>
        </div>
        ${aiPanel}
        <div class="hint-row">
          <label for="hintInput">Hint</label>
          <input id="hintInput" lang="ja" ${hintDisabled ? "disabled" : ""} value="${
    escapeHTML(hintValue)
  }"
                 placeholder="${hintDisabled ? "no hint — all senses apply" : "e.g. 変化に富む"}">
          ${hintChips.join("")}
        </div>
      </div>
      <div class="focus-actions">
        <button class="btn-primary" id="acceptButton" ${
    item.applied ? "disabled" : ""
  }>✓ Accept <kbd style="background:rgb(255 255 255 / .2);border-color:rgb(255 255 255 / .35);color:#fff">⏎</kbd></button>
        <button id="holdButton" ${item.applied ? "disabled" : ""}>Hold <kbd>x</kbd></button>
        <button id="skipButton">Skip <kbd>s</kbd></button>
        <div class="spacer"></div>
        <button id="openAnkiButton" title="Open this note in the Anki card browser">Open in Anki</button>
        <button id="rejectButton" ${
    item.applied ? "disabled" : ""
  } title="Leave this card untouched by this update">Reject</button>
      </div>
    </article>`;

  wireFocusCard(item, work);
}

function wireFocusCard(item, work) {
  const container = document.getElementById("focusWrap");
  for (const option of container.querySelectorAll(".sense-option[data-sense]")) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSense(item, Number(option.dataset.sense));
    });
  }
  container.querySelector("#resetToAI")?.addEventListener("click", (event) => {
    event.preventDefault();
    working.set(item.noteId, {
      senses: new Set(item.suggestion.senses),
      hint: item.suggestion.defaultHint ?? "",
    });
    renderAll();
  });
  container.querySelector("#runAI")?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.target.textContent = "✨ running…";
    try {
      const { suggestion } = await api("/api/suggest", { noteId: item.noteId });
      item.suggestion = suggestion;
      working.delete(item.noteId);
      renderAll();
      showToast(`AI suggestion ready for ${item.word}`);
    } catch (error) {
      showToast(`AI failed: ${error.message}`);
      renderAll();
    }
  });
  container.querySelector("#useAIHint")?.addEventListener("click", () => {
    work.hint = item.suggestion.aiHint;
    renderAll();
  });
  container.querySelector("#useCardHint")?.addEventListener("click", () => {
    work.hint = item.hint;
    renderAll();
  });
  const hintInput = container.querySelector("#hintInput");
  hintInput.addEventListener("input", () => {
    work.hint = hintInput.value;
  });
  hintInput.addEventListener("change", () => renderFocusCard());
  hintInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      acceptFocus();
    }
    event.stopPropagation();
  });
  container.querySelector("#acceptButton").addEventListener("click", acceptFocus);
  container.querySelector("#holdButton").addEventListener("click", () =>
    decide(item, {
      decision: "hold",
      senses: null,
      hint: null,
      resolvedBy: "human",
      decidedAt: new Date().toISOString(),
    }));
  container.querySelector("#skipButton").addEventListener("click", () => {
    focusNoteId = nextUndecidedRetarget(item.noteId)?.noteId ?? focusNoteId;
    renderAll();
  });
  container.querySelector("#rejectButton").addEventListener("click", () =>
    decide(item, {
      decision: "reject",
      senses: null,
      hint: null,
      resolvedBy: "human",
      decidedAt: new Date().toISOString(),
    }));
  container.querySelector("#openAnkiButton").addEventListener("click", async () => {
    try {
      await api("/api/open-note", { noteId: item.noteId });
      showToast("Opened in the Anki browser");
    } catch (error) {
      showToast(`Could not open: ${error.message}`);
    }
  });
}

function toggleSense(item, senseNumber) {
  if (item.applied) return;
  const work = getWorking(item);
  if (work.senses.has(senseNumber)) work.senses.delete(senseNumber);
  else work.senses.add(senseNumber);
  renderAll();
}

function acceptFocus() {
  const item = itemsByNoteId.get(focusNoteId);
  if (!item || item.applied) return;
  const work = getWorking(item);
  const selection = [...work.senses].sort((a, b) => a - b);
  const allOrNone = selection.length === 0 || selection.length === item.totalNewSenses;
  const hint = allOrNone ? null : (work.hint.trim() || null);
  const suggestion = item.suggestion;
  const matchesAI = suggestion !== null &&
    JSON.stringify(selection) === JSON.stringify([...suggestion.senses].sort((a, b) => a - b)) &&
    hint === suggestion.defaultHint;
  decide(item, {
    decision: "accept",
    senses: allOrNone ? [] : selection,
    hint,
    resolvedBy: suggestion === null ? "human" : (matchesAI ? "ai" : "ai-edited"),
    decidedAt: new Date().toISOString(),
  });
}

function renderRetargetQueue() {
  const container = document.getElementById("retargetQueue");
  container.innerHTML = "";
  for (const item of retargetItems()) {
    const stateIcon = item.applied
      ? "✅"
      : item.decision
      ? { accept: "✅", hold: "✋", reject: "🚫" }[item.decision.decision] ?? "•"
      : (item.noteId === focusNoteId ? "▶" : "○");
    let summary;
    if (item.decision?.decision === "accept") {
      const finalKey = computeKey(item, item.decision.senses ?? []);
      summary = `→ ${finalKey}${item.decision.hint ? ` · hint 「${item.decision.hint}」` : ""}`;
    } else if (item.suggestion) {
      const senses = item.suggestion.senses;
      const senseText = senses.length === 0 ? "all senses" : "senses " + senses.join(",");
      const hintText = item.suggestion.defaultHint
        ? (item.suggestion.defaultHint === item.hint
          ? "keep hint"
          : `hint 「${item.suggestion.defaultHint}」`)
        : (item.hint ? "drop hint" : "no hint");
      summary = `✨ suggests ${senseText} · ${hintText}`;
    } else {
      summary = item.detail;
    }

    const row = document.createElement("button");
    row.className = `queue-row ${item.noteId === focusNoteId ? "current" : ""} ${
      item.decision || item.applied ? "decided" : ""
    }`;
    row.innerHTML = `
      <span class="q-state">${stateIcon}</span>
      <span class="q-word" lang="ja">${escapeHTML(item.word)}</span>
      <span class="q-summary">${escapeHTML(summary)}</span>
      <span class="q-side">${
      item.suggestion ? `<span class="conf-dot ${item.suggestion.confidence}"></span>` : ""
    }<span class="senses-pill">${item.oldSenseCount}→${item.newSenseCount}</span></span>`;
    row.addEventListener("click", () => {
      focusNoteId = item.noteId;
      renderAll();
      document.getElementById("focusCard")?.scrollIntoView({ block: "nearest" });
    });
    container.append(row);
  }
}

/* ---------- routine section ---------- */

function renderRoutine() {
  const banner = document.getElementById("routineBanner");
  const container = document.getElementById("routineGroups");
  const list = routineItems();
  container.innerHTML = "";
  if (list.length === 0) {
    banner.innerHTML =
      '<div class="empty-state"><div class="empty-title">No routine updates</div><p>Every changed entry needed either nothing or a closer look.</p></div>';
    return;
  }

  const held = list.filter((item) => effectiveDecision(item) === "hold").length;
  banner.innerHTML = `
    <div class="banner">
      <div class="banner-text"><strong>${list.length} cards staged</strong> for a dictionary-HTML refresh.
        The chips show exactly what changed — skim and hold anything that looks off.
        ${held ? `<span class="chip chip-warn">${held} held</span>` : ""}</div>
      <button id="stageAllButton" ${held === 0 ? "disabled" : ""}>Stage all</button>
    </div>`;
  document.getElementById("stageAllButton")?.addEventListener("click", () => {
    const entries = list
      .filter((item) => effectiveDecision(item) === "hold")
      .map((item) => ({ noteId: item.noteId, record: null }));
    postDecisions(entries, { toast: "All routine updates staged" });
  });

  const byReason = new Map();
  for (const item of list) {
    if (!byReason.has(item.reason)) byReason.set(item.reason, []);
    byReason.get(item.reason).push(item);
  }
  const order = [
    ...ROUTINE_GROUP_ORDER,
    ...[...byReason.keys()].filter((reason) => !ROUTINE_GROUP_ORDER.includes(reason)),
  ];

  for (const reason of order) {
    const groupItems = byReason.get(reason);
    if (!groupItems) continue;
    const labels = REASON_LABELS[reason] ?? {};
    const groupElement = document.createElement("div");
    groupElement.className = "group";
    const groupHeld = groupItems.filter((item) => effectiveDecision(item) === "hold").length;
    groupElement.innerHTML = `
      <div class="group-head">
        <h3>${escapeHTML(labels.title ?? reason)}</h3>
        <span class="chip">${groupItems.length}</span>
        <span class="group-explain">${escapeHTML(labels.explain ?? "")}</span>
        <div class="group-actions">
          <button data-action="hold">Hold all</button>
          <button data-action="stage" ${groupHeld === 0 ? "disabled" : ""}>Stage all</button>
        </div>
      </div>
      <div class="rows"></div>`;
    const rows = groupElement.querySelector(".rows");
    for (const item of groupItems) rows.append(routineRow(item));
    groupElement.querySelector('[data-action="hold"]').addEventListener(
      "click",
      () =>
        postDecisions(
          groupItems.filter((item) => !item.applied).map((item) => ({
            noteId: item.noteId,
            record: {
              decision: "hold",
              senses: null,
              hint: null,
              resolvedBy: "human",
              decidedAt: new Date().toISOString(),
            },
          })),
          { toast: `Held ${groupItems.length}` },
        ),
    );
    groupElement.querySelector('[data-action="stage"]').addEventListener(
      "click",
      () =>
        postDecisions(
          groupItems
            .filter((item) => effectiveDecision(item) === "hold")
            .map((item) => ({ noteId: item.noteId, record: null })),
          { toast: "Staged" },
        ),
    );
    container.append(groupElement);
  }
}

function chipHTML(chip) {
  const kindClass = chip.kind.includes("added")
    ? "add"
    : chip.kind.includes("removed")
    ? "remove"
    : "";
  let body;
  if (chip.segments) {
    body = `<b>${escapeHTML(chip.label)}</b> ${segmentsSnippetHTML(chip.segments)}`;
  } else if (chip.kind === "form-added" || chip.kind === "form-removed") {
    body = `${chip.label} <span lang="ja">${escapeHTML(chip.text)}</span>`;
  } else if (chip.label) {
    body = `<b>${escapeHTML(chip.label)}</b> ${escapeHTML(truncate(chip.text ?? "", 42))}`;
  } else {
    body = escapeHTML(chip.text ?? "");
  }
  return `<span class="change-chip ${kindClass}">${body}</span>`;
}

function routineRow(item) {
  const held = effectiveDecision(item) === "hold";
  const row = document.createElement("div");
  row.className = `row ${held ? "held" : ""}`;
  row.dataset.noteId = item.noteId;

  const keyParts = item.key.split("|").map((part) => part.trim());
  const keySuffix = item.proposedKey
    ? "key updated"
    : (keyParts.length === 3 ? `#${keyParts[2]}` : "");
  const chips = item.changeChips.slice(0, 2).map(chipHTML).join("");
  const more = item.changeChips.length > 2
    ? `<span class="more-chip">+${item.changeChips.length - 2} more</span>`
    : "";
  const expanded = expandedRows.has(item.noteId);

  row.innerHTML = `
    <div class="row-main">
      <button class="state-toggle" title="${
    item.applied
      ? "Applied"
      : held
      ? "Held — click to stage the update"
      : "Staged to update — click to hold"
  }" ${item.applied ? "disabled" : ""}>${item.applied ? "✓" : "✓"}</button>
      <span class="row-word" lang="ja">${escapeHTML(item.word)}<span class="row-key-suffix">${
    escapeHTML(keySuffix)
  }</span></span>
      <span class="row-changes">${chips}${more}</span>
      <span class="senses-pill">${item.oldSenseCount}→${item.newSenseCount}</span>
      <button class="disclose">${expanded ? "▲ close" : "▼ diff"}</button>
    </div>
    ${expanded ? routineDetail(item) : ""}`;

  row.querySelector(".state-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    if (item.applied) return;
    if (held) {
      decide(item, null, { advance: false });
    } else {
      decide(item, {
        decision: "hold",
        senses: null,
        hint: null,
        resolvedBy: "human",
        decidedAt: new Date().toISOString(),
      }, { advance: false });
    }
  });
  row.querySelector(".row-main").addEventListener("click", () => {
    if (expandedRows.has(item.noteId)) expandedRows.delete(item.noteId);
    else expandedRows.add(item.noteId);
    renderAll();
  });
  return row;
}

function routineDetail(item) {
  const lines = item.changeChips.map((chip) => `
    <div class="detail-change-line">
      <span class="line-label">${escapeHTML(chip.label)}</span>
      <span>${chip.segments ? segmentsHTML(chip.segments) : escapeHTML(chip.text ?? "")}</span>
    </div>`).join("");
  const proposedKeyLine = item.proposedKey
    ? `<div class="detail-change-line"><span class="line-label">key</span><span>${
      keyDiffHTML(item.key, item.proposedKey)
    }</span></div>`
    : "";
  return `
    <div class="row-detail">
      <div class="detail-changes">${proposedKeyLine}${lines}</div>
      <details>
        <summary>Show full entries (targeted senses highlighted)</summary>
        <div class="entries-compare">
          <div class="entry-pane"><div class="pane-title">On card now</div>${
    markTargets(item.currentEntryHTML, item.targetSenseNumbers)
  }</div>
          <div class="entry-pane"><div class="pane-title">New JMDict</div>${
    markTargets(item.latestEntryHTML, item.mappedTargetSenses)
  }</div>
        </div>
      </details>
    </div>`;
}

function markTargets(entryHTML, targetNumbers) {
  const doc = new DOMParser().parseFromString(entryHTML || "", "text/html");
  const targets = new Set(targetNumbers);
  for (const [index, li] of [...doc.querySelectorAll("ol.senses > li")].entries()) {
    if (targets.has(index + 1)) li.classList.add("is-target");
  }
  return doc.body.innerHTML;
}

/* ---------- normalize & exceptions ---------- */

function renderNormalize() {
  const container = document.getElementById("normalizeBody");
  const list = normalizeItems();
  if (list.length === 0) {
    container.innerHTML =
      '<div class="normalize-strip">No encoding-only differences this run.</div>';
    return;
  }
  const applied = list.filter((item) => item.applied).length;
  container.innerHTML = `
    <div class="normalize-strip">
      <strong>${list.length} cards</strong> differ from the latest rendering only in entity encoding or whitespace
      — for example <del>it&amp;#39;s</del> → <ins>it's</ins> in the stored HTML.
      They'll be quietly brought in line when you apply${
    applied ? ` (${applied} already applied)` : ""
  }.
      <details>
        <summary>Show the ${list.length} words</summary>
        <div class="normalize-words">${
    list.map((item) => `<span lang="ja">${escapeHTML(item.word)}</span>`).join("")
  }</div>
      </details>
    </div>`;
}

function renderExceptions() {
  const container = document.getElementById("exceptionsBody");
  const list = exceptionItems();
  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">None this run 🎉</div>
        <p>Deleted entries, removed spellings, and unparseable cards land here,</p>
        <p>with the note opened in Anki for manual handling.</p>
      </div>`;
    return;
  }
  container.innerHTML = "";
  for (const item of list) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-main" style="cursor:default">
        <span></span>
        <span class="row-word" lang="ja">${escapeHTML(item.word)}</span>
        <span class="row-changes"><span class="chip chip-bad">${
      escapeHTML(reasonTitle(item.reason))
    }</span><span class="change-chip">${escapeHTML(item.detail)}</span></span>
        <span></span>
        <button class="disclose" data-open>Open in Anki</button>
      </div>`;
    row.querySelector("[data-open]").addEventListener("click", async () => {
      try {
        await api("/api/open-note", { noteId: item.noteId });
        showToast("Opened in the Anki browser");
      } catch (error) {
        showToast(`Could not open: ${error.message}`);
      }
    });
    container.append(row);
  }
}

/* ---------- apply ---------- */

function applyableItems() {
  return items.filter((item) =>
    item.verdict !== "exception" && !item.applied && effectiveDecision(item) === "accept" &&
    (item.verdict !== "retarget" || item.decision?.decision === "accept")
  );
}

function openApplyDialog() {
  const dialog = document.getElementById("applyDialog");
  const summary = document.getElementById("applySummary");
  const results = document.getElementById("applyResults");
  const confirm = document.getElementById("applyConfirm");
  const targets = applyableItems();
  const counts = { retarget: 0, routine: 0, normalize: 0 };
  for (const item of targets) ++counts[item.verdict];

  summary.innerHTML = `
    This writes to your Anki collection via AnkiConnect:
    <ul>
      ${
    counts.retarget
      ? `<li><strong>${counts.retarget}</strong> re-targeted (key/hint/entry)</li>`
      : ""
  }
      ${counts.routine ? `<li><strong>${counts.routine}</strong> routine entry refreshes</li>` : ""}
      ${
    counts.normalize ? `<li><strong>${counts.normalize}</strong> encoding normalizations</li>` : ""
  }
    </ul>
    Each note is re-checked against its analysis snapshot right before writing; anything that
    changed in Anki meanwhile is skipped.`;
  results.hidden = true;
  results.innerHTML = "";
  confirm.disabled = targets.length === 0;
  confirm.textContent = `Apply ${targets.length}`;
  confirm.onclick = () => runApply(targets);
  dialog.showModal();
}

async function runApply(targets) {
  const confirm = document.getElementById("applyConfirm");
  const results = document.getElementById("applyResults");
  confirm.disabled = true;
  confirm.textContent = "Applying…";
  try {
    const { results: applyResults } = await api("/api/apply", {
      noteIds: targets.map((item) => item.noteId),
    });
    let succeeded = 0;
    results.hidden = false;
    results.innerHTML = "";
    for (const result of applyResults) {
      const item = itemsByNoteId.get(result.noteId);
      if (result.ok) {
        ++succeeded;
        item.applied = { wroteFields: result.wroteFields };
        const line = document.createElement("div");
        line.className = "apply-result";
        line.innerHTML = `✅ <span lang="ja">${
          escapeHTML(item?.word ?? result.noteId)
        }</span> <span style="color:var(--faint)">${
          (result.wroteFields ?? []).join(", ") || "no change needed"
        }</span>`;
        results.append(line);
      } else {
        const line = document.createElement("div");
        line.className = "apply-result failed";
        line.innerHTML = `❌ <span lang="ja">${escapeHTML(item?.word ?? result.noteId)}</span> ${
          escapeHTML(result.error ?? "failed")
        }`;
        results.append(line);
      }
    }
    confirm.textContent = `Done — ${succeeded}/${applyResults.length} applied`;
    renderAll();
  } catch (error) {
    results.hidden = false;
    results.innerHTML = `<div class="apply-result failed">❌ ${escapeHTML(error.message)}</div>`;
    confirm.textContent = "Apply failed";
  }
}

/* ---------- toast ---------- */

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  document.getElementById("toastMessage").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ---------- keyboard ---------- */

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector("dialog[open]")) return;

  switch (event.key) {
    case "?":
      document.getElementById("helpDialog").showModal();
      return;
    case "z":
      undo();
      return;
  }

  const focusItem = itemsByNoteId.get(focusNoteId);
  if (!focusItem || !isInViewport(document.getElementById("focusCard"))) return;

  switch (event.key) {
    case "Enter":
      event.preventDefault();
      acceptFocus();
      return;
    case "x":
      decide(focusItem, {
        decision: "hold",
        senses: null,
        hint: null,
        resolvedBy: "human",
        decidedAt: new Date().toISOString(),
      });
      return;
    case "s":
      focusNoteId = nextUndecidedRetarget(focusNoteId)?.noteId ?? focusNoteId;
      renderAll();
      return;
    case "a":
      if (focusItem.suggestion) {
        working.set(focusItem.noteId, {
          senses: new Set(focusItem.suggestion.senses),
          hint: focusItem.suggestion.defaultHint ?? "",
        });
        renderAll();
      }
      return;
    case "h":
      document.getElementById("hintInput")?.focus();
      event.preventDefault();
      return;
    case "j":
    case "ArrowRight":
      moveFocus(1);
      event.preventDefault();
      return;
    case "k":
    case "ArrowLeft":
      moveFocus(-1);
      event.preventDefault();
      return;
  }
  if (/^[1-9]$/.test(event.key)) {
    const senseNumber = Number(event.key);
    if (senseNumber <= focusItem.totalNewSenses) toggleSense(focusItem, senseNumber);
  }
});

function moveFocus(delta) {
  const list = retargetItems();
  if (list.length === 0) return;
  const index = list.findIndex((item) => item.noteId === focusNoteId);
  focusNoteId = list[(index + delta + list.length) % list.length].noteId;
  renderAll();
}

function isInViewport(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 90 && rect.top < window.innerHeight * 0.8;
}

/* ---------- boot ---------- */

function renderAll() {
  renderHeader();
  renderRetargetBanner();
  renderFocusCard();
  renderRetargetQueue();
  renderRoutine();
  renderNormalize();
  renderExceptions();
}

async function boot() {
  try {
    const state = await api("/api/state");
    meta = state.meta;
    items = state.items;
    itemsByNoteId.clear();
    for (const item of state.items) itemsByNoteId.set(item.noteId, item);
  } catch (error) {
    const errorBox = document.getElementById("loadError");
    errorBox.hidden = false;
    errorBox.textContent = `Could not load the review data: ${error.message}`;
    return;
  }

  document.getElementById("main").hidden = false;
  document.getElementById("footer").hidden = false;
  document.getElementById("sectionNav").hidden = false;
  document.querySelector(".progress-cluster").hidden = false;
  document.querySelector(".topbar-actions").hidden = false;

  document.getElementById("undoButton").addEventListener("click", undo);
  document.getElementById("helpButton").addEventListener(
    "click",
    () => document.getElementById("helpDialog").showModal(),
  );
  document.getElementById("applyButton").addEventListener("click", openApplyDialog);
  document.getElementById("applyCancel").addEventListener(
    "click",
    () => document.getElementById("applyDialog").close(),
  );
  document.getElementById("toastUndo").addEventListener("click", () => {
    undo();
    document.getElementById("toast").classList.remove("show");
  });
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  renderAll();
}

boot();
