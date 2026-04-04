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
  if (window.updateBookViewNavButtons) {
    window.updateBookViewNavButtons();
  }
}

const bpBookNameToId = Object.entries(bookNames).reduce((acc, [id, name]) => {
  acc[String(name).toLowerCase()] = id;
  return acc;
}, {});

function normalizePhraseList(phrases) {
  const list = Array.isArray(phrases) ? phrases : [];
  const seen = new Set();
  const out = [];
  list.forEach((p) => {
    if (typeof p !== "string") return;
    if (!p.trim()) return;
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  });
  return out.sort((a, b) => b.length - a.length);
}

function getLiteralSearchPhrase(inputEl) {
  if (!inputEl || typeof inputEl.value !== "string") return "";
  return inputEl.value.trim() ? inputEl.value : "";
}

function getBookIdFromReference(reference) {
  if (typeof reference !== "string") return null;
  const match = reference
    .trim()
    .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+\d+/);
  if (!match) return null;
  const normalizedBookName = match[1].replace(/\s+/g, " ").trim().toLowerCase();
  return bpBookNameToId[normalizedBookName] || null;
}

function parseReferenceDetails(reference) {
  if (typeof reference !== "string") return null;
  const match = reference
    .trim()
    .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?/);
  if (!match) return null;
  const [, rawBookName, rawChapterNum, rawVerseStart, rawVerseEnd] = match;
  const normalizedBookName = rawBookName
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const chapterNum = parseInt(rawChapterNum, 10);
  const verseStart = rawVerseStart ? parseInt(rawVerseStart, 10) : null;
  const verseEnd = rawVerseEnd ? parseInt(rawVerseEnd, 10) : null;
  return {
    bookId: bpBookNameToId[normalizedBookName] || null,
    chapterNum: Number.isNaN(chapterNum) ? null : chapterNum,
    verseStart: Number.isNaN(verseStart) ? null : verseStart,
    verseEnd: Number.isNaN(verseEnd) ? null : verseEnd,
  };
}

function openReferenceMenu(icon, references, onSelectReference, onClose) {
  document.querySelectorAll(".reference-menu").forEach((m) => m.remove());
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

  references.forEach((ref) => {
    const refItem = document.createElement("div");
    refItem.className = "reference-menu-item";
    refItem.textContent = ref;
    refItem.style.padding = "4px 0";
    refItem.style.cursor = "pointer";
    refItem.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();
      onSelectReference(ref);
    });
    menu.appendChild(refItem);
  });

  const closeItem = document.createElement("div");
  closeItem.className = "reference-menu-item";
  closeItem.textContent = "Close";
  closeItem.style.padding = "4px 0";
  closeItem.style.cursor = "pointer";
  closeItem.style.color = "#0074d9";
  closeItem.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.remove();
    if (onClose) onClose();
  });
  menu.appendChild(document.createElement("hr"));
  menu.appendChild(closeItem);

  const rect = icon.getBoundingClientRect();
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener("mousedown", function handler(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("mousedown", handler);
      }
    });
  }, 0);
}

function decorateTopicButtonWithReferences(
  btn,
  label,
  references,
  onSelectReference,
  helperText,
  onClose,
) {
  if (!Array.isArray(references) || !references.length) {
    btn.textContent = label;
    return;
  }

  btn.classList.add("topic-btn--with-reference");
  const linkIcon = document.createElement("span");
  linkIcon.className = "outline-link-icon";
  linkIcon.innerHTML = "&#x1F4D6;";
  linkIcon.title = helperText
    ? `${references.join("; ")}\n${helperText}`
    : references.join("; ");
  linkIcon.style.cursor = "pointer";
  linkIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    openReferenceMenu(linkIcon, references, onSelectReference, onClose);
  });
  btn.appendChild(linkIcon);
  btn.appendChild(document.createTextNode(` ${label}`));
}

function buildVerseTextCache(verseElements) {
  const cache = new Map();
  (Array.isArray(verseElements) ? verseElements : []).forEach((el) => {
    const raw = el.getAttribute("data-original");
    if (raw === null) return;
    const text = decodeURIComponent(raw);
    cache.set(el, { text, lower: text.toLowerCase() });
  });
  return cache;
}

function resetVerseTextFromCache(verseTextCache) {
  verseTextCache.forEach((entry, el) => {
    el.innerHTML = entry.text;
  });
}

function collectNonOverlappingMatches(lowerText, lowerPhrases) {
  const matches = [];
  lowerPhrases.forEach((phrase) => {
    if (!phrase) return;
    let fromIdx = 0;
    while (true) {
      const idx = lowerText.indexOf(phrase, fromIdx);
      if (idx === -1) break;
      matches.push({
        start: idx,
        end: idx + phrase.length,
        len: phrase.length,
      });
      fromIdx = idx + 1;
    }
  });
  matches.sort((a, b) => a.start - b.start || b.len - a.len);

  const merged = [];
  let lastEnd = 0;
  matches.forEach((m) => {
    if (m.start >= lastEnd) {
      merged.push(m);
      lastEnd = m.end;
    }
  });
  return merged;
}

function renderHighlightedHtml(text, matches) {
  if (!matches.length) return text;
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    out =
      out.slice(0, m.start) +
      '<span class="search-highlight">' +
      out.slice(m.start, m.end) +
      "</span>" +
      out.slice(m.end);
  }
  return out;
}

function applyPhraseHighlightsFromCache(verseTextCache, phrases) {
  const normalized = normalizePhraseList(phrases);
  if (!normalized.length) {
    resetVerseTextFromCache(verseTextCache);
    return;
  }
  const lowerPhrases = normalized.map((p) => p.toLowerCase());
  verseTextCache.forEach((entry, el) => {
    const matches = collectNonOverlappingMatches(entry.lower, lowerPhrases);
    el.innerHTML = renderHighlightedHtml(entry.text, matches);
  });
}

function clearBoundListener(el, eventName, propName) {
  if (!el || !el[propName]) return;
  el.removeEventListener(eventName, el[propName]);
  el[propName] = null;
}

function bindSingleListener(el, eventName, propName, handler) {
  if (!el) return;
  clearBoundListener(el, eventName, propName);
  el[propName] = handler;
  el.addEventListener(eventName, handler);
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

    const chapterVerseTextCache = buildVerseTextCache(
      Array.from(document.querySelectorAll(".verse-text[data-original]")),
    );

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
      }

      let chapterSearchField = null;
      if (aside) {
        chapterSearchField = document.createElement("input");
        chapterSearchField.type = "text";
        chapterSearchField.id = "chapter-search-field";
        chapterSearchField.className = "bp-chapter-search-field";
        chapterSearchField.placeholder = "Highlight text...";
        chapterSearchField.setAttribute("autocomplete", "off");

        const stickyControls = aside.querySelector(
          ".bp-sidebar-sticky-controls",
        );
        if (stickyControls) {
          stickyControls.appendChild(chapterSearchField);
        } else {
          aside.insertBefore(chapterSearchField, aside.firstChild);
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
        aside.appendChild(highlightBar);
      }
      if (highlightBar) highlightBar.innerHTML = "";
      function autoSelectMatchingChapterTopic(chapterNum, verseStart, verseEnd) {
        const sidebarTopicBar = document.getElementById("chapter-topic-bar");
        if (!sidebarTopicBar || !verseStart) return;
        const topics = window._lastLoadedTopics;
        const targetChapterTopics =
          (topics && topics.chapterTopics && topics.chapterTopics[chapterNum]) ||
          [];
        const renderableTopics = targetChapterTopics.filter(
          (entry) =>
            entry &&
            Array.isArray(entry.verses) &&
            (typeof entry.label === "string" || typeof entry.outline === "string"),
        );
        const targetVerses = [];
        const rangeEnd = verseEnd || verseStart;
        for (let verse = verseStart; verse <= rangeEnd; verse++) {
          targetVerses.push(verse);
        }

        const matchingIndex = renderableTopics.findIndex((entry) => {
          const entryVerses = entry.verses.flatMap((value) => {
            if (typeof value === "string" && value.includes("-")) {
              const [start, end] = value.split("-").map(Number);
              return Array.from(
                { length: end - start + 1 },
                (_, idx) => start + idx,
              );
            }
            return [Number(value)];
          });
          return targetVerses.every((verse) => entryVerses.includes(verse));
        });

        if (matchingIndex === -1) return;
        const buttons = sidebarTopicBar.querySelectorAll(".topic-btn");
        if (buttons[matchingIndex]) {
          buttons[matchingIndex].click();
        }
      }

      function openChapterTopicReference(reference) {
        const details = parseReferenceDetails(reference);
        if (!details || !details.bookId || !details.chapterNum) return;
        loadBibleChapter(details.bookId, details.chapterNum, true);
        if (details.verseStart) {
          setTimeout(() => {
            autoSelectMatchingChapterTopic(
              details.chapterNum,
              details.verseStart,
              details.verseEnd,
            );
          }, 500);
        }
      }

      function pinTopicButton(btn) {
        btn.classList.add("pinned");
      }

      // LEFT: label and outline buttons (with highlight logic)
      chapterTopics.forEach((topic) => {
        let btn = null;
        let type = null;
        if (topic.label) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-label-btn";
          decorateTopicButtonWithReferences(
            btn,
            topic.label,
            topic.references,
            openChapterTopicReference,
            "Click to follow reference",
          );
          type = "label";
        } else if (topic.outline) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-outline-btn";
          decorateTopicButtonWithReferences(
            btn,
            topic.outline,
            topic.references,
            openChapterTopicReference,
            "Click to follow reference",
            () => pinTopicButton(btn),
          );
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
      // RIGHT: highlight buttons + typed field (supports sticky multi-select)

      function collectActivePhrases() {
        const phrases = [];
        if (highlightBar) {
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
        }
        const typedPhrase = getLiteralSearchPhrase(chapterSearchField);
        if (typedPhrase) {
          phrases.push(typedPhrase);
        }
        return normalizePhraseList(phrases);
      }

      function rerenderActiveHighlights() {
        applyPhraseHighlightsFromCache(
          chapterVerseTextCache,
          collectActivePhrases(),
        );
      }

      chapterTopics.forEach((topic) => {
        const highlightLabel =
          typeof topic.highlight === "string" ? topic.highlight.trim() : "";
        const highlightPhrases = normalizePhraseList(topic.text);
        if (highlightLabel && highlightPhrases.length && highlightBar) {
          const btn = document.createElement("button");
          btn.textContent = highlightLabel;
          btn.className = "topic-btn topic-highlight-btn";
          btn._highlightPhrases = highlightPhrases;
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

      if (chapterSearchField) {
        let chapterSearchDebounce = null;
        chapterSearchField.addEventListener("input", () => {
          clearTimeout(chapterSearchDebounce);
          chapterSearchDebounce = setTimeout(() => {
            rerenderActiveHighlights();
          }, 300);
        });
      }

      const stickyToggle = document.getElementById("sticky-highlight-toggle");
      if (stickyToggle) {
        clearBoundListener(
          stickyToggle,
          "change",
          "__bpBookHighlightSyncHandler",
        );
        bindSingleListener(
          stickyToggle,
          "change",
          "__bpChapterHighlightSyncHandler",
          () => {
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
          },
        );
      }
    }); // End tryFetchTopicFile callback
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
  let startChapter;
  let startVerse;
  let endChapter;
  let endVerse;

  const rangeMatch = trimmed.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  const singleVerseMatch = trimmed.match(/^(\d+):(\d+)$/);

  if (rangeMatch) {
    startChapter = parseInt(rangeMatch[1], 10);
    startVerse = parseInt(rangeMatch[2], 10);
    endChapter = parseInt(rangeMatch[3], 10);
    endVerse = parseInt(rangeMatch[4], 10);
  } else if (singleVerseMatch) {
    startChapter = parseInt(singleVerseMatch[1], 10);
    startVerse = parseInt(singleVerseMatch[2], 10);
    endChapter = startChapter;
    endVerse = startVerse;
  } else {
    return null;
  }

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

async function loadBibleBook(bookId = "MAT", options = {}) {
  const { preserveOrigin = false, skipBookHistory = false } = options;
  const enteringFromChapterView = window._currentViewMode !== "entireBook";
  const chapterBeforeBookMode = window._currentChapterNum || 1;

  if (enteringFromChapterView || !preserveOrigin || !window._entireBookOrigin) {
    window._entireBookOrigin = {
      bookId: window._currentBookId || bookId,
      chapterNum: chapterBeforeBookMode,
    };
  }
  window._chapterBeforeEntireBook = window._entireBookOrigin.chapterNum;
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(
      "bpChapterBeforeEntireBook",
      String(window._entireBookOrigin.chapterNum),
    );
    window.localStorage.setItem(
      "bpEntireBookOrigin",
      JSON.stringify(window._entireBookOrigin),
    );
  }

  if (enteringFromChapterView) {
    window._bookViewHistoryStack = [];
    window._bookViewHistoryIndex = -1;
  }

  setBpViewMode("entireBook");
  window._currentBookId = bookId;

  if (!skipBookHistory) {
    const currentStack = Array.isArray(window._bookViewHistoryStack)
      ? [...window._bookViewHistoryStack]
      : [];
    let currentIndex = Number.isInteger(window._bookViewHistoryIndex)
      ? window._bookViewHistoryIndex
      : -1;
    const activeBookId = currentIndex >= 0 ? currentStack[currentIndex] : null;
    if (activeBookId !== bookId) {
      const nextStack =
        currentIndex >= 0
          ? currentStack.slice(0, currentIndex + 1)
          : currentStack;
      if (nextStack[nextStack.length - 1] !== bookId) {
        nextStack.push(bookId);
      }
      window._bookViewHistoryStack = nextStack;
      window._bookViewHistoryIndex = nextStack.length - 1;
    }
  }
  if (window.updateBookViewNavButtons) {
    window.updateBookViewNavButtons();
  }

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
      const verses = Array.isArray(ch.verses) ? ch.verses : [];
      const maxVerse = verses.reduce((max, verse) => {
        const n = parseInt(verse?.n, 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 0);
      chapterMaxVerseMap[ch.number] = maxVerse;
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

    const bookVerseTextCache = buildVerseTextCache(
      Array.from(main.querySelectorAll(".verse-text[data-original]")),
    );

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
    window._lastLoadedBookTopics = topicsData;
    const bookWideOutline = Array.isArray(topicsData.bookWideOutline)
      ? topicsData.bookWideOutline
      : [];
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
      const typedPhrase = getLiteralSearchPhrase(bookSearchField);
      if (typedPhrase) {
        phrases.push(typedPhrase);
      }
      return [...new Set(phrases)];
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
      resetVerseTextFromCache(bookVerseTextCache);
      // Remove range highlight class from all verse spans
      document
        .querySelectorAll(".bp-main .verse-highlight")
        .forEach((el) => el.classList.remove("verse-highlight"));
      // 2. Apply phrase highlights (search-highlight spans)
      applyPhraseHighlightsFromCache(bookVerseTextCache, collectBookPhrases());
      // 3. Re-apply verse range highlights on top
      reapplyBookRangeHighlights();
    }

    function activateBookWideRangeEntry(btn, entry) {
      const wasActive = btn.classList.contains("active");
      topicBar
        .querySelectorAll(".topic-btn")
        .forEach((b) => b.classList.remove("active"));
      activeRangeKeys.clear();
      if (wasActive) {
        rerenderBookHighlights();
        return;
      }

      const { verseKeys, firstKey } = buildBookWideLabelVerseKeys(
        entry,
        chapterMaxVerseMap,
      );
      verseKeys.forEach((vk) => activeRangeKeys.add(vk));
      if (!verseKeys.length) {
        rerenderBookHighlights();
        return;
      }
      btn.classList.add("active");
      rerenderBookHighlights();
      if (firstKey) {
        const first = document.querySelector(
          `.verse-text[data-verse-key='${firstKey}']`,
        );
        if (first) {
          first.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }

    function openBookWideOutlineReference(reference) {
      const targetBookId = getBookIdFromReference(reference);
      if (!targetBookId || !window.loadBibleBook) return;
      window.loadBibleBook(targetBookId, { preserveOrigin: true });
    }

    if (bookWideOutline.length) {
      bookWideOutline.forEach((outlineEntry) => {
        if (
          !outlineEntry ||
          typeof outlineEntry.outline !== "string" ||
          !Array.isArray(outlineEntry.verses)
        ) {
          return;
        }
        const btn = document.createElement("button");
        btn.className = "topic-btn topic-outline-btn topic-book-outline-btn";
        decorateTopicButtonWithReferences(
          btn,
          outlineEntry.outline,
          outlineEntry.references,
          openBookWideOutlineReference,
          "Click to open referenced book in Entire Book view",
        );

        btn.onclick = () => {
          activateBookWideRangeEntry(btn, outlineEntry);
        };
        topicBar.appendChild(btn);
      });
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
        decorateTopicButtonWithReferences(
          btn,
          labelEntry.label,
          labelEntry.references,
          openBookWideOutlineReference,
          "Click to open referenced book in Entire Book view",
        );
        btn.onclick = () => {
          activateBookWideRangeEntry(btn, labelEntry);
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
      const stickyControls = aside.querySelector(".bp-sidebar-sticky-controls");
      if (stickyControls) {
        stickyControls.appendChild(bookSearchField);
      } else {
        aside.insertBefore(bookSearchField, aside.firstChild);
      }

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
          const label =
            typeof entry?.highlight === "string" ? entry.highlight.trim() : "";
          const phrases = normalizePhraseList(entry?.text);
          if (!label || !phrases.length) return;
          const btn = document.createElement("button");
          btn.textContent = label;
          btn.className = "topic-btn topic-highlight-btn";
          btn._highlightPhrases = phrases;
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
        if (stickyToggle) {
          clearBoundListener(
            stickyToggle,
            "change",
            "__bpChapterHighlightSyncHandler",
          );
          bindSingleListener(
            stickyToggle,
            "change",
            "__bpBookHighlightSyncHandler",
            () => {
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
            },
          );
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
