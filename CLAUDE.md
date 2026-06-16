# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bible Peruser** is a vanilla JavaScript/HTML/CSS Bible study web app hosted at https://bible-peruser.gospelgo.org. No build step is required — it's a static site. The "Unity Projects/Builds" path is just the host machine's folder convention; this is not a Unity project.

## Development

No build pipeline. Open `index.html` in a browser or serve the directory with any static file server:

```
npx serve .
# or
python -m http.server 8080
```

The only tooled script is `js/usfm-outline-extractor.js`, a standalone Node.js utility that parses `.sfm` source files from `sfm/` and generates topic JSON output. Run it directly with Node when regenerating topic data from USFM sources.

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `js/app.js` | UI orchestration: book scrollbar, chapter nav, jump form, sticky header |
| `js/bible-loader.js` | Core rendering: chapter display, column layout, highlight system, reference menus, note popups |
| `js/bible-utils.js` | Constants and localStorage helpers: book name/alias mappings, last-read position |
| `css/style.css` | Dark theme, responsive multi-column layout |

### Data Layer

**`data/bible.json`** (6.4 MB) — Full Berean Standard Bible:
```json
{ "books": [{ "id": "MAT", "chapterCount": 28, "chapters": [{ "number": 1, "verses": [{ "n": "1", "text": "..." }] }] }] }
```

**`data/topics/NNN_BOOKID_BSB.json`** — Chapter-level study outlines (one file per book):
```json
{
  "chapterTopics": {
    "1": [
      {
        "outline": "Section heading",
        "verses": ["1-5", "7"],
        "references": ["John 1:1-5"],
        "note": "Optional explanatory text"
      }
    ]
  }
}
```

Topic entry fields: `outline` (or `label`), `verses` (string array of ranges), `references`, `note`, `highlight`, `text`.

**`data/bookwide/`** — Optional book-wide highlights and labels.

### Rendering & Layout

`bible-loader.js` drives the responsive column layout:
- **< 900px**: Mobile overlay (no study view)
- **900–2999px**: 2–3 columns, font size determined by chapter character count
- **≥ 3000px**: 1–4 columns, 4K-optimized typography

Column count and font-size class (`font-small`, `font-xsmall`, etc.) are computed from character count per chapter in the `getLayoutConfig()` path around line 420.

### State

`localStorage` keys: `bibleLastBook`, `bibleLastChapter`, `bookBarScroll`, `bpEntireBookOrigin`, `bibleAppTheme`.

Window globals for cross-module state: `window._currentBookId`, `window._currentChapterNum`, `window._currentViewMode` (`"chapter"` | `"entireBook"`), `window._lastLoadedTopics`.

### URL / Deep Linking

```
?book=MAT&chapter=5    → Matthew 5
?book=PSA&chapter=23   → Psalm 23
```

All 66 books use standard 3-letter USFM abbreviations. `parseBookChapterInput()` in `bible-utils.js` handles flexible user input (e.g., `"mat4"`, `"4th matthew"`, `"Matthew 4"`).

## Active Study Content

The project is under active development with chapter-by-chapter study notes. Matthew (`data/topics/040_MAT_BSB.json`) is the most recently updated book. When editing topic files, match the existing JSON schema exactly — the renderer depends on field names.
