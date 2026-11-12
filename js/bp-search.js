// js/bp-search.js — whole-Bible phrase search, living in the header jump box.
//
// The jump box keeps its first job: anything that reads as a reference
// ("mat4", "jn 3:16") jumps there, handled by app.js as before. Anything
// else is searched here as a phrase across all 31,000 verses, and the
// matching verses drop down under the box; clicking one opens its chapter
// with the verse highlighted.
//
// Matching is a phrase match (not any-of-these-words), case-insensitive,
// anchored to the start of a word: "love" finds love / loved / loving but
// not "beloved" or "glove". Words in the phrase may be separated by any
// punctuation in the text, so "god who" finds "God, who". Common words need
// no stop list: inside a phrase they narrow the result, and a lone common
// word is simply capped (RESULTS_PAGE at a time, total always shown).
//
// Self-contained like bp-rsvp.js: reads the cached bible.json through
// window.bpGetBibleData and touches the page only through loadBibleChapter.
// app.js calls window.bpBibleSearch.submit() from the jump form's submit
// when the text is not a reference.
import {
  bookNames,
  bookOrder,
  bookAliasMap,
  normalizeBookAlias,
  parseBookChapterInput,
} from "./bible-utils.js";

// Letters/digits needed before anything is searched, so the list does not
// flash thousands of verses while the first word is still being typed.
const MIN_CHARS = 3;
const RESULTS_PAGE = 50;
const DEBOUNCE_MS = 150;
// Verses longer than this are shown as a window around the first match.
const SNIPPET_MAX = 220;
const SNIPPET_BEFORE = 80;
const SNIPPET_AFTER = 120;

const input = document.getElementById("bp-header-jump-input");
const form = document.getElementById("bp-header-jump-form");

// ── Index: every verse in Bible order (bible.json itself is alphabetical) ──
let indexPromise = null;
function getIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const data =
        typeof window.bpGetBibleData === "function"
          ? await window.bpGetBibleData()
          : await (await fetch("data/bible.json")).json();
      const byId = new Map((data.books || []).map((b) => [b.id, b]));
      const verses = [];
      for (const bookId of bookOrder) {
        const book = byId.get(bookId);
        if (!book) continue;
        for (const chapter of book.chapters || []) {
          for (const verse of chapter.verses || []) {
            const n = parseInt(verse.n, 10);
            if (!Number.isInteger(n) || !verse.text) continue;
            verses.push({ bookId, chapter: chapter.number, verse: n, text: verse.text });
          }
        }
      }
      return verses;
    })().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

// ── Query → matcher ───────────────────────────────────────────────────────
function queryTokens(query) {
  return String(query || "")
    .normalize("NFC")
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((t) => t.replace(/^['’]+|['’]+$/g, ""))
    .filter(Boolean);
}
function searchableLength(query) {
  return queryTokens(query).join("").replace(/['’]/g, "").length;
}
// Group 1 is the (non-word) character before the match, group 2 the match;
// done with a group rather than a lookbehind for older Safari.
function buildMatcher(query) {
  const tokens = queryTokens(query);
  if (tokens.join("").replace(/['’]/g, "").length < MIN_CHARS) return null;
  const body = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]"))
    .join("[^\\p{L}\\p{N}]+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${body})`, "giu");
}
function matchRanges(text, re) {
  const ranges = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    ranges.push([start, start + m[2].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return ranges;
}

// True while the box most likely holds a reference still being typed
// ("rev", "1 cor", "jn 3:") — live search stays quiet for those, so typing
// "revelation 3" does not flash a list of "reveal…" verses on the way.
// `partialOnly` asks just about the book-plus-numbers shape, which is never
// worth searching even on Enter.
function looksLikeReference(text, partialOnly = false) {
  const cleaned = String(text || "")
    .trim()
    .toLowerCase();
  const m = cleaned.match(/^(.+?)[\s._:-]*\d[\d\s._:-]*$/);
  if (m && bookAliasMap.has(normalizeBookAlias(m[1]))) return true;
  if (partialOnly) return false;
  const norm = normalizeBookAlias(cleaned);
  if (!norm) return false;
  for (const key of bookAliasMap.keys()) {
    if (key.startsWith(norm)) return true;
  }
  return false;
}
function isReference(text) {
  return parseBookChapterInput(text).ok;
}

// ── Panel ─────────────────────────────────────────────────────────────────
let panel = null;
let statusEl = null;
let listEl = null;
let moreBtn = null;
let current = { query: "", results: [], shown: 0, re: null };
let searchSeq = 0;
let debounceTimer = null;

function ensurePanel() {
  if (panel) return;
  panel = document.createElement("div");
  panel.className = "bp-search-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Bible search results");
  statusEl = document.createElement("div");
  statusEl.className = "bp-search__status";
  statusEl.setAttribute("aria-live", "polite");
  listEl = document.createElement("div");
  listEl.className = "bp-search__list";
  moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "bp-search__more";
  moreBtn.addEventListener("click", () => {
    const focusIdx = current.shown;
    renderMore();
    const rows = listEl.querySelectorAll(".bp-search__result");
    if (rows[focusIdx]) rows[focusIdx].focus({ preventScroll: true });
  });
  panel.append(statusEl, listEl, moreBtn);
  panel.addEventListener("keydown", onPanelKeydown);
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".bp-search__result");
    if (row) openResult(current.results[parseInt(row.dataset.idx, 10)]);
  });
}

function isOpen() {
  return !!(panel && panel.isConnected);
}

// Dropdown under the jump box on a wide screen; edge to edge under the
// header when there is no room beside the box (phones).
function positionPanel() {
  if (!isOpen() || !input) return;
  const r = input.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const margin = 8;
  const want = Math.min(608, vw - margin * 2);
  let left = r.left;
  if (left + want > vw - margin) left = Math.max(margin, vw - margin - want);
  const top = r.bottom + 6;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.width = `${Math.round(want)}px`;
  panel.style.maxHeight = `${Math.max(140, Math.round(vh - top - margin))}px`;
}

function showPanel() {
  ensurePanel();
  if (!panel.isConnected) document.body.appendChild(panel);
  positionPanel();
}

function closePanel() {
  clearTimeout(debounceTimer);
  searchSeq++;
  if (panel && panel.isConnected) panel.remove();
}

function refLabel(v) {
  return `${bookNames[v.bookId] || v.bookId} ${v.chapter}:${v.verse}`;
}

// The verse text with every match in <mark>; long verses are cut to a
// window around the first match, on word boundaries.
function buildSnippet(text, re) {
  const ranges = matchRanges(text, re);
  let from = 0;
  let to = text.length;
  if (text.length > SNIPPET_MAX && ranges.length) {
    from = Math.max(0, ranges[0][0] - SNIPPET_BEFORE);
    to = Math.min(text.length, ranges[0][1] + SNIPPET_AFTER);
    if (from > 0) {
      const sp = text.indexOf(" ", from);
      from = sp >= 0 && sp < ranges[0][0] ? sp + 1 : from;
    }
    if (to < text.length) {
      const sp = text.lastIndexOf(" ", to);
      to = sp > ranges[0][1] ? sp : to;
    }
  }
  const span = document.createElement("span");
  span.className = "bp-search__text";
  let pos = from;
  if (from > 0) span.appendChild(document.createTextNode("… "));
  for (const [s, e] of ranges) {
    if (e <= from || s >= to) continue;
    const ms = Math.max(s, from);
    const me = Math.min(e, to);
    if (ms > pos) span.appendChild(document.createTextNode(text.slice(pos, ms)));
    const mark = document.createElement("mark");
    mark.className = "bp-search__hit";
    mark.textContent = text.slice(ms, me);
    span.appendChild(mark);
    pos = me;
  }
  if (pos < to) span.appendChild(document.createTextNode(text.slice(pos, to)));
  if (to < text.length) span.appendChild(document.createTextNode(" …"));
  return span;
}

function renderMore() {
  const { results, re } = current;
  const end = Math.min(results.length, current.shown + RESULTS_PAGE);
  const frag = document.createDocumentFragment();
  for (let i = current.shown; i < end; i++) {
    const v = results[i];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bp-search__result";
    row.dataset.idx = String(i);
    const ref = document.createElement("span");
    ref.className = "bp-search__ref";
    ref.textContent = refLabel(v);
    row.append(ref, buildSnippet(v.text, re));
    frag.appendChild(row);
  }
  listEl.appendChild(frag);
  current.shown = end;
  const left = results.length - end;
  moreBtn.hidden = left <= 0;
  if (left > 0) {
    moreBtn.textContent = `Show ${Math.min(RESULTS_PAGE, left).toLocaleString()} more`;
  }
  const total = results.length.toLocaleString();
  const noun = results.length === 1 ? "verse" : "verses";
  statusEl.textContent =
    end < results.length
      ? `${total} ${noun} · showing the first ${end.toLocaleString()}`
      : `${total} ${noun}`;
}

async function runSearch(query) {
  const re = buildMatcher(query);
  if (!re) {
    closePanel();
    return false;
  }
  const seq = ++searchSeq;
  let verses;
  try {
    verses = await getIndex();
  } catch {
    return false;
  }
  if (seq !== searchSeq) return true;
  const results = [];
  for (const v of verses) {
    re.lastIndex = 0;
    if (re.test(v.text)) results.push(v);
  }
  current = { query, results, shown: 0, re };
  showPanel();
  listEl.textContent = "";
  listEl.scrollTop = 0;
  if (!results.length) {
    moreBtn.hidden = true;
    statusEl.textContent = `No verses found for “${query.trim()}”. A match has to begin at the start of a word.`;
  } else {
    renderMore();
  }
  positionPanel();
  return true;
}

async function openResult(v) {
  if (!v) return;
  closePanel();
  if (input) input.blur();
  if (typeof window.loadBibleChapter !== "function") return;
  await window.loadBibleChapter(v.bookId, v.chapter, true, {
    verseStart: v.verse,
    verseEnd: null,
  });
  if (typeof window.updateBookScrollbar === "function") window.updateBookScrollbar(v.bookId);
  if (typeof window.autoHighlightVerseRange === "function") {
    window.autoHighlightVerseRange(v.chapter, v.verse, v.verse);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────
function onInput() {
  clearTimeout(debounceTimer);
  const text = input.value;
  if (searchableLength(text) < MIN_CHARS || isReference(text) || looksLikeReference(text)) {
    closePanel();
    return;
  }
  debounceTimer = setTimeout(() => runSearch(text), DEBOUNCE_MS);
}

function onInputKeydown(e) {
  if (e.key === "Escape" && isOpen()) {
    e.preventDefault();
    closePanel();
  } else if (e.key === "ArrowDown" && isOpen()) {
    const first = listEl.querySelector(".bp-search__result");
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
}

function onPanelKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closePanel();
    if (input) input.focus();
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const stops = Array.from(panel.querySelectorAll(".bp-search__result, .bp-search__more:not([hidden])"));
  const i = stops.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const next = stops[i + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) next.focus();
  else if (e.key === "ArrowUp" && input) input.focus();
}

if (input && form) {
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onInputKeydown);
  // Coming back to the box with a phrase still in it brings the list back.
  input.addEventListener("focus", () => {
    if (!isOpen()) onInput();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!isOpen()) return;
    if (panel.contains(e.target) || form.contains(e.target)) return;
    closePanel();
  });
  window.addEventListener("resize", positionPanel);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", positionPanel);
}

window.bpBibleSearch = {
  // Called by app.js when the jump form is submitted with something that is
  // not a reference. Returns true when it was taken as a search (app.js then
  // skips its "use a format like mat4" error), false to let that error show.
  submit(text) {
    if (!input || searchableLength(text) < MIN_CHARS || looksLikeReference(text, true)) {
      closePanel();
      return false;
    }
    clearTimeout(debounceTimer);
    runSearch(text);
    return true;
  },
  close: closePanel,
};
