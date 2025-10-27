# Spotlight for Chrome

Spotlight for Chrome is a privacy-friendly command launcher that mirrors macOS Spotlight inside the browser. It sits entirely in the client: press `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux to open a fast overlay that searches tabs, bookmarks, and recent history without sending any data to the network.

---

## What you get

Spotlight combines universal search, productivity shortcuts, and visual helpers:

- **Lightning-fast search** over tabs, bookmarks, and up to 500 recent history entries using an in-memory index with fuzzy matching.
- **Rich filtering** with scoped prefixes (`tab:`/`t:`, `bookmark:`/`b:`, `history:`/`h:`) and contextual subfilters that surface recent domains, history ranges, and bookmark folders as clickable chips.
- **Command palette** with inline completions, contextual answers (e.g., "Tab sort" shows the tab count), and utility commands like `> reindex`, tab sort/shuffle, or close-all-audio.
- **Web search fallback** triggered with `Cmd+Enter` (`Ctrl+Enter`), plus an engine picker activated by pressing `-` to jump between Google, Bing, DuckDuckGo, Brave, Yahoo, and YouTube.
- **Focus mode for tabs** that pins, groups, and highlights a chosen tab across the UI so it's always one query away (details below).

---

## Using Spotlight day to day

1. **Open the overlay** – Use `Cmd+K`/`Ctrl+K` (or the optional `Alt+Space` shortcut) from any tab.
2. **Search or filter** – Start typing to instantly rank relevant tabs, bookmarks, or history. Use the scoped prefixes or click contextual chips to narrow results without extra typing.
3. **Navigate** – Move with arrow keys, hit `Enter` to open a result, `Cmd+Enter`/`Ctrl+Enter` for a new tab, or `Esc` to dismiss. Spotlight works entirely with the keyboard but also supports clicking.
4. **Run commands** – Type `>` followed by a command name (for example, `> reindex`, `> tab sort`, or `> shuffle tabs`) to trigger background automation.
5. **Jump to the web** – If no local match appears, use the `-` picker to select a search engine and confirm with `Enter`.

### Focusing a tab

Spotlight's **Focus** command keeps an important tab front and center:

1. Run a Spotlight query like `focus this tab` or `focus <tab name>`.
2. Spotlight pins the tab, moves it into a dedicated "🔥 Focus" group tinted orange, and adds page-level cues: a banner inside the content script and a `⭑ Focus ·` prefix in the tab title.
3. Spotlight adds a persistent "⭐ Focused Tab" shortcut—type `focus`, `jump to focus`, or select the shortcut to return instantly.
4. To clear the emphasis, run `unfocus tab` (or select **Remove Focus**) to remove the pin, group, and visual markers.

Focus persists across reloads and window changes; Spotlight restores the highlight whenever the tab becomes available again.

---

## Installing the extension

1. Clone or download this repository.
2. Navigate to `chrome://extensions/` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and choose the repository directory.
5. Visit any page and press `Cmd+K`/`Ctrl+K` to launch Spotlight.

---

## Architecture hints for contributors

- Background automation (indexing, commands, focus state) lives under `src/background/` with `src/background/index.js` orchestrating event listeners.
- Search, scoring, and contextual suggestions are implemented in `src/search/`.
- The overlay UI and in-page indicators are handled by `src/content/index.js` and its sibling modules.
- Shared utilities such as web search configuration reside in `src/shared/`.

Enjoy lightning-fast, private browsing search with a focused workspace!
