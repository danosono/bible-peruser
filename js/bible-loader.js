// js/bible-loader.js - loads a chapter from bible.json and displays it in <main>

async function loadBibleChapter(bookId = "GEN", chapterNum = 1) {
    const main = document.querySelector('.bp-main');
    const aside = document.querySelector('.bp-sidebar--right');
    if (!main) return;
    main.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const response = await fetch('data/bible.json');
        const data = await response.json();
        const book = data.books.find(b => b.id === bookId);
        if (!book) {
            main.innerHTML = `<div class="error">Book not found.</div>`;
            if (aside) aside.textContent = '';
            return;
        }
        const chapter = book.chapters.find(c => c.number === chapterNum);
        if (!chapter) {
            main.innerHTML = `<div class="error">Chapter not found.</div>`;
            if (aside) aside.textContent = '';
            return;
        }
        let html = `<h2>${bookId} ${chapterNum}</h2><div class="bible-chapter">`;
        let charCount = 0;
        for (const verse of chapter.verses) {
            html += `<span class="verse-num">${verse.n}</span> <span class="verse-text">${verse.text}</span><br>`;
            charCount += verse.text.length;
        }
        html += '</div>';
        main.innerHTML = html;
        if (aside) {
            aside.innerHTML = `<strong>Notes:</strong><br>Current chapter character count: <b>${charCount}</b>`;
        }
        // Save last location to localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('bibleLastBook', bookId);
            localStorage.setItem('bibleLastChapter', chapterNum);
        }
        // Update sticky nav buttons
        if (window.updateChapterNav) {
            window.updateChapterNav(bookId, chapterNum, book.chapterCount);
        }
    } catch (e) {
        main.innerHTML = `<div class="error">Failed to load Bible data.</div>`;
        if (aside) aside.textContent = '';
    }
}

// Optionally, call on load
if (typeof window !== 'undefined') {
    window.loadBibleChapter = loadBibleChapter;
    document.addEventListener('DOMContentLoaded', () => {
        let bookId = "GEN";
        let chapterNum = 1;
        if (window.localStorage) {
            const lastBook = localStorage.getItem('bibleLastBook');
            const lastChapter = localStorage.getItem('bibleLastChapter');
            if (lastBook && lastChapter) {
                bookId = lastBook;
                chapterNum = parseInt(lastChapter, 10) || 1;
            }
        }
        loadBibleChapter(bookId, chapterNum);
    });
}
