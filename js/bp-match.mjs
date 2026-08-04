// Shared entry-matching logic for the reader-suggestion feature. Used
// identically by the admin review page (js/bp-admin.js, in the browser)
// and the publish script (scripts/apply-approved-suggestions.js, in Node) —
// pure ESM, no DOM/Node-specific APIs, so it runs unmodified in both.
//
// A "correction" suggestion never carries a stable id back to the JSON
// files (see CLAUDE.md's Suggestions section for why). Instead it carries
// a breadcrumb + full snapshot captured client-side at submit time, and
// this module re-locates the entry at review/apply time. The rule that
// matters: on any doubt, return "no match" rather than guessing — a wrong
// silent overwrite is far worse than a suggestion that sits unapplied.

export function normName(name) {
  return String(name ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

// entries: the live array from the on-disk file (already JSON.parsed).
// target: the suggestion row's `target` jsonb — { entry_kind, entry_name,
//         entry_verses_or_text, entry_index, snapshot }.
// Returns { index: number|null, reason: null|'not-found'|'ambiguous' }.
export function findEntryIndex(entries, target) {
  if (!Array.isArray(entries) || !target) {
    return { index: null, reason: "not-found" };
  }
  const kind = target.entry_kind;
  const wantName = normName(target.entry_name);

  const byName = [];
  entries.forEach((entry, index) => {
    if (entry && normName(entry[kind]) === wantName) byName.push(index);
  });

  if (byName.length === 0) return { index: null, reason: "not-found" };
  if (byName.length === 1) return { index: byName[0], reason: null };

  const arrKey = kind === "highlight" ? "text" : "verses";
  const wantArr = Array.isArray(target.entry_verses_or_text)
    ? target.entry_verses_or_text
    : null;
  const byArr = wantArr
    ? byName.filter((i) => deepEqual(entries[i][arrKey], wantArr))
    : [];
  if (byArr.length === 1) return { index: byArr[0], reason: null };
  const candidates = byArr.length > 1 ? byArr : byName;

  // entry_index is only ever a tiebreaker among name (± array) matches —
  // never a primary locator, so array reordering alone can't misfire it.
  if (
    Number.isInteger(target.entry_index) &&
    candidates.includes(target.entry_index)
  ) {
    return { index: target.entry_index, reason: null };
  }

  return { index: null, reason: "ambiguous" };
}

// Confirms none of the fields this suggestion is about to touch have
// changed on disk since the suggestion was captured. `keys` = the keys
// present in the suggestion's `proposed` object.
export function snapshotIsFresh(liveEntry, snapshot, keys) {
  if (!liveEntry || !snapshot) return false;
  return keys.every((key) => deepEqual(liveEntry[key], snapshot[key]));
}

// Builds the full entry object to append for an action:'add' suggestion,
// in the same key order used throughout data/topics and data/bookwide.
export function entryFromProposed(row) {
  const p = row.proposed || {};
  const entry = {};
  if (row.entry_kind === "label") {
    entry.label = p.label;
    if (p.verses !== undefined) entry.verses = p.verses;
    if (p.references !== undefined) entry.references = p.references;
    if (p.note !== undefined) entry.note = p.note;
  } else if (row.entry_kind === "highlight") {
    entry.highlight = p.highlight;
    if (p.text !== undefined) entry.text = p.text;
  }
  return entry;
}

// Resolves which array in the parsed document a row targets.
// doc: the JSON.parse'd file content. Returns the array (or undefined if
// the chapter key doesn't exist yet — caller must create it).
//
// A chapter's topics may be either a plain array (older files) or
// { meta, topics: [...] } (newer files, meta holds chapter-level context
// shown in the footer legend) — see js/bible-loader.js's own unwrapping of
// this same shape when rendering.
export function resolveArray(doc, row) {
  if (row.scope === "bookwide") {
    return row.entry_kind === "label"
      ? doc.bookWideLabels
      : doc.bookWideHighlights;
  }
  const chapterKey = String(row.chapter);
  const chapterTopics = doc.chapterTopics ? doc.chapterTopics[chapterKey] : undefined;
  if (Array.isArray(chapterTopics)) return chapterTopics;
  if (chapterTopics && Array.isArray(chapterTopics.topics)) return chapterTopics.topics;
  return undefined;
}
