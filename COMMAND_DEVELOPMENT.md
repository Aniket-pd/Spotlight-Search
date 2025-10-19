# Command Development Guide

This guide explains how to add a new Spotlight command, wire it into the extension's background actions, and ensure it appears in the command autosuggestions shown in the launcher overlay.

## 1. Understand the Command Flow

Spotlight commands follow a two-part flow:

1. **Suggestion phase** – `src/search/search.js` evaluates the user query and surfaces command results. Static commands live in the `STATIC_COMMANDS` array near the top of the file. Dynamic commands (e.g., close tabs) are composed in helper functions further down the file.
2. **Execution phase** – `src/background/commands.js` receives the selected command and runs the corresponding action inside `executeCommand()`.

A new command should have entries in both areas.

## 2. Add the Command to `search.js`

Open [`src/search/search.js`](./src/search/search.js) and extend the `STATIC_COMMANDS` array with a new object. Follow the existing structure exactly:

```js
{
  id: "command:tab-example",
  title: "Example command",
  aliases: ["example", "demo command"],
  action: "tab-example",
  answer(context) {
    // Return the small helper text shown to the right of the input.
    return "What the command does";
  },
  description(context) {
    // Return the subtitle shown in the result row.
    return "Short summary for the list item";
  },
  isAvailable(context) {
    // Return true when the command should be surfaced.
    return true;
  },
}
```

Key points:

- **Autosuggestion / ghost text** – Add a clear `title` and populate the `aliases` array with the phrases that should trigger the command. Both the title and aliases feed into `findBestStaticCommand()`, which drives the inline ghost suggestion and highlighted result in the UI. Use lowercase phrases without punctuation for the aliases so that `normalizeCommandToken()` matches them predictably.
- **Context-aware availability** – Use the `context` argument (tab list, counts, etc.) to gate the command. Commands that are not relevant should return `false` in `isAvailable()` so they do not clutter autosuggestions.
- **Descriptions** – Keep `answer()` and `description()` concise (≤ 80 chars) and prefer sentence case.
- **Formatting** – Match the repository style: two-space indentation, trailing commas in object literals/arrays, double quotes for strings, and semicolons at the end of statements. Declare helper functions with `function` or `const foo = () => {}` consistently with surrounding code; static command entries should stay as plain object literals.

If your command needs dynamic suggestions (for example, it operates on specific tabs or domains) create a helper alongside `collectTabCloseSuggestions()` that returns `{ results, ghost, answer }` and merge it into `collectCommandSuggestions()`.

## 3. Handle Execution in `src/background/commands.js`

Open [`src/background/commands.js`](./src/background/commands.js) and add a new `case` block in `executeCommand()` that matches the `action` you set in `search.js`:

```js
case "tab-example":
  await doSomethingUseful();
  scheduleRebuild(400); // Keep the index fresh when the command mutates tabs/bookmarks/history.
  return;
```

Guidelines:

- Keep switch cases sorted alongside related commands (e.g., all tab commands together).
- Reuse existing helper utilities or add new ones above `executeCommand()` if the command requires additional logic. Follow the same coding style as the rest of the file (two-space indentation, `const` by default, async/await for Chrome APIs, defensive `try/catch` when a call can fail).
- Call `scheduleRebuild()` when the command changes tabs, bookmarks, or history so that subsequent searches remain accurate.

## 4. Wire Optional UI or Telemetry Hooks

If the new command needs additional UI behavior (such as rendering a custom result tile) update `src/content/index.js` accordingly. Ensure any new CSS follows the conventions in `src/content/styles.css` (BEM-like class names prefixed with `sp-`).

## 5. Validate the Experience

After wiring everything up:

1. Reload the extension in Chrome (`chrome://extensions`, **Reload** on the unpacked extension).
2. Trigger the launcher (Cmd/Ctrl+K) and type one of the aliases. Confirm the command appears with correct ghost text, description, and answer.
3. Execute the command and confirm the expected background behavior.

Keeping these steps in sync guarantees that new commands are both discoverable through autosuggestions and fully functional at runtime.
