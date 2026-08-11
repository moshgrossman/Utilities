# Utilities

Small self-contained tools — each one a single HTML file that runs
entirely in the browser. Nothing is uploaded anywhere: the page does all
its work on the device.

**Live site:** https://moshgrossman.github.io/Utilities/ (served by
GitHub Pages from this repo's `main` branch — see `pages-setup.txt` for
the one-time switch-on).

## The tools

| Tool | File | Version |
|---|---|---|
| Bulk → TXT Converter — EPUB/PDF/MOBI/CSV → plain `.txt`, split into ~300 KB parts | `bulktotxtconverter.html` | 3.1 |
| Audio Finder — pulls audio links out of a Chrome network log | `audio-finder.html` | — |

## Adding a new tool

1. Add the tool as one HTML file at the repo root.
2. Add a card for it to `index.html` and a line to the table above.
3. Give it a version number in its banner and add it to `version.json`.

Anything merged to `main` is on the live site about a minute later.
