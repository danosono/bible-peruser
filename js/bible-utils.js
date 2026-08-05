// js/bible-utils.js
// Utility functions and data for Bible app

export const bookNames = {
  GEN: "Genesis",
  EXO: "Exodus",
  LEV: "Leviticus",
  NUM: "Numbers",
  DEU: "Deuteronomy",
  JOS: "Joshua",
  JDG: "Judges",
  RUT: "Ruth",
  "1SA": "1 Samuel",
  "2SA": "2 Samuel",
  "1KI": "1 Kings",
  "2KI": "2 Kings",
  "1CH": "1 Chronicles",
  "2CH": "2 Chronicles",
  EZR: "Ezra",
  NEH: "Nehemiah",
  EST: "Esther",
  JOB: "Job",
  PSA: "Psalms",
  PRO: "Proverbs",
  ECC: "Ecclesiastes",
  SNG: "Song of Solomon",
  ISA: "Isaiah",
  JER: "Jeremiah",
  LAM: "Lamentations",
  EZK: "Ezekiel",
  DAN: "Daniel",
  HOS: "Hosea",
  JOL: "Joel",
  AMO: "Amos",
  OBA: "Obadiah",
  JON: "Jonah",
  MIC: "Micah",
  NAM: "Nahum",
  HAB: "Habakkuk",
  ZEP: "Zephaniah",
  HAG: "Haggai",
  ZEC: "Zechariah",
  MAL: "Malachi",
  MAT: "Matthew",
  MRK: "Mark",
  LUK: "Luke",
  JHN: "John",
  ACT: "Acts",
  ROM: "Romans",
  "1CO": "1 Corinthians",
  "2CO": "2 Corinthians",
  GAL: "Galatians",
  EPH: "Ephesians",
  PHP: "Philippians",
  COL: "Colossians",
  "1TH": "1 Thessalonians",
  "2TH": "2 Thessalonians",
  "1TI": "1 Timothy",
  "2TI": "2 Timothy",
  TIT: "Titus",
  PHM: "Philemon",
  HEB: "Hebrews",
  JAS: "James",
  "1PE": "1 Peter",
  "2PE": "2 Peter",
  "1JN": "1 John",
  "2JN": "2 John",
  "3JN": "3 John",
  JUD: "Jude",
  REV: "Revelation",
};

export const bookOrder = [
  "GEN",
  "EXO",
  "LEV",
  "NUM",
  "DEU",
  "JOS",
  "JDG",
  "RUT",
  "1SA",
  "2SA",
  "1KI",
  "2KI",
  "1CH",
  "2CH",
  "EZR",
  "NEH",
  "EST",
  "JOB",
  "PSA",
  "PRO",
  "ECC",
  "SNG",
  "ISA",
  "JER",
  "LAM",
  "EZK",
  "DAN",
  "HOS",
  "JOL",
  "AMO",
  "OBA",
  "JON",
  "MIC",
  "NAM",
  "HAB",
  "ZEP",
  "HAG",
  "ZEC",
  "MAL",
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
];

export function normalizeBookAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildBookAliasMap() {
  const aliasMap = new Map();
  const ordinalByNumber = {
    1: ["first", "1st"],
    2: ["second", "2nd"],
    3: ["third", "3rd"],
  };

  function addAlias(rawAlias, bookId) {
    const key = normalizeBookAlias(rawAlias);
    if (!key || aliasMap.has(key)) return;
    aliasMap.set(key, bookId);
  }

  bookOrder.forEach((id) => {
    const name = bookNames[id];
    const nameLower = name.toLowerCase();
    const normalizedName = nameLower.replace(/\s+/g, " ").trim();
    const compactName = normalizeBookAlias(normalizedName);

    addAlias(id.toLowerCase(), id);
    addAlias(normalizedName, id);
    addAlias(compactName, id);

    const short = compactName.slice(0, 3);
    if (short.length === 3) addAlias(short, id);

    const numberedMatch = id.match(/^([1-3])(.*)$/);
    if (numberedMatch) {
      const number = parseInt(numberedMatch[1], 10);
      const baseIdLetters = numberedMatch[2].toLowerCase();
      const baseName = normalizedName.replace(/^[1-3]\s+/, "").trim();
      const baseCompact = normalizeBookAlias(baseName);

      addAlias(`${number}${baseIdLetters}`, id);
      addAlias(`${number}${baseCompact}`, id);
      addAlias(`${number} ${baseName}`, id);
      addAlias(`${number}.${baseName}`, id);

      (ordinalByNumber[number] || []).forEach((ord) => {
        addAlias(`${ord}${baseCompact}`, id);
        addAlias(`${ord} ${baseName}`, id);
      });
    }
  });

  // Common alternates and shorthand spellings.
  addAlias("ps", "PSA");
  addAlias("psalm", "PSA");
  addAlias("psalms", "PSA");
  addAlias("song", "SNG");
  addAlias("songs", "SNG");
  addAlias("songofsongs", "SNG");
  addAlias("songofsolomon", "SNG");
  addAlias("canticles", "SNG");
  addAlias("matt", "MAT");
  addAlias("jn", "JHN");
  addAlias("joh", "JHN");
  addAlias("phil", "PHP");
  addAlias("philip", "PHP");
  addAlias("phlm", "PHM");
  addAlias("judg", "JDG");

  return aliasMap;
}

export const bookAliasMap = buildBookAliasMap();

export function resolveBookAlias(value) {
  return bookAliasMap.get(normalizeBookAlias(value)) || null;
}

export function parseBookChapterInput(rawInput) {
  const source = String(rawInput || "")
    .trim()
    .toLowerCase();
  if (!source) return { ok: false, reason: "Enter a reference." };

  const cleaned = source.replace(/[^a-z0-9\s._:-]/g, " ");
  const match = cleaned.match(/^(.+?)[\s._:-]*(\d+)$/);
  if (!match) {
    const bookToken = normalizeBookAlias(cleaned.trim());
    const bookId = bookAliasMap.get(bookToken) || null;
    if (bookId) return { ok: true, bookId, chapterNum: 1 };
    return {
      ok: false,
      reason: "Use format like mat4 or matthew 4.",
    };
  }

  const bookToken = normalizeBookAlias(match[1]);
  const chapterNum = parseInt(match[2], 10);
  const bookId = bookAliasMap.get(bookToken) || null;

  if (!bookId) return { ok: false, reason: "Unknown book name." };
  if (!Number.isInteger(chapterNum) || chapterNum < 1) {
    return { ok: false, reason: "Chapter must be 1 or greater." };
  }

  return { ok: true, bookId, chapterNum };
}

export function saveLastRead(bookId, chapterNum) {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem("bibleLastBook", bookId);
    localStorage.setItem("bibleLastChapter", chapterNum);
  }
}

export function getLastRead() {
  if (typeof window !== "undefined" && window.localStorage) {
    return {
      bookId: localStorage.getItem("bibleLastBook") || "MAT",
      chapterNum: parseInt(localStorage.getItem("bibleLastChapter"), 10) || 1,
    };
  }
  return { bookId: "MAT", chapterNum: 1 };
}
