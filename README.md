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
- Contextual subfilters that surface history date ranges, open tab domains, and bookmark folders directly under the query bar for quick refinement.

## Contextual Subfilters

Spotlight presents filter-specific suggestions to help narrow results without typing extra operators:

- **History** – Toggle between date ranges like **Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, or **Older**.
- **Tabs** – Quickly scope to the domains of tabs you currently have open (e.g., YouTube, Google, Reddit). The list refreshes automatically as your active tabs change.
- **Bookmarks** – Browse by bookmark folder (e.g., Work, Personal, Tutorials) to jump straight to the right collection.

Each subfilter chip adopts a macOS Spotlight-inspired pill design. Selecting a chip applies the filter instantly, and you can tap the active chip again to clear it.

## Loading the Extension
1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the repository directory.
5. Use the keyboard shortcut (`Cmd+K`/`Ctrl+K`) on any page to open Spotlight.

## Development Notes
- Background indexing runs on startup and whenever tabs/bookmarks/history change.
- The background service worker is implemented in modular services under `src/background/` (index management, favicon resolution, and command execution).
- The overlay UI lives in `src/content/index.js` with styles in `src/content/styles.css`.
- Index construction utilities reside in `src/indexing/`, shared helpers in `src/common/`, and the search engine in `src/search/`.

Enjoy lightning-fast, private browsing search!
