# Spotlight for Chrome

A Spotlight-style universal search and launcher for Chrome that runs entirely locally. Invoke the overlay with `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to instantly search across open tabs, bookmarks, and recent history.

## Features
- Fast in-memory index covering tabs, bookmarks, and up to 500 history entries.
- Scoped filters with `tab:`/`t:`, `bookmark:`/`b:`, and `history:`/`h:` prefixes to focus results.
- Weighted scoring with support for exact, prefix, and fuzzy matches (edit distance ≤ 1).
- Arrow-key navigation, Enter to open, and Esc/click outside to dismiss.
- Optional `Alt+Space` shortcut.
- Command suggestions with inline ghost completions and contextual answers (e.g., tab count for "Tab sort").
- Command `> reindex` to rebuild the local search index on demand.
- All processing performed locally—no network calls.
- Domain-first tab sort command to organize each window's tabs while keeping pinned tabs in place.
- Tab shuffle command to randomize unpinned tabs when you want a fresh perspective.
- Close-all-audio command to instantly silence every tab that's currently playing sound.
- Live tab performance command that surfaces real-time CPU and memory usage for every open tab directly inside Spotlight.
- Built-in DevTools bridge that lets the background service worker attach to tabs via Chrome's debugger protocol for advanced diagnostics.
- Contextual subfilters that surface history date ranges, open tab domains, and bookmark folders directly under the query bar for quick refinement.


## Contextual Subfilters

Spotlight presents filter-specific suggestions to help narrow results without typing extra operators:

- **History** – Toggle between date ranges like **Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, or **Older**.
- **Tabs** – Quickly scope to the domains of tabs you currently have open (e.g., YouTube, Google, Reddit). The list refreshes automatically as your active tabs change.
- **Bookmarks** – Browse by bookmark folder (e.g., Work, Personal, Tutorials) to jump straight to the right collection.

Each subfilter chip adopts a macOS Spotlight-inspired pill design. Selecting a chip applies the filter instantly, and you can tap the active chip again to clear it.

## Live Tab Performance

Type `tab performance` (or jump straight to `> performance`) to summon a dedicated performance view that refreshes automatically while Spotlight is open. Every open tab is listed with its favicon, title, domain, and live metrics:

- **CPU** usage with an animated gauge so heavy tabs stand out immediately.
- **Memory** consumption in megabytes or gigabytes, plus optional JS heap totals when Chrome exposes them.
- Status chips that call out active, audible, discarded, or locked tabs at a glance.

Select any tab in the performance view to focus it instantly. Behind the scenes Spotlight relies on Chrome's `processes` API and can elevate to the DevTools protocol through the background debugger bridge for deeper telemetry—all with no external requests.

## Loading the Extension
1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the repository directory.
5. Use the keyboard shortcut (`Cmd+K`/`Ctrl+K`) on any page to open Spotlight.

## Development Notes
- Background indexing runs on startup and whenever tabs/bookmarks/history change.
- The overlay UI lives in `src/content/index.js` with styles from `src/content/styles.css`.
- Indexing and search logic reside in `src/search/indexer.js` and `src/search/search.js` respectively.
- Background orchestration is handled by the modules in `src/background/` with `src/background/index.js` wiring listeners together.

Enjoy lightning-fast, private browsing search!
