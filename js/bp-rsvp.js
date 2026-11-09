// js/bp-rsvp.js — Focus Reader: shows the text one word (or short phrase)
// at a time at a steady pace, the technique reading research calls RSVP
// (Rapid Serial Visual Presentation). It pops out of the eye button in the
// chapter header (chapter view and Entire Book), starts from the verse the
// reader is looking at, and when closed leaves the page on the verse where
// reading stopped so nothing is lost.
//
// Deliberately self-contained: it reads straight from bible.json (via the
// cached getBibleData the loader exposes) rather than from the rendered
// page, so it can run on past the end of a chapter or a book without
// touching the chapter view underneath. Only on close does it sync the page.
//
// Keys while open (also listed in the window's footer): Space play/pause,
// ← / → previous/next verse, ↑ / ↓ speed, F fullscreen, Esc leaves
// fullscreen first and closes on a second press.
import { bookNames, bookOrder } from "./bible-utils.js";

const WPM_MIN = 100;
const WPM_MAX = 900;
const WPM_STEP = 25;
const WPM_DEFAULT = 300;
const CHUNK_MAX = 3;
const LS_WPM = "bpRsvpWpm";
const LS_CHUNK = "bpRsvpChunk";
const LS_FULL = "bpRsvpFull";
const LS_STOP = "bpRsvpStopAtEnd";
// Fixed part of a chapter heading card's dwell (the rest scales with wpm).
const HEADING_MS = 1400;
// Chunks longer than this are never merged — a 3-word chunk of long words
// stops reading as a glance and defeats the fixed focal point.
const CHUNK_MAX_CHARS = 20;
// First few items after Play run slower and speed up to the set pace, so
// the eye has time to settle on the focal point.
const RAMP_ITEMS = 6;

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

async function getData() {
  if (typeof window.bpGetBibleData === "function") return window.bpGetBibleData();
  const response = await fetch("data/bible.json");
  return response.json();
}

// ── Tokenising ────────────────────────────────────────────────────────────
// A verse's words, with an em-dash kept on the word before it ("Jabez—the"
// → "Jabez—", "the") so a dashed aside still gets its own beat.
function verseWords(text) {
  const out = [];
  for (const raw of String(text || "").split(/\s+/)) {
    if (!raw) continue;
    for (const part of raw.replace(/—/g, "—\u0000").split("\u0000")) {
      if (part) out.push(part);
    }
  }
  return out;
}

const PHRASE_END_RE = /[.,;:!?—][”’"')\]]*$/;
const SENTENCE_END_RE = /[.!?][”’"')\]]*$/;
const CLAUSE_END_RE = /[,;:—][”’"')\]]*$/;

// Items for one chapter: { text, chapter, verseN, words, wordIdx, wordCount,
// lastInVerse } per word/chunk, plus an optional leading heading item
// ({ heading: true, text: "Matthew 6", chapter }) when flowing in from the
// chapter before.
function buildChapterItems(bookId, chapter, chunkSize, withHeading) {
  const items = [];
  if (withHeading) {
    items.push({
      heading: true,
      text: `${bookNames[bookId] || bookId} ${chapter.number}`,
      chapter: chapter.number,
      verseN: null,
    });
  }
  for (const verse of chapter.verses || []) {
    const words = verseWords(verse.text);
    const verseN = parseInt(verse.n, 10);
    let i = 0;
    while (i < words.length) {
      let k = 0;
      let len = 0;
      while (k < chunkSize && i + k < words.length) {
        const w = words[i + k];
        if (k > 0 && len + 1 + w.length > CHUNK_MAX_CHARS) break;
        len += (k ? 1 : 0) + w.length;
        k++;
        if (PHRASE_END_RE.test(w)) break;
      }
      items.push({
        text: words.slice(i, i + k).join(" "),
        chapter: chapter.number,
        verseN,
        words,
        wordIdx: i,
        wordCount: k,
        lastInVerse: i + k >= words.length,
      });
      i += k;
    }
  }
  return items;
}

// How long an item stays up. `base` is the per-word budget (60000 / wpm);
// punctuation, verse ends, long words and numerals all buy extra time, since
// RSVP's one real weakness is that nothing lets the eye linger on its own.
function dwellFor(item, base) {
  if (item.heading) return HEADING_MS + base;
  let ms = base * item.wordCount;
  const t = item.text;
  if (SENTENCE_END_RE.test(t)) ms += base * 1.6;
  else if (CLAUSE_END_RE.test(t)) ms += base * 0.7;
  else if (item.lastInVerse) ms += base * 0.5;
  const letters = t.replace(/[^A-Za-z]/g, "").length;
  if (letters > 8) ms += base * 0.3;
  if (letters > 12) ms += base * 0.3;
  if (/\d/.test(t)) ms += base * 0.3;
  return ms;
}

// "4 min", "1 hr 10 min", "under a minute" — for the paused-state estimate.
function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// Optimal recognition point: a little left of centre, where the eye lands
// naturally on a word. Leading quote marks don't count toward the length.
function orpIndex(text) {
  const m = text.match(/[A-Za-z0-9]/);
  const first = m ? m.index : 0;
  const len = text.length - first;
  let off;
  if (len <= 1) off = 0;
  else if (len <= 5) off = 1;
  else if (len <= 9) off = 2;
  else if (len <= 13) off = 3;
  else off = 4;
  let idx = Math.min(text.length - 1, first + off);
  while (idx < text.length - 1 && text[idx] === " ") idx++;
  return idx;
}

// ── Where to start / where to leave the page ─────────────────────────────
function parseVerseKey(el) {
  const key = el && el.getAttribute("data-verse-key");
  const m = key && key.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { chapterNum: parseInt(m[1], 10), verseN: parseInt(m[2], 10) };
}

// Chapter view: the first highlighted verse if any (an active label, a
// deep link's verse=), else the first verse in view. Entire Book: the first
// verse in view. Falls back to verse 1 of the current chapter.
function detectStartPosition() {
  const bookId = window._currentBookId || "MAT";
  const inBook = window._currentViewMode === "entireBook";
  const main = document.querySelector(".bp-main");
  let pos = null;
  if (main) {
    const hl = main.querySelector(".verse-text.verse-highlight");
    if (hl) pos = parseVerseKey(hl);
    if (!pos) {
      const hdr = main.querySelector(".bp-chapter-header");
      const topEdge = hdr
        ? hdr.getBoundingClientRect().bottom
        : main.getBoundingClientRect().top;
      for (const span of main.querySelectorAll(".verse-text")) {
        const r = span.getBoundingClientRect();
        if (r.height && r.bottom >= topEdge + 2) {
          pos = parseVerseKey(span);
          if (pos) break;
        }
      }
    }
  }
  if (!pos) {
    pos = {
      chapterNum: inBook ? 1 : parseInt(window._currentChapterNum, 10) || 1,
      verseN: 1,
    };
  }
  return { bookId, chapterNum: pos.chapterNum, verseN: pos.verseN };
}

async function syncPageToPosition(startPos, cur) {
  if (!cur) return;
  if (
    cur.bookId === startPos.bookId &&
    cur.chapterNum === startPos.chapterNum &&
    cur.verseN === startPos.verseN
  ) {
    return;
  }
  const inBook = window._currentViewMode === "entireBook";
  const main = document.querySelector(".bp-main");
  if (inBook && cur.bookId === window._currentBookId && main) {
    const key = `${cur.chapterNum}:${cur.verseN}`;
    const target = main.querySelector(`.verse-text[data-verse-key='${key}']`);
    if (target) {
      main
        .querySelectorAll(".verse-highlight")
        .forEach((el) => el.classList.remove("verse-highlight"));
      main
        .querySelectorAll(`[data-verse-key='${key}']`)
        .forEach((el) => el.classList.add("verse-highlight"));
      target.scrollIntoView({ block: "center" });
      return;
    }
  }
  if (typeof window.loadBibleChapter !== "function") return;
  const verse = { verseStart: cur.verseN, verseEnd: null };
  await window.loadBibleChapter(cur.bookId, cur.chapterNum, true, verse);
  if (typeof window.autoHighlightVerseRange === "function") {
    window.autoHighlightVerseRange(cur.chapterNum, cur.verseN, cur.verseN);
  }
}

// ── Icons (stroke-based, matching the chapter-header buttons) ────────────
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"></path></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"></path></svg>';
const ICON_PREV =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 5v14M18 5.5v13L8.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M18 5v14M6 5.5v13l9.5-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
const ICON_FULL =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const ICON_UNFULL =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

// ── The reader ────────────────────────────────────────────────────────────
let openReader = null;

async function openRsvpReader() {
  if (openReader) {
    openReader.close();
    return;
  }
  const data = await getData();
  const books = Array.isArray(data && data.books) ? data.books : [];
  if (!books.length) return;

  let startPos = detectStartPosition();
  const isMobile = typeof window.bpIsMobileMode === "function" && window.bpIsMobileMode();

  let wpm = clamp(parseInt(lsGet(LS_WPM), 10) || WPM_DEFAULT, WPM_MIN, WPM_MAX);
  wpm = Math.round(wpm / WPM_STEP) * WPM_STEP;
  let chunk = clamp(parseInt(lsGet(LS_CHUNK), 10) || 1, 1, CHUNK_MAX);
  // Default is to stop at the chapter end: the chapter is the unit the
  // reader opened on, and Play continues into the next one anyway.
  let stopAtEnd = lsGet(LS_STOP) !== "0";

  let bookId = startPos.bookId;
  let chapterNum = startPos.chapterNum;
  let items = [];
  let idx = 0;
  let playing = false;
  let timer = null;
  let rampLeft = 0;
  let finished = false;
  // Parked on the "End of <book> <n>" card (stopAtEnd); Play/→ move on.
  let atChapterEnd = false;
  // Per-chapter dwell factors for the current book (see remainingTimes).
  let factorsCache = null;

  // ── DOM ──
  const overlay = document.createElement("div");
  overlay.className = "bp-rsvp-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Focus Reader");

  const modal = document.createElement("div");
  modal.className = "bp-rsvp-modal";
  modal.tabIndex = -1;
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "bp-rsvp__header";
  const title = document.createElement("h2");
  title.className = "bp-rsvp__title";
  title.textContent = "Focus Reader";
  const fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = "bp-rsvp__icon-btn bp-rsvp__full-btn";
  fullBtn.title = "Fullscreen (F)";
  fullBtn.setAttribute("aria-label", "Fullscreen");
  fullBtn.setAttribute("aria-pressed", "false");
  fullBtn.innerHTML = ICON_FULL;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bp-rsvp__icon-btn bp-rsvp__close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.title = "Close (Esc)";
  header.append(title, fullBtn, closeBtn);
  modal.appendChild(header);

  const stage = document.createElement("div");
  stage.className = "bp-rsvp__stage";
  stage.title = "Tap or press Space to play / pause";
  const guideTop = document.createElement("div");
  guideTop.className = "bp-rsvp__guide bp-rsvp__guide--top";
  const wordEl = document.createElement("div");
  wordEl.className = "bp-rsvp__word";
  wordEl.setAttribute("aria-live", "off");
  const before = document.createElement("span");
  before.className = "bp-rsvp__before";
  const pivot = document.createElement("span");
  pivot.className = "bp-rsvp__pivot";
  const after = document.createElement("span");
  after.className = "bp-rsvp__after";
  wordEl.append(before, pivot, after);
  const guideBottom = document.createElement("div");
  guideBottom.className = "bp-rsvp__guide bp-rsvp__guide--bottom";
  const refEl = document.createElement("div");
  refEl.className = "bp-rsvp__ref";
  const contextEl = document.createElement("div");
  contextEl.className = "bp-rsvp__context";
  const timeEl = document.createElement("div");
  timeEl.className = "bp-rsvp__time";
  stage.append(guideTop, wordEl, guideBottom, refEl, contextEl, timeEl);
  modal.appendChild(stage);

  const progress = document.createElement("div");
  progress.className = "bp-rsvp__progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const progressFill = document.createElement("div");
  progressFill.className = "bp-rsvp__progress-fill";
  progress.appendChild(progressFill);
  modal.appendChild(progress);

  const controls = document.createElement("div");
  controls.className = "bp-rsvp__controls";

  const transport = document.createElement("div");
  transport.className = "bp-rsvp__transport";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "bp-rsvp__icon-btn";
  prevBtn.title = "Previous verse (←)";
  prevBtn.setAttribute("aria-label", "Previous verse");
  prevBtn.innerHTML = ICON_PREV;
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "bp-rsvp__play";
  playBtn.setAttribute("aria-label", "Play");
  playBtn.title = "Play / pause (Space)";
  playBtn.innerHTML = ICON_PLAY;
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "bp-rsvp__icon-btn";
  nextBtn.title = "Next verse (→)";
  nextBtn.setAttribute("aria-label", "Next verse");
  nextBtn.innerHTML = ICON_NEXT;
  transport.append(prevBtn, playBtn, nextBtn);

  const speedWrap = document.createElement("label");
  speedWrap.className = "bp-rsvp__speed";
  const speedCaption = document.createElement("span");
  speedCaption.className = "bp-rsvp__caption";
  speedCaption.textContent = "Speed";
  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.className = "bp-rsvp__slider";
  speedSlider.min = String(WPM_MIN);
  speedSlider.max = String(WPM_MAX);
  speedSlider.step = String(WPM_STEP);
  speedSlider.value = String(wpm);
  speedSlider.setAttribute("aria-label", "Words per minute");
  const speedValue = document.createElement("span");
  speedValue.className = "bp-rsvp__speed-value";
  speedWrap.append(speedCaption, speedSlider, speedValue);

  const chunkWrap = document.createElement("div");
  chunkWrap.className = "bp-rsvp__chunk";
  chunkWrap.setAttribute("role", "group");
  chunkWrap.setAttribute("aria-label", "Words at a time");
  const chunkCaption = document.createElement("span");
  chunkCaption.className = "bp-rsvp__caption";
  chunkCaption.textContent = "Words";
  chunkWrap.appendChild(chunkCaption);
  const chunkSegs = document.createElement("span");
  chunkSegs.className = "bp-rsvp__segs";
  chunkWrap.appendChild(chunkSegs);
  const chunkBtns = [];
  for (let n = 1; n <= CHUNK_MAX; n++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bp-rsvp__seg";
    b.textContent = String(n);
    b.title = n === 1 ? "One word at a time" : `Up to ${n} words at a time`;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => setChunk(n));
    chunkBtns.push(b);
    chunkSegs.appendChild(b);
  }

  const stopWrap = document.createElement("div");
  stopWrap.className = "bp-rsvp__chunk bp-rsvp__stop";
  stopWrap.setAttribute("role", "group");
  stopWrap.setAttribute("aria-label", "At the end of a chapter");
  const stopCaption = document.createElement("span");
  stopCaption.className = "bp-rsvp__caption";
  stopCaption.textContent = "Chapter end";
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "bp-rsvp__seg";
  stopBtn.textContent = "Stop";
  stopBtn.title = "Pause at the end of the chapter; Play continues into the next";
  const goOnBtn = document.createElement("button");
  goOnBtn.type = "button";
  goOnBtn.className = "bp-rsvp__seg";
  goOnBtn.textContent = "Continue";
  goOnBtn.title = "Run straight on through the next chapter";
  stopBtn.addEventListener("click", () => setStopAtEnd(true));
  goOnBtn.addEventListener("click", () => setStopAtEnd(false));
  const stopSegs = document.createElement("span");
  stopSegs.className = "bp-rsvp__segs";
  stopSegs.append(stopBtn, goOnBtn);
  stopWrap.append(stopCaption, stopSegs);

  controls.append(transport, speedWrap, chunkWrap, stopWrap);
  modal.appendChild(controls);

  const hint = document.createElement("div");
  hint.className = "bp-rsvp__hint";
  hint.innerHTML =
    "<kbd>Space</kbd> play / pause &middot; <kbd>&larr;</kbd> <kbd>&rarr;</kbd> verse &middot; " +
    "<kbd>&uarr;</kbd> <kbd>&darr;</kbd> speed &middot; <kbd>F</kbd> fullscreen &middot; <kbd>Esc</kbd> close";
  modal.appendChild(hint);

  if (typeof window.bpAttachModalDrag === "function") {
    window.bpAttachModalDrag(modal, header);
  }

  // ── Data helpers ──
  function findBook(id) {
    return books.find((b) => b.id === id) || null;
  }
  function findChapter(book, num) {
    return (book.chapters || []).find((c) => c.number === num) || null;
  }
  function neighbourChapter(dir) {
    const book = findBook(bookId);
    if (!book) return null;
    const count = book.chapters.length;
    if (chapterNum + dir >= 1 && chapterNum + dir <= count) {
      return { bookId, chapterNum: chapterNum + dir };
    }
    const bi = bookOrder.indexOf(bookId);
    const nextBook = findBook(bookOrder[bi + dir]);
    if (!nextBook || !nextBook.chapters.length) return null;
    return {
      bookId: nextBook.id,
      chapterNum: dir > 0 ? 1 : nextBook.chapters.length,
    };
  }
  function loadChapter(target, withHeading) {
    const book = findBook(target.bookId);
    const chapter = book && findChapter(book, target.chapterNum);
    if (!chapter) return false;
    bookId = target.bookId;
    chapterNum = target.chapterNum;
    items = buildChapterItems(bookId, chapter, chunk, withHeading);
    return items.length > 0;
  }
  function firstIdxOfVerse(verseN) {
    const i = items.findIndex((it) => !it.heading && it.verseN === verseN);
    return i < 0 ? 0 : i;
  }
  function lastVerseN() {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i].heading) return items[i].verseN;
    }
    return 1;
  }
  function currentPosition() {
    if (atChapterEnd) return { bookId, chapterNum, verseN: lastVerseN() };
    const it = items[idx];
    if (!it) return { bookId, chapterNum, verseN: 1 };
    return { bookId, chapterNum, verseN: it.heading ? 1 : it.verseN };
  }

  // Time left at the current pace: exact for the rest of this chapter (sum
  // of each item's dwell), and for the rest of the book from per-chapter
  // dwell factors computed once per book/chunk (everything in dwellFor()
  // scales with the per-word base except the heading constant).
  function remainingTimes() {
    const base = 60000 / wpm;
    let chapterMs = 0;
    if (!atChapterEnd) {
      for (let i = idx; i < items.length; i++) chapterMs += dwellFor(items[i], base);
    }
    const book = findBook(bookId);
    let bookMs = chapterMs;
    let chaptersLeft = 0;
    if (book) {
      if (!factorsCache || factorsCache.bookId !== bookId || factorsCache.chunk !== chunk) {
        const perChapter = new Map();
        for (const c of book.chapters) {
          const its = buildChapterItems(bookId, c, chunk, false);
          perChapter.set(
            c.number,
            its.reduce((sum, it) => sum + dwellFor(it, 1), 0),
          );
        }
        factorsCache = { bookId, chunk, perChapter };
      }
      for (const c of book.chapters) {
        if (c.number <= chapterNum) continue;
        chaptersLeft++;
        bookMs += (factorsCache.perChapter.get(c.number) || 0) * base + HEADING_MS + base;
      }
    }
    return { chapterMs, bookMs, chaptersLeft };
  }

  // ── Rendering ──
  function renderContext(item) {
    contextEl.textContent = "";
    if (!item || item.heading || !item.words) return;
    item.words.forEach((w, i) => {
      if (i) contextEl.appendChild(document.createTextNode(" "));
      if (i >= item.wordIdx && i < item.wordIdx + item.wordCount) {
        const b = document.createElement("b");
        b.textContent = w;
        contextEl.appendChild(b);
      } else {
        contextEl.appendChild(document.createTextNode(w));
      }
    });
  }
  function renderTime() {
    timeEl.textContent = "";
    if (playing || finished) return;
    const { chapterMs, bookMs, chaptersLeft } = remainingTimes();
    const label = bookNames[bookId] || bookId;
    const about = (ms) => {
      const d = formatDuration(ms);
      return d.startsWith("under") ? d : `about ${d}`;
    };
    const parts = [];
    if (!atChapterEnd) parts.push(`${about(chapterMs)} left in this chapter`);
    if (chaptersLeft > 0) parts.push(`${about(bookMs)} to the end of ${label}`);
    if (!parts.length) return;
    const line = `${parts.join(" · ")} at ${wpm} wpm`;
    timeEl.textContent = line.charAt(0).toUpperCase() + line.slice(1);
  }
  function render() {
    const item = items[idx];
    const label = bookNames[bookId] || bookId;
    if (atChapterEnd) {
      const next = neighbourChapter(1);
      wordEl.classList.add("bp-rsvp__word--heading");
      before.textContent = "";
      pivot.textContent = `End of ${label} ${chapterNum}`;
      after.textContent = "";
      refEl.textContent = next
        ? `Play or → continues to ${bookNames[next.bookId] || next.bookId} ${next.chapterNum}`
        : "";
      contextEl.textContent = "";
      progressFill.style.width = "100%";
      progress.setAttribute("aria-valuenow", "100");
      renderTime();
      return;
    }
    if (!item) {
      before.textContent = "";
      pivot.textContent = finished ? "The End" : "";
      after.textContent = "";
      wordEl.classList.add("bp-rsvp__word--heading");
      refEl.textContent = finished ? `${label} ${chapterNum}` : "";
      contextEl.textContent = "";
      return;
    }
    if (item.heading) {
      wordEl.classList.add("bp-rsvp__word--heading");
      before.textContent = "";
      pivot.textContent = item.text;
      after.textContent = "";
      refEl.textContent = "";
    } else {
      wordEl.classList.remove("bp-rsvp__word--heading");
      const p = orpIndex(item.text);
      before.textContent = item.text.slice(0, p);
      pivot.textContent = item.text.charAt(p);
      after.textContent = item.text.slice(p + 1);
      refEl.textContent = `${label} ${chapterNum}:${item.verseN}`;
    }
    const pct = items.length > 1 ? Math.round((idx / (items.length - 1)) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progress.setAttribute("aria-valuenow", String(pct));
    progress.title = `${label} ${chapterNum}: ${pct}% through the chapter`;
    // Pausing reveals the whole verse with the current word marked, since
    // RSVP never lets the eye glance back on its own.
    if (playing) contextEl.textContent = "";
    else renderContext(item);
    renderTime();
  }
  function renderPlayState() {
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    modal.classList.toggle("bp-rsvp-modal--playing", playing);
  }
  function renderSpeed() {
    speedSlider.value = String(wpm);
    speedValue.textContent = `${wpm} wpm`;
  }
  function renderChunk() {
    chunkBtns.forEach((b, i) => {
      const on = i + 1 === chunk;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function renderStop() {
    stopBtn.classList.toggle("active", stopAtEnd);
    stopBtn.setAttribute("aria-pressed", stopAtEnd ? "true" : "false");
    goOnBtn.classList.toggle("active", !stopAtEnd);
    goOnBtn.setAttribute("aria-pressed", stopAtEnd ? "false" : "true");
  }
  function setStopAtEnd(on) {
    stopAtEnd = !!on;
    lsSet(LS_STOP, stopAtEnd ? "1" : "0");
    renderStop();
  }
  // Leave the end-of-chapter card for the next chapter (or the end of the
  // Bible). Returns false when there is nowhere to go.
  function advanceFromChapterEnd() {
    const next = neighbourChapter(1);
    if (next && loadChapter(next, true)) {
      atChapterEnd = false;
      idx = 0;
      return true;
    }
    atChapterEnd = false;
    finished = true;
    items = [];
    idx = 0;
    return false;
  }

  // ── Playback ──
  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    clearTimer();
    const item = items[idx];
    if (!item) return;
    const base = 60000 / wpm;
    let ms = dwellFor(item, base);
    if (rampLeft > 0) {
      ms *= 1 + 0.8 * (rampLeft / RAMP_ITEMS);
      rampLeft--;
    }
    timer = setTimeout(step, ms);
  }
  function step() {
    timer = null;
    if (!playing) return;
    if (idx + 1 < items.length) {
      idx++;
      render();
      schedule();
      return;
    }
    if (stopAtEnd) {
      atChapterEnd = true;
      playing = false;
      renderPlayState();
      render();
      return;
    }
    const next = neighbourChapter(1);
    if (next && loadChapter(next, true)) {
      idx = 0;
      render();
      schedule();
      return;
    }
    finished = true;
    items = [];
    idx = 0;
    setPlaying(false);
    render();
  }
  function setPlaying(on) {
    if (on && finished) return;
    if (on && atChapterEnd && !advanceFromChapterEnd()) {
      render();
      return;
    }
    playing = on;
    renderPlayState();
    if (playing) {
      rampLeft = RAMP_ITEMS;
      render();
      schedule();
    } else {
      clearTimer();
      render();
    }
  }
  function togglePlay() {
    setPlaying(!playing);
  }
  function setWpm(v) {
    wpm = clamp(Math.round(v / WPM_STEP) * WPM_STEP, WPM_MIN, WPM_MAX);
    lsSet(LS_WPM, wpm);
    renderSpeed();
    if (playing) schedule();
    else renderTime();
  }
  function setChunk(n) {
    n = clamp(n, 1, CHUNK_MAX);
    if (n === chunk) return;
    const cur = items[idx];
    chunk = n;
    lsSet(LS_CHUNK, chunk);
    renderChunk();
    if (finished) return;
    if (atChapterEnd) {
      render();
      return;
    }
    const hadHeading = !!(items[0] && items[0].heading);
    loadChapter({ bookId, chapterNum }, hadHeading);
    // Re-find the chunk holding the word we were on.
    idx = 0;
    if (cur && !cur.heading) {
      const i = items.findIndex(
        (it) =>
          !it.heading &&
          it.verseN === cur.verseN &&
          cur.wordIdx >= it.wordIdx &&
          cur.wordIdx < it.wordIdx + it.wordCount,
      );
      if (i >= 0) idx = i;
    }
    render();
    if (playing) schedule();
  }
  // ← : back to the start of this verse, or (already there) the one before.
  function prevVerse() {
    if (finished) {
      finished = false;
      loadChapter({ bookId, chapterNum }, false);
      idx = items.length ? firstIdxOfVerse(items[items.length - 1].verseN) : 0;
    } else if (atChapterEnd) {
      atChapterEnd = false;
      idx = firstIdxOfVerse(lastVerseN());
    } else {
      const cur = items[idx];
      const verseStart = cur && !cur.heading ? firstIdxOfVerse(cur.verseN) : 0;
      const beforeStart = verseStart > 0 ? items[verseStart - 1] : null;
      if (cur && !cur.heading && idx > verseStart) {
        idx = verseStart;
      } else if (beforeStart && !beforeStart.heading) {
        idx = firstIdxOfVerse(beforeStart.verseN);
      } else {
        const prev = neighbourChapter(-1);
        if (prev && loadChapter(prev, false)) {
          idx = items.length ? firstIdxOfVerse(items[items.length - 1].verseN) : 0;
        } else {
          idx = 0;
        }
      }
    }
    rampLeft = Math.max(rampLeft, 2);
    render();
    if (playing) schedule();
  }
  function nextVerse() {
    if (finished) return;
    if (atChapterEnd) {
      advanceFromChapterEnd();
      render();
      if (playing) schedule();
      return;
    }
    const cur = items[idx];
    let i = -1;
    if (cur) {
      i = items.findIndex(
        (it, j) => j > idx && !it.heading && (cur.heading || it.verseN !== cur.verseN),
      );
    }
    if (i >= 0) {
      idx = i;
    } else if (stopAtEnd) {
      atChapterEnd = true;
      if (playing) {
        playing = false;
        clearTimer();
        renderPlayState();
      }
      render();
      return;
    } else {
      const next = neighbourChapter(1);
      if (next && loadChapter(next, true)) idx = 0;
      else return;
    }
    rampLeft = Math.max(rampLeft, 2);
    render();
    if (playing) schedule();
  }

  // ── Fullscreen ──
  // "Full" is our own layout class (the window grows to fill the viewport
  // over a solid backdrop); the browser's Fullscreen API is layered on top
  // when available, and dropped silently where it isn't (iPhone Safari).
  // The choice is remembered (F / the corner button), windowed by default.
  // Esc always closes the reader rather than stepping down to windowed, so
  // backing out never silently flips the saved preference.
  function isFull() {
    return overlay.classList.contains("bp-rsvp-overlay--full");
  }
  function setFull(on, persist = true) {
    if (persist) lsSet(LS_FULL, on ? "1" : "0");
    overlay.classList.toggle("bp-rsvp-overlay--full", on);
    fullBtn.setAttribute("aria-pressed", on ? "true" : "false");
    fullBtn.innerHTML = on ? ICON_UNFULL : ICON_FULL;
    fullBtn.title = on ? "Exit fullscreen (F)" : "Fullscreen (F)";
    fullBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
    if (on) {
      if (overlay.requestFullscreen && !document.fullscreenElement) {
        overlay.requestFullscreen().catch(() => {});
      }
    } else if (document.fullscreenElement === overlay && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    modal.focus({ preventScroll: true });
  }
  function onFullscreenChange() {
    // The browser left fullscreen on its own — in Chrome that is Esc, which
    // never reaches the page while fullscreen — so treat it as a close.
    if (!document.fullscreenElement && isFull()) close();
  }

  // ── Events ──
  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onSlider = document.activeElement === speedSlider;
    switch (e.key) {
      case " ":
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
        return;
      case "ArrowLeft":
        if (onSlider) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) prevVerse();
        return;
      case "ArrowRight":
        if (onSlider) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) nextVerse();
        return;
      case "ArrowUp":
      case "+":
      case "=":
        e.preventDefault();
        e.stopPropagation();
        setWpm(wpm + WPM_STEP);
        return;
      case "ArrowDown":
      case "-":
      case "_":
        e.preventDefault();
        e.stopPropagation();
        setWpm(wpm - WPM_STEP);
        return;
      case "f":
      case "F":
        e.preventDefault();
        e.stopPropagation();
        setFull(!isFull());
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      default:
        return;
    }
  }
  function onVisibility() {
    if (document.hidden && playing) setPlaying(false);
  }

  // The window is click-through, so the reader can navigate the page
  // underneath (book strip, chapter arrows, jump box) while it is open.
  // When the page lands somewhere else, follow it: pause and relocate to
  // what is now in view, and treat that as the new start so closing does
  // not drag the page back. Compared against where the page *was*, not
  // where the reader is, so the reader running ahead into the next chapter
  // on its own is left alone.
  let pagePos = {
    bookId: window._currentBookId,
    chapterNum: window._currentChapterNum,
    mode: window._currentViewMode,
  };
  let pageCheck = null;
  function onPageMutated() {
    if (pageCheck) return;
    pageCheck = setTimeout(() => {
      pageCheck = null;
      const now = {
        bookId: window._currentBookId,
        chapterNum: window._currentChapterNum,
        mode: window._currentViewMode,
      };
      if (
        now.bookId === pagePos.bookId &&
        now.chapterNum === pagePos.chapterNum &&
        now.mode === pagePos.mode
      ) {
        return;
      }
      pagePos = now;
      const pos = detectStartPosition();
      if (!loadChapter({ bookId: pos.bookId, chapterNum: pos.chapterNum }, false)) return;
      clearTimer();
      playing = false;
      finished = false;
      atChapterEnd = false;
      startPos = pos;
      idx = firstIdxOfVerse(pos.verseN);
      renderPlayState();
      render();
    }, 80);
  }
  const mainEl = document.querySelector(".bp-main");
  const pageObserver = mainEl ? new MutationObserver(onPageMutated) : null;
  if (pageObserver) pageObserver.observe(mainEl, { childList: true });

  stage.addEventListener("click", togglePlay);
  playBtn.addEventListener("click", togglePlay);
  prevBtn.addEventListener("click", prevVerse);
  nextBtn.addEventListener("click", nextVerse);
  fullBtn.addEventListener("click", () => setFull(!isFull()));
  closeBtn.addEventListener("click", () => close());
  speedSlider.addEventListener("input", () => setWpm(parseInt(speedSlider.value, 10)));
  // Buttons hand focus back to the window after a click, so Space keeps
  // meaning play/pause instead of re-firing whichever button was last hit.
  controls.addEventListener("click", (e) => {
    if (e.target.closest("button")) modal.focus({ preventScroll: true });
  });
  header.addEventListener("click", (e) => {
    if (e.target.closest("button")) modal.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibility);

  function close() {
    if (!overlay.isConnected) return;
    clearTimer();
    playing = false;
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("visibilitychange", onVisibility);
    if (pageObserver) pageObserver.disconnect();
    if (pageCheck) clearTimeout(pageCheck);
    if (document.fullscreenElement === overlay && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    const cur = finished ? { bookId, chapterNum, verseN: 1 } : currentPosition();
    overlay.remove();
    openReader = null;
    const btn = document.getElementById("bp-rsvp-btn");
    if (btn) btn.setAttribute("aria-pressed", "false");
    syncPageToPosition(startPos, cur);
  }
  openReader = { close };

  // ── Go ──
  if (!loadChapter({ bookId, chapterNum }, false)) {
    loadChapter({ bookId: "MAT", chapterNum: 1 }, false);
  }
  idx = firstIdxOfVerse(startPos.verseN);
  renderSpeed();
  renderChunk();
  renderStop();
  renderPlayState();
  render();
  if (isMobile) hint.style.display = "none";
  document.body.appendChild(overlay);
  // Restore the remembered layout. requestFullscreen needs a recent user
  // gesture; the button click that opened us normally still counts, and if
  // not we simply stay in the in-page full layout.
  if (lsGet(LS_FULL) === "1") setFull(true, false);
  const btn = document.getElementById("bp-rsvp-btn");
  if (btn) btn.setAttribute("aria-pressed", "true");
  modal.focus({ preventScroll: true });
}

// The header button is re-rendered with every chapter/book load, so listen
// once at the document rather than wiring each copy.
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#bp-rsvp-btn");
  if (!btn) return;
  e.preventDefault();
  openRsvpReader();
});

window.bpOpenRsvpReader = openRsvpReader;
