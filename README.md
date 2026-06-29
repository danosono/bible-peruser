# Bible Peruser

Bible Peruser supports chapter deep links using URL query parameters.

## Quick Linking

Use this format:

`https://your-domain/?book=MAT&chapter=5`

Production example:

`https://bible-peruser.gospelgo.org/?book=MIC&chapter=1`

If the app is hosted in a subfolder, use that folder path:

`https://your-domain/your-app-path/?book=MAT&chapter=5`

Parameters:

- `book`: 3-character Bible book abbreviation (see full list in `docs/linking.md`)
- `chapter`: positive integer (`1`, `2`, ...)

Examples:

- `https://bible-peruser.gospelgo.org/?book=GEN&chapter=1`
- `https://bible-peruser.gospelgo.org/?book=PSA&chapter=23`
- `https://bible-peruser.gospelgo.org/?book=JHN&chapter=3`
- `https://bible-peruser.gospelgo.org/?book=REV&chapter=22`

## Debug Panel

A diagnostic overlay for troubleshooting layout and JavaScript errors on any device.

**Turn on** — add `debug=1` to the URL:

```
# Starting fresh (no existing params):
https://bible-peruser.gospelgo.org/?debug=1

# Already have book/chapter params — use & not ?:
https://bible-peruser.gospelgo.org/?book=MAT&chapter=3&debug=1
```

The panel appears in the bottom-left corner and shows:
- `DPR` — device pixel ratio (1.5 = Windows 150% display scale)
- Viewport width × height in CSS pixels
- Current breakpoint (`mobile` / `hd` / `ultrawide`)
- Any JavaScript errors in red as they occur

The debug flag persists via `sessionStorage` for the rest of the browser session, so it survives chapter navigation.

**Turn off** — click `[x] close debug` in the panel, or run in the browser console:

```js
sessionStorage.removeItem("_bpDebug")
```

Then refresh the page.

> **Note:** `?debug=1` at the end of an existing URL (double `?`) still works — the app detects it — but the correct format is `&debug=1` when other params are already present.

## Full Documentation

See `docs/linking.md` for:

- full link specification
- full 66-book abbreviation list
- validation behavior and notes

## Topic Notes Quick Reference

Topic metadata for each chapter lives in files like `data/topics/040_MAT_BSB.json` under:

- `chapterTopics` -> chapter number -> `topics`

To add a note on a label item, include a `note` field on that label object:

```json
{
  "label": "carcass / vultures",
  "verses": ["28"],
  "note": "It is obvious that there is a carcass when you see the birds circling..."
}
```

If you also want it searchable as a highlight, add a separate highlight object:

```json
{
  "highlight": "carcass / vultures",
  "text": ["wherever there is a carcass, there the vultures will gather"]
}
```

## Sibling Project Link (Header)

Bible Peruser includes a compact desktop header link to sibling project Bible Explorer:

- URL: `https://bible-explorer.gospelgo.org/`
- Placement: between Copy Link and Berean Standard Bible in the right header control group
- Label: `Bible Explorer` (text-only, no icon)

Implementation files:

- `index.html` (`.bp-header__right` link markup)
- `css/style.css` (`.bp-header__explorer-link` and responsive spacing for HD/4K)
