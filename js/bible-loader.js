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
      "GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers", "DEU": "Deuteronomy",
      "JOS": "Joshua", "JDG": "Judges", "RUT": "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel",
      "1KI": "1 Kings", "2KI": "2 Kings", "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra",
      "NEH": "Nehemiah", "EST": "Esther", "JOB": "Job", "PSA": "Psalms", "PRO": "Proverbs",
      "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah", "JER": "Jeremiah", "LAM": "Lamentations",
      "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea", "JOL": "Joel", "AMO": "Amos", "OBA": "Obadiah",
      "JON": "Jonah", "MIC": "Micah", "NAM": "Nahum", "HAB": "Habakkuk", "ZEP": "Zephaniah",
      "HAG": "Haggai", "ZEC": "Zechariah", "MAL": "Malachi", "MAT": "Matthew", "MRK": "Mark",
      "LUK": "Luke", "JHN": "John", "ACT": "Acts", "ROM": "Romans", "1CO": "1 Corinthians",
      "2CO": "2 Corinthians", "GAL": "Galatians", "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians",
      "1TH": "1 Thessalonians", "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy",
      "TIT": "Titus", "PHM": "Philemon", "HEB": "Hebrews", "JAS": "James", "1PE": "1 Peter",
      "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John", "3JN": "3 John", "JUD": "Jude", "REV": "Revelation"
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
    }
    html += "</div>";
    main.innerHTML = html;

    // Load topics for current book/chapter
    const topicBar = document.getElementById("chapter-topic-bar");
    if (topicBar) topicBar.innerHTML = "";
    if (bookId === "MAT") {
      fetch("data/topics/MAT.json")
        .then((r) => r.json())
        .then((topics) => {
          // Chapter topics
          const chapterTopics = topics.chapterTopics[chapterNum] || [];
          if (topicBar && chapterTopics.length) {
            chapterTopics.forEach((topic) => {
              const btn = document.createElement("button");
              btn.textContent = topic.label;
              btn.className = "topic-btn";
              btn.onclick = () => {
                const isActive = btn.classList.contains("active");
                // Remove highlight from all and deactivate all topic buttons
                document
                  .querySelectorAll(".verse-highlight")
                  .forEach((el) => el.classList.remove("verse-highlight"));
                topicBar
                  .querySelectorAll(".topic-btn")
                  .forEach((b) => b.classList.remove("active"));
                if (!isActive) {
                  btn.classList.add("active");
                  // Expand ranges and highlight
                  let verses = [];
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
                      .querySelectorAll(`.verse-num[data-verse="${v}"]`)
                      .forEach((el) => el.classList.add("verse-highlight"));
                    document
                      .querySelectorAll(`.verse-text[data-verse="${v}"]`)
                      .forEach((el) => el.classList.add("verse-highlight"));
                  });
                }
              };
              topicBar.appendChild(btn);
            });
          }
        });
    }
    if (aside) {
      aside.innerHTML = `<strong>Notes:</strong><br>Current chapter character count: <b>${charCount}</b>`;
    }
    // Save last location to localStorage
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
