# Spotlight for Chrome

A Spotlight-style universal search and launcher for Chrome that runs entirely locally. Invoke the overlay with `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) to instantly search across open tabs, bookmarks, and recent history.

## Features
- Fast in-memory index covering tabs, bookmarks, and up to 500 history entries.
- Scoped filters with `tab:`/`t:`, `bookmark:`/`b:`, and `history:`/`h:` prefixes to focus results.
- Weighted scoring with support for exact, prefix, and fuzzy matches (edit distance ≤ 1).
- Arrow-key navigation, Enter to open, and Esc/click outside to dismiss.
- Optional `Alt+Space` shortcut.
- On-device Smart History interpreter that understands natural-language date ranges when you scope to history.
- Command `> reindex` to rebuild the local search index on demand.
- All processing performed locally—no network calls.
- Domain-first tab sort command to organize each window's tabs while keeping pinned tabs in place.
- Tab shuffle command to randomize unpinned tabs when you want a fresh perspective.
- Close-all-audio command to instantly silence every tab that's currently playing sound.
- Contextual subfilters that surface history date ranges, open tab domains, and bookmark folders directly under the query bar for quick refinement.
- Web search fallback that offers Google results when no local matches remain, with a "-" engine picker for Google, Bing, DuckDuckGo, Brave, Yahoo, and YouTube (all rendered with favicons).


## Contextual Subfilters

Spotlight presents filter-specific suggestions to help narrow results without typing extra operators:

- **History** – Toggle between date ranges like **Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, or **Older**.
- **Tabs** – Quickly scope to the domains of tabs you currently have open (e.g., YouTube, Google, Reddit). The list refreshes automatically as your active tabs change.
- **Bookmarks** – Browse by bookmark folder (e.g., Work, Personal, Tutorials) to jump straight to the right collection.

Each subfilter chip adopts a macOS Spotlight-inspired pill design. Selecting a chip applies the filter instantly, and you can tap the active chip again to clear it.

## Smart History Search (Prompt API)

Spotlight can translate conversational history requests into concrete filters and actions by calling Chrome's on-device Prompt API with the Smart History interpreter content script.

### Prerequisites

- Chrome 127 or newer running on Windows 10/11, macOS 13+, Linux, or a Chromebook Plus device (Prompt API is currently desktop-only).
- Hardware that meets Google's on-device Gemini Nano requirements (≥4 CPU cores and 16 GB RAM for CPU inference, or a GPU with >4 GB VRAM).
- Sufficient free storage for the Gemini Nano model (Chrome removes it if less than 10 GB remain). Check **chrome://on-device-internals** to confirm the download status.
- If your Chrome build still hides the API behind a flag, enable **chrome://flags/#prompt-api-for-gemini-nano** and restart the browser.

The launcher automatically falls back to the legacy keyword behavior when the Prompt API is unavailable, so you can still search by typing manual filters.

### Using Smart History Search

1. Open Spotlight with `Cmd+K`/`Ctrl+K`.
2. Scope to history by typing `history:` (or `h:`), choosing the History slash command (`/` → **History**), or clicking the **History** filter chip.
3. When the history scope is active, a dedicated **Smart history prompt** input appears under the filter chips—describe the pages or timeframe you're after there (for example, "show the docs I read yesterday", "open the flight check-in page from last week", or "list the recipes after my Amazon search"). You can still keep manual keywords in the main Spotlight field if you want to combine both approaches.
4. Spotlight combines the prompt with any remaining history keywords and sends them to Gemini Nano along with the current time. The interpreter extracts relevant topics, applies an appropriate history date subfilter (Today, Yesterday, Last 7 Days, Last 30 Days, or Older), and limits the result count when you specify a quantity.
5. If you say "open" or "reopen", Spotlight will automatically open the top history matches (up to 10) once the intent confidence clears the built-in threshold. Otherwise it just narrows the suggestion list.
6. When the interpreter is unsure, Spotlight surfaces its clarifying question next to the status line so you can refine the query.

You can cancel the AI assistance at any time by clearing the history scope (press `Esc` or remove the `history:` prefix) and the overlay reverts to the traditional keyword search.

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

## Development Notes
- Background indexing runs on startup and whenever tabs/bookmarks/history change.
- The overlay UI lives in `src/content/index.js` with styles from `src/content/styles.css`.
- Indexing and search logic reside in `src/search/indexer.js` and `src/search/search.js` respectively.
- Background orchestration is handled by the modules in `src/background/` with `src/background/index.js` wiring listeners together.
- Web search configuration, engine metadata, and fallback helpers are centralized in `src/shared/web-search.js`.

Enjoy lightning-fast, private browsing search!
