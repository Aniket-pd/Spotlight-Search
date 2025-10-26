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
- Contextual subfilters that surface history date ranges, open tab domains, and bookmark folders directly under the query bar for quick refinement.
- Web search fallback that offers Google results when no local matches remain, with a "-" engine picker for Google, Bing, DuckDuckGo, Brave, Yahoo, and YouTube (all rendered with favicons).
- Optional Smart History Assistant (behind a feature flag) that interprets natural-language requests to show, open, delete, or summarize history using Chrome's on-device Prompt and Summarizer APIs.


## Contextual Subfilters

Spotlight presents filter-specific suggestions to help narrow results without typing extra operators:

- **History** – Toggle between date ranges like **Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, or **Older**.
- **Tabs** – Quickly scope to the domains of tabs you currently have open (e.g., YouTube, Google, Reddit). The list refreshes automatically as your active tabs change.
- **Bookmarks** – Browse by bookmark folder (e.g., Work, Personal, Tutorials) to jump straight to the right collection.

Each subfilter chip adopts a macOS Spotlight-inspired pill design. Selecting a chip applies the filter instantly, and you can tap the active chip again to clear it.

## Web Search Fallback & Engine Picker

Spotlight keeps web search only one keystroke away when local data comes up empty:

1. Type your query in the Spotlight input field as usual.
2. Press `Cmd+Enter` (`Ctrl+Enter` on Windows/Linux) at any time to open the query in a new tab using your default engine (Google out of the box).
3. Press the `-` key to open the engine picker menu. The menu filters as you continue typing and lists each provider with its favicon so you can quickly differentiate between Google, Bing, DuckDuckGo, Brave Search, Yahoo, and YouTube.
4. Confirm an engine from the picker with `Enter` or click. Spotlight will preview the pending web search as a single result row highlighting your query and the chosen engine.
5. Press `Enter` to open the previewed engine in a new tab, or press `Esc` to return to the full local results list.

The shared web search utilities live in `src/shared/web-search.js` if you want to add or customize engines.

## Loading the Extension
1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the repository directory.
5. Use the keyboard shortcut (`Cmd+K`/`Ctrl+K`) on any page to open Spotlight.

### Enabling the Smart History Assistant (optional)

The conversational history helper ships behind a local feature flag so it never interferes with the classic Spotlight workflow. To try it out:

1. Open the extension's background page (`chrome://extensions/` → **Spotlight for Chrome** → **service worker**).
2. Run the following snippet in the console to enable the flag for your profile:

   ```js
   chrome.storage.local.set({ spotlightSmartHistoryAssistant: true });
   ```

3. Reopen Spotlight and select the history filter to reveal the Smart History Assistant panel.

All parsing, history lookups, and summaries execute locally via Chrome's on-device Gemini Nano APIs.

## Development Notes
- Background indexing runs on startup and whenever tabs/bookmarks/history change.
- The overlay UI lives in `src/content/index.js` with styles from `src/content/styles.css`.
- Indexing and search logic reside in `src/search/indexer.js` and `src/search/search.js` respectively.
- Background orchestration is handled by the modules in `src/background/` with `src/background/index.js` wiring listeners together.
- Web search configuration, engine metadata, and fallback helpers are centralized in `src/shared/web-search.js`.

Enjoy lightning-fast, private browsing search!
