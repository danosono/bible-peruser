// Lightweight verse/reference validation for the Verses/References fields
// in the reader-suggestion form (js/bp-suggest.js). Fetches the small
// per-book data/books/{ID}.json files (chapterCount + per-chapter
// verseCount already baked in) rather than the 6.4MB data/bible.json.
// Every validator fails OPEN (ok: true) when book data can't be resolved,
// so a network hiccup never blocks submission.
import { resolveBookAlias } from "./bible-utils.js";

const bookInfoCache = new Map(); // bookId -> Promise<{chapterCount, verseCounts: Map} | null>

export function getBookInfo(bookId) {
  if (!bookInfoCache.has(bookId)) {
    bookInfoCache.set(
      bookId,
      fetch(`data/books/${bookId}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data || !Number.isInteger(data.chapterCount)) return null;
          // Use the highest verse NUMBER, not the raw verse count — some
          // chapters have a numbering gap (e.g. Matthew 18 omits v11 per
          // the BSB's textual apparatus, so it has 34 verses numbered
          // 1-10, 12-35), and the traditional final verse number is what
          // "Chapter:Verse" references actually mean, not the array length.
          const verseCounts = new Map();
          (data.chapters || []).forEach((c) => {
            const nums = (c.verses || []).map((v) => parseInt(v.n, 10)).filter((n) => !isNaN(n));
            verseCounts.set(c.number, nums.length ? Math.max(...nums) : c.verseCount);
          });
          return { chapterCount: data.chapterCount, verseCounts };
        })
        .catch(() => null),
    );
  }
  return bookInfoCache.get(bookId);
}

function ok() {
  return { ok: true, error: null };
}

function fail(errors) {
  return { ok: false, error: errors.join("; ") };
}

export async function validateChapterVerses(rawText, bookId, chapterNum) {
  const tokens = String(rawText || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return ok();

  const info = await getBookInfo(bookId);
  if (!info) return ok();
  const verseCount = info.verseCounts.get(chapterNum);
  if (!verseCount) return ok();

  const errors = [];
  for (const token of tokens) {
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue; // not a plain number/range — leave it alone
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || start > verseCount) {
      errors.push(`Verse ${start} doesn't exist in this chapter (it has ${verseCount} verses)`);
      continue;
    }
    if (m[2]) {
      if (end < start) {
        errors.push(`"${token}" is a reversed range`);
        continue;
      }
      if (end > verseCount) {
        errors.push(`Verse ${end} doesn't exist in this chapter (it has ${verseCount} verses)`);
      }
    }
  }
  return errors.length ? fail(errors) : ok();
}

export async function validateBookwideVerses(rawText, bookId) {
  const tokens = String(rawText || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return ok();

  const info = await getBookInfo(bookId);
  if (!info) return ok();

  const errors = [];
  for (const token of tokens) {
    const m = token.match(/^(\d+):(\d+)(?:\s*[-–]\s*(?:(\d+):)?(\d+))?$/);
    if (!m) continue; // not the Chapter:Verse shape — leave it alone
    const c1 = parseInt(m[1], 10);
    const v1 = parseInt(m[2], 10);

    if (c1 < 1 || c1 > info.chapterCount) {
      errors.push(`Chapter ${c1} doesn't exist in this book (it has ${info.chapterCount} chapters)`);
      continue;
    }
    const vc1 = info.verseCounts.get(c1);
    if (vc1 && (v1 < 1 || v1 > vc1)) {
      errors.push(`${c1}:${v1} doesn't exist (chapter ${c1} has ${vc1} verses)`);
      continue;
    }

    if (m[4]) {
      const c2 = m[3] ? parseInt(m[3], 10) : c1;
      const v2 = parseInt(m[4], 10);
      if (c2 < 1 || c2 > info.chapterCount) {
        errors.push(`Chapter ${c2} doesn't exist in this book (it has ${info.chapterCount} chapters)`);
        continue;
      }
      const vc2 = info.verseCounts.get(c2);
      if (vc2 && (v2 < 1 || v2 > vc2)) {
        errors.push(`${c2}:${v2} doesn't exist (chapter ${c2} has ${vc2} verses)`);
        continue;
      }
      if (c2 < c1 || (c2 === c1 && v2 < v1)) {
        errors.push(`"${token}" is a reversed range`);
      }
    }
  }
  return errors.length ? fail(errors) : ok();
}

const REF_RE =
  /^([1-3]?\s?[A-Za-z][A-Za-z. ]*?)\s+(\d+):(\d+)(?:\s*[-–]\s*(?:(\d+):)?(\d+))?\s*(?:\([^()]*\))?$/;

export async function validateReferenceLines(lines) {
  const errors = [];
  for (const line of lines) {
    const m = line.match(REF_RE);
    if (!m) continue; // doesn't cleanly parse — don't risk a false positive

    const refBookId = resolveBookAlias(m[1]);
    if (!refBookId) {
      errors.push(`Unrecognized book name in reference: "${line}"`);
      continue;
    }

    const info = await getBookInfo(refBookId);
    if (!info) continue; // can't verify — allow it

    const c1 = parseInt(m[2], 10);
    const v1 = parseInt(m[3], 10);
    if (c1 < 1 || c1 > info.chapterCount) {
      errors.push(`"${line}" — chapter ${c1} doesn't exist in that book`);
      continue;
    }
    const vc1 = info.verseCounts.get(c1);
    if (vc1 && (v1 < 1 || v1 > vc1)) {
      errors.push(`"${line}" — verse ${v1} doesn't exist in chapter ${c1}`);
      continue;
    }

    if (m[5]) {
      const c2 = m[4] ? parseInt(m[4], 10) : c1;
      const v2 = parseInt(m[5], 10);
      if (c2 < 1 || c2 > info.chapterCount) {
        errors.push(`"${line}" — chapter ${c2} doesn't exist in that book`);
        continue;
      }
      const vc2 = info.verseCounts.get(c2);
      if (vc2 && (v2 < 1 || v2 > vc2)) {
        errors.push(`"${line}" — verse ${v2} doesn't exist in chapter ${c2}`);
        continue;
      }
      if (c2 < c1 || (c2 === c1 && v2 < v1)) {
        errors.push(`"${line}" is a reversed range`);
      }
    }
  }
  return errors.length ? fail(errors) : ok();
}
