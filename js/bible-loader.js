// js/bible-loader.js - loads a chapter from bible.json and displays it in <main>

async function loadBibleChapter(bookId = "GEN", chapterNum = 1) {
  const main = document.querySelector(".bp-main");
  const aside = document.querySelector(".bp-sidebar--right");
  if (!main) return;
  main.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const response = await fetch("data/bible.json");
    const data = await response.json();
    const book = data.books.find((b) => b.id === bookId);
    if (!book) {
      main.innerHTML = `<div class="error">Book not found.</div>`;
      if (aside) aside.textContent = "";
      return;
    }
    const chapter = book.chapters.find((c) => c.number === chapterNum);
    if (!chapter) {
      main.innerHTML = `<div class="error">Chapter not found.</div>`;
      if (aside) aside.textContent = "";
      return;
    }
    // Book name mapping from app.js
    const bookNames = {
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
    let bookName = bookNames[bookId] || bookId;
    let html = `<h2>${bookName} ${chapterNum}</h2>`;
    // Determine column and font layout
    let columnClass = "";
    let fontClass = "";
    const verseCount = chapter.verses.length;
    if (window.innerWidth >= 3000) {
      if (verseCount <= 19) columnClass = "center-1";
      else if (verseCount <= 48) columnClass = "center-2";
      else if (verseCount <= 79) columnClass = "center-3";
      else if (verseCount <= 90) columnClass = "center-4";
      else {
        columnClass = "hd-center-4";
        fontClass = "font-4k-psalms-119";
      }
    }
    if (window.innerWidth >= 900 && window.innerWidth < 3000) {
      if (verseCount > 81) {
        columnClass = "hd-center-3-psalms-119";
        fontClass = "font-psalms-119";
      } else if (verseCount > 48) {
        columnClass = "hd-center-3";
        fontClass = "font-xsmall";
      } else if (verseCount > 30) {
        columnClass = "hd-center-3";
        fontClass = fontClass || "font-small";
      }
    }
    html += `<div class="bible-chapter${columnClass ? " " + columnClass : ""}${fontClass ? " " + fontClass : ""}">`;
    let charCount = 0;
    for (const verse of chapter.verses) {
      html += `<span class="verse-num" data-verse="${verse.n}">${verse.n}</span> <span class="verse-text" data-verse="${verse.n}">${verse.text}</span><br>`;
      charCount += verse.text.length;
      // Collect words for frequency analysis
      if (!window._chapterWords) window._chapterWords = [];
      window._chapterWords.push(...verse.text.split(/\W+/));
    }
    html += "</div>";
    main.innerHTML = html;

    // Load topics for current book/chapter
    const topicBar = document.getElementById("chapter-topic-bar");
    if (topicBar) topicBar.innerHTML = "";
    // Try to load topics for the current book, using new predictable filename: NNN_BOOKID_BSB.json
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
    function getTopicFilename(bid) {
      const idx = bookOrder.indexOf(bid);
      if (idx === -1) return null;
      const num = (idx + 1).toString().padStart(3, "0");
      return `data/topics/${num}_${bid}_BSB.json`;
    }

    const topicFile = getTopicFilename(bookId);
    const topicFileCandidates = topicFile ? [topicFile] : [];

    function tryFetchTopicFile(files, cb) {
      if (!files.length) return cb(null);
      fetch(files[0])
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => cb(data))
        .catch(() => tryFetchTopicFile(files.slice(1), cb));
    }

    tryFetchTopicFile(topicFileCandidates, (topics) => {
      if (!topics) return;
      const chapterTopics = topics.chapterTopics[chapterNum] || [];
      // Create highlight buttons in right sidebar
      const aside = document.querySelector(".bp-sidebar--right");
      let highlightBar = document.getElementById("chapter-highlight-bar");
      if (!highlightBar && aside) {
        highlightBar = document.createElement("div");
        highlightBar.id = "chapter-highlight-bar";
        highlightBar.style.display = "flex";
        highlightBar.style.flexWrap = "wrap";
        highlightBar.style.gap = "6px";
        highlightBar.style.margin = "12px 0";
        aside.insertBefore(highlightBar, aside.firstChild);
      }
      if (highlightBar) highlightBar.innerHTML = "";
      chapterTopics.forEach((topic) => {
        // Highlight button logic
        let btn = null;
        if (topic.label) {
          btn = document.createElement("button");
          btn.textContent = topic.label;
          btn.className = "topic-btn topic-label-btn";
        } else if (topic.outline) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-outline-btn";
          if (Array.isArray(topic.references) && topic.references.length) {
            btn.innerHTML = `<span class="outline-arrow">&#9654;</span> ${topic.outline}`;
            const tooltip = document.createElement("div");
            tooltip.className = "outline-tooltip";
            tooltip.style.display = "none";
            tooltip.style.position = "absolute";
            tooltip.style.zIndex = 1000;
            tooltip.style.background = "#fff";
            tooltip.style.border = "1px solid #ccc";
            tooltip.style.padding = "6px 10px";
            tooltip.style.borderRadius = "6px";
            tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
            tooltip.style.fontSize = "0.95em";
            tooltip.innerHTML =
              "<b>References:</b><br>" +
              topic.references
                .map(
                  (ref) =>
                    `<a href=\"#\" class=\"outline-ref-link\" data-ref=\"${ref.replace(/\"/g, "&quot;")}\">${ref}</a>`,
                )
                .join(", ") +
              '<div class="outline-tooltip-hint" style="margin-top:6px;color:#888;font-size:0.9em;">Click arrow to pin</div>';
            document.body.appendChild(tooltip);
            let sticky = false;
            function positionTooltip() {
              const rect = btn.getBoundingClientRect();
              tooltip.style.left = rect.left + window.scrollX + "px";
              tooltip.style.top = rect.bottom + window.scrollY + 4 + "px";
            }
            btn.addEventListener("mouseenter", (e) => {
              if (!sticky) {
                positionTooltip();
                tooltip.style.display = "block";
              }
            });
            btn.addEventListener("mouseleave", () => {
              if (!sticky) tooltip.style.display = "none";
            });
            tooltip.addEventListener("mouseenter", () => {
              if (!sticky) tooltip.style.display = "block";
            });
            tooltip.addEventListener("mouseleave", () => {
              if (!sticky) tooltip.style.display = "none";
            });
            btn.querySelector(".outline-arrow").style.cursor = "pointer";
            btn.querySelector(".outline-arrow").title =
              "Click to pin references";
            btn
              .querySelector(".outline-arrow")
              .addEventListener("click", (ev) => {
                ev.stopPropagation();
                sticky = !sticky;
                if (sticky) {
                  positionTooltip();
                  tooltip.style.display = "block";
                  btn.querySelector(".outline-arrow").innerHTML = "&#9660;";
                } else {
                  tooltip.style.display = "none";
                  btn.querySelector(".outline-arrow").innerHTML = "&#9654;";
                }
              });
            document.addEventListener("mousedown", function docClick(ev) {
              if (
                sticky &&
                !btn.contains(ev.target) &&
                !tooltip.contains(ev.target)
              ) {
                sticky = false;
                tooltip.style.display = "none";
                btn.querySelector(".outline-arrow").innerHTML = "&#9654;";
              }
            });
            tooltip.addEventListener("click", function (ev) {
              const link = ev.target.closest(".outline-ref-link");
              if (link) {
                ev.preventDefault();
                const ref = link.dataset.ref;
                const match = ref.match(/([A-Za-z0-9 ]+)\s+(\d+)(?::\d+)?/);
                if (match) {
                  let book = match[1].trim();
                  let chapter = parseInt(match[2], 10);
                  let bookId = Object.keys(bookNames).find(
                    (k) => bookNames[k].toLowerCase() === book.toLowerCase(),
                  );
                  if (bookId && !isNaN(chapter)) {
                    if (window.loadBibleChapter)
                      window.loadBibleChapter(bookId, chapter);
                    if (window.updateBookScrollbar)
                      window.updateBookScrollbar(bookId);
                  }
                }
                if (!sticky) tooltip.style.display = "none";
              }
            });
          } else {
            btn.textContent = topic.outline;
          }
        }
        if (btn) {
          btn.onclick = () => {
            const isActive = btn.classList.contains("active");
            document
              .querySelectorAll(".verse-highlight")
              .forEach((el) => el.classList.remove("verse-highlight"));
            topicBar
              .querySelectorAll(".topic-btn")
              .forEach((b) => b.classList.remove("active"));
            if (!isActive) {
              btn.classList.add("active");
              let verses = [];
              topic.verses &&
                topic.verses.forEach((v) => {
                  if (typeof v === "string" && v.includes("-")) {
                    const [start, end] = v.split("-").map(Number);
                    if (!isNaN(start) && !isNaN(end)) {
                      for (let i = start; i <= end; i++) verses.push(i);
                    }
                  } else {
                    verses.push(Number(v));
                  }
                });
              verses.forEach((v) => {
                document
                  .querySelectorAll(`.verse-num[data-verse=\"${v}\"]`)
                  .forEach((el) => el.classList.add("verse-highlight"));
                document
                  .querySelectorAll(`.verse-text[data-verse=\"${v}\"]`)
                  .forEach((el) => el.classList.add("verse-highlight"));
              });
            }
          };
          topicBar.appendChild(btn);
        }
      }); // End chapterTopics.forEach
    }); // End tryFetchTopicFile callback
    if (aside) {
      // Remove character count from aside; will be set in footer instead
      aside.innerHTML = "";
    }
    // Update character count in footer
    const footer = document.querySelector(".bp-footer");
    if (footer) {
      let cc = document.getElementById("bp-char-count");
      // Compute top 5 words in chapter
      let words = (window._chapterWords || [])
        .map((w) => w.toLowerCase())
        .filter(
          (w) =>
            w &&
            ![
              "the",
              "and",
              "of",
              "to",
              "in",
              "a",
              "that",
              "is",
              "for",
              "on",
              "with",
              "as",
              "by",
              "at",
              "an",
              "be",
              "are",
              "was",
              "it",
              "from",
              "but",
              "not",
              "or",
              "this",
              "which",
              "his",
              "her",
              "their",
              "they",
              "he",
              "she",
              "you",
              "we",
              "i",
              "have",
              "has",
              "had",
              "will",
              "shall",
              "were",
              "them",
              "him",
              "our",
              "your",
              "my",
              "me",
              "so",
              "all",
              "who",
              "what",
              "when",
              "where",
              "how",
              "can",
              "do",
              "if",
              "then",
              "than",
              "these",
              "those",
              "there",
              "here",
              "out",
              "up",
              "down",
              "into",
              "upon",
              "over",
              "under",
              "again",
              "also",
              "now",
              "let",
              "may",
              "did",
              "been",
              "no",
              "yes",
              "one",
              "two",
              "three",
              "four",
              "five",
              "six",
              "seven",
              "eight",
              "nine",
              "ten",
            ].includes(w),
        );
      let freq = {};
      for (let w of words) freq[w] = (freq[w] || 0) + 1;
      let topWords = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      let topWordsStr = topWords.length
        ? `Top words: ` + topWords.map(([w, c]) => `${w} (${c})`).join(", ")
        : "";
      if (cc) {
        cc.textContent =
          `Character count: ${charCount}` +
          (topWordsStr ? ` | ${topWordsStr}` : "");
      }
      // Reset for next chapter load
      window._chapterWords = [];
    }
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("bibleLastBook", bookId);
      localStorage.setItem("bibleLastChapter", chapterNum);
    }
    // Update sticky nav buttons
    if (window.updateChapterNav) {
      window.updateChapterNav(bookId, chapterNum, book.chapterCount);
    }
    // Update chapter dropdown
    if (window.updateChapterDropdown) {
      window.updateChapterDropdown(bookId, chapterNum, book.chapterCount);
    }
  } catch (e) {
    main.innerHTML = `<div class="error">Failed to load Bible data.</div>`;
    if (aside) aside.textContent = "";
  }
}

// Optionally, call on load
if (typeof window !== "undefined") {
  window.loadBibleChapter = loadBibleChapter;
  document.addEventListener("DOMContentLoaded", () => {
    let bookId = "GEN";
    let chapterNum = 1;
    if (window.localStorage) {
      const lastBook = localStorage.getItem("bibleLastBook");
      const lastChapter = localStorage.getItem("bibleLastChapter");
      if (lastBook && lastChapter) {
        bookId = lastBook;
        chapterNum = parseInt(lastChapter, 10) || 1;
      }
    }
    loadBibleChapter(bookId, chapterNum);
    // Add topic bar under chapter nav in left sidebar
    const nav = document.querySelector(".bp-sidebar--left");
    if (nav && !document.getElementById("chapter-topic-bar")) {
      const topicBar = document.createElement("div");
      topicBar.id = "chapter-topic-bar";
      topicBar.style.display = "flex";
      topicBar.style.flexWrap = "wrap";
      topicBar.style.gap = "6px";
      topicBar.style.margin = "12px 0";
      nav.insertBefore(topicBar, nav.children[1]);
    }
  });
}
