// Bible Metadata Builder
// Reads the Theographic Bible Metadata dataset (events.json + Verses.csv +
// people.json + places.json) and produces trimmed, chapter-indexed JSON
// files consumed by the app's Timeline/People/Places features.
//
// Run manually whenever the source dataset changes: node js/build-bible-metadata.js
// Not part of any runtime build step (this project has no build pipeline).
//
// Source: Theographic Bible Metadata, CC BY-SA 4.0 (https://viz.bible)

const fs = require("fs");
const path = require("path");

const GAME_DATA_DIR =
  "C:\\Unity Projects\\_BibleDatasets\\GospelgoMapDatasets\\GameData";
const VERSES_CSV_PATH =
  "C:\\Unity Projects\\_BibleDatasets\\GospelgoMapDatasets\\RawDataInclude\\theographic-bible-metadata-master\\theographic-bible-metadata-master\\CSV\\Verses.csv";

const OUT_DIR = path.join(__dirname, "..", "data");

const SOURCE_CREDIT = "Theographic Bible Metadata (CC BY-SA 4.0, viz.bible)";

// Theographic uses OSIS-style short book abbreviations; map to this app's
// USFM-style 3-letter ids (see bookOrder in js/bible-utils.js).
const BOOK_ID_BY_ABBR = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAM",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
  Matt: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Rom: "ROM",
  "1Cor": "1CO",
  "2Cor": "2CO",
  Gal: "GAL",
  Eph: "EPH",
  Phil: "PHP",
  Col: "COL",
  "1Thess": "1TH",
  "2Thess": "2TH",
  "1Tim": "1TI",
  "2Tim": "2TI",
  Titus: "TIT",
  Phlm: "PHM",
  Heb: "HEB",
  Jas: "JAS",
  "1Pet": "1PE",
  "2Pet": "2PE",
  "1John": "1JN",
  "2John": "2JN",
  "3John": "3JN",
  Jude: "JUD",
  Rev: "REV",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
}

// Returns { text, truncated }. The full, untruncated text ships separately
// (data/verse-tags/{people,places}-full.json) and is only fetched lazily \u2014
// the first time a reader actually expands a card \u2014 so ordinary chapter
// browsing never pays for text nobody asked to read.
function truncate(text, maxLen) {
  if (typeof text !== "string") return { text: "", truncated: false };
  const clean = text.trim();
  if (clean.length <= maxLen) return { text: clean, truncated: false };
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return {
    text: `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}\u2026`,
    truncated: true,
  };
}

// --- Minimal CSV parsing (quoted fields, "" escaping, embedded commas) ---
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// Reassembles logical rows before parsing, since quoted fields can contain
// embedded newlines (defensive; none observed in this file, but cheap to
// handle correctly).
function parseCsvRows(text) {
  const rawLines = text.split(/\r?\n/);
  const rows = [];
  let buffer = "";
  for (const rawLine of rawLines) {
    buffer = buffer ? `${buffer}\n${rawLine}` : rawLine;
    const quoteCount = (buffer.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      if (buffer.length) rows.push(parseCsvLine(buffer));
      buffer = "";
    }
  }
  if (buffer.length) rows.push(parseCsvLine(buffer));
  return rows;
}

// ---------------------------------------------------------------------
// Timeline: events.json -> data/timeline/events.json + milestones.json
// ---------------------------------------------------------------------
function buildTimelineData() {
  const events = readJson(path.join(GAME_DATA_DIR, "events.json"));
  const flatEvents = [];
  const byChapter = {};

  events.forEach((ev) => {
    if (!ev || !Array.isArray(ev.verses) || !ev.verses.length) return;

    // One event can touch multiple (bookId, chapter) pairs — even across
    // different books, e.g. genealogies cross-referencing Genesis/Luke.
    const groups = new Map();
    ev.verses.forEach((ref) => {
      const parts = String(ref).split(".");
      if (parts.length !== 3) return;
      const [abbr, chapterStr, verseStr] = parts;
      const bookId = BOOK_ID_BY_ABBR[abbr];
      const chapter = parseInt(chapterStr, 10);
      const verseNum = parseInt(verseStr, 10);
      if (
        !bookId ||
        !Number.isInteger(chapter) ||
        !Number.isInteger(verseNum)
      ) {
        return;
      }
      const key = `${bookId}_${chapter}`;
      if (!groups.has(key)) {
        groups.set(key, { bookId, chapter, verseNums: [] });
      }
      groups.get(key).verseNums.push(verseNum);
    });

    groups.forEach(({ bookId, chapter, verseNums }, key) => {
      const verseStart = Math.min(...verseNums);
      const verseEnd = Math.max(...verseNums);
      // The source dataset draws its "gospels" era cutoff partway through
      // Acts (chapters 1-9 are tagged "gospels", presumably by a strict
      // year-based boundary), but the entire book of Acts narrates
      // post-Ascension church life — reclassify the whole book regardless
      // of the source era field.
      const era = bookId === "ACT" ? "earlyChurch" : ev.era;
      flatEvents.push({
        id: ev.id,
        title: ev.title,
        year: ev.year,
        era,
        sortKey: ev.sortKey,
        book: bookId,
        chapter,
        verseStart,
        verseEnd,
      });
      if (!byChapter[key]) byChapter[key] = [];
      byChapter[key].push({ id: ev.id, verseStart, verseEnd });
    });
  });

  writeJson(path.join(OUT_DIR, "timeline", "events.json"), {
    source: SOURCE_CREDIT,
    events: flatEvents,
    byChapter,
  });

  return flatEvents;
}

function buildMilestones(flatEvents) {
  const seeds = {
    ot: [
      "Creation of all things",
      "The Fall",
      "Exodus from Egypt",
      "David Kills Goliath",
      "Construction of Solomon's Temple",
    ],
    gospels: [
      "Birth of Jesus",
      "Crucifixion and Burial",
      "Resurrection and Ascension",
    ],
    earlyChurch: [
      "Peter preaches at Pentecost",
      "Saul is converted",
      "Jerusalem Council",
      "Paul's Journey to Rome",
    ],
  };

  const milestones = { ot: [], gospels: [], earlyChurch: [] };
  Object.entries(seeds).forEach(([era, titles]) => {
    titles.forEach((title) => {
      const match = flatEvents.find((e) => e.title === title);
      if (match && !milestones[era].includes(match.id)) {
        milestones[era].push(match.id);
      } else if (!match) {
        console.warn(`  [milestones] no event found for title: "${title}"`);
      }
    });
  });

  writeJson(path.join(OUT_DIR, "timeline", "milestones.json"), milestones);
  return milestones;
}

// ---------------------------------------------------------------------
// People / Places: Verses.csv -> data/verse-tags/{people,places}.json
// ---------------------------------------------------------------------
function buildVerseTagData() {
  let csvText = fs.readFileSync(VERSES_CSV_PATH, "utf8");
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);
  const rows = parseCsvRows(csvText);
  const header = rows[0];
  const idxOsis = header.indexOf("osisRef");
  const idxPeople = header.indexOf("people");
  const idxPlaces = header.indexOf("places");

  const peopleByChapter = {};
  const placesByChapter = {};
  const referencedPeopleIds = new Set();
  const referencedPlaceIds = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= Math.max(idxOsis, idxPeople, idxPlaces)) {
      continue;
    }
    const osisRef = row[idxOsis];
    if (!osisRef) continue;
    const parts = osisRef.split(".");
    if (parts.length !== 3) continue;
    const [abbr, chapterStr] = parts;
    const bookId = BOOK_ID_BY_ABBR[abbr];
    const chapter = parseInt(chapterStr, 10);
    if (!bookId || !Number.isInteger(chapter)) continue;
    const key = `${bookId}_${chapter}`;

    const peopleIds = (row[idxPeople] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const placeIds = (row[idxPlaces] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (peopleIds.length) {
      if (!peopleByChapter[key]) peopleByChapter[key] = new Set();
      peopleIds.forEach((id) => {
        peopleByChapter[key].add(id);
        referencedPeopleIds.add(id);
      });
    }
    if (placeIds.length) {
      if (!placesByChapter[key]) placesByChapter[key] = new Set();
      placeIds.forEach((id) => {
        placesByChapter[key].add(id);
        referencedPlaceIds.add(id);
      });
    }
  }

  const peopleDirectory = readJson(path.join(GAME_DATA_DIR, "people.json"));
  const placesDirectory = readJson(path.join(GAME_DATA_DIR, "places.json"));
  const peopleById = new Map(peopleDirectory.map((p) => [p.id, p]));
  const placesById = new Map(placesDirectory.map((p) => [p.id, p]));

  const people = {};
  const peopleFull = {};
  referencedPeopleIds.forEach((id) => {
    const p = peopleById.get(id);
    if (!p) return;
    const desc = truncate(p.description, 320);
    people[id] = {
      name: p.name,
      alsoCalled: p.alsoCalled || null,
      gender: p.gender || null,
      birthYear: Number.isInteger(p.birthYear) ? p.birthYear : null,
      deathYear: Number.isInteger(p.deathYear) ? p.deathYear : null,
      description: desc.text,
      truncated: desc.truncated,
    };
    if (desc.truncated) peopleFull[id] = p.description.trim();
  });

  const places = {};
  const placesFull = {};
  referencedPlaceIds.forEach((id) => {
    const p = placesById.get(id);
    if (!p) return;
    const desc = truncate(p.description, 320);
    places[id] = {
      name: p.name,
      lat: typeof p.lat === "number" ? p.lat : null,
      lon: typeof p.lon === "number" ? p.lon : null,
      featureType: p.featureType || null,
      description: desc.text,
      truncated: desc.truncated,
    };
    if (desc.truncated) placesFull[id] = p.description.trim();
  });

  const peopleByChapterOut = {};
  Object.entries(peopleByChapter).forEach(([key, set]) => {
    const ids = Array.from(set).filter((id) => people[id]);
    if (ids.length) peopleByChapterOut[key] = ids;
  });
  const placesByChapterOut = {};
  Object.entries(placesByChapter).forEach(([key, set]) => {
    const ids = Array.from(set).filter((id) => places[id]);
    if (ids.length) placesByChapterOut[key] = ids;
  });

  writeJson(path.join(OUT_DIR, "verse-tags", "people.json"), {
    source: SOURCE_CREDIT,
    byChapter: peopleByChapterOut,
    people,
  });
  writeJson(path.join(OUT_DIR, "verse-tags", "places.json"), {
    source: SOURCE_CREDIT,
    byChapter: placesByChapterOut,
    places,
  });
  // Full, untruncated descriptions — fetched lazily by the app only the
  // first time a reader expands a card, so ordinary chapter browsing never
  // downloads text nobody asked to read.
  writeJson(path.join(OUT_DIR, "verse-tags", "people-full.json"), peopleFull);
  writeJson(path.join(OUT_DIR, "verse-tags", "places-full.json"), placesFull);

  return {
    peopleCount: Object.keys(people).length,
    placesCount: Object.keys(places).length,
    chaptersWithPeople: Object.keys(peopleByChapterOut).length,
    chaptersWithPlaces: Object.keys(placesByChapterOut).length,
    peopleFullCount: Object.keys(peopleFull).length,
    placesFullCount: Object.keys(placesFull).length,
  };
}

function main() {
  console.log("Building timeline data...");
  const flatEvents = buildTimelineData();
  console.log(
    `  ${flatEvents.length} chapter-scoped event entries across ${
      new Set(flatEvents.map((e) => `${e.book}_${e.chapter}`)).size
    } chapters`,
  );
  const milestones = buildMilestones(flatEvents);
  console.log(
    `  milestones: ot=${milestones.ot.length} gospels=${milestones.gospels.length} earlyChurch=${milestones.earlyChurch.length}`,
  );

  console.log("Building people/places verse-tag data...");
  const stats = buildVerseTagData();
  console.log(
    `  ${stats.peopleCount} people across ${stats.chaptersWithPeople} chapters`,
  );
  console.log(
    `  ${stats.placesCount} places across ${stats.chaptersWithPlaces} chapters`,
  );
  console.log(
    `  full-text lazily available for ${stats.peopleFullCount} people, ${stats.placesFullCount} places`,
  );

  console.log("Done.");
}

main();
