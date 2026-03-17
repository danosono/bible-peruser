// USFM Outline Extractor
// Usage: node usfm-outline-extractor.js <input.usfm> <output.json>

const fs = require("fs");

function parseUSFM(usfmText) {
  // Helper to group consecutive numbers into ranges
  function groupConsecutiveVerses(verses) {
    if (!verses.length) return [];
    const nums = verses.map(Number).sort((a, b) => a - b);
    const result = [];
    let start = nums[0],
      end = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i];
      } else {
        result.push(start === end ? String(start) : `${start}-${end}`);
        start = end = nums[i];
      }
    }
    result.push(start === end ? String(start) : `${start}-${end}`);
    return result;
  }
  const lines = usfmText.split(/\r?\n/);
  let result = {};
  let currentChapter = null;
  let currentSection = null;
  let currentReferences = null;
  let currentVerses = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Robust chapter marker: match \c followed by optional spaces and digits
    if (/^\\c\s*\d+/.test(line)) {
      const match = line.match(/^\\c\s*(\d+)/);
      if (match) {
        // Save previous section at chapter break
        if (currentSection) {
          result[currentChapter]?.push({
            outline: currentSection,
            verses: groupConsecutiveVerses(currentVerses),
            references: currentReferences || [],
          });
        }
        currentChapter = match[1];
        result[currentChapter] = [];
        currentSection = null;
        currentReferences = null;
        currentVerses = [];
      }
    } else if (/^\\s1\s+/.test(line)) {
      // Save previous section (even if no verses yet)
      if (currentSection) {
        result[currentChapter].push({
          outline: currentSection,
          verses: groupConsecutiveVerses(currentVerses),
          references: currentReferences || [],
        });
      }
      // New section
      currentSection = line.replace(/^\\s1\s+/, "").trim();
      currentReferences = [];
      currentVerses = [];
      // Check for \r on next line
      if (lines[i + 1] && /^\\r\s+/.test(lines[i + 1].trim())) {
        const refLine = lines[i + 1].trim();
        currentReferences = refLine
          .replace(/^\\r\s+/, "")
          .replace(/[()]/g, "")
          .split(";")
          .map((r) => r.trim())
          .filter(Boolean);
        i++; // Skip reference line
      }
    } else if (/^\\v\s+/.test(line)) {
      // Verse number
      const verseNum = line.match(/^\\v\s+(\d+)/);
      if (verseNum) currentVerses.push(verseNum[1]);
    }
  }
  // Save last section
  if (currentSection) {
    result[currentChapter].push({
      outline: currentSection,
      verses: groupConsecutiveVerses(currentVerses),
      references: currentReferences || [],
    });
  }
  return result;
}

if (require.main === module) {
  const path = require("path");
  const sfmDir = path.join(__dirname, "../sfm");
  const topicsDir = path.join(__dirname, "../data/topics");
  if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });
  const sfmFiles = fs
    .readdirSync(sfmDir)
    .filter((f) => f.toLowerCase().endsWith(".sfm"));
  if (sfmFiles.length === 0) {
    console.log("No .sfm files found in", sfmDir);
  } else {
    console.log("Found .sfm files:", sfmFiles);
  }

  // Book order for 3-digit mapping
  const bookOrder = [
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

  sfmFiles.forEach((sfmFile) => {
    console.log("Processing file:", sfmFile);
    const usfmText = fs.readFileSync(path.join(sfmDir, sfmFile), "utf8");
    const outlineData = parseUSFM(usfmText);
    const chapters = Object.keys(outlineData);
    if (chapters.length === 0) {
      console.log("No chapters found in", sfmFile);
    } else {
      console.log("Chapters found in", sfmFile, ":", chapters);
    }
    // Group by book: { chapterTopics: { [chapterNum]: [topics] } }
    const bookTopics = { chapterTopics: {} };
    Object.entries(outlineData).forEach(([chapter, sections]) => {
      bookTopics.chapterTopics[chapter] = sections;
    });
    // Extract book code from \id line in SFM file
    const idLine = usfmText.split(/\r?\n/).find((l) => l.startsWith("\\id "));
    let bookId = null;
    if (idLine) {
      const match = idLine.match(/^\\id\s+([A-Z0-9]+)/i);
      if (match) bookId = match[1].toUpperCase();
    }
    let idx = bookId ? bookOrder.indexOf(bookId) : -1;
    if (idx === -1) {
      // fallback: try to extract from filename as before
      const base = path.basename(sfmFile, ".sfm").toUpperCase();
      for (let i = 0; i < bookOrder.length; i++) {
        const code = bookOrder[i];
        const regex = new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`);
        if (base.includes(code) && regex.test(base)) {
          bookId = code;
          idx = i;
          break;
        }
      }
    }
    const num = idx !== -1 ? (idx + 1).toString().padStart(3, "0") : "000";
    const outFile = path.join(
      topicsDir,
      `${num}_${bookId || "UNKNOWN"}_BSB.json`,
    );
    fs.writeFileSync(outFile, JSON.stringify(bookTopics, null, 2));
    console.log("Extracted", outFile);
  });
}

module.exports = parseUSFM;
