# Bible Peruser

Bible Peruser supports chapter deep links using URL query parameters.

## Quick Linking

Use this format:

`https://your-domain/path/?book=MAT&chapter=5`

Parameters:

- `book`: 3-character Bible book abbreviation (see full list in `docs/linking.md`)
- `chapter`: positive integer (`1`, `2`, ...)

Examples:

- `/?book=GEN&chapter=1`
- `/?book=PSA&chapter=23`
- `/?book=JHN&chapter=3`
- `/?book=REV&chapter=22`

## Full Documentation

See `docs/linking.md` for:

- full link specification
- full 66-book abbreviation list
- validation behavior and notes
