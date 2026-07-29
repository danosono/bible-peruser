// Book Info Builder
// Produces data/book-info.json (+ lazily-loaded data/book-info-full.json)
// for the "Book" footer feature: date written, author(s), and a summary
// for every one of the 66 books.
//
// Run manually whenever the source data changes: node js/build-book-info.js
// Not part of any runtime build step (this project has no build pipeline).
//
// Sources:
// - Date written / author(s): hand-transcribed from
//   "RawDataInclude/Berean/Book Authors Dates.csv" (bare facts only —
//   dates and author names aren't copyrightable regardless of that CSV's
//   own source; its "Notes" column of original argumentation is
//   deliberately NOT used here). Per the user, grouped books (e.g. the
//   Pentateuch under Moses, or 1 & 2 Kings) simply share identical values.
// - Summary: excerpted from Easton's Bible Dictionary (M.G. Easton, 1897;
//   local plain-text copy at "RawDataInclude/Easton/ebd2.txt", whose own
//   file header states "Rights: Public Domain").

const fs = require("fs");
const path = require("path");

const EASTON_TXT_PATH =
  "C:/Unity Projects/_BibleDatasets/GospelgoMapDatasets/RawDataInclude/Easton/ebd2.txt";

const OUT_DIR = path.join(__dirname, "..", "data");

const EASTON_CREDIT = "Easton's Bible Dictionary (1897, public domain, via ccel.org)";

// Hand-transcribed from "Book Authors Dates.csv". Grouped books share
// identical values, exactly as they appear on the CSV's shared row.
const DATE_AUTHOR = {
  GEN: { dateWritten: "1445-1406 BC", authors: ["Moses"] },
  EXO: { dateWritten: "1445-1406 BC", authors: ["Moses"] },
  LEV: { dateWritten: "1445-1406 BC", authors: ["Moses"] },
  NUM: { dateWritten: "1445-1406 BC", authors: ["Moses"] },
  DEU: { dateWritten: "1406 BC", authors: ["Moses", "Joshua (traditionally, final chapter)"] },
  JOS: { dateWritten: "1370 BC", authors: ["Joshua", "Phinehas (traditionally, closing verses)"] },
  JDG: { dateWritten: "1085-971 BC", authors: ["Unknown (traditionally Samuel)"] },
  RUT: { dateWritten: "1085-971 BC", authors: ["Unknown (traditionally Samuel)"] },
  "1SA": { dateWritten: "1030-931 BC", authors: ["Samuel", "Nathan", "Gad"] },
  "2SA": { dateWritten: "1030-931 BC", authors: ["Samuel", "Nathan", "Gad"] },
  "1KI": { dateWritten: "627-574 BC", authors: ["Jeremiah (traditionally)", "Ezra"] },
  "2KI": { dateWritten: "627-574 BC", authors: ["Jeremiah (traditionally)", "Ezra"] },
  "1CH": { dateWritten: "450-400 BC", authors: ["Ezra (traditionally)"] },
  "2CH": { dateWritten: "450-400 BC", authors: ["Ezra (traditionally)"] },
  EZR: { dateWritten: "440 BC", authors: ["Ezra"] },
  NEH: { dateWritten: "430 BC", authors: ["Nehemiah"] },
  EST: { dateWritten: "474-450 BC", authors: ["Unknown"] },
  JOB: { dateWritten: "1030-931 BC", authors: ["Unknown"] },
  PSA: {
    dateWritten: "440-400 BC",
    authors: [
      "David", "Sons of Korah", "Asaph", "Solomon",
      "Heman the Ezrahite", "Ethan the Ezrahite", "Moses", "and others",
    ],
  },
  PRO: { dateWritten: "971-686 BC", authors: ["Solomon", "Agur", "Lemuel"] },
  ECC: { dateWritten: "c. 940 BC", authors: ["Solomon"] },
  SNG: { dateWritten: "c. 940 BC", authors: ["Solomon"] },
  ISA: { dateWritten: "739-686 BC", authors: ["Isaiah"] },
  JER: { dateWritten: "605-580 BC", authors: ["Jeremiah", "Baruch (scribe)"] },
  LAM: { dateWritten: "586 BC", authors: ["Jeremiah"] },
  EZK: { dateWritten: "597-573 BC", authors: ["Ezekiel"] },
  DAN: { dateWritten: "550-530 BC", authors: ["Daniel"] },
  HOS: { dateWritten: "782-722 BC", authors: ["Hosea"] },
  JOL: { dateWritten: "800-700 BC", authors: ["Joel"] },
  AMO: { dateWritten: "792-752 BC", authors: ["Amos"] },
  OBA: { dateWritten: "586 BC", authors: ["Obadiah"] },
  JON: { dateWritten: "745-630 BC", authors: ["Jonah (traditionally)"] },
  MIC: { dateWritten: "733-701 BC", authors: ["Micah"] },
  NAM: { dateWritten: "663-626 BC", authors: ["Nahum"] },
  HAB: { dateWritten: "626-590 BC", authors: ["Habakkuk"] },
  ZEP: { dateWritten: "636-627 BC", authors: ["Zephaniah"] },
  HAG: { dateWritten: "520 BC", authors: ["Haggai"] },
  ZEC: { dateWritten: "520-480 BC", authors: ["Zechariah"] },
  MAL: { dateWritten: "515-415 BC (uncertain)", authors: ["Malachi"] },
  MAT: { dateWritten: "60-66 AD", authors: ["Matthew"] },
  MRK: { dateWritten: "64-67 AD", authors: ["Mark", "based on Peter's account"] },
  LUK: { dateWritten: "61-64 AD", authors: ["Luke"] },
  JHN: { dateWritten: "85-90 AD", authors: ["John"] },
  ACT: { dateWritten: "63-64 AD", authors: ["Luke"] },
  ROM: { dateWritten: "57 AD", authors: ["Paul"] },
  "1CO": { dateWritten: "55 AD", authors: ["Paul"] },
  "2CO": { dateWritten: "56 AD", authors: ["Paul"] },
  GAL: { dateWritten: "48-52 AD", authors: ["Paul"] },
  EPH: { dateWritten: "58-60 AD", authors: ["Paul"] },
  PHP: { dateWritten: "61 AD", authors: ["Paul"] },
  COL: { dateWritten: "58-60 AD", authors: ["Paul"] },
  "1TH": { dateWritten: "50 AD", authors: ["Paul"] },
  "2TH": { dateWritten: "50 AD", authors: ["Paul"] },
  "1TI": { dateWritten: "62-66 AD", authors: ["Paul"] },
  "2TI": { dateWritten: "65 AD", authors: ["Paul"] },
  TIT: { dateWritten: "63 AD", authors: ["Paul"] },
  PHM: { dateWritten: "58-60 AD", authors: ["Paul"] },
  HEB: { dateWritten: "66-70 AD", authors: ["Unknown"] },
  JAS: { dateWritten: "45-50 AD", authors: ["James"] },
  "1PE": { dateWritten: "62-64 AD", authors: ["Peter"] },
  "2PE": { dateWritten: "64-68 AD", authors: ["Peter"] },
  "1JN": { dateWritten: "85-90 AD", authors: ["John"] },
  "2JN": { dateWritten: "90 AD", authors: ["John"] },
  "3JN": { dateWritten: "90 AD", authors: ["John"] },
  JUD: { dateWritten: "60-65 AD", authors: ["Jude"] },
  REV: { dateWritten: "70-96 AD", authors: ["John"] },
};

// Exact Easton's entry title to use per book — preferring the "Book of X" /
// "Epistle to X" style entry over a same-named person entry, confirmed by
// direct inspection of ebd2.txt this session. A few entries are shared by
// design (e.g. one "Kings, The Books of" entry covers both 1KI and 2KI).
const EASTON_TITLE = {
  GEN: "Genesis",
  EXO: "Exodus, Book of",
  LEV: "Leviticus",
  NUM: "Numbers, Book of",
  DEU: "Deuteronomy",
  JOS: "Joshua, The Book of",
  JDG: "Judges, Book of",
  RUT: "Ruth The Book of",
  "1SA": "Samuel, Books of",
  "2SA": "Samuel, Books of",
  "1KI": "Kings, The Books of",
  "2KI": "Kings, The Books of",
  "1CH": "Chronicles, Books of",
  "2CH": "Chronicles, Books of",
  EZR: "Ezra, Book of",
  NEH: "Nehemiah, Book of",
  EST: "Esther, Book of",
  JOB: "Job, Book of",
  PSA: "Psalms",
  PRO: "Proverbs, Book of",
  ECC: "Ecclesiastes",
  SNG: "Solomon, Song of",
  ISA: "Isaiah, The Book of",
  JER: "Jeremiah, Book of",
  LAM: "Lamentations, Book of",
  EZK: "Ezekiel, Book of",
  DAN: "Daniel, Book of",
  HOS: "Hosea, Prophecies of",
  JOL: "Joel, Book of",
  AMO: "Amos",
  OBA: "Obadiah, Book of",
  JON: "Jonah, Book of",
  MIC: "Micah, Book of",
  NAM: "Nahum, Book of",
  HAB: "Habakkuk, Prophecies of",
  ZEP: "Zephaniah",
  HAG: "Haggai, Book of",
  ZEC: "Zechariah",
  MAL: "Malachi, Prophecies of",
  MAT: "Matthew, Gospel according to",
  MRK: "Mark, Gospel according to",
  LUK: "Luke, Gospel according to",
  JHN: "John, Gospel of",
  ACT: "Acts of the Apostles",
  ROM: "Romans, Epistle to the",
  "1CO": "Corinthians, First Epistle to the",
  "2CO": "Corinthians, Second Epistle to the",
  GAL: "Galatians, Epistle to",
  EPH: "Ephesians, Epistle to",
  PHP: "Philippians, Epistle to",
  COL: "Colossians, Epistle to the",
  "1TH": "Thessalonians, Epistles to the",
  "2TH": "Thessalonians, Epistles to the",
  "1TI": "Timothy, First Epistle to",
  "2TI": "Timothy, Second Epistle to",
  TIT: "Titus, Epistle to",
  PHM: "Philemon, Epistle to",
  HEB: "Hebrews, Epistle to",
  JAS: "James, Epistle of",
  "1PE": "Peter, First Epistle of",
  "2PE": "Peter, Second Epistle of",
  "1JN": "John, First Epistle of",
  "2JN": "John, Second Epistle of",
  "3JN": "John, Third Epistle of",
  JUD: "Jude, Epistle of",
  REV: "Revelation, Book of",
};

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
}

function truncate(text, maxLen) {
  const clean = text.trim();
  if (clean.length <= maxLen) return { text: clean, truncated: false };
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return {
    text: `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}…`,
    truncated: true,
  };
}

// Easton's entries are delimited by title lines (3-space indent) followed
// by word-wrapped body text (10-space indent); an entry runs to the next
// title line. Restrict to the main dictionary body — the file ends with an
// "Indexes" section (scripture-reference cross-index) that isn't part of
// the dictionary body and would otherwise pollute title matching.
function parseEastonEntries(text) {
  const lines = text.split(/\r?\n/);
  const indexHeaderIdx = lines.findIndex((l) => l.trim() === "Indexes");
  const bodyLines = indexHeaderIdx === -1 ? lines : lines.slice(0, indexHeaderIdx);

  const titles = [];
  bodyLines.forEach((l, i) => {
    if (/^   [^\s]/.test(l) && !/^          /.test(l)) {
      titles.push({ line: i, title: l.trim() });
    }
  });

  const entries = new Map();
  titles.forEach((t, idx) => {
    const start = t.line + 1;
    const end = idx + 1 < titles.length ? titles[idx + 1].line : bodyLines.length;
    const paragraphs = [];
    let current = [];
    for (let i = start; i < end; i++) {
      const raw = bodyLines[i];
      if (raw === undefined || raw.trim() === "") {
        if (current.length) {
          paragraphs.push(current.join(" "));
          current = [];
        }
        continue;
      }
      current.push(raw.trim());
    }
    if (current.length) paragraphs.push(current.join(" "));
    // Easton's original typesetting sometimes opens an entry with a bare
    // "=" as an "also called" marker (e.g. "=Askelon=Ascalon...") — reads
    // as a stray character out of that context, so strip a leading one.
    if (paragraphs.length && paragraphs[0].startsWith("=")) {
      paragraphs[0] = paragraphs[0].replace(/^=\s*/, "");
    }
    // Some titles repeat (e.g. numbered sub-sections of one long entry) —
    // keep the first occurrence only, which is what EASTON_TITLE targets.
    if (!entries.has(t.title)) {
      entries.set(t.title, paragraphs.join("\n\n"));
    }
  });
  return entries;
}

function main() {
  console.log("Building book info...");
  const eastonText = fs.readFileSync(EASTON_TXT_PATH, "utf8");
  const eastonEntries = parseEastonEntries(eastonText);

  const bookInfo = {};
  const bookInfoFull = {};
  const missingEaston = [];

  Object.keys(DATE_AUTHOR).forEach((bookId) => {
    const { dateWritten, authors } = DATE_AUTHOR[bookId];
    const title = EASTON_TITLE[bookId];
    const rawSummary = eastonEntries.get(title);
    if (!rawSummary) {
      missingEaston.push(`${bookId} ("${title}")`);
    }
    const { text: description, truncated } = truncate(rawSummary || "", 320);
    bookInfo[bookId] = { dateWritten, authors, description, truncated };
    if (truncated) bookInfoFull[bookId] = rawSummary.trim();
  });

  if (missingEaston.length) {
    console.warn("  Missing Easton's entries for:", missingEaston.join(", "));
  }

  writeJson(path.join(OUT_DIR, "book-info.json"), {
    source: EASTON_CREDIT,
    books: bookInfo,
  });
  writeJson(path.join(OUT_DIR, "book-info-full.json"), bookInfoFull);

  console.log(`  ${Object.keys(bookInfo).length} of 66 books written`);
  console.log(
    `  full-text lazily available for ${Object.keys(bookInfoFull).length} books`,
  );
  console.log("Done.");
}

main();
