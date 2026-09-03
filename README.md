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
| Audio Finder — pulls audio links out of a Chrome network log | `audio-finder/` | `/Utilities/audio-finder/` | 1.4 |
| Form Filler — flat PDF / Word doc → fillable form | `form-filler/` | `/Utilities/form-filler/` | 1.1 |
| Launcher — the front page listing the tools | `home/` | `/Utilities/home/` | 1.4 |

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
(`index.html`, `bulktotxtconverter.html`, `audio-finder.html`,
`form-filler.html`), which keep
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

## Form Filler and offline use

Form Filler is the one tool that carries its own libraries (`form-filler/vendor/`)
rather than loading them from a CDN, because it has to work with the network off.
Two things make that true:

- `form-filler/sw.js` caches every asset, so the installed app keeps working offline.
- `form-filler/form-filler-offline.html` is a single self-contained 3 MB file — the
  whole tool, libraries inlined — that runs straight from a Downloads folder with
  no server and no connection. Rebuild it after any change with:

      python3 form-filler/build-offline.py

  Changing `index.html`, `app.js` or `detect.js` without rebuilding leaves the
  offline copy stale, so run it in the same commit.

Plain-English instructions for the tool live in
`form-filler/how-to-use-form-filler.txt`.
