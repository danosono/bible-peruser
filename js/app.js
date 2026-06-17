// js/app.js - Bible Peruser

function bpGetBreakpoint() {
  const w = window.innerWidth;
  if (w < 900) return "mobile";
  if (w >= 3000) return "ultrawide";
  return "hd";
}

function bpHandleBreakpoint() {
  const bp = bpGetBreakpoint();
  // Example: add logic for each breakpoint
  if (bp === "mobile") {
    // Mobile/tablet overlay is handled by CSS
  } else if (bp === "hd") {
    // HD rules (900px - 2999px)
    // Add JS logic for HD screens here
  } else if (bp === "ultrawide") {
    // Ultra-wide rules (>=3000px)
    // Add JS logic for ultra-wide screens here
  }
}

window.addEventListener("resize", bpHandleBreakpoint);

document.addEventListener("DOMContentLoaded", () => {
  let bpBibleDataPromise = null;

  function getBibleDataForJump() {
    if (!bpBibleDataPromise) {
      bpBibleDataPromise = fetch("data/bible.json").then((r) => {
        if (!r.ok) throw new Error("Failed to load bible.json");
        return r.json();
      });
    }
    return bpBibleDataPromise;
  }

  async function getChapterCountForBook(bookId) {
    const data = await getBibleDataForJump();
    const book = Array.isArray(data?.books)
      ? data.books.find((b) => b.id === bookId)
      : null;
    if (!book) return null;
    if (Number.isInteger(book.chapterCount) && book.chapterCount > 0) {
      return book.chapterCount;
    }
    if (Array.isArray(book.chapters)) {
      return book.chapters.length;
    }
    return null;
  }

  function normalizeBookAlias(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  // Update the selected book button in the horizontal scrollbar
  function updateBookScrollbar(bookId) {
    const bookBar = document.getElementById("bp-book-scrollbar");
    if (!bookBar) return;
    bookBar.querySelectorAll(".bp-book-scrollbar__btn").forEach((btn) => {
      if (btn.dataset.book === bookId) {
        btn.classList.add("selected");
        // Optionally scroll into view
        btn.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      } else {
        btn.classList.remove("selected");
      }
    });
  }
  // Expose updateBookScrollbar globally
  window.updateBookScrollbar = updateBookScrollbar;
  // --- Back/Forward Navigation Buttons ---
  const backBtn = document.getElementById("bp-nav-back");
  const forwardBtn = document.getElementById("bp-nav-forward");
  function updateNavButtons() {
    if (backBtn) backBtn.disabled = window.history.length <= 1;
    if (forwardBtn) forwardBtn.disabled = false;
    // Always show pointer cursor for forward
    forwardBtn.style.cursor = "pointer";
  }
  if (backBtn && forwardBtn) {
    backBtn.onclick = () => window.history.back();
    forwardBtn.onclick = () => window.history.forward();
    window.addEventListener("popstate", (e) => {
      // Only reload chapter if state exists
      if (
        e.state &&
        e.state.bookId &&
        e.state.chapterNum &&
        window.loadBibleChapter
      ) {
        window.loadBibleChapter(e.state.bookId, e.state.chapterNum, false);
      }
      updateNavButtons();
    });
    updateNavButtons();
  }
  bpHandleBreakpoint();

  function getCurrentChapterLink() {
    const bookId = window._currentBookId;
    const chapterNum = window._currentChapterNum;
    if (
      window.buildBibleChapterUrl &&
      typeof bookId === "string" &&
      Number.isInteger(chapterNum)
    ) {
      const builtUrl = window.buildBibleChapterUrl(bookId, chapterNum);
      if (builtUrl) return builtUrl;
    }
    return window.location.href;
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
  }

  function flashButtonText(button, nextText, defaultText, ms = 1500) {
    if (!button) return;
    button.textContent = nextText;
    setTimeout(() => {
      button.textContent = defaultText;
    }, ms);
  }

  const desktopCopyLinkBtn = document.getElementById("bp-copy-link-btn");
  if (desktopCopyLinkBtn) {
    desktopCopyLinkBtn.onclick = async () => {
      try {
        await copyTextToClipboard(getCurrentChapterLink());
        flashButtonText(desktopCopyLinkBtn, "Copied!", "Copy Link");
      } catch {
        flashButtonText(desktopCopyLinkBtn, "Copy Failed", "Copy Link", 1800);
      }
    };
  }

  // Mobile overlay actions
  const copyBtn = document.getElementById("bp-copy-btn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await copyTextToClipboard(getCurrentChapterLink());
        flashButtonText(copyBtn, "Copied!", "Copy Address");
      } catch {
        flashButtonText(copyBtn, "Copy Failed", "Copy Address", 1800);
      }
    };
  }
  const shareBtn = document.getElementById("bp-share-btn");
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const chapterUrl = getCurrentChapterLink();
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Bible Peruser",
            url: chapterUrl,
          });
        } catch {
          // User cancel or share failure; keep silent.
        }
      } else {
        window.open(chapterUrl, "_blank");
      }
    };
  }
  // Set current date in header
  const dateElem = document.getElementById("current-date");
  if (dateElem) {
    const now = new Date();
    dateElem.textContent = now.toLocaleDateString();
  }

  // Book list for 66 books (id, short name)
  const books = [
    { id: "GEN", name: "Genesis" },
    { id: "EXO", name: "Exodus" },
    { id: "LEV", name: "Leviticus" },
    { id: "NUM", name: "Numbers" },
    { id: "DEU", name: "Deuteronomy" },
    { id: "JOS", name: "Joshua" },
    { id: "JDG", name: "Judges" },
    { id: "RUT", name: "Ruth" },
    { id: "1SA", name: "1 Samuel" },
    { id: "2SA", name: "2 Samuel" },
    { id: "1KI", name: "1 Kings" },
    { id: "2KI", name: "2 Kings" },
    { id: "1CH", name: "1 Chronicles" },
    { id: "2CH", name: "2 Chronicles" },
    { id: "EZR", name: "Ezra" },
    { id: "NEH", name: "Nehemiah" },
    { id: "EST", name: "Esther" },
    { id: "JOB", name: "Job" },
    { id: "PSA", name: "Psalms" },
    { id: "PRO", name: "Proverbs" },
    { id: "ECC", name: "Ecclesiastes" },
    { id: "SNG", name: "Song of Songs" },
    { id: "ISA", name: "Isaiah" },
    { id: "JER", name: "Jeremiah" },
    { id: "LAM", name: "Lamentations" },
    { id: "EZK", name: "Ezekiel" },
    { id: "DAN", name: "Daniel" },
    { id: "HOS", name: "Hosea" },
    { id: "JOL", name: "Joel" },
    { id: "AMO", name: "Amos" },
    { id: "OBA", name: "Obadiah" },
    { id: "JON", name: "Jonah" },
    { id: "MIC", name: "Micah" },
    { id: "NAM", name: "Nahum" },
    { id: "HAB", name: "Habakkuk" },
    { id: "ZEP", name: "Zephaniah" },
    { id: "HAG", name: "Haggai" },
    { id: "ZEC", name: "Zechariah" },
    { id: "MAL", name: "Malachi" },
    { id: "MAT", name: "Matthew" },
    { id: "MRK", name: "Mark" },
    { id: "LUK", name: "Luke" },
    { id: "JHN", name: "John" },
    { id: "ACT", name: "Acts" },
    { id: "ROM", name: "Romans" },
    { id: "1CO", name: "1 Corinthians" },
    { id: "2CO", name: "2 Corinthians" },
    { id: "GAL", name: "Galatians" },
    { id: "EPH", name: "Ephesians" },
    { id: "PHP", name: "Philippians" },
    { id: "COL", name: "Colossians" },
    { id: "1TH", name: "1 Thessalonians" },
    { id: "2TH", name: "2 Thessalonians" },
    { id: "1TI", name: "1 Timothy" },
    { id: "2TI", name: "2 Timothy" },
    { id: "TIT", name: "Titus" },
    { id: "PHM", name: "Philemon" },
    { id: "HEB", name: "Hebrews" },
    { id: "JAS", name: "James" },
    { id: "1PE", name: "1 Peter" },
    { id: "2PE", name: "2 Peter" },
    { id: "1JN", name: "1 John" },
    { id: "2JN", name: "2 John" },
    { id: "3JN", name: "3 John" },
    { id: "JUD", name: "Jude" },
    { id: "REV", name: "Revelation" },
  ];

  const bookNameById = books.reduce((acc, book) => {
    acc[book.id] = book.name;
    return acc;
  }, {});

  function buildBookAliasMap(bookList) {
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

    bookList.forEach(({ id, name }) => {
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

  const bookAliasMap = buildBookAliasMap(books);

  function parseBookChapterInput(rawInput) {
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

  // Populate book scrollbar
  const bookBar = document.getElementById("bp-book-scrollbar");
  if (bookBar) {
    bookBar.innerHTML = books
      .map(
        (b) =>
          `<button class="bp-book-scrollbar__btn" data-book="${b.id}">${b.name}</button>`,
      )
      .join("");
    // Select first by default
    bookBar.querySelector(".bp-book-scrollbar__btn").classList.add("selected");
    // Restore scroll position if available
    const scrollPos = localStorage.getItem("bookBarScroll");
    if (scrollPos) {
      bookBar.scrollLeft = parseInt(scrollPos, 10);
    }

    // Enable horizontal scrolling with mouse wheel
    bookBar.addEventListener(
      "wheel",
      function (e) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          bookBar.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );
  }

  // Book button click handler
  if (bookBar) {
    bookBar.addEventListener("click", (e) => {
      if (e.target.classList.contains("bp-book-scrollbar__btn")) {
        // Remove previous selection
        bookBar
          .querySelectorAll(".bp-book-scrollbar__btn")
          .forEach((btn) => btn.classList.remove("selected"));
        e.target.classList.add("selected");
        // Load first chapter of selected book
        if (window.loadBibleChapter) {
          window.loadBibleChapter(e.target.dataset.book, 1);
        }
      }
    });
    // Save scroll position on scroll
    bookBar.addEventListener("scroll", () => {
      localStorage.setItem("bookBarScroll", bookBar.scrollLeft);
    });
  }

  const headerJumpForm = document.getElementById("bp-header-jump-form");
  const headerJumpInput = document.getElementById("bp-header-jump-input");
  let jumpErrorTimer = null;

  function clearHeaderJumpError() {
    if (!headerJumpInput) return;
    headerJumpInput.classList.remove("bp-header__jump-input--error");
    headerJumpInput.removeAttribute("title");
  }

  function setHeaderJumpError(message) {
    if (!headerJumpInput) return;
    if (jumpErrorTimer) clearTimeout(jumpErrorTimer);
    headerJumpInput.classList.add("bp-header__jump-input--error");
    headerJumpInput.title = message;
    jumpErrorTimer = setTimeout(() => {
      clearHeaderJumpError();
    }, 2200);
  }

  async function submitHeaderJump() {
    if (!headerJumpInput) return;
    const parsed = parseBookChapterInput(headerJumpInput.value);
    if (!parsed.ok) {
      setHeaderJumpError(parsed.reason);
      return;
    }

    let maxChapter;
    try {
      maxChapter = await getChapterCountForBook(parsed.bookId);
    } catch {
      setHeaderJumpError("Unable to verify chapter count right now.");
      return;
    }

    if (!Number.isInteger(maxChapter) || maxChapter < 1) {
      setHeaderJumpError("Book data unavailable.");
      return;
    }

    if (parsed.chapterNum > maxChapter) {
      const bookLabel = bookNameById[parsed.bookId] || parsed.bookId;
      setHeaderJumpError(`${bookLabel} has ${maxChapter} chapters.`);
      return;
    }

    clearHeaderJumpError();
    headerJumpInput.value = "";
    if (window.loadBibleChapter) {
      window.loadBibleChapter(parsed.bookId, parsed.chapterNum);
    }
    if (window.updateBookScrollbar) {
      window.updateBookScrollbar(parsed.bookId);
    }
  }

  if (headerJumpInput) {
    headerJumpInput.addEventListener("input", clearHeaderJumpError);
  }
  if (headerJumpForm) {
    headerJumpForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitHeaderJump();
    });
  }

  // Navigation and sticky chapter nav
  const nav = document.querySelector(".bp-sidebar--left");
  if (nav) {
    nav.innerHTML = `
            <div class="chapter-nav-sticky" style="flex-direction:column;align-items:center;">
                <button id="entire-book-btn" style="margin-top:8px;width:90%;max-width:220px;">Entire Book</button>
          <select id="chapter-dropdown" style="margin-top:8px;padding:4px 12px;border-radius:4px;background:var(--bg-sidebar);color:var(--text-main);border:1px solid var(--accent);font-size:1em;width:90%;max-width:220px;"></select>
          <div style="display:flex;justify-content:center;align-items:center;width:100%;margin-top:8px;">
            <button id="prev-chapter-btn" disabled>&lt;CH</button>
            <button id="next-chapter-btn" disabled>CH&gt;</button>
          </div>
            </div>
            <div id="chapter-topic-bar" style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0;"></div>
        `;
  }

  function updateEntireBookButton(mode) {
    const btn = document.getElementById("entire-book-btn");
    if (!btn) return;
    btn.textContent =
      mode === "entireBook" ? "Exit Entire Book" : "Entire Book";
  }
  window.updateEntireBookButton = updateEntireBookButton;

  function setEntireBookOrigin(origin) {
    if (!origin || !origin.bookId || !origin.chapterNum) return;
    window._entireBookOrigin = {
      bookId: origin.bookId,
      chapterNum: origin.chapterNum,
    };
    window._chapterBeforeEntireBook = origin.chapterNum;
    localStorage.setItem(
      "bpChapterBeforeEntireBook",
      String(origin.chapterNum),
    );
    localStorage.setItem(
      "bpEntireBookOrigin",
      JSON.stringify(window._entireBookOrigin),
    );
  }

  function getEntireBookOrigin() {
    if (
      window._entireBookOrigin &&
      window._entireBookOrigin.bookId &&
      Number.isInteger(window._entireBookOrigin.chapterNum)
    ) {
      return window._entireBookOrigin;
    }
    const raw = localStorage.getItem("bpEntireBookOrigin");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.bookId && Number.isInteger(parsed.chapterNum)) {
        window._entireBookOrigin = parsed;
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  function updateBookViewNavButtons() {
    // Intentionally kept as a no-op to preserve compatibility with bible-loader hooks.
  }
  window.updateBookViewNavButtons = updateBookViewNavButtons;

  const entireBookBtn = document.getElementById("entire-book-btn");
  if (entireBookBtn) {
    entireBookBtn.onclick = () => {
      const currentBook = window._currentBookId || "MAT";
      if (window._currentViewMode === "entireBook") {
        const origin = getEntireBookOrigin();
        const targetBook = origin?.bookId || currentBook;
        const currentChapter =
          origin?.chapterNum ||
          Number.parseInt(window._chapterBeforeEntireBook, 10) ||
          window._currentChapterNum ||
          1;
        window._bookViewHistoryStack = [];
        window._bookViewHistoryIndex = -1;
        updateBookViewNavButtons();
        if (window.loadBibleChapter) {
          window.loadBibleChapter(targetBook, currentChapter, false);
        }
        return;
      }
      setEntireBookOrigin({
        bookId: currentBook,
        chapterNum: window._currentChapterNum || 1,
      });
      if (window.loadBibleBook) {
        window.loadBibleBook(currentBook);
      }
    };
  }
  updateEntireBookButton(window._currentViewMode || "chapter");

  // Populate chapter dropdown after chapter loads
  window.updateChapterDropdown = function (bookId, chapterNum, chapterCount) {
    const dropdown = document.getElementById("chapter-dropdown");
    if (dropdown) {
      const inBookMode = window._currentViewMode === "entireBook";
      dropdown.innerHTML = "";
      for (let i = 1; i <= chapterCount; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = "Chapter " + i;
        if (i === chapterNum) opt.selected = true;
        dropdown.appendChild(opt);
      }
      dropdown.disabled = inBookMode;
      dropdown.onchange = function () {
        if (window._currentViewMode === "entireBook") return;
        if (window.loadBibleChapter) {
          window.loadBibleChapter(bookId, parseInt(dropdown.value, 10));
        }
      };
    }
  };
  // Listen for chapter changes to update nav buttons
  window.updateChapterNav = function (bookId, chapterNum, chapterCount) {
    const inBookMode = window._currentViewMode === "entireBook";
    // Sidebar chapter buttons
    const prevBtn = document.getElementById("prev-chapter-btn");
    const nextBtn = document.getElementById("next-chapter-btn");
    if (prevBtn) {
      prevBtn.disabled = inBookMode || chapterNum <= 1;
      prevBtn.onclick = prevBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum - 1);
    }
    if (nextBtn) {
      nextBtn.disabled = inBookMode || chapterNum >= chapterCount;
      nextBtn.onclick = nextBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum + 1);
    }
    // Header chapter buttons
    const headerPrevChapterBtn = document.getElementById("bp-chapter-prev");
    const headerNextChapterBtn = document.getElementById("bp-chapter-next");
    if (headerPrevChapterBtn) {
      headerPrevChapterBtn.disabled = inBookMode || chapterNum <= 1;
      headerPrevChapterBtn.onclick = headerPrevChapterBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum - 1);
    }
    if (headerNextChapterBtn) {
      headerNextChapterBtn.disabled = inBookMode || chapterNum >= chapterCount;
      headerNextChapterBtn.onclick = headerNextChapterBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum + 1);
    }
    updateEntireBookButton(window._currentViewMode || "chapter");
    updateBookViewNavButtons();
  };

  // Placeholder: Notes/context
  function renderStickyHighlightToggle(aside) {
    if (!aside) return;
    let stickyControls = aside.querySelector(".bp-sidebar-sticky-controls");
    if (!stickyControls) {
      stickyControls = document.createElement("div");
      stickyControls.className = "bp-sidebar-sticky-controls";
      aside.prepend(stickyControls);
    } else if (aside.firstChild !== stickyControls) {
      aside.insertBefore(stickyControls, aside.firstChild);
    }

    // Only add if not already present
    if (!stickyControls.querySelector(".sticky-highlight-toggle-bar")) {
      const toggleBar = document.createElement("div");
      toggleBar.className = "sticky-highlight-toggle-bar";
      toggleBar.innerHTML = `
        <label class="sticky-highlight-toggle-label">
          <input type="checkbox" id="sticky-highlight-toggle" />
          <span>Sticky Highlights</span>
        </label>
      `;
      stickyControls.appendChild(toggleBar);
      // Restore toggle state from localStorage
      const stickyToggle = toggleBar.querySelector("#sticky-highlight-toggle");
      if (stickyToggle) {
        const stickyState =
          localStorage.getItem("stickyHighlightMode") === "true";
        stickyToggle.checked = stickyState;
        stickyToggle.addEventListener("change", () => {
          localStorage.setItem(
            "stickyHighlightMode",
            stickyToggle.checked ? "true" : "false",
          );
        });
      }
    }
  }

  // Call this whenever you update the right sidebar content
  function ensureStickyToggleInSidebar() {
    const aside = document.querySelector(".bp-sidebar--right");
    renderStickyHighlightToggle(aside);
  }

  // Initial render
  ensureStickyToggleInSidebar();
  // Expose for other modules (e.g., bible-loader.js)
  window.renderStickyHighlightToggle = renderStickyHighlightToggle;
});
