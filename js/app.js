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
  // Mobile overlay actions
  const copyBtn = document.getElementById("bp-copy-btn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText("https://bible-peruser.gospelgo.org");
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy Address";
      }, 1500);
    };
  }
  const shareBtn = document.getElementById("bp-share-btn");
  if (shareBtn) {
    shareBtn.onclick = async () => {
      if (navigator.share) {
        await navigator.share({
          title: "Bible Peruser",
          url: "https://bible-peruser.gospelgo.org",
        });
      } else {
        window.open("https://bible-peruser.gospelgo.org", "_blank");
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

  // Navigation and sticky chapter nav
  const nav = document.querySelector(".bp-sidebar--left");
  if (nav) {
    nav.innerHTML = `
            <div class="chapter-nav-sticky" style="flex-direction:column;align-items:center;">
                <div style="display:flex;justify-content:center;align-items:center;width:100%;">
                    <button id="prev-chapter-btn" disabled>&lt;CH</button>
                    <button id="next-chapter-btn" disabled>CH&gt;</button>
                </div>
                <select id="chapter-dropdown" style="margin-top:8px;padding:4px 12px;border-radius:4px;background:var(--bg-sidebar);color:var(--text-main);border:1px solid var(--accent);font-size:1em;width:90%;max-width:220px;"></select>
            </div>
            <div id="chapter-topic-bar" style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0;"></div>
        `;
  }
  // Populate chapter dropdown after chapter loads
  window.updateChapterDropdown = function (bookId, chapterNum, chapterCount) {
    const dropdown = document.getElementById("chapter-dropdown");
    if (dropdown) {
      dropdown.innerHTML = "";
      for (let i = 1; i <= chapterCount; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = "Chapter " + i;
        if (i === chapterNum) opt.selected = true;
        dropdown.appendChild(opt);
      }
      dropdown.onchange = function () {
        if (window.loadBibleChapter) {
          window.loadBibleChapter(bookId, parseInt(dropdown.value, 10));
        }
      };
    }
  };
  // Listen for chapter changes to update nav buttons
  window.updateChapterNav = function (bookId, chapterNum, chapterCount) {
    const prevBtn = document.getElementById("prev-chapter-btn");
    const nextBtn = document.getElementById("next-chapter-btn");
    if (prevBtn) {
      prevBtn.disabled = chapterNum <= 1;
      prevBtn.onclick = prevBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum - 1);
    }
    if (nextBtn) {
      nextBtn.disabled = chapterNum >= chapterCount;
      nextBtn.onclick = nextBtn.disabled
        ? null
        : () => window.loadBibleChapter(bookId, chapterNum + 1);
    }
  };

  // Placeholder: Notes/context
  const aside = document.querySelector(".bp-sidebar--right");
  if (aside) {
    aside.innerHTML = `<strong>Notes:</strong><br>Click a book to navigate.`;
  }
});
