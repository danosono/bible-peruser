import {
  bookNames,
  bookOrder,
  saveLastRead,
  getLastRead,
  parseBookChapterInput,
} from "./bible-utils.js";
import {
  openSuggestModal,
  buildSuggestNewLink,
  maybeResumeSuggestDraft,
} from "./bp-suggest.js";
import { initAccountWidget } from "./bp-account-widget.js";

// js/bible-loader.js - loads a chapter from bible.json and displays it in <main>

let bpBibleDataCache = null;

async function getBibleData() {
  if (bpBibleDataCache) return bpBibleDataCache;
  const response = await fetch("data/bible.json");
  bpBibleDataCache = await response.json();
  return bpBibleDataCache;
}

const BIBLE_METADATA_CREDIT = "Theographic Bible Metadata (CC BY-SA 4.0, viz.bible)";

let bpBibleMetadataPromise = null;

async function fetchJsonOrNull(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Timeline/People/Places data, generated offline by js/build-bible-metadata.js
// from Theographic Bible Metadata. Fetched once and cached; any file that
// fails to load (e.g. optional overrides.json) just yields empty data rather
// than breaking the rest of the app.
function getBibleMetadata() {
  if (!bpBibleMetadataPromise) {
    bpBibleMetadataPromise = Promise.all([
      fetchJsonOrNull("data/timeline/events.json"),
      fetchJsonOrNull("data/timeline/milestones.json"),
      fetchJsonOrNull("data/timeline/overrides.json"),
      fetchJsonOrNull("data/verse-tags/people.json"),
      fetchJsonOrNull("data/verse-tags/places.json"),
      fetchJsonOrNull("data/book-info.json"),
    ]).then(([timeline, milestones, overrides, people, places, bookInfo]) => ({
      timeline: timeline || { events: [], byChapter: {} },
      milestones: milestones || { ot: [], gospels: [], earlyChurch: [] },
      overrides: overrides || {},
      people: people || { byChapter: {}, people: {} },
      places: places || { byChapter: {}, places: {} },
      bookInfo: bookInfo || { books: {} },
    }));
  }
  return bpBibleMetadataPromise;
}

const FULL_TEXT_URLS = {
  people: "data/verse-tags/people-full.json",
  places: "data/verse-tags/places-full.json",
  book: "data/book-info-full.json",
};

const bpFullTextPromises = { people: null, places: null, book: null };

// Full, untruncated descriptions are a separate, lazily-fetched file —
// only downloaded the first time a reader actually expands a card, not as
// part of the eager per-chapter metadata load.
function getFullTextMap(kind) {
  if (!bpFullTextPromises[kind]) {
    bpFullTextPromises[kind] = fetchJsonOrNull(FULL_TEXT_URLS[kind]).then(
      (data) => data || {},
    );
  }
  return bpFullTextPromises[kind];
}

const OUTLINE_PREF_KEY = "bpShowOutlines";

function getOutlinePref() {
  if (typeof window === "undefined" || !window.localStorage) return true;
  const stored = localStorage.getItem(OUTLINE_PREF_KEY);
  return stored === null ? true : stored === "1";
}

function applyOutlinePref(show) {
  document.documentElement.classList.toggle("bp-hide-outlines", !show);
}

const STUDY_NOTES_PREF_KEY = "bpShowStudyNotes";

function getStudyNotesPref() {
  if (typeof window === "undefined" || !window.localStorage) return true;
  const stored = localStorage.getItem(STUDY_NOTES_PREF_KEY);
  return stored === null ? true : stored === "1";
}

function applyStudyNotesPref(show) {
  document.documentElement.classList.toggle("bp-hide-study-notes", !show);
}

// A persistent footer toggle for the developer's own study-note buttons —
// "label" buttons (left sidebar) and "highlight" toggle buttons (right
// sidebar), both hand-curated annotations layered on top of the neutral
// chapter outline. Outline buttons (topic-outline-btn) are never affected.
// Hiding is pure CSS (buttons stay in the DOM, just display:none), so no
// other rendering logic needs to change.
// Splits a "<emoji> <Text>" footer-button label into separate icon/label
// spans so mobile CSS can hide just the label and keep icon-only buttons.
function setMetaBtnContent(btn, label) {
  const spaceIdx = label.indexOf(" ");
  const icon = label.slice(0, spaceIdx);
  const text = label.slice(spaceIdx + 1);
  btn.innerHTML = "";
  const iconSpan = document.createElement("span");
  iconSpan.className = "bp-meta-btn__icon";
  iconSpan.textContent = icon;
  const labelSpan = document.createElement("span");
  labelSpan.className = "bp-meta-btn__label";
  labelSpan.textContent = " " + text;
  btn.append(iconSpan, labelSpan);
  if (!btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", text);
}

function ensureOutlineToggle(footer) {
  applyOutlinePref(getOutlinePref());

  let btn = document.getElementById("bp-outline-toggle");

  function refreshButton() {
    const shown = getOutlinePref();
    btn.classList.toggle("bp-meta-btn--off", !shown);
    const tooltip = shown ? "Don't show outline" : "Show outline";
    btn.dataset.tooltip = tooltip;
    btn.setAttribute("aria-label", tooltip);
  }

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "bp-outline-toggle";
    btn.type = "button";
    btn.className = "bp-meta-btn bp-tooltip-up";
    setMetaBtnContent(btn, "\u{1F4D1} Outline");
    btn.addEventListener("click", () => {
      const nowShow = !getOutlinePref();
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(OUTLINE_PREF_KEY, nowShow ? "1" : "0");
      }
      applyOutlinePref(nowShow);
      refreshButton();
    });
    footer.appendChild(btn);
  }
  refreshButton();
}

function ensureStudyNotesToggle(footer) {
  applyStudyNotesPref(getStudyNotesPref());

  let btn = document.getElementById("bp-study-notes-toggle");

  function refreshButton() {
    const shown = getStudyNotesPref();
    btn.classList.toggle("bp-meta-btn--off", !shown);
    const tooltip = shown ? "Don't show notes" : "Show notes";
    // Custom tooltip (data-tooltip + .bp-tooltip-up) instead of the native
    // title attribute — native tooltips always open downward, which clips
    // or runs off-screen for a button sitting at the bottom of the page.
    btn.dataset.tooltip = tooltip;
    btn.setAttribute("aria-label", tooltip);
  }

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "bp-study-notes-toggle";
    btn.type = "button";
    btn.className = "bp-meta-btn bp-tooltip-up";
    setMetaBtnContent(btn, "\u{1F3F7}\u{FE0F} Notes");
    btn.addEventListener("click", () => {
      const nowShow = !getStudyNotesPref();
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(STUDY_NOTES_PREF_KEY, nowShow ? "1" : "0");
      }
      applyStudyNotesPref(nowShow);
      refreshButton();
    });
    footer.appendChild(btn);
  }
  refreshButton();
}

// Builds a fresh pair of off-state sidebar hints (Outlines, then Notes) —
// called at every left/right panel insertion point so ordering (outline
// hint above notes hint, when both toggles are off) stays consistent.
function buildOffToggleHints() {
  const outlineHint = document.createElement("div");
  outlineHint.className = "bp-outline-hint";
  outlineHint.innerHTML =
    "Outlines are off. Click the <strong>Outlines</strong> button at the bottom to turn them on.";
  const notesHint = document.createElement("div");
  notesHint.className = "bp-study-notes-hint";
  notesHint.innerHTML =
    "Notes are off. Click the <strong>Notes</strong> button at the bottom to turn them on.";
  return { outlineHint, notesHint };
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

const BOOK_AND_CHAPTER_RE =
  /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)/;
const FULL_REFERENCE_RE =
  /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?$/;
const REFERENCE_CORE_RE =
  /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+\d+(?::\d+(?:[-–]\d+)?)?/;

function extractReferenceCore(reference) {
  if (typeof reference !== "string") return null;
  const trimmed = reference.trim();
  // Supports human-readable suffixes by parsing only the leading canonical reference.
  const match = trimmed.match(REFERENCE_CORE_RE);
  return match ? match[0] : null;
}

// Some topic entries mix real references with organizational filler
// ("REPENT:", "KINGDOM:", "-", " ") used to group/space out the list for
// readers. Those aren't real Bible references, so they're excluded from
// compare — they still render fine in the plain reference popup, which
// isn't touched by this check.
function isComparableReference(reference) {
  return Boolean(extractReferenceCore(reference));
}

// "Matthew 4:17" / "Matthew 4:3, 5-6, 8-9" for the compare header — only
// meaningful for chapter-scoped topics, where verses are simple in-chapter
// numbers/ranges (book-wide entries use a different cross-chapter format).
function formatChapterVerseLabel(bookId, chapterNum, verses) {
  if (!bookId || !chapterNum || !Array.isArray(verses) || !verses.length) {
    return null;
  }
  const versePart = verses.filter(Boolean).join(", ");
  if (!versePart) return null;
  const bookLabel = bookNames[bookId] || bookId;
  return `${bookLabel} ${chapterNum}:${versePart}`;
}

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

// Expands a topic.verses-style token array (e.g. ["1-5","7"]) into a flat
// array of verse numbers. Shared by whole-verse .verse-highlight targeting
// and by emphasis-phrase verse-key scoping.
function expandVerseRangeTokens(tokens) {
  const verses = [];
  (Array.isArray(tokens) ? tokens : []).forEach((v) => {
    if (typeof v === "string" && v.includes("-")) {
      const [start, end] = v.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) verses.push(i);
      }
    } else {
      const n = Number(v);
      if (!isNaN(n)) verses.push(n);
    }
  });
  return verses;
}

// Like normalizePhraseList but for { phrase, className, scopeVerseKeys }
// entries. Dedupes by className+phrase (not phrase alone) since the same
// text under two different classes/scopes must stay two distinct entries.
function normalizePhraseEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const out = [];
  list.forEach((e) => {
    if (!e || typeof e.phrase !== "string" || !e.phrase.trim()) return;
    const className = e.className || "search-highlight";
    const key = className + " " + e.phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ phrase: e.phrase, className, scopeVerseKeys: e.scopeVerseKeys || null });
  });
  return out.sort((a, b) => b.phrase.length - a.phrase.length);
}

function getLiteralSearchPhrase(inputEl) {
  if (!inputEl || typeof inputEl.value !== "string") return "";
  return inputEl.value.trim() ? inputEl.value : "";
}

function getBookIdFromReference(reference) {
  const canonicalReference = extractReferenceCore(reference);
  if (!canonicalReference) return null;
  const match = canonicalReference.match(BOOK_AND_CHAPTER_RE);
  if (!match) return null;
  const normalizedBookName = match[1].replace(/\s+/g, " ").trim().toLowerCase();
  return bpBookNameToId[normalizedBookName] || null;
}

function parseReferenceDetails(reference) {
  const canonicalReference = extractReferenceCore(reference);
  if (!canonicalReference) return null;
  const match = canonicalReference.match(FULL_REFERENCE_RE);
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

// Full passage lookup for the compare view. Unlike the hover-preview
// resolver (which caps unbounded refs to two lines), a reference with no
// verse range shows the whole chapter here since side-by-side reading is
// the point of comparing.
async function resolveReferenceForCompare(reference) {
  const details = parseReferenceDetails(reference);
  if (!details || !details.bookId || !details.chapterNum) return null;

  const data = await getBibleData();
  const books = Array.isArray(data?.books) ? data.books : [];
  const book = books.find((b) => b.id === details.bookId);
  if (!book || !Array.isArray(book.chapters)) return null;

  const chapter = book.chapters.find((c) => c.number === details.chapterNum);
  if (!chapter || !Array.isArray(chapter.verses) || !chapter.verses.length) {
    return null;
  }

  const bookLabel = bookNames[details.bookId] || details.bookId;
  let title = `${bookLabel} ${details.chapterNum}`;
  let verses = chapter.verses;

  if (Number.isInteger(details.verseStart) && details.verseStart > 0) {
    const verseEnd =
      Number.isInteger(details.verseEnd) &&
      details.verseEnd >= details.verseStart
        ? details.verseEnd
        : details.verseStart;
    title = `${bookLabel} ${details.chapterNum}:${details.verseStart}${verseEnd > details.verseStart ? `-${verseEnd}` : ""}`;
    verses = chapter.verses.filter((v) => {
      const n = parseInt(v?.n, 10);
      return Number.isInteger(n) && n >= details.verseStart && n <= verseEnd;
    });
  }

  if (!verses.length) return null;
  return {
    title,
    verses: verses.map((v) => ({ n: v.n, text: v.text })),
  };
}

// Makes the compare modal draggable by its header, so the reader can slide
// it aside to read a referenced verse in its chapter context underneath —
// the overlay no longer dims/blocks the page (see .bp-compare-overlay CSS),
// so dragging is the only way to reveal what's behind it. Desktop only.
function attachModalDrag(modalEl, headerEl) {
  if (window.bpIsMobileMode && window.bpIsMobileMode()) return;

  headerEl.classList.add("bp-compare-modal__header--draggable");
  let dragging = false;
  let hasSwitchedToFixed = false;
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let startLeft = 0;

  headerEl.addEventListener("pointerdown", (e) => {
    if (typeof e.button === "number" && e.button !== 0) return;
    if (e.target.closest(".bp-compare-modal__close")) return;

    if (!hasSwitchedToFixed) {
      const rect = modalEl.getBoundingClientRect();
      modalEl.style.position = "fixed";
      modalEl.style.margin = "0";
      modalEl.style.top = `${rect.top}px`;
      modalEl.style.left = `${rect.left}px`;
      hasSwitchedToFixed = true;
    }

    dragging = true;
    headerEl.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    startTop = parseFloat(modalEl.style.top);
    startLeft = parseFloat(modalEl.style.left);
    headerEl.classList.add("bp-compare-modal__header--dragging");
  });

  headerEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const margin = 80; // keep at least this much of the modal reachable
    const modalRect = modalEl.getBoundingClientRect();
    let newTop = startTop + (e.clientY - startY);
    let newLeft = startLeft + (e.clientX - startX);
    newTop = Math.max(
      margin - modalRect.height,
      Math.min(newTop, window.innerHeight - margin),
    );
    newLeft = Math.max(
      margin - modalRect.width,
      Math.min(newLeft, window.innerWidth - margin),
    );
    modalEl.style.top = `${newTop}px`;
    modalEl.style.left = `${newLeft}px`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    headerEl.classList.remove("bp-compare-modal__header--dragging");
    if (e && e.pointerId != null) {
      try {
        headerEl.releasePointerCapture(e.pointerId);
      } catch {}
    }
  }
  headerEl.addEventListener("pointerup", endDrag);
  headerEl.addEventListener("pointercancel", endDrag);
}

function openCompareModal(references, compareContext) {
  document.querySelectorAll(".bp-compare-overlay").forEach((el) => el.remove());

  const refs = Array.from(
    new Set((references || []).filter(isComparableReference)),
  );
  if (!refs.length) return;

  const overlay = document.createElement("div");
  overlay.className = "bp-compare-overlay";

  const modal = document.createElement("div");
  modal.className = "bp-compare-modal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "bp-compare-modal__header";

  const title = document.createElement("h2");
  title.className = "bp-compare-modal__title";
  const contextLabel = compareContext?.title
    ? `${compareContext.title}${compareContext.verseRef ? ` (${compareContext.verseRef})` : ""}`
    : "";
  title.textContent = contextLabel
    ? `Compare References — ${contextLabel}`
    : "Compare References";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bp-compare-modal__close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "Close compare view");

  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);
  attachModalDrag(modal, header);

  const body = document.createElement("div");
  body.className = "bp-compare-modal__body";
  modal.appendChild(body);

  const sidebar = document.createElement("div");
  sidebar.className = "bp-compare-sidebar";
  const sidebarHint = document.createElement("div");
  sidebarHint.className = "bp-compare-sidebar__hint";
  sidebarHint.textContent = "Drag ≡ to reorder. Uncheck to hide.";
  sidebar.appendChild(sidebarHint);
  const sidebarList = document.createElement("div");
  sidebarList.className = "bp-compare-sidebar__list";
  sidebar.appendChild(sidebarList);
  body.appendChild(sidebar);

  const content = document.createElement("div");
  content.className = "bp-compare-modal__list";
  body.appendChild(content);

  const emptyMsg = document.createElement("div");
  emptyMsg.className = "bp-compare-modal__empty";
  emptyMsg.textContent = "Check a reference on the left to show it here.";
  content.appendChild(emptyMsg);

  function closeModal() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }

  closeBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", onKeydown);

  const entries = new Map();

  function syncContentOrder() {
    let anyVisible = false;
    Array.from(sidebarList.querySelectorAll(".bp-compare-sidebar__row")).forEach(
      (row) => {
        const entry = entries.get(row.dataset.ref);
        if (!entry) return;
        if (entry.checkbox.checked) {
          anyVisible = true;
          entry.card.style.display = "";
          content.appendChild(entry.card);
        } else {
          entry.card.style.display = "none";
        }
      },
    );
    emptyMsg.style.display = anyVisible ? "none" : "";
  }

  function attachDragReorder(row, handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (typeof e.button === "number" && e.button !== 0) return;
      e.preventDefault();
      // Capture on the stable list container, not on `row`/`handle` — those
      // get reparented on every swap below, and reparenting the captured
      // element mid-drag causes some browsers to silently release capture,
      // which stops onUp from ever firing and leaves the row stuck floating.
      sidebarList.setPointerCapture(e.pointerId);

      row.classList.add("bp-compare-sidebar__row--dragging");
      row.style.position = "relative";
      row.style.zIndex = "5";
      // Hidden from hit-testing so elementFromPoint below finds the row
      // underneath the cursor instead of the dragged row itself.
      row.style.pointerEvents = "none";

      let lastY = e.clientY;
      let translateY = 0;

      function onMove(ev) {
        translateY += ev.clientY - lastY;
        lastY = ev.clientY;
        row.style.transform = `translateY(${translateY}px)`;

        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const overRow = target && target.closest(".bp-compare-sidebar__row");
        if (!overRow || overRow === row || !sidebarList.contains(overRow)) {
          return;
        }
        const overRect = overRow.getBoundingClientRect();
        const before = ev.clientY < overRect.top + overRect.height / 2;

        // FLIP-style compensation: measure the row's natural (untransformed)
        // position before/after the DOM move so it can keep tracking the
        // cursor smoothly instead of visually jumping.
        row.style.transform = "";
        const beforeTop = row.getBoundingClientRect().top;
        sidebarList.insertBefore(row, before ? overRow : overRow.nextSibling);
        const afterTop = row.getBoundingClientRect().top;
        translateY -= afterTop - beforeTop;
        row.style.transform = `translateY(${translateY}px)`;

        syncContentOrder();
      }
      function onUp() {
        row.classList.remove("bp-compare-sidebar__row--dragging");
        row.style.transform = "";
        row.style.position = "";
        row.style.zIndex = "";
        row.style.pointerEvents = "";
        sidebarList.removeEventListener("pointermove", onMove);
        sidebarList.removeEventListener("pointerup", onUp);
        sidebarList.removeEventListener("pointercancel", onUp);
      }
      sidebarList.addEventListener("pointermove", onMove);
      sidebarList.addEventListener("pointerup", onUp);
      sidebarList.addEventListener("pointercancel", onUp);
    });
  }

  refs.forEach((ref) => {
    const row = document.createElement("div");
    row.className = "bp-compare-sidebar__row";
    row.dataset.ref = ref;

    const handle = document.createElement("span");
    handle.className = "bp-compare-drag-handle";
    handle.innerHTML = "&#x2261;";
    handle.setAttribute("aria-label", "Drag to reorder");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.className = "bp-compare-sidebar__checkbox";
    checkbox.setAttribute("aria-label", `Show ${ref} in comparison`);

    const label = document.createElement("span");
    label.className = "bp-compare-sidebar__label";
    label.textContent = ref;

    row.appendChild(handle);
    row.appendChild(checkbox);
    row.appendChild(label);
    sidebarList.appendChild(row);

    const card = document.createElement("div");
    card.className = "bp-compare-card";

    const cardTitle = document.createElement("div");
    cardTitle.className = "bp-compare-card__title";
    cardTitle.textContent = ref;
    card.appendChild(cardTitle);

    const cardBody = document.createElement("div");
    cardBody.className = "bp-compare-card__body";
    cardBody.textContent = "Loading…";
    card.appendChild(cardBody);

    content.appendChild(card);

    entries.set(ref, { row, checkbox, card });

    checkbox.addEventListener("change", syncContentOrder);
    attachDragReorder(row, handle);

    resolveReferenceForCompare(ref).then((resolved) => {
      if (!entries.has(ref)) return;
      cardBody.innerHTML = "";
      if (!resolved) {
        cardBody.textContent = "Couldn't load this passage.";
        return;
      }
      // Preserve any trailing note the user added after the reference
      // (e.g. "Deuteronomy 8:3 (bread alone)") — ignored for lookup, but
      // still useful to show alongside the resolved, cleanly-formatted title.
      const core = extractReferenceCore(ref);
      const annotation = core ? ref.slice(ref.indexOf(core) + core.length).trim() : "";
      cardTitle.textContent = annotation
        ? `${resolved.title} ${annotation}`
        : resolved.title;
      resolved.verses.forEach((v) => {
        const verseEl = document.createElement("p");
        verseEl.className = "bp-compare-card__verse";
        const num = document.createElement("sup");
        num.textContent = v.n;
        verseEl.appendChild(num);
        verseEl.appendChild(document.createTextNode(` ${v.text}`));
        cardBody.appendChild(verseEl);
      });
    });
  });

  syncContentOrder();
  document.body.appendChild(overlay);
}

// Shared plumbing for the People/Places modals — a simple scrollable card
// list with the same overlay/header/close/Escape/click-outside pattern as
// openCompareModal, plus a data-source credit line at the bottom.
function openInfoListModal(
  titleText,
  entries,
  renderCard,
  disclaimerText,
  creditText,
) {
  document.querySelectorAll(".bp-info-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "bp-info-overlay";

  const modal = document.createElement("div");
  modal.className = "bp-info-modal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "bp-info-modal__header";

  const title = document.createElement("h2");
  title.className = "bp-info-modal__title";
  title.textContent = titleText;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bp-info-modal__close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "Close");

  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const list = document.createElement("div");
  list.className = "bp-info-modal__list";
  modal.appendChild(list);

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "bp-info-modal__empty";
    empty.textContent = "Nothing to show.";
    list.appendChild(empty);
  } else {
    entries.forEach((entry) => list.appendChild(renderCard(entry)));
  }

  if (disclaimerText) {
    const disclaimer = document.createElement("div");
    disclaimer.className = "bp-info-modal__disclaimer";
    disclaimer.textContent = disclaimerText;
    modal.appendChild(disclaimer);
  }

  const credit = document.createElement("div");
  credit.className = "bp-info-modal__credit";
  credit.textContent = creditText || `Data: ${BIBLE_METADATA_CREDIT}`;
  modal.appendChild(credit);

  function closeModal() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);
}

function formatBirthDeathYear(year) {
  if (!Number.isInteger(year)) return null;
  return year < 0 ? `${-year} BC` : `${year} AD`;
}

// Toggles a card's truncated description to the full text (fetched lazily,
// once per session) and back. No-op if this entry was never truncated.
function attachReadMoreToggle(card, bodyEl, entry, kind) {
  if (!entry.truncated) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bp-info-card__toggle";
  toggle.textContent = "Read more";
  let expanded = false;
  let fullText = null;
  toggle.addEventListener("click", async () => {
    if (expanded) {
      bodyEl.textContent = entry.description;
      toggle.textContent = "Read more";
      expanded = false;
      return;
    }
    if (fullText === null) {
      toggle.textContent = "Loading…";
      toggle.disabled = true;
      const fullMap = await getFullTextMap(kind);
      fullText = fullMap[entry.id] || entry.description;
      toggle.disabled = false;
    }
    bodyEl.textContent = fullText;
    toggle.textContent = "Show less";
    expanded = true;
  });
  card.appendChild(toggle);
}

function openPeopleModal(bookId, chapterNum, metadata) {
  const chapterKey = `${bookId}_${chapterNum}`;
  const ids = metadata.people.byChapter[chapterKey] || [];
  const bookLabel = bookNames[bookId] || bookId;
  const entries = ids
    .map((id) => metadata.people.people[id] && { id, ...metadata.people.people[id] })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  openInfoListModal(`People in ${bookLabel} ${chapterNum}`, entries, (person) => {
    const card = document.createElement("div");
    card.className = "bp-info-card";

    const nameEl = document.createElement("div");
    nameEl.className = "bp-info-card__title";
    nameEl.textContent = person.alsoCalled
      ? `${person.name} (${person.alsoCalled
          .split(",")
          .map((s) => s.trim())
          .join(", ")})`
      : person.name;
    card.appendChild(nameEl);

    const metaParts = [];
    if (person.gender) metaParts.push(person.gender);
    const birth = formatBirthDeathYear(person.birthYear);
    const death = formatBirthDeathYear(person.deathYear);
    if (birth || death) {
      metaParts.push([birth, death].filter(Boolean).join(" – "));
    }
    if (metaParts.length) {
      const metaEl = document.createElement("div");
      metaEl.className = "bp-info-card__meta";
      metaEl.textContent = metaParts.join(" · ");
      card.appendChild(metaEl);
    }

    if (person.description) {
      const bodyEl = document.createElement("div");
      bodyEl.className = "bp-info-card__body";
      bodyEl.textContent = person.description;
      card.appendChild(bodyEl);
      attachReadMoreToggle(card, bodyEl, person, "people");
    }

    return card;
  }, "Names and identifications are intended to give a general overview of Bible people — not an interpretation of Scripture.");
}

// The source dataset occasionally has two separate place records for the
// same real location (e.g. "Judea" and a "Judean" adjective-form entry)
// with identical name/coordinates/description — safe to merge for display,
// unlike people, where two entries sharing a name are usually genuinely
// different individuals and must never be collapsed.
function dedupePlaceEntries(entries) {
  const seen = new Map();
  const result = [];
  entries.forEach((place) => {
    const key = `${place.name}|${place.lat}|${place.lon}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, place);
      result.push(place);
    } else if (!existing.featureType && place.featureType) {
      result[result.indexOf(existing)] = place;
      seen.set(key, place);
    }
  });
  return result;
}

function openPlacesModal(bookId, chapterNum, metadata) {
  const chapterKey = `${bookId}_${chapterNum}`;
  const ids = metadata.places.byChapter[chapterKey] || [];
  const bookLabel = bookNames[bookId] || bookId;
  const entries = dedupePlaceEntries(
    ids
      .map((id) => metadata.places.places[id] && { id, ...metadata.places.places[id] })
      .filter(Boolean),
  ).sort((a, b) => a.name.localeCompare(b.name));

  openInfoListModal(`Places in ${bookLabel} ${chapterNum}`, entries, (place) => {
    const card = document.createElement("div");
    card.className = "bp-info-card";

    const nameEl = document.createElement("div");
    nameEl.className = "bp-info-card__title";
    nameEl.textContent = place.name;
    card.appendChild(nameEl);

    if (place.featureType) {
      const metaEl = document.createElement("div");
      metaEl.className = "bp-info-card__meta";
      metaEl.textContent = place.featureType;
      card.appendChild(metaEl);
    }

    if (place.description) {
      const bodyEl = document.createElement("div");
      bodyEl.className = "bp-info-card__body";
      bodyEl.textContent = place.description;
      card.appendChild(bodyEl);
      attachReadMoreToggle(card, bodyEl, place, "places");
    }

    return card;
  }, "Place identifications are intended to give a general overview of Bible geography — not an interpretation of Scripture.");
}

const BOOK_INFO_CREDIT =
  "Summary: Easton's Bible Dictionary (1897, public domain, via ccel.org)";

// Unlike Timeline/People/Places, every book has an entry — this modal is
// always reachable, so unlike the other three it isn't gated behind a
// "does this chapter have data" check.
function openBookModal(bookId, metadata) {
  const bookLabel = bookNames[bookId] || bookId;
  const info = metadata.bookInfo.books[bookId];
  const entries = info ? [{ id: bookId, ...info }] : [];

  openInfoListModal(bookLabel, entries, (book) => {
    const card = document.createElement("div");
    card.className = "bp-info-card";

    const metaEl = document.createElement("div");
    metaEl.className = "bp-info-card__meta";
    const authorsText = (book.authors || []).join(", ");
    metaEl.textContent = [
      book.dateWritten ? `Written: ${book.dateWritten}` : "",
      authorsText ? `Author: ${authorsText}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    card.appendChild(metaEl);

    if (book.description) {
      const bodyEl = document.createElement("div");
      bodyEl.className = "bp-info-card__body";
      bodyEl.textContent = book.description;
      card.appendChild(bodyEl);
      attachReadMoreToggle(card, bodyEl, book, "book");
    }

    return card;
  }, "This information is provided for big-picture context — not an interpretation of Scripture.", BOOK_INFO_CREDIT);
}

const BP_TIMELINE_ERA_LABELS = {
  ot: "Old Testament",
  gospels: "Christ in the Flesh and on the Earth",
  earlyChurch: "Early Church",
};
const BP_TIMELINE_ERA_ORDER = ["ot", "gospels", "earlyChurch"];

function formatTimelineEventYear(year) {
  if (!Number.isInteger(year)) return "";
  return year < 0 ? `${-year} BC` : `${year} AD`;
}

function openTimelineModal(bookId, chapterNum, metadata) {
  document
    .querySelectorAll(".bp-timeline-overlay")
    .forEach((el) => el.remove());

  const chapterKey = `${bookId}_${chapterNum}`;
  const chapterEntries = metadata.timeline.byChapter[chapterKey] || [];
  if (!chapterEntries.length) return;

  const uniqueEventsById = new Map();
  metadata.timeline.events.forEach((ev) => {
    if (!uniqueEventsById.has(ev.id)) uniqueEventsById.set(ev.id, ev);
  });

  const currentIds = new Set(chapterEntries.map((e) => e.id));
  const currentEvents = Array.from(currentIds)
    .map((id) => uniqueEventsById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.sortKey - b.sortKey);
  if (!currentEvents.length) return;

  const currentEra = currentEvents[0].era;

  const eraSorted = Array.from(uniqueEventsById.values())
    .filter((e) => e.era === currentEra)
    .sort((a, b) => a.sortKey - b.sortKey);

  const currentIndexes = eraSorted
    .map((e, i) => (currentIds.has(e.id) ? i : -1))
    .filter((i) => i !== -1);
  const firstIdx = Math.min(...currentIndexes);
  const lastIdx = Math.max(...currentIndexes);

  const override = metadata.overrides[chapterKey] || {};

  // The current chapter's own events aren't necessarily contiguous in the
  // era's sortKey order — parallel Gospel accounts (Matthew/Mark/Luke/John)
  // interleave by chronology, so a chapter's events can have unrelated
  // events from OTHER books' chapters sorted in between them. Use
  // `currentEvents` directly for the highlighted middle (not an index-range
  // slice from first to last), so only genuinely-before/after neighbors —
  // never interleaved events from other chapters — surround it.
  let neighborhood;
  if (Array.isArray(override.before) || Array.isArray(override.after)) {
    const beforeEvents = (override.before || [])
      .map((id) => uniqueEventsById.get(id))
      .filter(Boolean);
    const afterEvents = (override.after || [])
      .map((id) => uniqueEventsById.get(id))
      .filter(Boolean);
    neighborhood = [...beforeEvents, ...currentEvents, ...afterEvents];
  } else if (
    Number.isInteger(override.beforeCount) ||
    Number.isInteger(override.afterCount)
  ) {
    const beforeCount = Number.isInteger(override.beforeCount)
      ? override.beforeCount
      : 3;
    const afterCount = Number.isInteger(override.afterCount)
      ? override.afterCount
      : 3;
    const before = eraSorted.slice(Math.max(0, firstIdx - beforeCount), firstIdx);
    const after = eraSorted.slice(lastIdx + 1, lastIdx + 1 + afterCount);
    neighborhood = [...before, ...currentEvents, ...after];
  } else {
    // Default: the entire era, auto-centered on the current chapter's
    // events once rendered — gives full context to explore (the other two
    // eras stay compact, curated landmark strips) rather than a narrow
    // fixed window.
    neighborhood = eraSorted;
  }

  const overlay = document.createElement("div");
  overlay.className = "bp-timeline-overlay";

  const modal = document.createElement("div");
  modal.className = "bp-timeline-modal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "bp-timeline-modal__header";
  const bookLabel = bookNames[bookId] || bookId;
  const title = document.createElement("h2");
  title.className = "bp-timeline-modal__title";
  title.textContent = `Timeline — ${bookLabel} ${chapterNum}`;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bp-timeline-modal__close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "Close timeline");
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "bp-timeline-modal__body";
  modal.appendChild(body);

  const detail = document.createElement("div");
  detail.className = "bp-timeline-detail";
  modal.appendChild(detail);

  const disclaimer = document.createElement("div");
  disclaimer.className = "bp-timeline-disclaimer";
  disclaimer.textContent =
    "Dates and event order are intended to give a general historical overview — not an interpretation of Scripture.";
  modal.appendChild(disclaimer);

  const credit = document.createElement("div");
  credit.className = "bp-timeline-credit";
  credit.textContent = `Data: ${BIBLE_METADATA_CREDIT}`;
  modal.appendChild(credit);

  function showDetail(ev, zoneEra) {
    detail.innerHTML = "";
    const t = document.createElement("div");
    t.className = "bp-timeline-detail__title";
    t.classList.toggle("bp-timeline-detail__title--current", currentIds.has(ev.id));
    t.textContent = ev.title;
    const meta = document.createElement("div");
    meta.className = "bp-timeline-detail__meta";
    const evBookLabel = bookNames[ev.book] || ev.book;
    const verseRef = Number.isInteger(ev.verseStart)
      ? `${evBookLabel} ${ev.chapter}:${ev.verseStart}${
          ev.verseEnd > ev.verseStart ? `-${ev.verseEnd}` : ""
        }`
      : "";
    // Landmark events are hand-curated into a zone regardless of their own
    // recorded era (e.g. Pentecost sits right at the gospels/earlyChurch
    // boundary in the source data) — label with the zone they're shown in,
    // not the raw field, so it never contradicts where it's displayed.
    meta.textContent = [
      formatTimelineEventYear(ev.year),
      BP_TIMELINE_ERA_LABELS[zoneEra || ev.era],
      verseRef,
    ]
      .filter(Boolean)
      .join(" · ");
    detail.appendChild(t);
    detail.appendChild(meta);
  }

  function makeMarker(ev, { highlighted, compact, zoneEra }) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = compact ? "bp-timeline-landmark" : "bp-timeline-marker";
    if (highlighted) marker.classList.add("bp-timeline-marker--current");
    const dot = document.createElement("span");
    dot.className = compact
      ? "bp-timeline-landmark__dot"
      : "bp-timeline-marker__dot";
    const label = document.createElement("span");
    label.className = compact
      ? "bp-timeline-landmark__label"
      : "bp-timeline-marker__label";
    label.textContent = ev.title;
    marker.appendChild(dot);
    marker.appendChild(label);
    marker.addEventListener("click", () => showDetail(ev, zoneEra));
    return marker;
  }

  // Mouse users have no native way to pan a horizontally-scrolling flex
  // row (only the scrollbar itself, or a wheel/trackpad gesture) — add
  // click-and-drag panning, plus vertical-wheel-scrolls-horizontally so a
  // plain mouse wheel works too. Touch already scrolls this natively via
  // the browser, so pointerType "touch"/"pen" are left alone entirely.
  function attachDragScroll(track) {
    let dragging = false;
    let capturing = false;
    let pointerId = null;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;

    track.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      if (typeof e.button === "number" && e.button !== 0) return;
      // Ignore mousedowns on the native scrollbar strip itself — letting
      // the browser drive that directly avoids fighting our own panning,
      // which is inverted from how dragging a scrollbar thumb works.
      const trackRect = track.getBoundingClientRect();
      if (e.clientY - trackRect.top > track.clientHeight) return;
      dragging = true;
      moved = false;
      capturing = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScrollLeft = track.scrollLeft;
    });
    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      // Defer pointer capture until an actual drag is confirmed — capturing
      // unconditionally on every mousedown retargets the eventual 'click'
      // to `track` instead of the marker button that was visually clicked,
      // silently breaking plain (non-drag) clicks on the cards.
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        track.setPointerCapture(pointerId);
        capturing = true;
        track.classList.add("bp-timeline-zone__track--dragging");
      }
      if (moved) track.scrollLeft = startScrollLeft - dx;
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (capturing) {
        track.releasePointerCapture(pointerId);
        capturing = false;
      }
      track.classList.remove("bp-timeline-zone__track--dragging");
      if (moved) {
        // A drag shouldn't also trigger the marker button's click — but
        // only suppress the click that fires (if any) as an immediate
        // byproduct of THIS release, not indefinitely: whether a mouseup
        // over a different element than mousedown produces a trailing
        // click varies by browser, so an unconditional `once` listener can
        // sit armed and silently eat the user's next unrelated click.
        const suppressClick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        track.addEventListener("click", suppressClick, { capture: true });
        setTimeout(() => {
          track.removeEventListener("click", suppressClick, true);
        }, 0);
      }
    }
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    track.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY === 0) return;
        e.preventDefault();
        track.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
  }

  BP_TIMELINE_ERA_ORDER.forEach((era) => {
    const zone = document.createElement("div");
    zone.className = "bp-timeline-zone";

    const zoneHeader = document.createElement("div");
    zoneHeader.className = "bp-timeline-zone__header";
    zoneHeader.textContent = BP_TIMELINE_ERA_LABELS[era];
    zone.appendChild(zoneHeader);

    if (era === currentEra) {
      zone.classList.add("bp-timeline-zone--expanded");
      const hint = document.createElement("div");
      hint.className = "bp-timeline-zone__hint";
      hint.innerHTML =
        "This chapter's events are <strong>highlighted in gold</strong> below — drag, scroll, or use your mouse wheel to see what comes before and after.";
      zone.appendChild(hint);
      const track = document.createElement("div");
      track.className = "bp-timeline-zone__track";
      attachDragScroll(track);
      neighborhood.forEach((ev) => {
        track.appendChild(
          makeMarker(ev, {
            highlighted: currentIds.has(ev.id),
            compact: false,
            zoneEra: era,
          }),
        );
      });
      zone.appendChild(track);
    } else {
      zone.classList.add("bp-timeline-zone--compact");
      const landmarkIds = metadata.milestones[era] || [];
      landmarkIds.forEach((id) => {
        const ev = uniqueEventsById.get(id);
        if (!ev) return;
        zone.appendChild(
          makeMarker(ev, { highlighted: false, compact: true, zoneEra: era }),
        );
      });
    }

    body.appendChild(zone);
  });

  showDetail(currentEvents[0], currentEra);

  function closeModal() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);

  // Now that the modal is in the document, scroll the current era's track
  // so the current chapter's earliest event is centered — otherwise, with
  // the whole era in the track by default, the view opens on its leftmost
  // (earliest-in-era) events rather than "you are here".
  //
  // Center on just the first highlighted marker, not a span across all of
  // them: a chapter's own events aren't necessarily clustered together in
  // the full era list (parallel Gospel accounts interleave by chronology),
  // so spanning first-to-last could center on an unrelated stretch of the
  // timeline sitting between two widely-separated highlighted events.
  const firstHighlighted = body.querySelector(".bp-timeline-marker--current");
  if (firstHighlighted) {
    const expandedTrack = firstHighlighted.closest(".bp-timeline-zone__track");
    if (expandedTrack) {
      // Measure relative to the track itself, not offsetLeft — offsetLeft
      // is relative to the nearest *positioned* ancestor (here,
      // .bp-timeline-overlay, which is position:fixed), not the scroll
      // container. That happens to look right when the OT zone (always
      // leftmost) is the current era, since nothing precedes it, but is
      // wrong whenever a later zone (Christ in the Flesh, Early Church) is
      // current — its offsetLeft is inflated by the width of whatever
      // zone(s) come before it.
      const trackRect = expandedTrack.getBoundingClientRect();
      const markerRect = firstHighlighted.getBoundingClientRect();
      const markerContentLeft =
        markerRect.left - trackRect.left + expandedTrack.scrollLeft;
      const center = markerContentLeft + markerRect.width / 2;
      expandedTrack.scrollLeft = Math.max(0, center - expandedTrack.clientWidth / 2);
    }
  }
}

function positionIconTooltip(icon, tooltip) {
  const gap = 6;
  const viewportPadding = 8;
  const anchorRect = icon.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();

  const viewportTop = window.scrollY;
  const viewportBottom = window.scrollY + window.innerHeight;
  const viewportLeft = window.scrollX;
  const viewportRight = window.scrollX + window.innerWidth;

  // Default above the icon (the cursor sits on/near the icon while
  // hovering, so a tooltip below gets partly covered by the cursor);
  // flip below only when there isn't room above.
  let top = anchorRect.top + window.scrollY - tipRect.height - gap;
  let left = anchorRect.left + window.scrollX;

  if (top < viewportTop + viewportPadding) {
    top = anchorRect.bottom + window.scrollY + gap;
  }

  const minTop = viewportTop + viewportPadding;
  const maxTop = viewportBottom - tipRect.height - viewportPadding;
  top = Math.max(minTop, Math.min(top, maxTop));

  const minLeft = viewportLeft + viewportPadding;
  const maxLeft = viewportRight - tipRect.width - viewportPadding;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

// Custom hover tooltip for the small outline/note icons. A native `title`
// attribute would float above everything unclipped, but these icons live
// inside the scrollable sidebars (overflow-y: auto), so a CSS-positioned
// tooltip anchored to the icon gets clipped at the sidebar edge. Appending
// to document.body (like the reference-menu popups) escapes that clipping.
function attachIconHoverTooltip(el, text) {
  if (!text) return;
  if (!window.matchMedia("(hover: hover)").matches) return;

  let tooltipEl = null;
  let showTimer = null;

  function hide() {
    clearTimeout(showTimer);
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  function show() {
    hide();
    tooltipEl = document.createElement("div");
    tooltipEl.className = "bp-icon-tooltip-popover";
    tooltipEl.textContent = text;
    document.body.appendChild(tooltipEl);
    positionIconTooltip(el, tooltipEl);
  }

  el.addEventListener("mouseenter", () => {
    clearTimeout(showTimer);
    showTimer = setTimeout(show, 150);
  });
  el.addEventListener("mouseleave", hide);
  el.addEventListener("focus", show);
  el.addEventListener("blur", hide);

  return hide;
}

function positionFloatingMenu(icon, menu) {
  // Mobile layout: render as a fixed bottom sheet instead of anchoring to the
  // icon (the .reference-menu--sheet CSS overrides the inline positioning).
  if (window.bpIsMobileMode && window.bpIsMobileMode()) {
    menu.classList.add("reference-menu--sheet");
    menu.style.top = "";
    menu.style.left = "";
    return;
  }
  const gap = 2;
  const viewportPadding = 8;
  const anchorRect = icon.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  const viewportTop = window.scrollY;
  const viewportBottom = window.scrollY + window.innerHeight;
  const viewportLeft = window.scrollX;
  const viewportRight = window.scrollX + window.innerWidth;

  // Preserve current behavior by default: open under the icon.
  let top = anchorRect.bottom + window.scrollY + gap;
  let left = anchorRect.left + window.scrollX;

  const wouldOverflowBottom =
    top + menuRect.height > viewportBottom - viewportPadding;
  if (wouldOverflowBottom) {
    top = anchorRect.top + window.scrollY - menuRect.height - gap;
  }

  // Clamp to viewport if content is still taller than available room.
  const minTop = viewportTop + viewportPadding;
  const maxTop = viewportBottom - menuRect.height - viewportPadding;
  top = Math.max(minTop, Math.min(top, maxTop));

  const minLeft = viewportLeft + viewportPadding;
  const maxLeft = viewportRight - menuRect.width - viewportPadding;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function openReferenceMenu(
  icon,
  references,
  links,
  onSelectReference,
  onClose,
  compareContext,
) {
  document.querySelectorAll(".reference-menu").forEach((m) => m.remove());
  document
    .querySelectorAll(".reference-preview-popover")
    .forEach((m) => m.remove());

  const previewCache = new Map();

  function parseReferenceForPreview(reference) {
    const details = parseReferenceDetails(reference);
    if (!details || !details.bookId || !details.chapterNum) return null;
    return details;
  }

  async function resolveReferencePreview(reference) {
    const canonical = extractReferenceCore(reference);
    if (!canonical) return null;
    if (previewCache.has(canonical)) return previewCache.get(canonical);

    const details = parseReferenceForPreview(reference);
    if (!details) return null;

    const data = await getBibleData();
    const books = Array.isArray(data?.books) ? data.books : [];
    const book = books.find((b) => b.id === details.bookId);
    if (!book || !Array.isArray(book.chapters)) return null;

    const chapter = book.chapters.find((c) => c.number === details.chapterNum);
    if (!chapter || !Array.isArray(chapter.verses) || !chapter.verses.length)
      return null;

    const bookLabel = bookNames[details.bookId] || details.bookId;
    let title = `${bookLabel} ${details.chapterNum}`;
    let lines = [];

    if (Number.isInteger(details.verseStart) && details.verseStart > 0) {
      const verseEnd =
        Number.isInteger(details.verseEnd) &&
        details.verseEnd >= details.verseStart
          ? details.verseEnd
          : details.verseStart;
      title = `${bookLabel} ${details.chapterNum}:${details.verseStart}${verseEnd > details.verseStart ? `-${verseEnd}` : ""}`;

      lines = chapter.verses
        .filter((v) => {
          const n = parseInt(v?.n, 10);
          return (
            Number.isInteger(n) && n >= details.verseStart && n <= verseEnd
          );
        })
        .map((v) => `${v.n}. ${v.text}`);
    } else {
      lines = chapter.verses.slice(0, 2).map((v) => `${v.n}. ${v.text}`);
    }

    if (!lines.length) return null;

    const preview = {
      title,
      text: lines.join("\n"),
    };
    previewCache.set(canonical, preview);
    return preview;
  }

  function positionPreviewPopover(anchorEl, popoverEl) {
    const gap = 8;
    const viewportPadding = 8;
    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = popoverEl.getBoundingClientRect();
    const viewportLeft = window.scrollX;
    const viewportRight = window.scrollX + window.innerWidth;
    const viewportTop = window.scrollY;
    const viewportBottom = window.scrollY + window.innerHeight;

    let left = anchorRect.right + window.scrollX + gap;
    let top = anchorRect.top + window.scrollY;

    if (left + popRect.width > viewportRight - viewportPadding) {
      left = anchorRect.left + window.scrollX - popRect.width - gap;
    }

    const minLeft = viewportLeft + viewportPadding;
    const maxLeft = viewportRight - popRect.width - viewportPadding;
    const minTop = viewportTop + viewportPadding;
    const maxTop = viewportBottom - popRect.height - viewportPadding;

    popoverEl.style.left = `${Math.max(minLeft, Math.min(left, maxLeft))}px`;
    popoverEl.style.top = `${Math.max(minTop, Math.min(top, maxTop))}px`;
  }

  let activePreviewAnchor = null;
  let activePreviewPopover = null;
  let previewPinned = false;
  let previewShowTimer = null;
  let previewHideTimer = null;
  let previewRequestToken = 0;

  function clearPreviewTimers() {
    if (previewShowTimer) {
      clearTimeout(previewShowTimer);
      previewShowTimer = null;
    }
    if (previewHideTimer) {
      clearTimeout(previewHideTimer);
      previewHideTimer = null;
    }
  }

  function removePreview(force = false) {
    if (previewPinned && !force) return;
    if (activePreviewPopover) {
      activePreviewPopover.remove();
      activePreviewPopover = null;
    }
    activePreviewAnchor = null;
    previewPinned = false;
  }

  function schedulePreviewHide() {
    clearPreviewTimers();
    previewHideTimer = setTimeout(() => {
      removePreview(false);
    }, 140);
  }

  function renderPreview(anchorEl, preview) {
    if (!preview || !anchorEl) return;
    if (!activePreviewPopover) {
      activePreviewPopover = document.createElement("div");
      activePreviewPopover.className = "reference-preview-popover";
      activePreviewPopover.style.position = "absolute";
      activePreviewPopover.style.zIndex = 1001;
      activePreviewPopover.style.background = "#fff";
      activePreviewPopover.style.border = "1px solid #ccc";
      activePreviewPopover.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
      activePreviewPopover.style.borderRadius = "6px";
      activePreviewPopover.style.padding = "8px 10px";
      activePreviewPopover.style.color = "#222";
      activePreviewPopover.style.minWidth = "260px";
      activePreviewPopover.style.maxWidth = "min(560px, 80vw)";
      activePreviewPopover.style.maxHeight = "50vh";
      activePreviewPopover.style.overflowY = "auto";
      activePreviewPopover.style.whiteSpace = "pre-wrap";
      activePreviewPopover.style.cursor = "default";

      activePreviewPopover.addEventListener("mouseenter", () => {
        clearPreviewTimers();
      });
      activePreviewPopover.addEventListener("mouseleave", () => {
        schedulePreviewHide();
      });
      activePreviewPopover.addEventListener("click", (e) => {
        e.stopPropagation();
        previewPinned = !previewPinned;
      });
      document.body.appendChild(activePreviewPopover);
    }

    const safeTitle = String(preview.title || "Reference");
    const safeText = String(preview.text || "");
    activePreviewPopover.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "reference-preview-popover__title";
    titleEl.textContent = safeTitle;

    const textEl = document.createElement("div");
    textEl.className = "reference-preview-popover__text";
    textEl.textContent = safeText;

    const helperEl = document.createElement("div");
    helperEl.className = "reference-preview-popover__helper";
    helperEl.textContent = "Hover preview. Click preview to pin/unpin.";

    activePreviewPopover.appendChild(titleEl);
    activePreviewPopover.appendChild(textEl);
    activePreviewPopover.appendChild(helperEl);
    activePreviewAnchor = anchorEl;
    positionPreviewPopover(anchorEl, activePreviewPopover);
  }

  function attachReferencePreviewBehavior(refItem, ref) {
    // Hover previews only make sense with a real hover pointer; on touch
    // devices tapping a reference navigates to it directly.
    if (!window.matchMedia("(hover: hover)").matches) return;
    if (!parseReferenceForPreview(ref)) return;

    refItem.addEventListener("mouseenter", () => {
      if (previewPinned) return;
      clearPreviewTimers();
      previewShowTimer = setTimeout(async () => {
        const token = ++previewRequestToken;
        try {
          const preview = await resolveReferencePreview(ref);
          if (token !== previewRequestToken || previewPinned) return;
          renderPreview(refItem, preview);
        } catch {
          // Keep hover behavior silent on preview failures.
        }
      }, 170);
    });

    refItem.addEventListener("mouseleave", () => {
      if (previewPinned) return;
      schedulePreviewHide();
    });
  }

  function closeReferenceUi(force = true) {
    clearPreviewTimers();
    removePreview(force);
    menu.remove();
    if (onClose) onClose();
  }

  const menu = document.createElement("div");
  menu.className = "reference-menu";
  menu.style.position = "absolute";
  menu.style.zIndex = 1000;
  menu.style.background = "#fff";
  menu.style.border = "1px solid #ccc";
  menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  menu.style.padding = "6px 10px";
  menu.style.borderRadius = "6px";
  menu.style.minWidth = "180px";
  menu.style.maxWidth = "min(448px, 85vw)";
  menu.style.maxHeight = "70vh";
  menu.style.overflowY = "auto";
  menu.style.color = "#222";
  menu.style.cursor = "default";

  const compareCandidates = (references || []).filter(Boolean);

  compareCandidates.forEach((ref) => {
    const refItem = document.createElement("div");
    refItem.className = "reference-menu-item";
    refItem.textContent = ref;
    refItem.style.padding = "4px 0";
    refItem.style.cursor = "pointer";
    attachReferencePreviewBehavior(refItem, ref);
    refItem.addEventListener("click", (e) => {
      e.stopPropagation();
      clearPreviewTimers();
      removePreview(true);
      menu.remove();
      onSelectReference(ref);
    });
    menu.appendChild(refItem);
  });

  const comparableCount = compareCandidates.filter(isComparableReference).length;

  if (comparableCount > 1) {
    menu.appendChild(document.createElement("hr"));
    const compareBtn = document.createElement("button");
    compareBtn.type = "button";
    compareBtn.className = "reference-menu-compare-btn";
    compareBtn.textContent = "Compare These References";
    compareBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeReferenceUi(true);
      openCompareModal(compareCandidates, compareContext);
    });
    menu.appendChild(compareBtn);
  }

  (links || []).forEach((link) => {
    if (!link || !link.url || !link.label) return;
    const linkItem = document.createElement("div");
    linkItem.className = "reference-menu-item reference-menu-item--external";
    linkItem.style.padding = "4px 0";
    linkItem.style.cursor = "pointer";
    linkItem.textContent = link.label;
    const arrow = document.createElement("span");
    arrow.className = "reference-menu-item--external-icon";
    arrow.textContent = " ↗";
    linkItem.appendChild(arrow);
    linkItem.addEventListener("click", (e) => {
      e.stopPropagation();
      clearPreviewTimers();
      removePreview(true);
      menu.remove();
      window.open(link.url, "_blank", "noopener,noreferrer");
    });
    menu.appendChild(linkItem);
  });

  const closeItem = document.createElement("div");
  closeItem.className = "reference-menu-item";
  closeItem.textContent = "Close";
  closeItem.style.padding = "4px 0";
  closeItem.style.cursor = "pointer";
  closeItem.style.color = "#0074d9";
  closeItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeReferenceUi(true);
  });
  menu.appendChild(document.createElement("hr"));
  menu.appendChild(closeItem);

  document.body.appendChild(menu);
  positionFloatingMenu(icon, menu);

  setTimeout(() => {
    document.addEventListener("mousedown", function handler(e) {
      const clickInsidePreview =
        activePreviewPopover && activePreviewPopover.contains(e.target);
      if (!menu.contains(e.target) && !clickInsidePreview) {
        closeReferenceUi(true);
        document.removeEventListener("mousedown", handler);
      }
    });
  }, 0);
}

function openNoteMenu(icon, noteText, onClose) {
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
  menu.style.minWidth = "220px";
  menu.style.maxWidth = "min(483px, 85vw)";
  menu.style.maxHeight = "70vh";
  menu.style.overflowY = "auto";
  menu.style.color = "#222";
  menu.style.cursor = "default";

  const noteItem = document.createElement("div");
  noteItem.className = "reference-menu-item";
  noteItem.textContent = noteText;
  noteItem.style.whiteSpace = "pre-wrap";
  noteItem.style.cursor = "default";
  menu.appendChild(noteItem);

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

  document.body.appendChild(menu);
  positionFloatingMenu(icon, menu);

  setTimeout(() => {
    document.addEventListener("mousedown", function handler(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("mousedown", handler);
      }
    });
  }, 0);
}

// Reference/note icons share one small cluster on the trailing side of the
// button (rather than reference-before-text, note-after-text as in earlier
// versions) so they only cost one text-to-icons gap instead of two, and the
// icons themselves sit tighter together than that gap.
function getTopicBtnIcons(btn) {
  let wrap = btn.querySelector(":scope > .topic-btn__icons");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "topic-btn__icons";
    btn.appendChild(wrap);
  }
  return wrap;
}

function decorateTopicButtonWithReferences(
  btn,
  label,
  references,
  links,
  onSelectReference,
  helperText,
  onClose,
  compareContext,
) {
  const hasRefs = Array.isArray(references) && references.length;
  const hasLinks = Array.isArray(links) && links.length;
  if (!hasRefs && !hasLinks) {
    btn.textContent = label;
    return;
  }

  btn.classList.add("topic-btn--with-reference");
  const linkIcon = document.createElement("span");
  linkIcon.className = "outline-link-icon";
  linkIcon.innerHTML = "&#x1F4D6;";
  const refsPart = hasRefs ? references.filter(Boolean).join("; ") : "";
  const linksPart = hasLinks ? links.map((l) => l.label).join("; ") : "";
  const tooltipCore = [refsPart, linksPart].filter(Boolean).join("; ");
  const tooltipText = helperText
    ? `${tooltipCore}\n${helperText}`
    : tooltipCore;
  linkIcon.setAttribute("aria-label", tooltipText);
  const hideLinkTooltip = attachIconHoverTooltip(linkIcon, tooltipText);
  linkIcon.style.cursor = "pointer";
  linkIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    if (hideLinkTooltip) hideLinkTooltip();
    openReferenceMenu(
      linkIcon,
      references,
      links,
      onSelectReference,
      onClose,
      compareContext,
    );
  });
  btn.appendChild(document.createTextNode(label));
  getTopicBtnIcons(btn).appendChild(linkIcon);
}

function decorateTopicButtonWithNote(btn, noteText, helperText, onClose) {
  let normalizedNote = "";
  if (typeof noteText === "string") {
    normalizedNote = noteText.trim();
  } else if (Array.isArray(noteText)) {
    normalizedNote = noteText
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (!normalizedNote) return;

  btn.classList.add("topic-btn--with-reference");
  const noteIcon = document.createElement("span");
  noteIcon.className = "outline-link-icon note-link-icon";
  noteIcon.innerHTML = "&#x1F4DD;";
  const noteTooltipText = helperText || "Show note";
  noteIcon.setAttribute("aria-label", noteTooltipText);
  const hideNoteTooltip = attachIconHoverTooltip(noteIcon, noteTooltipText);
  noteIcon.style.cursor = "pointer";
  noteIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    if (hideNoteTooltip) hideNoteTooltip();
    openNoteMenu(noteIcon, normalizedNote, onClose);
  });
  getTopicBtnIcons(btn).appendChild(noteIcon);
}

// ctx: { action:'correct'|'add', scope:'chapter'|'bookwide', bookId,
//        chapterNum, entryKind:'label'|'highlight', entry, entryIndex }
// Hidden by default, revealed on hover/focus of the whole button (see
// .suggest-link-icon in css/style.css) so it doesn't visually compete with
// the 📖/📝 icons that already exist on busy buttons.
function decorateTopicButtonWithSuggest(btn, ctx) {
  btn.classList.add("topic-btn--with-reference");
  const icon = document.createElement("span");
  icon.className = "outline-link-icon suggest-link-icon";
  icon.innerHTML = "&#x270F;&#xFE0F;";
  const tooltipText = "Suggest a correction";
  icon.setAttribute("aria-label", tooltipText);
  const hideTooltip = attachIconHoverTooltip(icon, tooltipText);
  icon.style.cursor = "pointer";
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    if (hideTooltip) hideTooltip();
    openSuggestModal(ctx);
  });
  btn.appendChild(icon);
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

function collectNonOverlappingMatches(lowerText, phraseEntries) {
  const matches = [];
  phraseEntries.forEach((pe) => {
    const phrase = (pe.phrase || "").toLowerCase();
    if (!phrase) return;
    let fromIdx = 0;
    while (true) {
      const idx = lowerText.indexOf(phrase, fromIdx);
      if (idx === -1) break;
      matches.push({
        start: idx,
        end: idx + phrase.length,
        len: phrase.length,
        className: pe.className,
      });
      fromIdx = idx + 1;
    }
  });
  matches.sort((a, b) => a.start - b.start || b.len - a.len);

  // Overlaps between two DIFFERENT-class matches are split into up to 3
  // segments (leading non-overlap, shared overlap, trailing non-overlap)
  // rather than one match winning and the other being dropped outright —
  // the leading/trailing pieces keep their own class/color, and the shared
  // middle piece carries both classes so the "<classA>.<classB>" CSS rule
  // can render it as a blend. Overlaps between two matches of the SAME
  // class just extend the existing span (no blend needed, same color).
  const merged = [];
  matches.forEach((m) => {
    if (!merged.length) {
      merged.push(m);
      return;
    }
    const prev = merged[merged.length - 1];
    if (m.start >= prev.end) {
      merged.push(m);
      return;
    }
    if (m.className === prev.className) {
      if (m.end > prev.end) prev.end = m.end;
      return;
    }
    merged.pop();
    if (m.start > prev.start) {
      merged.push({ start: prev.start, end: m.start, className: prev.className });
    }
    const overlapEnd = Math.min(prev.end, m.end);
    merged.push({ start: m.start, end: overlapEnd, className: prev.className + " " + m.className });
    const tailEnd = Math.max(prev.end, m.end);
    if (tailEnd > overlapEnd) {
      merged.push({
        start: overlapEnd,
        end: tailEnd,
        className: prev.end > m.end ? prev.className : m.className,
      });
    }
  });
  return merged;
}

function renderHighlightedHtml(text, matches) {
  if (!matches.length) return text;
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const cls = m.className || "search-highlight";
    out =
      out.slice(0, m.start) +
      `<span class="${cls}">` +
      out.slice(m.start, m.end) +
      "</span>" +
      out.slice(m.end);
  }
  return out;
}

function applyPhraseHighlightsFromCache(verseTextCache, phraseEntries) {
  const normalized = normalizePhraseEntries(phraseEntries);
  if (!normalized.length) {
    resetVerseTextFromCache(verseTextCache);
    return;
  }
  try {
    verseTextCache.forEach((entry, el) => {
      const verseKey = el.getAttribute("data-verse-key");
      const scoped = normalized.filter(
        (pe) => pe.scopeVerseKeys === null || (verseKey && pe.scopeVerseKeys.has(verseKey)),
      );
      if (!scoped.length) {
        el.innerHTML = entry.text;
        return;
      }
      const matches = collectNonOverlappingMatches(entry.lower, scoped);
      el.innerHTML = renderHighlightedHtml(entry.text, matches);
    });
  } catch (e) {
    console.error("[BiblePeruser] phrase highlight apply failed:", e);
  }
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
      if (aside) {
        const _sb = aside.querySelector(".bp-sidebar__scroll-body");
        if (_sb) _sb.innerHTML = "";
        else aside.textContent = "";
      }
      return;
    }
    const chapter = book.chapters.find((c) => c.number === chapterNum);
    if (!chapter) {
      main.innerHTML = `<div class="error">Chapter not found.</div>`;
      if (aside) {
        const _sb = aside.querySelector(".bp-sidebar__scroll-body");
        if (_sb) _sb.innerHTML = "";
        else aside.textContent = "";
      }
      return;
    }
    // Book name mapping from app.js
    let bookName = bookNames[bookId] || bookId;
    let html = `<div class="bp-chapter-header">
      <h2>${bookName} ${chapterNum}</h2>
      <div class="bp-font-controls">
        <span class="bp-font-label-sm" aria-hidden="true">A</span>
        <input type="range" class="bp-font-slider" id="bp-font-slider"
               min="1.0" max="2.0" step="0.1" value="1.0"
               aria-label="Font size">
        <span class="bp-font-label-lg" aria-hidden="true">A</span>
        <button class="bp-font-reset" id="bp-font-reset" title="Reset font size">&#8634;</button>
      </div>
    </div>`;
    // Determine column and font layout
    let columnClass = "";
    let fontClass = "";
    let charCount = 0;
    for (const verse of chapter.verses) {
      charCount += verse.text.length;
    }
    if (window.innerWidth >= 3000) {
      if (charCount <= 2000) columnClass = "center-1";
      else if (charCount <= 3500) columnClass = "center-2";
      else if (charCount <= 6500) columnClass = "center-3";
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
      } else if (charCount > 5600) {
        columnClass = "hd-center-3";
        fontClass = "font-msmall";
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
      html += `<span class="verse-num" data-verse="${verse.n}" data-verse-key="${chapterNum}:${verse.n}">${verse.n}</span> <span class="verse-text" data-verse="${verse.n}" data-verse-key="${chapterNum}:${verse.n}" data-original="${encodeURIComponent(verse.text)}">${verse.text}</span><br>`;
      // Collect words for frequency analysis
      if (!window._chapterWords) window._chapterWords = [];
      window._chapterWords.push(
        ...verse.text
          .split(/[^A-Za-z']+/)
          .map((w) => w.replace(/^'+|'+$/g, ""))
          .filter(Boolean),
      );
    }
    html += "</div>";
    main.innerHTML = html;

    // Wire font-size slider
    (function () {
      const scale = 1.0;
      localStorage.setItem("bpFontScale", "1.0");
      document.documentElement.style.setProperty("--bp-font-scale", scale);
      const slider = document.getElementById("bp-font-slider");
      const reset = document.getElementById("bp-font-reset");
      if (slider) {
        slider.addEventListener("input", () => {
          const v = parseFloat(slider.value);
          document.documentElement.style.setProperty("--bp-font-scale", v);
          localStorage.setItem("bpFontScale", v);
        });
      }
      if (reset) {
        reset.addEventListener("click", () => {
          slider.value = "1.0";
          document.documentElement.style.setProperty("--bp-font-scale", 1.0);
          localStorage.setItem("bpFontScale", "1.0");
        });
      }
    })();

    let chapterVerseTextCache;
    try {
      chapterVerseTextCache = buildVerseTextCache(
        Array.from(document.querySelectorAll(".verse-text[data-original]")),
      );
    } catch (e) {
      console.error("[BiblePeruser] verse cache build failed:", e);
      chapterVerseTextCache = new Map();
    }

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

    // Clear right sidebar scroll body only (keep sticky controls intact)
    const aside = document.querySelector(".bp-sidebar--right");
    if (aside) {
      const _sb = aside.querySelector(".bp-sidebar__scroll-body");
      if (_sb) _sb.innerHTML = "";
      else aside.innerHTML = "";
    }

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
      // Create highlight buttons in right sidebar (clear scroll body only)
      const aside = document.querySelector(".bp-sidebar--right");
      if (aside) {
        const _sb = aside.querySelector(".bp-sidebar__scroll-body");
        if (_sb) _sb.innerHTML = "";
        else aside.innerHTML = "";
      }
      // Re-insert sticky highlight toggle bar if function exists
      if (window.renderStickyHighlightToggle) {
        window.renderStickyHighlightToggle(aside);
      }

      // The first field is always visible; the extra ones only show once
      // the developer's study-note buttons are toggled off (see the
      // html.bp-hide-study-notes CSS), reusing the space that would
      // otherwise be full of highlight-toggle buttons — and giving the
      // Sticky Highlights toggle more than one typed phrase to apply to.
      const EXTRA_CHAPTER_SEARCH_FIELDS = 2;
      const chapterSearchFields = [];
      let chapterSearchField = null;
      if (aside) {
        aside
          .querySelectorAll(
            ".bp-chapter-search-field, .bp-book-search-field, .bp-study-notes-hint, .bp-outline-hint",
          )
          .forEach((el) => el.remove());

        const stickyControls = aside.querySelector(
          ".bp-sidebar-sticky-controls",
        );
        const insertField = (field) => {
          if (stickyControls) {
            stickyControls.appendChild(field);
          } else {
            aside.insertBefore(field, aside.firstChild);
          }
        };

        for (let i = 0; i <= EXTRA_CHAPTER_SEARCH_FIELDS; i++) {
          const field = document.createElement("input");
          field.type = "text";
          field.id =
            i === 0 ? "chapter-search-field" : `chapter-search-field-${i + 1}`;
          field.className =
            i === 0
              ? "bp-chapter-search-field"
              : "bp-chapter-search-field bp-chapter-search-field--extra";
          field.placeholder =
            i === 0 ? "Highlight text..." : `Highlight text ${i + 1}...`;
          field.setAttribute("autocomplete", "off");
          insertField(field);
          chapterSearchFields.push(field);
        }
        chapterSearchField = chapterSearchFields[0];

        const { outlineHint, notesHint } = buildOffToggleHints();
        insertField(outlineHint);
        insertField(notesHint);
      }

      let highlightBar = document.getElementById("chapter-highlight-bar");
      if (!highlightBar && aside) {
        highlightBar = document.createElement("div");
        highlightBar.id = "chapter-highlight-bar";
        highlightBar.style.display = "flex";
        highlightBar.style.flexWrap = "wrap";
        highlightBar.style.gap = "6px";
        highlightBar.style.margin = "12px 0";
        (aside.querySelector(".bp-sidebar__scroll-body") || aside).appendChild(
          highlightBar,
        );
      }
      if (highlightBar) highlightBar.innerHTML = "";
      function autoSelectMatchingChapterTopic(
        chapterNum,
        verseStart,
        verseEnd,
      ) {
        const sidebarTopicBar = document.getElementById("chapter-topic-bar");
        if (!sidebarTopicBar || !verseStart) return;
        const topics = window._lastLoadedTopics;
        const targetChapterTopics =
          (topics &&
            topics.chapterTopics &&
            topics.chapterTopics[chapterNum]) ||
          [];
        const renderableTopics = targetChapterTopics.filter(
          (entry) =>
            entry &&
            Array.isArray(entry.verses) &&
            (typeof entry.label === "string" ||
              typeof entry.outline === "string"),
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
      chapterTopics.forEach((topic, topicIdx) => {
        let btn = null;
        let type = null;
        if (topic.label) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-label-btn";
          decorateTopicButtonWithReferences(
            btn,
            topic.label,
            topic.references,
            topic.links,
            openChapterTopicReference,
            "Click to follow reference",
            undefined,
            {
              title: topic.label,
              verseRef: formatChapterVerseLabel(bookId, chapterNum, topic.verses),
            },
          );
          decorateTopicButtonWithNote(btn, topic.note, "Click to view note");
          decorateTopicButtonWithSuggest(btn, {
            action: "correct",
            scope: "chapter",
            bookId,
            chapterNum,
            entryKind: "label",
            entry: topic,
            entryIndex: topicIdx,
          });
          const emphasisPhrases = normalizePhraseList(topic.emphasis);
          if (emphasisPhrases.length) {
            btn._emphasisPhrases = emphasisPhrases;
            btn._emphasisScopeKeys = new Set(
              expandVerseRangeTokens(topic.verses).map((v) => `${chapterNum}:${v}`),
            );
          }
          type = "label";
        } else if (topic.outline) {
          btn = document.createElement("button");
          btn.className = "topic-btn topic-outline-btn";
          decorateTopicButtonWithReferences(
            btn,
            topic.outline,
            topic.references,
            topic.links,
            openChapterTopicReference,
            "Click to follow reference",
            () => pinTopicButton(btn),
            {
              title: topic.outline,
              verseRef: formatChapterVerseLabel(bookId, chapterNum, topic.verses),
            },
          );
          decorateTopicButtonWithNote(
            btn,
            topic.note,
            "Click to view note",
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
              expandVerseRangeTokens(topic.verses).forEach((v) => {
                document
                  .querySelectorAll(`.verse-num[data-verse='${v}']`)
                  .forEach((el) => el.classList.add("verse-highlight"));
                document
                  .querySelectorAll(`.verse-text[data-verse='${v}']`)
                  .forEach((el) => el.classList.add("verse-highlight"));
              });
            }
            rerenderActiveHighlights();
          };
          if (topicBar) topicBar.appendChild(btn);
        }
      });
      if (topicBar) {
        topicBar.appendChild(
          buildSuggestNewLink("label", { scope: "chapter", bookId, chapterNum }),
        );
        const leftHints = buildOffToggleHints();
        topicBar.appendChild(leftHints.outlineHint);
        topicBar.appendChild(leftHints.notesHint);
      }
      // RIGHT: highlight buttons + typed field (supports sticky multi-select)

      function collectActivePhrases() {
        const entries = [];
        if (highlightBar) {
          highlightBar
            .querySelectorAll(".topic-highlight-btn.active")
            .forEach((activeBtn) => {
              const arr = Array.isArray(activeBtn._highlightPhrases)
                ? activeBtn._highlightPhrases
                : [];
              arr.forEach((p) => {
                if (p) entries.push({ phrase: p, className: "search-highlight", scopeVerseKeys: null });
              });
            });
        }
        chapterSearchFields.forEach((field) => {
          const typedPhrase = getLiteralSearchPhrase(field);
          if (typedPhrase) entries.push({ phrase: typedPhrase, className: "search-highlight", scopeVerseKeys: null });
        });
        const activeLabelBtn = topicBar ? topicBar.querySelector(".topic-label-btn.active") : null;
        if (activeLabelBtn && Array.isArray(activeLabelBtn._emphasisPhrases)) {
          activeLabelBtn._emphasisPhrases.forEach((p) => {
            if (p) {
              entries.push({
                phrase: p,
                className: "emphasis-highlight",
                scopeVerseKeys: activeLabelBtn._emphasisScopeKeys || null,
              });
            }
          });
        }
        return normalizePhraseEntries(entries);
      }

      function rerenderActiveHighlights() {
        applyPhraseHighlightsFromCache(
          chapterVerseTextCache,
          collectActivePhrases(),
        );
      }

      chapterTopics.forEach((topic, topicIdx) => {
        const highlightLabel =
          typeof topic.highlight === "string" ? topic.highlight.trim() : "";
        const highlightPhrases = normalizePhraseList(topic.text);
        if (highlightLabel && highlightPhrases.length && highlightBar) {
          const btn = document.createElement("button");
          btn.appendChild(document.createTextNode(highlightLabel));
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
          decorateTopicButtonWithSuggest(btn, {
            action: "correct",
            scope: "chapter",
            bookId,
            chapterNum,
            entryKind: "highlight",
            entry: topic,
            entryIndex: topicIdx,
          });
          highlightBar.appendChild(btn);
        }
      });
      if (highlightBar) {
        highlightBar.appendChild(
          buildSuggestNewLink("highlight", { scope: "chapter", bookId, chapterNum }),
        );
      }

      chapterSearchFields.forEach((field) => {
        let debounceTimer = null;
        field.addEventListener("input", () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            rerenderActiveHighlights();
          }, 300);
        });
      });

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
      // Looked up by document-wide id, not as a footer descendant — on
      // mobile, bpSyncMobileUi() may already have relocated this row into
      // the bottom drawer's sticky controls before this async callback
      // runs, so it's no longer inside `footer` at all.
      const metaBtnRow = document.getElementById("bp-meta-btn-row") || footer;
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
          " |  Jesus, name above all names!";
      }
      // Reset for next chapter load
      window._chapterWords = [];

      // Timeline / People / Places buttons — each shown only if this
      // chapter has matching data. Buttons persist across chapter loads
      // (footer.innerHTML is never reset), so just toggle visibility.
      const metadata = await getBibleMetadata();
      const chapterKey = `${bookId}_${chapterNum}`;
      const timelineEntries = metadata.timeline.byChapter[chapterKey] || [];
      const peopleEntries = metadata.people.byChapter[chapterKey] || [];
      const placesEntries = metadata.places.byChapter[chapterKey] || [];

      function ensureMetaButton(id, label, entries, onClick) {
        let btn = document.getElementById(id);
        if (!entries.length) {
          if (btn) btn.style.display = "none";
          return;
        }
        if (!btn) {
          btn = document.createElement("button");
          btn.id = id;
          btn.type = "button";
          btn.className = "bp-meta-btn";
          metaBtnRow.appendChild(btn);
        }
        setMetaBtnContent(btn, label);
        btn.style.display = "";
        btn.onclick = onClick;
      }

      // Outline and Notes are created first (and thus always leftmost, in
      // that fixed order) so their position stays stable regardless of
      // which of the content-dependent buttons below happen to show for a
      // given chapter. Book is next — like the first two, it's
      // unconditional (every book has an entry), so it's built with
      // ensureMetaButton passing a non-empty placeholder array rather than
      // the real (always-true) condition.
      ensureOutlineToggle(metaBtnRow);
      ensureStudyNotesToggle(metaBtnRow);
      ensureMetaButton(
        "bp-book-info-btn",
        "\u{1F4D5} Book",
        [true],
        () => openBookModal(bookId, metadata),
      );
      ensureMetaButton(
        "bp-timeline-btn",
        "\u{1F4C5} Timeline",
        timelineEntries,
        () => openTimelineModal(bookId, chapterNum, metadata),
      );
      ensureMetaButton(
        "bp-people-btn",
        "\u{1F464} People",
        peopleEntries,
        () => openPeopleModal(bookId, chapterNum, metadata),
      );
      ensureMetaButton(
        "bp-places-btn",
        "\u{1F4CD} Places",
        placesEntries,
        () => openPlacesModal(bookId, chapterNum, metadata),
      );
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
  if (aside) {
    const _sb = aside.querySelector(".bp-sidebar__scroll-body");
    if (_sb) _sb.innerHTML = "";
    else aside.innerHTML = "";
  }
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
    html.push(`<div class="bp-chapter-header">
      <h2 class="bp-book-view__title">${bookName} (Entire Book)</h2>
      <div class="bp-font-controls">
        <span class="bp-font-label-sm" aria-hidden="true">A</span>
        <input type="range" class="bp-font-slider" id="bp-font-slider"
               min="1.0" max="2.0" step="0.1" value="1.0"
               aria-label="Font size">
        <span class="bp-font-label-lg" aria-hidden="true">A</span>
        <button class="bp-font-reset" id="bp-font-reset" title="Reset font size">&#8634;</button>
        <button class="bp-font-overview" id="bp-font-overview" title="Overview: show entire book at minimum size">Overview</button>
      </div>
    </div>`);
    html.push(
      `<div class="bible-book bible-book--dense book-${bookId.toLowerCase()}">`,
    );
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

    // Wire font-size slider and Overview toggle
    (function () {
      const scale = 1.0;
      localStorage.setItem("bpFontScale", "1.0");
      document.documentElement.style.setProperty("--bp-font-scale", scale);
      const slider = document.getElementById("bp-font-slider");
      const reset = document.getElementById("bp-font-reset");
      const overview = document.getElementById("bp-font-overview");
      const bookDense = main.querySelector(".bible-book.bible-book--dense");

      if (slider) {
        slider.addEventListener("input", () => {
          const v = parseFloat(slider.value);
          document.documentElement.style.setProperty("--bp-font-scale", v);
          localStorage.setItem("bpFontScale", v);
        });
      }
      if (reset) {
        reset.addEventListener("click", () => {
          if (overview) overview.classList.remove("active");
          if (bookDense) bookDense.classList.remove("bp-overview-active");
          if (slider) slider.disabled = false;
          slider.value = "1.0";
          document.documentElement.style.setProperty("--bp-font-scale", 1.0);
          localStorage.setItem("bpFontScale", "1.0");
        });
      }
      if (overview && bookDense) {
        overview.addEventListener("click", () => {
          const isActive = overview.classList.toggle("active");
          if (isActive) {
            bookDense.classList.add("bp-overview-active");
            document.documentElement.style.setProperty("--bp-font-scale", 0.3);
            slider.disabled = true;
          } else {
            bookDense.classList.remove("bp-overview-active");
            const v = parseFloat(slider.value);
            document.documentElement.style.setProperty("--bp-font-scale", v);
            slider.disabled = false;
          }
        });
      }
    })();

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
    const bookWideFile = getBookWideFilename(bookId);
    const legacyTopicFile = getTopicFilename(bookId);
    if (!bookWideFile || !topicBar) return;

    let resp = await fetch(bookWideFile);
    if (!resp.ok && legacyTopicFile) {
      // Backward compatibility for older datasets that still keep book-wide data in topics.
      resp = await fetch(legacyTopicFile);
    }
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
      const entries = [];
      if (bookHighlightBar) {
        bookHighlightBar
          .querySelectorAll(".topic-highlight-btn.active")
          .forEach((activeBtn) => {
            (Array.isArray(activeBtn._highlightPhrases)
              ? activeBtn._highlightPhrases
              : []
            ).forEach((p) => {
              if (p) entries.push({ phrase: p, className: "search-highlight", scopeVerseKeys: null });
            });
          });
      }
      const typedPhrase = getLiteralSearchPhrase(bookSearchField);
      if (typedPhrase) {
        entries.push({ phrase: typedPhrase, className: "search-highlight", scopeVerseKeys: null });
      }
      const activeLabelBtn = topicBar ? topicBar.querySelector(".topic-label-btn.active") : null;
      if (activeLabelBtn && Array.isArray(activeLabelBtn._emphasisPhrases)) {
        activeLabelBtn._emphasisPhrases.forEach((p) => {
          if (p) {
            entries.push({
              phrase: p,
              className: "emphasis-highlight",
              scopeVerseKeys: activeLabelBtn._emphasisScopeKeys || null,
            });
          }
        });
      }
      return normalizePhraseEntries(entries);
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
          outlineEntry.links,
          openBookWideOutlineReference,
          "Click to open referenced book in Entire Book view",
          undefined,
          { title: outlineEntry.outline },
        );
        decorateTopicButtonWithNote(
          btn,
          outlineEntry.note,
          "Click to view note",
        );

        btn.onclick = () => {
          activateBookWideRangeEntry(btn, outlineEntry);
        };
        topicBar.appendChild(btn);
      });
    }

    // ── Left panel: bookWideLabels ────────────────────────────────────────────
    if (bookWideLabels.length) {
      bookWideLabels.forEach((labelEntry, labelIdx) => {
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
          labelEntry.links,
          openBookWideOutlineReference,
          "Click to open referenced book in Entire Book view",
          undefined,
          { title: labelEntry.label },
        );
        decorateTopicButtonWithNote(btn, labelEntry.note, "Click to view note");
        decorateTopicButtonWithSuggest(btn, {
          action: "correct",
          scope: "bookwide",
          bookId,
          chapterNum: null,
          entryKind: "label",
          entry: labelEntry,
          entryIndex: labelIdx,
        });
        if (labelEntry.emphasis) {
          const emphasisPhrases = normalizePhraseList(labelEntry.emphasis);
          if (emphasisPhrases.length) {
            const { verseKeys } = buildBookWideLabelVerseKeys(labelEntry, chapterMaxVerseMap);
            btn._emphasisPhrases = emphasisPhrases;
            btn._emphasisScopeKeys = new Set(verseKeys);
          }
        }
        btn.onclick = () => {
          activateBookWideRangeEntry(btn, labelEntry);
        };
        topicBar.appendChild(btn);
      });
    }
    if (topicBar) {
      topicBar.appendChild(
        buildSuggestNewLink("label", { scope: "bookwide", bookId, chapterNum: null }),
      );
      const leftHints = buildOffToggleHints();
      topicBar.appendChild(leftHints.outlineHint);
      topicBar.appendChild(leftHints.notesHint);
    }

    // ── Right panel: sticky toggle + search field + bookWideHighlights ────────
    let bookHighlightBar = null;
    let bookSearchField = null;

    if (aside) {
      // Sticky toggle (reuse existing renderer from app.js if available)
      if (window.renderStickyHighlightToggle) {
        window.renderStickyHighlightToggle(aside);
      }

      aside
        .querySelectorAll(
          ".bp-chapter-search-field, .bp-book-search-field, .bp-study-notes-hint, .bp-outline-hint",
        )
        .forEach((el) => el.remove());

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
      const { outlineHint, notesHint } = buildOffToggleHints();
      if (stickyControls) {
        stickyControls.appendChild(outlineHint);
        stickyControls.appendChild(notesHint);
      } else {
        aside.appendChild(outlineHint);
        aside.appendChild(notesHint);
      }

      let searchDebounceTimer = null;
      bookSearchField.addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => rerenderBookHighlights(), 300);
      });

      // Highlight buttons from bookWideHighlights (bar always created, even
      // with zero entries, so the "+ Suggest a new highlight" link always
      // has somewhere to live).
      {
        bookHighlightBar = document.createElement("div");
        bookHighlightBar.id = "book-highlight-bar";
        bookHighlightBar.style.cssText =
          "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;";
        (aside.querySelector(".bp-sidebar__scroll-body") || aside).appendChild(
          bookHighlightBar,
        );

        bookWideHighlights.forEach((entry, entryIdx) => {
          const label =
            typeof entry?.highlight === "string" ? entry.highlight.trim() : "";
          const phrases = normalizePhraseList(entry?.text);
          if (!label || !phrases.length) return;
          const btn = document.createElement("button");
          btn.appendChild(document.createTextNode(label));
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
          decorateTopicButtonWithSuggest(btn, {
            action: "correct",
            scope: "bookwide",
            bookId,
            chapterNum: null,
            entryKind: "highlight",
            entry,
            entryIndex: entryIdx,
          });
          bookHighlightBar.appendChild(btn);
        });
        bookHighlightBar.appendChild(
          buildSuggestNewLink("highlight", {
            scope: "bookwide",
            bookId,
            chapterNum: null,
          }),
        );

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
    (aside.querySelector(".bp-sidebar__scroll-body") || aside).appendChild(
      highlightBar,
    );
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

function getBookWideFilename(bid) {
  const idx = bookOrder.indexOf(bid);
  if (idx === -1) return null;
  const num = (idx + 1).toString().padStart(3, "0");
  return `data/bookwide/${num}_${bid}_BSB.json`;
}

function parseChapterDeepLink() {
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search || "");
  const rawBook = (params.get("book") || "").trim().toUpperCase();
  const rawChapter = (params.get("chapter") || "").trim();
  if (!rawBook || !rawChapter) return null;

  if (!bookOrder.includes(rawBook)) return null;

  const chapterNum = parseInt(rawChapter, 10);
  if (!Number.isInteger(chapterNum) || chapterNum < 1) return null;

  return { bookId: rawBook, chapterNum };
}

function buildChapterUrl(bookId, chapterNum) {
  const normalizedBook = String(bookId || "").toUpperCase();
  const normalizedChapter = parseInt(chapterNum, 10);
  if (!bookOrder.includes(normalizedBook)) return null;
  if (!Number.isInteger(normalizedChapter) || normalizedChapter < 1)
    return null;
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "";
  const path =
    typeof window !== "undefined" && window.location
      ? window.location.pathname
      : "/";
  return `${origin}${path}?book=${normalizedBook}&chapter=${normalizedChapter}`;
}

// Optionally, call on load
if (typeof window !== "undefined") {
  window.loadBibleChapter = loadBibleChapter;
  window.loadBibleBook = loadBibleBook;
  window.buildBibleChapterUrl = buildChapterUrl;
  window.bookNames = bookNames;
  window.bookOrder = bookOrder;
  window.parseBookChapterInput = parseBookChapterInput;
  window.bookNameFor = (id) => bookNames[id] || id;
  document.addEventListener("DOMContentLoaded", () => {
    let bookId = "MAT";
    let chapterNum = 1;
    const deepLink = parseChapterDeepLink();
    if (deepLink) {
      bookId = deepLink.bookId;
      chapterNum = deepLink.chapterNum;
    } else if (window.localStorage) {
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
    maybeResumeSuggestDraft();
    initAccountWidget();
  });
}
