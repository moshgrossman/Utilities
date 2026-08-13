# Utilities

Small self-contained tools — each one a single HTML file that runs
entirely in the browser. Nothing is uploaded anywhere: the page does all
its work on the device.

**Live site:** https://moshgrossman.github.io/Utilities/ (served by
GitHub Pages from this repo's `main` branch — see `pages-setup.txt` for
the one-time switch-on).

## The tools

| Tool | Lives in | Live address | Version |
|---|---|---|---|
| Bulk → TXT Converter — EPUB/PDF/MOBI/CSV → plain `.txt`, split into ~300 KB parts | `converter/` | `/Utilities/converter/` | 3.4 |
| Audio Finder — pulls audio links out of a Chrome network log | `audio-finder/` | `/Utilities/audio-finder/` | 1.2 |
| Launcher — the front page listing the tools | `home/` | `/Utilities/home/` | 1.3 |

## One folder per app — why the layout looks like this

Android decides whether a page belongs to an already-installed app by the
manifest's **`scope`**. Everything under a scope belongs to that one app.
The first attempt put all three manifests at the repo root with
`scope: /Utilities/`, so the installed launcher swallowed both tool pages:
Chrome offered "open in the app you have" instead of "install", and the
tools could never become apps of their own.

The rule that follows: **every app gets its own folder, and its `scope`,
`start_url` and `id` all point at that folder only** — no app's scope may
contain another app's pages. The repo root holds only redirect stubs
(`index.html`, `bulktotxtconverter.html`, `audio-finder.html`), which keep
older links working and deliberately carry no manifest, so they belong to
no app.

## Adding a new tool

1. Make a folder for it, with the tool as `index.html` inside.
2. Add `manifest.json` in that folder: `id`, `start_url` and `scope` all
   set to `/Utilities/<folder>/`, plus 192px and 512px icons under
   `/Utilities/icons/`.
3. Link the manifest and icon from the tool's `<head>`.
4. Add a card for it in `home/index.html` and a row in the table above.
5. Give it a version number in its banner and add it to `version.json`.

Anything merged to `main` is on the live site about a minute later.
