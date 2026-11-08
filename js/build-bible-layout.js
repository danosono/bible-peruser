#!/usr/bin/env node
// js/build-bible-layout.js — generates data/layout/NNN_BOOK_BSB.json from the
// USFM source files in sfm/, one file per book.
//
// What it extracts (all editorial markup from the Berean Standard Bible
// source, not present in data/bible.json which is verse-flat):
//   - paragraph / stanza starts  (\m \p \pmo \pi \pc markers, and \b blank lines)
//   - poetry line segments       (\q1 \q2 \q3 \qr \qc …, and \li1 \li2 list lines)
//     as character offsets into the verse text as it appears in bible.json
//   - Psalm superscriptions      (\d — e.g. "A Psalm of David") — absent from bible.json
//   - acrostic letter headings   (\qa — Psalm 119). bible.json glued each of
//     these onto the END of the preceding verse's text ("…forsake me. BETH");
//     the layout records that tail so the renderer can lift it back out.
//
// Safety: for every verse it rebuilds the text from the USFM lines (footnotes
// and cross-references stripped) and requires it to be byte-identical to the
// bible.json verse text. Any verse that differs fails its whole book: no file
// is written for that book and the differing verses are printed. A book with
// no layout file simply renders as it does today, so a failure can never
// produce wrong line breaks — only the absence of them.
//
// Usage:
//   node js/build-bible-layout.js             # write all 66 books
//   node js/build-bible-layout.js --dry-run   # verify + report only, write nothing
//   node js/build-bible-layout.js --book PSA  # one book (combinable with --dry-run)
//
// Built-ins only (no npm dependencies in this repo).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SFM_DIR = path.join(ROOT, "sfm");
const OUT_DIR = path.join(ROOT, "data", "layout");
const BIBLE_JSON = path.join(ROOT, "data", "bible.json");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_BOOK = (() => {
  const i = args.indexOf("--book");
  return i >= 0 ? String(args[i + 1] || "").toUpperCase() : null;
})();

// Marker classes. Anything not listed here is reported under "unknown" so a
// new marker in a future source drop is noticed rather than silently dropped.
const POETRY_LINE = new Set(["q", "q1", "q2", "q3", "q4", "qr", "qc", "qm", "qm1", "qm2", "qm3"]);
const LIST_LINE = new Set(["li", "li1", "li2", "li3", "li4"]);
const PROSE_PARA = new Set(["m", "p", "pmo", "pm", "pmr", "pmc", "pi", "pi1", "pi2", "pi3", "pc", "mi"]);
const CONTINUE_PARA = new Set(["nb"]); // "no break" — explicitly continues the paragraph
const IGNORED = new Set([
  "id", "h", "toc1", "toc2", "toc3", "mt", "mt1", "mt2", "mt3", "ms", "ms1", "mr",
  "s", "s1", "s2", "s3", "r", "c", "cl", "sp", "rem", "ie", "ide", "usfm",
]);

function stripInline(text) {
  return text
    .replace(/\\f\s[\s\S]*?\\f\*/g, "") // footnotes
    .replace(/\\x\s[\s\S]*?\\x\*/g, "") // cross-references
    .replace(/\\[a-z]+\d?\*?/g, "") // any remaining inline marker tokens (content kept)
    .replace(/\s+/g, " ")
    .trim();
}

// Parses one book's USFM into { chapters: { n: { d, qa:{v:letter}, verses: { v: { segs:[{m,text}], para } } } }, unknown: Set }
function parseUsfm(source) {
  const lines = source.replace(/\r/g, "").split("\n");
  const chapters = {};
  const unknown = {};
  let ch = null;
  let verse = null; // current verse record
  let pendingMarker = null; // marker on an otherwise empty line, applies to the next \v
  let pendingBreak = false; // \b seen since the last verse started
  let pendingQa = null;
  const chapterRec = () => chapters[ch] || (chapters[ch] = { d: null, qa: {}, verses: {} });

  for (const raw of lines) {
    const m = raw.match(/^\\([a-z]+\d?)(?:\s(.*))?$/);
    if (!m) continue; // continuation/garbage lines (none expected in BSB)
    const tag = m[1];
    const rest = m[2] === undefined ? "" : m[2];

    if (tag === "c") {
      ch = parseInt(rest, 10);
      chapterRec();
      verse = null;
      pendingMarker = null;
      pendingBreak = false;
      pendingQa = null;
      continue;
    }
    if (ch === null) continue; // front matter
    if (tag === "v") {
      const vm = rest.match(/^(\d+)(?:-(\d+))?\s*(.*)$/);
      if (!vm) throw new Error(`bad verse line in chapter ${ch}: ${raw}`);
      if (vm[2]) throw new Error(`verse range not supported: ${ch}:${vm[1]}-${vm[2]}`);
      const v = parseInt(vm[1], 10);
      const firstMarker = pendingMarker || "cont";
      verse = {
        segs: [{ m: firstMarker, text: stripInline(vm[3]) }],
        para: pendingBreak || PROSE_PARA.has(firstMarker),
      };
      chapterRec().verses[v] = verse;
      if (pendingQa) {
        chapterRec().qa[v] = pendingQa;
        pendingQa = null;
      }
      pendingMarker = null;
      pendingBreak = false;
      continue;
    }
    if (tag === "b") {
      pendingBreak = true;
      continue;
    }
    if (tag === "d") {
      chapterRec().d = stripInline(rest);
      continue;
    }
    if (tag === "qa") {
      pendingQa = stripInline(rest);
      continue;
    }
    if (POETRY_LINE.has(tag) || LIST_LINE.has(tag) || PROSE_PARA.has(tag) || CONTINUE_PARA.has(tag)) {
      const text = stripInline(rest);
      if (text === "") {
        // Marker-only line: describes the line/paragraph the NEXT \v begins.
        pendingMarker = tag;
      } else if (verse) {
        // Mid-verse continuation line (poetry second half-line, or a new
        // paragraph starting inside a verse).
        verse.segs.push({ m: tag, text });
      }
      continue;
    }
    if (IGNORED.has(tag)) continue;
    unknown[tag] = (unknown[tag] || 0) + 1;
  }
  return { chapters, unknown };
}

// Builds the compact layout record for one book and verifies it against
// bible.json. Returns { layout, mismatches, stats }.
function buildBookLayout(bookJson, parsed) {
  const layout = { bookId: bookJson.id, chapters: {} };
  const mismatches = [];
  let verses = 0;
  let segmented = 0;
  for (const chap of bookJson.chapters) {
    const pc = parsed.chapters[chap.number];
    if (!pc) {
      mismatches.push(`${chap.number}: chapter missing in USFM`);
      continue;
    }
    const out = {};
    if (pc.d) out.d = pc.d;
    if (Object.keys(pc.qa).length) out.qa = pc.qa;
    const para = [];
    const lines = {};
    const tails = {};
    for (const verse of chap.verses) {
      verses++;
      const v = parseInt(verse.n, 10);
      const pv = pc.verses[v];
      if (!pv) {
        mismatches.push(`${chap.number}:${verse.n}: verse missing in USFM`);
        continue;
      }
      const segs = pv.segs.filter((s) => s.text !== "");
      const joined = segs.map((s) => s.text).join(" ");
      let json = verse.text;
      // Psalm 119: bible.json appended the next stanza's acrostic heading to
      // this verse ("… forsake me. BETH"). Accept it when it matches the \qa
      // registered for the following verse, and record the tail to strip.
      const nextQa = pc.qa[v + 1];
      if (joined !== json && nextQa && json.toUpperCase() === (joined + " " + nextQa).toUpperCase()) {
        tails[v] = json.slice(joined.length + 1);
        json = joined;
      }
      if (joined !== json) {
        mismatches.push(
          `${chap.number}:${verse.n}\n      usfm: ${joined}\n      json: ${json}`,
        );
        continue;
      }
      if (pv.para) para.push(v);
      const isLineVerse = segs.some((s) => POETRY_LINE.has(s.m) || LIST_LINE.has(s.m));
      const hasInnerPara = segs.slice(1).some((s) => PROSE_PARA.has(s.m));
      if (isLineVerse || hasInnerPara) {
        let offset = 0;
        const arr = [];
        segs.forEach((s, i) => {
          // Marker for the segment's own line type; "cont" (first segment with
          // no marker line before \v) continues the previous line/paragraph.
          arr.push([offset, s.m]);
          offset += s.text.length + (i < segs.length - 1 ? 1 : 0);
        });
        lines[v] = arr;
        segmented++;
      }
    }
    if (para.length) out.para = para;
    if (Object.keys(lines).length) out.lines = lines;
    if (Object.keys(tails).length) out.tails = tails;
    if (Object.keys(out).length) layout.chapters[chap.number] = out;
    // Verses present in USFM but not in bible.json
    for (const v of Object.keys(pc.verses)) {
      if (!chap.verses.some((x) => parseInt(x.n, 10) === parseInt(v, 10))) {
        mismatches.push(`${chap.number}:${v}: verse in USFM but not in bible.json`);
      }
    }
  }
  return { layout, mismatches, stats: { verses, segmented } };
}

function main() {
  const bible = JSON.parse(fs.readFileSync(BIBLE_JSON, "utf8"));
  const sfmFiles = fs.readdirSync(SFM_DIR).filter((f) => /\.sfm$/i.test(f));
  // Paratext file names: NN + 3-letter id, e.g. 09 1SA → "091SABSB.SFM".
  // NN is 01–39 for the OT and 41–66 for the NT (40 is reserved), so the
  // canonical 1–66 position used by data/topics file names is NN, or NN-1
  // past 40. bible.json itself lists books alphabetically, so its index is
  // no use for numbering.
  const sfmById = {};
  const canonById = {};
  for (const f of sfmFiles) {
    const nn = parseInt(f.slice(0, 2), 10);
    const id = f.slice(2, 5).toUpperCase();
    sfmById[id] = f;
    canonById[id] = nn > 40 ? nn - 1 : nn;
  }
  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  let failed = 0;
  let written = 0;
  const unknownAll = {};
  const rows = [];
  bible.books.forEach((book) => {
    if (ONLY_BOOK && book.id !== ONLY_BOOK) return;
    const sfm = sfmById[book.id];
    if (!sfm) {
      rows.push(`${book.id}  NO USFM FILE`);
      failed++;
      return;
    }
    const parsed = parseUsfm(fs.readFileSync(path.join(SFM_DIR, sfm), "utf8"));
    for (const [k, n] of Object.entries(parsed.unknown)) unknownAll[k] = (unknownAll[k] || 0) + n;
    const { layout, mismatches, stats } = buildBookLayout(book, parsed);
    const outName = `${String(canonById[book.id]).padStart(3, "0")}_${book.id}_BSB.json`;
    if (mismatches.length) {
      failed++;
      rows.push(`${book.id}  FAIL  ${mismatches.length} mismatch(es) in ${stats.verses} verses — not written`);
      mismatches.slice(0, 6).forEach((m) => rows.push(`    ${m}`));
      if (mismatches.length > 6) rows.push(`    … ${mismatches.length - 6} more`);
      return;
    }
    const paraCount = Object.values(layout.chapters).reduce((n, c) => n + (c.para ? c.para.length : 0), 0);
    const dCount = Object.values(layout.chapters).filter((c) => c.d).length;
    rows.push(
      `${book.id}  ok    ${String(stats.verses).padStart(4)} verses, ${String(stats.segmented).padStart(4)} line-verses, ${String(paraCount).padStart(4)} para starts${dCount ? `, ${dCount} superscriptions` : ""}  → ${outName}${DRY_RUN ? " (dry run)" : ""}`,
    );
    if (!DRY_RUN) {
      layout.generatedFrom = `sfm/${sfm}`;
      layout.generatedBy = "js/build-bible-layout.js";
      fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(layout) + "\n");
      written++;
    }
  });
  console.log(rows.join("\n"));
  if (Object.keys(unknownAll).length) {
    console.log(`\nUnhandled markers (ignored, review): ${JSON.stringify(unknownAll)}`);
  }
  console.log(`\n${DRY_RUN ? "Dry run. " : ""}${written} file(s) written, ${failed} book(s) failed.`);
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();
