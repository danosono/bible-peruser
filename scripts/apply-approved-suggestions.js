#!/usr/bin/env node
// Publishes approved reader suggestions (js/bp-admin.js) into the on-disk
// data/topics and data/bookwide JSON files as a set of surgical text edits,
// so `git diff` shows exactly the intended change and nothing else.
//
// Usage:
//   node scripts/apply-approved-suggestions.js [--dry-run]
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from a local .env (never
// committed). No npm install — only Node's built-in fetch/fs. Never runs
// git; the owner reviews `git diff data/` and commits normally afterward.
// Never touches js/usfm-outline-extractor.js.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const {
  deepEqual,
  findEntryIndex,
  snapshotIsFresh,
  entryFromProposed,
  resolveArray,
} = await import(pathToFileURL(path.join(REPO_ROOT, "js", "bp-match.mjs")).href);
const {
  findKeyInObject,
  skipValue,
  arrayElementRanges,
  spliceAppendToArray,
  spliceInsertChapterKey,
  spliceSetField,
  spliceDeleteField,
} = await import(pathToFileURL(path.join(REPO_ROOT, "js", "bp-json-edit.mjs")).href);

const DRY_RUN = process.argv.includes("--dry-run");

function loadEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  const env = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return env;
}

function findDataFile(dir, bookId) {
  const full = path.join(REPO_ROOT, dir);
  if (!existsSync(full)) return null;
  const re = new RegExp(`^\\d{3}_${bookId}_BSB\\.json$`);
  const match = readdirSync(full).find((f) => re.test(f));
  return match ? path.join(full, match) : null;
}

function filePathForRow(row) {
  return row.scope === "bookwide"
    ? findDataFile("data/bookwide", row.book_id)
    : findDataFile("data/topics", row.book_id);
}

function topLevelObjectStart(src) {
  let i = 0;
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

// Finds the array in TEXT that this row targets. For scope:'chapter' the
// chapter key may not exist yet (a chapter with zero prior label/highlight
// entries) — callers must handle the 'missing-chapter' case.
function locateArrayInText(src, row) {
  const topStart = topLevelObjectStart(src);
  if (row.scope === "bookwide") {
    const arrayKey = row.entry_kind === "label" ? "bookWideLabels" : "bookWideHighlights";
    const found = findKeyInObject(src, topStart, arrayKey);
    if (!found) throw new Error(`Top-level key "${arrayKey}" not found`);
    return { kind: "array", start: found.valueStart, end: found.valueEnd };
  }
  const ctFound = findKeyInObject(src, topStart, "chapterTopics");
  if (!ctFound) throw new Error('Top-level key "chapterTopics" not found');
  const ctObjStart = ctFound.valueStart;
  const ctObjEnd = skipValue(src, ctFound.valueStart);
  const chapterKey = String(row.chapter);
  const chFound = findKeyInObject(src, ctObjStart, chapterKey);
  if (!chFound) return { kind: "missing-chapter", ctObjStart, ctObjEnd, chapterKey };

  // A chapter's value is either a plain array, or { meta, topics: [...] }
  // (see resolveArray() in bp-match.mjs — same shape, same reasoning).
  if (src[chFound.valueStart] === "[") {
    return { kind: "array", start: chFound.valueStart, end: chFound.valueEnd };
  }
  if (src[chFound.valueStart] === "{") {
    const topicsFound = findKeyInObject(src, chFound.valueStart, "topics");
    if (topicsFound && src[topicsFound.valueStart] === "[") {
      return { kind: "array", start: topicsFound.valueStart, end: topicsFound.valueEnd };
    }
  }
  throw new Error(`Chapter "${chapterKey}" value is neither an array nor {meta, topics}`);
}

function ensureShadowArray(shadowDoc, row) {
  let arr = resolveArray(shadowDoc, row);
  if (Array.isArray(arr)) return arr;
  if (row.scope === "chapter") {
    if (!shadowDoc.chapterTopics) shadowDoc.chapterTopics = {};
    shadowDoc.chapterTopics[String(row.chapter)] = [];
    return shadowDoc.chapterTopics[String(row.chapter)];
  }
  const key = row.entry_kind === "label" ? "bookWideLabels" : "bookWideHighlights";
  shadowDoc[key] = [];
  return shadowDoc[key];
}

// Applies one 'add' row to both the text (src) and the shadow ground-truth
// object, returning the updated src.
function applyAdd(src, shadowDoc, row) {
  const entry = entryFromProposed(row);
  const loc = locateArrayInText(src, row);
  const newSrc =
    loc.kind === "missing-chapter"
      ? spliceInsertChapterKey(src, loc.ctObjStart, loc.ctObjEnd, loc.chapterKey, entry)
      : spliceAppendToArray(src, loc.start, loc.end, entry);
  ensureShadowArray(shadowDoc, row).push(JSON.parse(JSON.stringify(entry)));
  return newSrc;
}

// Applies one 'correct' row. Returns { src, outcome } where outcome is
// 'applied' or { unmatched: reason }. Matching/staleness are checked
// against the shadow doc, which reflects every row already applied THIS
// run (so two approved rows touching the same field can't silently race —
// the second sees the first's change and is correctly marked stale if it
// no longer matches its own snapshot).
function applyCorrect(src, shadowDoc, row) {
  const liveArr = resolveArray(shadowDoc, row);
  if (!Array.isArray(liveArr)) return { src, outcome: { unmatched: "not-found" } };

  const match = findEntryIndex(liveArr, row.target);
  if (match.index === null) return { src, outcome: { unmatched: match.reason } };

  const liveEntry = liveArr[match.index];
  const keys = Object.keys(row.proposed);
  if (!snapshotIsFresh(liveEntry, row.target.snapshot, keys)) {
    return { src, outcome: { unmatched: "stale" } };
  }

  const loc = locateArrayInText(src, row);
  if (loc.kind !== "array") {
    // Shadow says the array/entry exists but the text doesn't — should be
    // unreachable in practice; fail safe rather than guess.
    return { src, outcome: { unmatched: "not-found" } };
  }

  let newSrc = src;
  for (const [key, value] of Object.entries(row.proposed)) {
    const ranges = arrayElementRanges(newSrc, loc.start);
    const elRange = ranges[match.index];
    if (!elRange) return { src, outcome: { unmatched: "not-found" } };
    newSrc =
      value === null
        ? spliceDeleteField(newSrc, elRange.start, elRange.end, key)
        : spliceSetField(newSrc, elRange.start, elRange.end, key, value);
  }

  for (const [key, value] of Object.entries(row.proposed)) {
    if (value === null) delete liveEntry[key];
    else liveEntry[key] = JSON.parse(JSON.stringify(value));
  }

  return { src: newSrc, outcome: "applied" };
}

async function main() {
  const env = loadEnv();
  const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill them in.",
    );
    process.exit(1);
  }

  const restHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bp_suggestions?status=eq.approved&order=created_at.asc&select=*`,
    { headers: restHeaders },
  );
  if (!listRes.ok) {
    console.error(`Failed to fetch approved suggestions: ${listRes.status} ${await listRes.text()}`);
    process.exit(1);
  }
  const rows = await listRes.json();
  if (!rows.length) {
    console.log("No approved suggestions waiting to be applied.");
    return;
  }

  // Group by target file, preserving each row's created_at-asc order.
  const byFile = new Map(); // filePath -> rows[]
  const outcomes = new Map(); // row.id -> 'applied' | {unmatched: reason} | {error}
  for (const row of rows) {
    const filePath = filePathForRow(row);
    if (!filePath) {
      outcomes.set(row.id, { unmatched: "not-found" });
      continue;
    }
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push(row);
  }

  const writes = []; // { filePath, newSrc }
  for (const [filePath, fileRows] of byFile) {
    const originalSrc = readFileSync(filePath, "utf8");
    let originalDoc;
    try {
      originalDoc = JSON.parse(originalSrc);
    } catch (err) {
      for (const row of fileRows) outcomes.set(row.id, { error: `File is not valid JSON: ${err.message}` });
      continue;
    }
    const shadowDoc = JSON.parse(JSON.stringify(originalDoc));
    let src = originalSrc;

    for (const row of fileRows) {
      try {
        if (row.action === "add") {
          src = applyAdd(src, shadowDoc, row);
          outcomes.set(row.id, "applied");
        } else {
          const result = applyCorrect(src, shadowDoc, row);
          src = result.src;
          outcomes.set(row.id, result.outcome);
        }
      } catch (err) {
        outcomes.set(row.id, { error: err.message });
      }
    }

    // Safety net: the text-spliced result, re-parsed, must exactly match
    // the independently-computed shadow object — two different code paths
    // (string splicing vs. plain object mutation) have to agree, or we
    // abort the ENTIRE run rather than risk writing a corrupted file.
    let reparsed;
    try {
      reparsed = JSON.parse(src);
    } catch (err) {
      console.error(`ABORTING: ${filePath} would no longer be valid JSON (${err.message}). Nothing was written.`);
      process.exit(1);
    }
    if (!deepEqual(reparsed, shadowDoc)) {
      console.error(
        `ABORTING: ${filePath} — the surgical edit result doesn't match the expected content. Nothing was written. This is a bug in scripts/apply-approved-suggestions.js, not bad data — please report it rather than re-running.`,
      );
      process.exit(1);
    }

    if (src !== originalSrc) writes.push({ filePath, newSrc: src });
  }

  console.log(`\n${DRY_RUN ? "[dry run] " : ""}Suggestion outcomes:`);
  let appliedCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    const outcome = outcomes.get(row.id);
    const where = row.scope === "bookwide" ? `${row.book_id} (book-wide)` : `${row.book_id} ${row.chapter}`;
    if (outcome === "applied") {
      appliedCount++;
      console.log(`  OK        ${where} · ${row.entry_kind} · ${row.action} (${row.id})`);
    } else {
      skippedCount++;
      const reason = outcome?.unmatched ? `unmatched: ${outcome.unmatched}` : outcome?.error ? `error: ${outcome.error}` : "unknown";
      console.log(`  SKIPPED   ${where} · ${row.entry_kind} · ${row.action} — ${reason} (${row.id})`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDry run: would apply ${appliedCount}, skip ${skippedCount}. No files written, no rows updated.`);
    return;
  }

  for (const { filePath, newSrc } of writes) {
    writeFileSync(filePath, newSrc, "utf8");
  }

  const now = new Date().toISOString();
  for (const row of rows) {
    const outcome = outcomes.get(row.id);
    const patch =
      outcome === "applied"
        ? { status: "applied", applied_at: now }
        : { status: "unmatched", review_note: outcome?.unmatched || outcome?.error || "unknown" };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bp_suggestions?id=eq.${row.id}`, {
      method: "PATCH",
      headers: restHeaders,
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      console.error(`Warning: failed to update status for suggestion ${row.id}: ${res.status}`);
    }
  }

  console.log(
    `\nApplied ${appliedCount} suggestion(s) to ${writes.length} file(s), skipped ${skippedCount}.\n` +
      `Review with:  git diff data/\n` +
      `Then commit as you normally would. Nothing was committed or pushed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
