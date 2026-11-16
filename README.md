# Weby Browser — Phase 1

A privacy-first Windows browser (Chromium engine via Electron).

**Rules, enforced in code**
- No ads — network blocklist + cosmetic rules + YouTube ad removal
- No tracking — trackers blocked, third-party cookies blocked, tracking URL params stripped, DNT/GPC sent, WebRTC IP leak disabled, all permissions (camera, mic, location, notifications) denied
- No accounts / login / sync, no extensions or add-ons, no AI, no telemetry
- HTTPS-only (never falls back to plain HTTP)
- One-tap **Clear all** (toolbar button or `Ctrl+Shift+Del`): history, cookies, cache, storage, logins

**Built in**
- **YouTube focus tool** (`Ctrl+Shift+Y`): ads always removed; toggle Shorts, home feed, recommendations, comments, end cards, autoplay, grayscale; one-click full focus mode
- **Enhanced print** (`Ctrl+P`): live preview, Original / Clean / Reader layouts, ink saver, remove images, show link URLs, printer picker, paper/margins/scale/page range/copies/duplex, Save as PDF
- Find in page, zoom, tabs, local history (searchable), settings page

## Build on GitHub (no local setup)
1. Create a new GitHub repository and upload everything in this folder (keep `.github/workflows/build.yml`).
2. Open **Actions → Build Weby Browser (Windows) → Run workflow** (it also runs on every push).
3. When it finishes, download from the run's **Artifacts**:
   - `Weby-Browser-Installer` → `Weby-Browser-Setup-0.1.0.exe`
   - `Weby-Browser-Portable` → `Weby-Browser-Portable-0.1.0.exe`
4. For a public download page, push a tag like `v0.1.0`; the exes are attached to a GitHub Release.

The portable build keeps all data in a `WebyData` folder beside the `.exe`.

## Build locally (Windows)
```
npm install
npm start          # run
npm run dist       # installer + portable in dist/
```

## Notes
- The build downloads StevenBlack + AdGuard host lists (optional, adds ~100k domains). If it fails, the built-in list still ships.
- Unsigned exe: Windows SmartScreen shows a warning on first run (More info → Run anyway).
- Shortcuts: Ctrl+T/W/L/R/F/H/P, Ctrl+Tab, Ctrl+1–9, Alt+←/→, Ctrl +/−/0, F11.
- Source layout: `main.js`, `src/core` (blocker, privacy, tabs, youtube), `src/shell` (browser UI), `src/pages` (home/history/settings), `src/print`.
