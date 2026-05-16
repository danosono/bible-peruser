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

## Full Documentation

See `docs/linking.md` for:

- full link specification
- full 66-book abbreviation list
- validation behavior and notes
