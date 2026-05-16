# Bible Peruser Linking Guide

This app supports chapter-level deep links via query parameters.

## URL Format

Use this URL pattern:

`https://your-domain/?book=BOOK&chapter=CHAPTER`

Example:

`https://bible-peruser.gospelgo.org/?book=MAT&chapter=5`

If you deploy in a subfolder, include that subfolder in the path:

`https://your-domain/your-app-path/?book=BOOK&chapter=CHAPTER`

## Parameters

- `book`: required, one of the supported 3-character abbreviations listed below
- `chapter`: required, positive integer

If either value is missing or invalid, the app falls back to its default initial chapter.

## Supported 66 Book Abbreviations

Use these exact values for `book`:

- `GEN`
- `EXO`
- `LEV`
- `NUM`
- `DEU`
- `JOS`
- `JDG`
- `RUT`
- `1SA`
- `2SA`
- `1KI`
- `2KI`
- `1CH`
- `2CH`
- `EZR`
- `NEH`
- `EST`
- `JOB`
- `PSA`
- `PRO`
- `ECC`
- `SNG`
- `ISA`
- `JER`
- `LAM`
- `EZK`
- `DAN`
- `HOS`
- `JOL`
- `AMO`
- `OBA`
- `JON`
- `MIC`
- `NAM`
- `HAB`
- `ZEP`
- `HAG`
- `ZEC`
- `MAL`
- `MAT`
- `MRK`
- `LUK`
- `JHN`
- `ACT`
- `ROM`
- `1CO`
- `2CO`
- `GAL`
- `EPH`
- `PHP`
- `COL`
- `1TH`
- `2TH`
- `1TI`
- `2TI`
- `TIT`
- `PHM`
- `HEB`
- `JAS`
- `1PE`
- `2PE`
- `1JN`
- `2JN`
- `3JN`
- `JUD`
- `REV`

## Practical Examples

- Start users in Matthew 5: `https://bible-peruser.gospelgo.org/?book=MAT&chapter=5`
- Start users in Psalm 23: `https://bible-peruser.gospelgo.org/?book=PSA&chapter=23`
- Start users in John 3: `https://bible-peruser.gospelgo.org/?book=JHN&chapter=3`
- Start users in Revelation 22: `https://bible-peruser.gospelgo.org/?book=REV&chapter=22`

## Notes

- Abbreviations should be uppercase.
- This guide documents chapter-level deep links.
- If you later add verse-level URL support, extend this document with a `verse` parameter section.
