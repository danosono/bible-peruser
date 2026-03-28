import {
  bookNames,
  bookOrder,
  saveLastRead,
  getLastRead,
} from "./bible-utils.js";

// js/bible-loader.js - loads a chapter from bible.json and displays it in <main>

let bpBibleDataCache = null;

async function getBibleData() {
  if (bpBibleDataCache) return bpBibleDataCache;
  const response = await fetch("data/bible.json");
  bpBibleDataCache = await response.json();
  return bpBibleDataCache;
}

function setBpViewMode(mode) {
  const app = document.querySelector(".bp-app");
  if (!app) return;
  app.classList.toggle("bp-entire-book-mode", mode === "entireBook");
  window._currentViewMode = mode;
  if (window.updateEntireBookButton) {
    window.updateEntireBookButton(mode);
  }
}

async function loadBibleChapter(
  bookId = "MAT",
  chapterNum = 1,
  pushState = true,
) {
  setBpViewMode("chapter");
  window._currentBookId = bookId;
  window._currentChapterNum = chapterNum;
  // Push state for browser navigation only if not handling popstate
  // Update book scrollbar selection
  if (window.updateBookScrollbar) window.updateBookScrollbar(bookId);
  if (pushState && window.history && window.history.pushState) {
    const state = {
      bookId,
      chapterNum,
    };
    window.history.pushState(
      state,
      "",
      `?book=${bookId}&chapter=${chapterNum}`,
    );
  }
  const main = document.querySelector(".bp-main");
  const aside = document.querySelector(".bp-sidebar--right");
  if (!main) return;
  main.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await getBibleData();
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
    let bookName = bookNames[bookId] || bookId;
    let html = `<h2>${bookName} ${chapterNum}</h2>`;
    // Determine column and font layout
    let columnClass = "";
    let fontClass = "";
    let charCount = 0;
    for (const verse of chapter.verses) {
      charCount += verse.text.length;
    }
    if (window.innerWidth >= 3000) {
      if (charCount <= 2700) columnClass = "center-1";
      else if (charCount <= 510) columnClass = "center-2";
      else if (charCount <= 8000) columnClass = "center-3";
      else if (charCount <= 12000) columnClass = "center-4";
      else {
        columnClass = "hd-center-4";
        fontClass = "font-4k-psalms-119";
      }
    }
    if (window.innerWidth >= 900 && window.innerWidth < 3000) {
      if (charCount > 12000) {
        columnClass = "hd-center-3-psalms-119";
        fontClass = "font-psalms-119";
      } else if (charCount > 4200) {
        columnClass = "hd-center-3";
        fontClass = "font-xsmall";
      } else if (charCount > 2700) {
        columnClass = "hd-center-3";
        fontClass = "font-small";
      } else {
        columnClass = "hd-center-2";
        fontClass = fontClass || "font-small";
      }
    }
    html += `<div class="bible-chapter${columnClass ? " " + columnClass : ""}${fontClass ? " " + fontClass : ""}">`;
    for (const verse of chapter.verses) {
      // Store original verse text in a data attribute for safe re-highlighting
      html += `<span class="verse-num" data-verse="${verse.n}">${verse.n}</span> <span class="verse-text" data-verse="${verse.n}" data-original="${encodeURIComponent(verse.text)}">${verse.text}</span><br>`;
      // Collect words for frequency analysis
      if (!window._chapterWords) window._chapterWords = [];
      window._chapterWords.push(...verse.text.split(/\W+/));
    }
    html += "</div>";
    main.innerHTML = html;

    // Load topics for current book/chapter
    let topicBar = document.getElementById("chapter-topic-bar");
    if (!topicBar) {
      const nav = document.querySelector(".bp-sidebar--left");
      if (nav) {
        topicBar = document.createElement("div");
        topicBar.id = "chapter-topic-bar";
        topicBar.style.display = "flex";
        topicBar.style.flexWrap = "wrap";
        topicBar.style.gap = "6px";
        topicBar.style.margin = "12px 0";
        nav.insertBefore(topicBar, nav.children[1] || null);
      }
    }
    if (topicBar) topicBar.innerHTML = "";
    // Try to load topics for the current book, using new predictable filename: NNN_BOOKID_BSB.json
    const topicFile = getTopicFilename(bookId);
    const topicFileCandidates = topicFile ? [topicFile] : [];

    // Clear right sidebar
    const aside = document.querySelector(".bp-sidebar--right");
    if (aside) aside.innerHTML = "";

    function tryFetchTopicFile(files, cb) {
      if (!files.length) return cb(null);
      fetch(files[0])
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => cb(data))
        .catch(() => tryFetchTopicFile(files.slice(1), cb));
    }

    tryFetchTopicFile(topicFileCandidates, (topics) => {
      if (!topics) return;
      let chapterTopics = topics.chapterTopics[chapterNum];
      let meta = null;
      // Support both new (object with meta/topics) and old (array) formats
      if (
        chapterTopics &&
        chapterTopics.meta &&
        Array.isArray(chapterTopics.topics)
      ) {
        meta = chapterTopics.meta;
        chapterTopics = chapterTopics.topics;
      } else if (!Array.isArray(chapterTopics)) {
        chapterTopics = [];
      }
      // --- Display chapter meta in legend/footer ---
      const legendElem = document.querySelector(".bp-footer__legend");
      if (legendElem && meta) {
        // Display all key-value pairs in meta
        let legendStr = "";
        const metaKeys = Object.keys(meta);
        metaKeys.forEach((key, idx) => {
          if (idx > 0) legendStr += " | ";
          legendStr += `<b>${key}:</b> ${meta[key]}`;
        });
        legendElem.innerHTML = legendStr;
      } else if (legendElem) {
        legendElem.innerHTML = "";
      }
      // Create highlight buttons in right sidebar
      const aside = document.querySelector(".bp-sidebar--right");
      if (aside) aside.innerHTML = "";
      // Re-insert sticky highlight toggle bar if function exists
      if (window.renderStickyHighlightToggle) {
        window.renderStickyHighlightToggle(aside);
        // Move sticky toggle bar to top if not already
        const stickyBar = aside.querySelector(".sticky-highlight-toggle-bar");
        if (stickyBar && aside.firstChild !== stickyBar) {
          aside.insertBefore(stickyBar, aside.firstChild);
        }
      }
      let highlightBar = document.getElementById("chapter-highlight-bar");
      if (!highlightBar && aside) {
        highlightBar = document.createElement("div");
        highlightBar.id = "chapter-highlight-bar";
        highlightBar.style.display = "flex";
        highlightBar.style.flexWrap = "wrap";
        highlightBar.style.gap = "6px";
        highlightBar.style.margin = "12px 0";
        // Always insert highlightBar after sticky toggle bar
        const stickyBar = aside.querySelector(".sticky-highlight-toggle-bar");
        if (stickyBar && stickyBar.nextSibling) {
          aside.insertBefore(highlightBar, stickyBar.nextSibling);
        } else if (stickyBar) {
          aside.appendChild(highlightBar);
        } else {
          aside.insertBefore(highlightBar, aside.firstChild);
        }
      }
      if (highlightBar) highlightBar.innerHTML = "";
      // LEFT: label and outline buttons (with highlight logic)
      chapterTopics.forEach((topic) => {
        let btn = null;
        let type = null;
        if (topic.label) {
          btn = document.createElement("button");
          btn.textContent = topic.label;
          btn.className = "topic-btn topic-label-btn";
          type = "label";
        } else if (topic.outline) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-outline-btn";
          if (Array.isArray(topic.references) && topic.references.length) {
            // Create link icon span
            const linkIcon = document.createElement("span");
            linkIcon.className = "outline-link-icon";
            linkIcon.innerHTML = "&#x1F4D6;"; // Unicode book icon
            // Tooltip message
            linkIcon.title =
              topic.references.join("; ") +
              "\nClick to pin or follow reference";
            // Add click handler for sticky/follow
            linkIcon.style.cursor = "pointer";
            linkIcon.addEventListener("click", (e) => {
              e.stopPropagation();
              showReferenceMenu(linkIcon, topic.references, topic, btn);
            });
            btn.appendChild(linkIcon);
            // Always append the outline text as a text node
            btn.appendChild(document.createTextNode(" " + topic.outline));
            // Show a menu of references for navigation and pinning
            function showReferenceMenu(icon, references, topic, outlineBtn) {
              // Remove any existing menu
              document
                .querySelectorAll(".reference-menu")
                .forEach((m) => m.remove());
              // Create menu
              const menu = document.createElement("div");
              menu.className = "reference-menu";
              menu.style.position = "absolute";
              menu.style.zIndex = 1000;
              menu.style.background = "#fff";
              menu.style.border = "1px solid #ccc";
              menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
              menu.style.padding = "6px 10px";
              menu.style.borderRadius = "6px";
              menu.style.fontSize = "14px";
              menu.style.minWidth = "180px";
              menu.style.maxWidth = "320px";
              menu.style.color = "#222";
              menu.style.cursor = "default";
              // Add references as clickable items
              references.forEach((ref) => {
                const refItem = document.createElement("div");
                refItem.className = "reference-menu-item";
                refItem.textContent = ref;
                refItem.style.padding = "4px 0";
                refItem.style.cursor = "pointer";
                refItem.addEventListener("click", (e) => {
                  e.stopPropagation();
                  menu.remove();
                  handleReferenceClick(ref, topic, outlineBtn);
                });
                menu.appendChild(refItem);
              });
              // Add pin option
              const pinItem = document.createElement("div");
              pinItem.textContent = "Close";
              pinItem.className = "reference-menu-item";
              pinItem.style.padding = "4px 0";
              pinItem.style.cursor = "pointer";
              pinItem.style.color = "#0074d9";
              pinItem.addEventListener("click", (e) => {
                e.stopPropagation();
                menu.remove();
                pinOutline(topic, outlineBtn);
              });
              menu.appendChild(document.createElement("hr"));
              menu.appendChild(pinItem);
              // Position menu below icon
              const rect = icon.getBoundingClientRect();
              menu.style.left = `${rect.left + window.scrollX}px`;
              menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
              document.body.appendChild(menu);
              // Remove menu on outside click
              setTimeout(() => {
                document.addEventListener("mousedown", function handler(e) {
                  if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener("mousedown", handler);
                  }
                });
              }, 0);
            }

            // Handle clicking a reference: navigate and auto-select outline if possible
            function handleReferenceClick(ref, topic, outlineBtn) {
              // Parse reference (e.g., "Ruth 4:18–22")
              const match = ref.match(
                /([1-3]?[A-Za-z]+)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?/,
              );
              if (!match) return;
              let [_, book, chapter, verseStart, verseEnd] = match;
              book = bookNameToId(book);
              chapter = parseInt(chapter, 10);
              // Navigate to book/chapter
              if (book && chapter) {
                loadBibleChapter(book, chapter, true);
                // After navigation, try to auto-select matching outline
                setTimeout(() => {
                  autoSelectMatchingOutline(
                    topic,
                    book,
                    chapter,
                    verseStart,
                    verseEnd,
                  );
                }, 500);
              }
            }

            // Try to select the outline button whose verses match the reference
            function autoSelectMatchingOutline(
              originTopic,
              book,
              chapter,
              verseStart,
              verseEnd,
            ) {
              // Find the topicBar and all outline buttons
              const topicBar = document.getElementById("chapter-topic-bar");
              if (!topicBar) return;
              // Find all outline topics for this chapter
              const topics = window._lastLoadedTopics;
              const chapterTopics =
                (topics &&
                  topics.chapterTopics &&
                  topics.chapterTopics[chapter]) ||
                [];
              // Try to match by verses
              let refVerses = [];
              if (verseStart && verseEnd) {
                for (
                  let v = parseInt(verseStart, 10);
                  v <= parseInt(verseEnd, 10);
                  v++
                )
                  refVerses.push(v);
              } else if (verseStart) {
                refVerses = [parseInt(verseStart, 10)];
              }
              // Find outline topic with matching verses
              for (let i = 0; i < chapterTopics.length; i++) {
                const t = chapterTopics[i];
                if (t.outline && t.verses) {
                  const tVerses = t.verses.flatMap((v) => {
                    if (typeof v === "string" && v.includes("-")) {
                      const [start, end] = v.split("-").map(Number);
                      return Array.from(
                        { length: end - start + 1 },
                        (_, idx) => start + idx,
                      );
                    } else {
                      return [Number(v)];
                    }
                  });
                  if (
                    refVerses.length &&
                    tVerses.length &&
                    refVerses.every((v) => tVerses.includes(v))
                  ) {
                    // Simulate click/select
                    const btns =
                      topicBar.querySelectorAll(".topic-outline-btn");
                    if (btns[i]) btns[i].click();
                    break;
                  }
                }
              }
            }

            // Pin outline: visually mark as pinned (future: sticky highlight)
            function pinOutline(topic, outlineBtn) {
              outlineBtn.classList.add("pinned");
              // Optionally, keep highlight active or show a pin icon
            }

            // Helper: map book name to ID (e.g., 'Matthew' -> 'MAT')
            function bookNameToId(name) {
              // Add more mappings as needed
              const map = {
                Genesis: "GEN",
                Exodus: "EXO",
                Leviticus: "LEV",
                Numbers: "NUM",
                Deuteronomy: "DEU",
                Joshua: "JOS",
                Judges: "JDG",
                Ruth: "RUT",
                "1 Samuel": "1SA",
                "2 Samuel": "2SA",
                "1 Kings": "1KI",
                "2 Kings": "2KI",
                "1 Chronicles": "1CH",
                "2 Chronicles": "2CH",
                Ezra: "EZR",
                Nehemiah: "NEH",
                Esther: "EST",
                Job: "JOB",
                Psalms: "PSA",
                Proverbs: "PRO",
                Ecclesiastes: "ECC",
                "Song of Songs": "SNG",
                Isaiah: "ISA",
                Jeremiah: "JER",
                Lamentations: "LAM",
                Ezekiel: "EZK",
                Daniel: "DAN",
                Hosea: "HOS",
                Joel: "JOL",
                Amos: "AMO",
                Obadiah: "OBA",
                Jonah: "JON",
                Micah: "MIC",
                Nahum: "NAM",
                Habakkuk: "HAB",
                Zephaniah: "ZEP",
                Haggai: "HAG",
                Zechariah: "ZEC",
                Malachi: "MAL",
                Matthew: "MAT",
                Mark: "MRK",
                Luke: "LUK",
                John: "JHN",
                Acts: "ACT",
                Romans: "ROM",
                "1 Corinthians": "1CO",
                "2 Corinthians": "2CO",
                Galatians: "GAL",
                Ephesians: "EPH",
                Philippians: "PHP",
                Colossians: "COL",
                "1 Thessalonians": "1TH",
                "2 Thessalonians": "2TH",
                "1 Timothy": "1TI",
                "2 Timothy": "2TI",
                Titus: "TIT",
                Philemon: "PHM",
                Hebrews: "HEB",
                James: "JAS",
                "1 Peter": "1PE",
                "2 Peter": "2PE",
                "1 John": "1JN",
                "2 John": "2JN",
                "3 John": "3JN",
                Jude: "JUD",
                Revelation: "REV",
                // Short forms
                Ruth: "RUT",
                Luke: "LUK",
                Matthew: "MAT",
                Mark: "MRK",
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
              return map[name] || map[name.replace(/\.$/, "")] || null;
            }
          } else {
            // No references, just show the outline text
            btn.textContent = topic.outline;
          }
          type = "outline";
        }
        if (btn) {
          btn.onclick = () => {
            const isActive = btn.classList.contains("active");
            topicBar
              .querySelectorAll(".topic-btn")
              .forEach((b) => b.classList.remove("active"));
            document
              .querySelectorAll(".verse-highlight")
              .forEach((el) => el.classList.remove("verse-highlight"));
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
                  .querySelectorAll(`.verse-num[data-verse='${v}']`)
                  .forEach((el) => el.classList.add("verse-highlight"));
                document
                  .querySelectorAll(`.verse-text[data-verse='${v}']`)
                  .forEach((el) => el.classList.add("verse-highlight"));
              });
            }
          };
          if (topicBar) topicBar.appendChild(btn);
        }
      });
      // RIGHT: highlight buttons only (supports sticky multi-select)
      function resetVerseTextToOriginal() {
        document.querySelectorAll(".verse-text").forEach((el) => {
          const orig = el.getAttribute("data-original");
          if (orig !== null) {
            el.innerHTML = decodeURIComponent(orig);
          }
        });
      }

      function collectActivePhrases() {
        if (!highlightBar) return [];
        const phrases = [];
        highlightBar
          .querySelectorAll(".topic-highlight-btn.active")
          .forEach((activeBtn) => {
            const arr = Array.isArray(activeBtn._highlightPhrases)
              ? activeBtn._highlightPhrases
              : [];
            arr.forEach((p) => {
              if (p) phrases.push(p);
            });
          });
        return [...new Set(phrases)];
      }

      function applyPhraseHighlights(phrases) {
        if (!phrases.length) return;
        const sortedPhrases = [...phrases].sort((a, b) => b.length - a.length);
        document.querySelectorAll(".verse-text").forEach((el) => {
          const orig = el.getAttribute("data-original");
          if (orig === null) return;
          const text = decodeURIComponent(orig);
          let matches = [];
          sortedPhrases.forEach((phrase) => {
            const safe = phrase.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
            const regex = new RegExp(safe, "gi");
            let match;
            while ((match = regex.exec(text)) !== null) {
              matches.push({
                start: match.index,
                end: match.index + match[0].length,
                len: match[0].length,
              });
              if (regex.lastIndex === match.index) regex.lastIndex++;
            }
          });
          matches.sort((a, b) => a.start - b.start || b.len - a.len);
          let result = [];
          let lastEnd = 0;
          for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (m.start >= lastEnd) {
              result.push(m);
              lastEnd = m.end;
            }
          }
          let out = text;
          for (let i = result.length - 1; i >= 0; i--) {
            const m = result[i];
            out =
              out.slice(0, m.start) +
              '<span class="search-highlight">' +
              out.slice(m.start, m.end) +
              "</span>" +
              out.slice(m.end);
          }
          el.innerHTML = out;
        });
      }

      function rerenderActiveHighlights() {
        resetVerseTextToOriginal();
        applyPhraseHighlights(collectActivePhrases());
      }

      chapterTopics.forEach((topic) => {
        if (topic.highlight && highlightBar) {
          const btn = document.createElement("button");
          btn.textContent = topic.highlight;
          btn.className = "topic-btn topic-highlight-btn";
          btn._highlightPhrases = Array.isArray(topic.text) ? topic.text : [];
          btn.onclick = () => {
            const stickyToggle = document.getElementById(
              "sticky-highlight-toggle",
            );
            const stickyMode = !!(stickyToggle && stickyToggle.checked);

            if (stickyMode) {
              btn.classList.toggle("active");
            } else {
              const wasActive = btn.classList.contains("active");
              highlightBar
                .querySelectorAll(".topic-highlight-btn")
                .forEach((b) => b.classList.remove("active"));
              if (!wasActive) btn.classList.add("active");
            }

            rerenderActiveHighlights();
          };
          highlightBar.appendChild(btn);
        }
      });

      const stickyToggle = document.getElementById("sticky-highlight-toggle");
      if (stickyToggle && !stickyToggle.dataset.highlightSyncBound) {
        stickyToggle.addEventListener("change", () => {
          if (!highlightBar) return;
          if (!stickyToggle.checked) {
            const activeBtns = Array.from(
              highlightBar.querySelectorAll(".topic-highlight-btn.active"),
            );
            highlightBar
              .querySelectorAll(".topic-highlight-btn")
              .forEach((b) => b.classList.remove("active"));
            if (activeBtns.length) {
              const lastActive = activeBtns[activeBtns.length - 1];
              lastActive.classList.add("active");
            }
          }
          rerenderActiveHighlights();
        });
        stickyToggle.dataset.highlightSyncBound = "1";
      }
    }); // End tryFetchTopicFile callback
    // Update character count in footer
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
        ? `<b>Top words:</b> ` +
          topWords.map(([w, c]) => `${w} (${c})`).join(", ")
        : "";
      if (cc) {
        cc.innerHTML =
          `<b>Character count:</b> ${charCount}` +
          (topWordsStr ? ` | ${topWordsStr}` : "") +
          " | -> Control+F to highlight whatever you type.";
      }
      // Reset for next chapter load
      window._chapterWords = [];
    }
    if (typeof window !== "undefined" && window.localStorage) {
      saveLastRead(bookId, chapterNum);
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

function parseBookWideRangeToken(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  const m = trimmed.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  let startChapter = parseInt(m[1], 10);
  let startVerse = parseInt(m[2], 10);
  let endChapter = parseInt(m[3], 10);
  let endVerse = parseInt(m[4], 10);
  if ([startChapter, startVerse, endChapter, endVerse].some((n) => n < 1)) {
    return null;
  }

  const isReversed =
    startChapter > endChapter ||
    (startChapter === endChapter && startVerse > endVerse);
  if (isReversed) {
    const tempStartChapter = startChapter;
    const tempStartVerse = startVerse;
    startChapter = endChapter;
    startVerse = endVerse;
    endChapter = tempStartChapter;
    endVerse = tempStartVerse;
  }

  return {
    raw: trimmed,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  };
}

function buildBookWideLabelVerseKeys(label, chapterMaxVerseMap) {
  const tokens = Array.isArray(label?.verses) ? label.verses : [];
  const verseKeys = [];
  let firstKey = null;

  tokens.forEach((token) => {
    const parsed = parseBookWideRangeToken(token);
    if (!parsed) {
      console.warn("Skipping invalid bookWideLabels range:", token);
      return;
    }
    const { startChapter, startVerse, endChapter, endVerse, raw } = parsed;

    for (let ch = startChapter; ch <= endChapter; ch++) {
      const chapterMax = chapterMaxVerseMap[ch];
      if (!chapterMax) continue;
      const fromVerse = ch === startChapter ? startVerse : 1;
      const toVerse = ch === endChapter ? endVerse : chapterMax;
      if (fromVerse > chapterMax) continue;
      const cappedTo = Math.min(toVerse, chapterMax);
      for (let v = fromVerse; v <= cappedTo; v++) {
        const key = `${ch}:${v}`;
        if (!firstKey) firstKey = key;
        verseKeys.push(key);
      }
    }

    if (!firstKey) {
      console.warn("Range resolved to no verses in this book:", raw);
    }
  });

  return { verseKeys, firstKey };
}

async function loadBibleBook(bookId = "MAT") {
  setBpViewMode("entireBook");
  window._currentBookId = bookId;
  window._currentChapterNum = 1;

  if (window.updateBookScrollbar) window.updateBookScrollbar(bookId);

  const main = document.querySelector(".bp-main");
  const aside = document.querySelector(".bp-sidebar--right");
  const topicBar = document.getElementById("chapter-topic-bar");
  const legendElem = document.querySelector(".bp-footer__legend");
  if (!main) return;
  main.innerHTML = '<div class="loading">Loading book...</div>';
  if (aside) aside.innerHTML = "";
  if (legendElem) legendElem.innerHTML = "";

  try {
    const data = await getBibleData();
    const book = data.books.find((b) => b.id === bookId);
    if (!book) {
      main.innerHTML = `<div class="error">Book not found.</div>`;
      if (topicBar) topicBar.innerHTML = "";
      return;
    }

    const chapterMaxVerseMap = {};
    let charCount = 0;
    book.chapters.forEach((ch) => {
      chapterMaxVerseMap[ch.number] = Array.isArray(ch.verses)
        ? ch.verses.length
        : 0;
      (ch.verses || []).forEach((verse) => {
        charCount += (verse.text || "").length;
      });
    });

    const bookName = bookNames[bookId] || bookId;
    const html = [];
    html.push(`<div class="bp-book-view">`);
    html.push(`<h2 class="bp-book-view__title">${bookName} (Entire Book)</h2>`);
    html.push(`<div class="bible-book bible-book--dense">`);
    book.chapters.forEach((chapter) => {
      html.push(
        `<h3 class="bp-book-view__chapter">Chapter ${chapter.number}</h3>`,
      );
      (chapter.verses || []).forEach((verse) => {
        const safeText = encodeURIComponent(verse.text || "");
        html.push(
          `<span class="verse-num" data-chapter="${chapter.number}" data-verse="${verse.n}" data-verse-key="${chapter.number}:${verse.n}">${chapter.number}:${verse.n}</span> <span class="verse-text" data-chapter="${chapter.number}" data-verse="${verse.n}" data-verse-key="${chapter.number}:${verse.n}" data-original="${safeText}">${verse.text}</span><br>`,
        );
      });
    });
    html.push(`</div>`);
    html.push(`</div>`);
    main.innerHTML = html.join("");

    if (window.updateChapterNav) {
      window.updateChapterNav(bookId, 1, 1);
    }
    if (window.updateChapterDropdown) {
      window.updateChapterDropdown(bookId, 1, 1);
    }

    if (topicBar) topicBar.innerHTML = "";
    const topicFile = getTopicFilename(bookId);
    if (!topicFile || !topicBar) return;

    const resp = await fetch(topicFile);
    if (!resp.ok) {
      topicBar.innerHTML = `<div class="error">No book-wide labels found.</div>`;
      return;
    }

    const topicsData = await resp.json();
    const bookWideLabels = Array.isArray(topicsData.bookWideLabels)
      ? topicsData.bookWideLabels
      : [];
    const bookWideHighlights = Array.isArray(topicsData.bookWideHighlights)
      ? topicsData.bookWideHighlights
      : [];

    // ── State for active verse-range keys (from left-panel label) ────────────
    let activeRangeKeys = new Set();

    // ── Unified rerender: phrase highlights + verse-range highlights ──────────
    // Phrase pass uses data-original to reset, then wraps matches in search-highlight.
    // Range pass then re-applies verse-highlight class on top without touching innerHTML.
    function collectBookPhrases() {
      const phrases = [];
      if (bookHighlightBar) {
        bookHighlightBar
          .querySelectorAll(".topic-highlight-btn.active")
          .forEach((activeBtn) => {
            (Array.isArray(activeBtn._highlightPhrases)
              ? activeBtn._highlightPhrases
              : []
            ).forEach((p) => {
              if (p) phrases.push(p);
            });
          });
      }
      if (bookSearchField && bookSearchField.value.trim()) {
        phrases.push(bookSearchField.value.trim());
      }
      return [...new Set(phrases)];
    }

    function applyBookPhraseHighlights(phrases) {
      if (!phrases.length) return;
      const sortedPhrases = [...phrases].sort((a, b) => b.length - a.length);
      document.querySelectorAll(".verse-text").forEach((el) => {
        const orig = el.getAttribute("data-original");
        if (orig === null) return;
        const text = decodeURIComponent(orig);
        const matches = [];
        sortedPhrases.forEach((phrase) => {
          const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(safe, "gi");
          let match;
          while ((match = regex.exec(text)) !== null) {
            matches.push({
              start: match.index,
              end: match.index + match[0].length,
              len: match[0].length,
            });
            if (regex.lastIndex === match.index) regex.lastIndex++;
          }
        });
        matches.sort((a, b) => a.start - b.start || b.len - a.len);
        const merged = [];
        let lastEnd = 0;
        for (const m of matches) {
          if (m.start >= lastEnd) {
            merged.push(m);
            lastEnd = m.end;
          }
        }
        let out = text;
        for (let i = merged.length - 1; i >= 0; i--) {
          const m = merged[i];
          out =
            out.slice(0, m.start) +
            '<span class="search-highlight">' +
            out.slice(m.start, m.end) +
            "</span>" +
            out.slice(m.end);
        }
        el.innerHTML = out;
      });
    }

    function reapplyBookRangeHighlights() {
      if (!activeRangeKeys.size) return;
      activeRangeKeys.forEach((vk) => {
        document
          .querySelectorAll(`[data-verse-key='${vk}']`)
          .forEach((el) => el.classList.add("verse-highlight"));
      });
    }

    function rerenderBookHighlights() {
      // 1. Reset verse text to originals
      document.querySelectorAll(".verse-text[data-original]").forEach((el) => {
        el.innerHTML = decodeURIComponent(el.getAttribute("data-original"));
      });
      // Remove range highlight class from all verse spans
      document
        .querySelectorAll(".verse-highlight")
        .forEach((el) => el.classList.remove("verse-highlight"));
      // 2. Apply phrase highlights (search-highlight spans)
      applyBookPhraseHighlights(collectBookPhrases());
      // 3. Re-apply verse range highlights on top
      reapplyBookRangeHighlights();
    }

    // ── Left panel: bookWideLabels ────────────────────────────────────────────
    if (bookWideLabels.length) {
      bookWideLabels.forEach((labelEntry) => {
        if (
          !labelEntry ||
          !labelEntry.label ||
          !Array.isArray(labelEntry.verses)
        )
          return;
        const btn = document.createElement("button");
        btn.className = "topic-btn topic-label-btn";
        btn.textContent = labelEntry.label;
        btn.onclick = () => {
          const wasActive = btn.classList.contains("active");
          topicBar
            .querySelectorAll(".topic-btn")
            .forEach((b) => b.classList.remove("active"));
          activeRangeKeys.clear();
          if (!wasActive) {
            const { verseKeys, firstKey } = buildBookWideLabelVerseKeys(
              labelEntry,
              chapterMaxVerseMap,
            );
            verseKeys.forEach((vk) => activeRangeKeys.add(vk));
            if (verseKeys.length) {
              btn.classList.add("active");
              rerenderBookHighlights();
              if (firstKey) {
                const first = document.querySelector(
                  `.verse-text[data-verse-key='${firstKey}']`,
                );
                if (first)
                  first.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }
          } else {
            rerenderBookHighlights();
          }
        };
        topicBar.appendChild(btn);
      });
    }

    // ── Right panel: sticky toggle + search field + bookWideHighlights ────────
    let bookHighlightBar = null;
    let bookSearchField = null;

    if (aside) {
      // Sticky toggle (reuse existing renderer from app.js if available)
      if (window.renderStickyHighlightToggle) {
        window.renderStickyHighlightToggle(aside);
      }

      // Text search field
      bookSearchField = document.createElement("input");
      bookSearchField.type = "text";
      bookSearchField.id = "book-search-field";
      bookSearchField.className = "bp-book-search-field";
      bookSearchField.placeholder = "Highlight text…";
      bookSearchField.setAttribute("autocomplete", "off");
      aside.appendChild(bookSearchField);

      let searchDebounceTimer = null;
      bookSearchField.addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => rerenderBookHighlights(), 300);
      });

      // Highlight buttons from bookWideHighlights
      if (bookWideHighlights.length) {
        bookHighlightBar = document.createElement("div");
        bookHighlightBar.id = "book-highlight-bar";
        bookHighlightBar.style.cssText =
          "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;";
        aside.appendChild(bookHighlightBar);

        bookWideHighlights.forEach((entry) => {
          if (!entry || !entry.highlight || !Array.isArray(entry.text)) return;
          const btn = document.createElement("button");
          btn.textContent = entry.highlight;
          btn.className = "topic-btn topic-highlight-btn";
          btn._highlightPhrases = entry.text.filter(Boolean);
          btn.onclick = () => {
            const stickyToggle = document.getElementById(
              "sticky-highlight-toggle",
            );
            const stickyMode = !!(stickyToggle && stickyToggle.checked);
            if (stickyMode) {
              btn.classList.toggle("active");
            } else {
              const wasActive = btn.classList.contains("active");
              bookHighlightBar
                .querySelectorAll(".topic-highlight-btn")
                .forEach((b) => b.classList.remove("active"));
              if (!wasActive) btn.classList.add("active");
            }
            rerenderBookHighlights();
          };
          bookHighlightBar.appendChild(btn);
        });

        // Wire sticky toggle change to rerender
        const stickyToggle = document.getElementById("sticky-highlight-toggle");
        if (stickyToggle && !stickyToggle.dataset.bookHighlightSyncBound) {
          stickyToggle.addEventListener("change", () => {
            if (!bookHighlightBar) return;
            if (!stickyToggle.checked) {
              const activeBtns = Array.from(
                bookHighlightBar.querySelectorAll(
                  ".topic-highlight-btn.active",
                ),
              );
              bookHighlightBar
                .querySelectorAll(".topic-highlight-btn")
                .forEach((b) => b.classList.remove("active"));
              if (activeBtns.length)
                activeBtns[activeBtns.length - 1].classList.add("active");
            }
            rerenderBookHighlights();
          });
          stickyToggle.dataset.bookHighlightSyncBound = "1";
        }
      }
    }

    updateFooterCharCount(charCount, "");
  } catch (e) {
    main.innerHTML = `<div class="error">Failed to load entire book.</div>`;
    if (topicBar) topicBar.innerHTML = "";
  }
}

// Helper: update main content
function updateMainContent(main, html) {
  main.innerHTML = html;
}

// Helper: update aside/sidebar
function updateAside(aside, content = "") {
  if (aside) aside.innerHTML = content;
}

// Helper: update topic bar
function updateTopicBar(topicBar, content = "") {
  if (topicBar) topicBar.innerHTML = content;
}

// Helper: update character count/footer
function updateFooterCharCount(charCount, topWordsStr) {
  const footer = document.querySelector(".bp-footer");
  if (footer) {
    let cc = document.getElementById("bp-char-count");
    if (cc) {
      cc.textContent =
        `Character count: ${charCount}` +
        (topWordsStr ? ` | ${topWordsStr}` : "");
    }
  }
}

// Helper: create a topic button
function createTopicButton(topic, topicBar, onClick) {
  const btn = document.createElement("button");
  btn.textContent = topic.label || topic.outline || topic.highlight;
  btn.className = topic.label
    ? "topic-btn topic-label-btn"
    : topic.outline
      ? "topic-btn topic-outline-btn"
      : "topic-btn topic-highlight-btn";
  btn.onclick = onClick;
  topicBar.appendChild(btn);
  return btn;
}

// Helper: create highlightBar if needed
function ensureHighlightBar(aside) {
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
  return highlightBar;
}

// Helper to get topic filename for a book
function getTopicFilename(bid) {
  const idx = bookOrder.indexOf(bid);
  if (idx === -1) return null;
  const num = (idx + 1).toString().padStart(3, "0");
  return `data/topics/${num}_${bid}_BSB.json`;
}

// Optionally, call on load
if (typeof window !== "undefined") {
  window.loadBibleChapter = loadBibleChapter;
  window.loadBibleBook = loadBibleBook;
  document.addEventListener("DOMContentLoaded", () => {
    let bookId = "MAT";
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
