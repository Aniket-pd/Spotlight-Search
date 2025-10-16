import { buildIndex } from "./indexer.js";
import { runSearch } from "./search.js";

let indexData = null;
let buildingPromise = null;
let rebuildTimer = null;

async function ensureIndex() {
  if (indexData) {
    return indexData;
  }
  return rebuildIndex();
}

async function rebuildIndex() {
  if (!buildingPromise) {
    buildingPromise = buildIndex()
      .then((data) => {
        indexData = data;
        buildingPromise = null;
        return data;
      })
      .catch((error) => {
        console.error("Spotlight: failed to build index", error);
        buildingPromise = null;
        throw error;
      });
  }
  return buildingPromise;
}

function scheduleRebuild(delay = 600) {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildIndex().catch((err) => console.error("Spotlight: rebuild failed", err));
  }, delay);
}

function countOpenTabsFromIndex(data) {
  if (!data || !Array.isArray(data.items)) {
    return 0;
  }
  let count = 0;
  for (const item of data.items) {
    if (item && item.type === "tab") {
      count += 1;
    }
  }
  return count;
}

function buildQueryAugmentations(query, data, baseResults) {
  const trimmed = (query || "").trim();
  const lower = trimmed.toLowerCase();
  const tabCount = countOpenTabsFromIndex(data);

  if (!lower) {
    return { results: baseResults, ghostSuggestion: "", ghostAnswer: "" };
  }

  const commands = [
    {
      suggestion: "tab",
      answer: () => {
        if (!tabCount) return "No open tabs";
        return tabCount === 1 ? "1 open tab" : `${tabCount} open tabs`;
      },
    },
    {
      suggestion: "tab sort",
      answer: () => "Sort tabs alphabetically",
      result: {
        id: "__command_tab_sort",
        title: "Sort tabs by title",
        subtitle: "Organize the current window's tabs alphabetically",
        type: "command",
        command: "tab-sort",
        commandStart: "Sorting tabs...",
        commandSuccess: "Tabs sorted",
        commandError: "Unable to sort tabs",
        score: Number.MAX_SAFE_INTEGER,
      },
      minResultLength: 4,
    },
  ];

  const matches = [];
  const commandResults = [];

  for (const command of commands) {
    const suggestionLower = command.suggestion.toLowerCase();
    if (!suggestionLower.startsWith(lower)) {
      continue;
    }
    if (lower.length > suggestionLower.length) {
      continue;
    }

    const answerText = typeof command.answer === "function" ? command.answer() : command.answer;
    matches.push({ suggestion: command.suggestion, answer: answerText });

    if (command.result) {
      const minLength = command.minResultLength || suggestionLower.length;
      if (lower.length >= minLength) {
        commandResults.push({ ...command.result });
      }
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => {
      const diffA = a.suggestion.length - lower.length;
      const diffB = b.suggestion.length - lower.length;
      if (diffA !== diffB) {
        return diffA - diffB;
      }
      return a.suggestion.length - b.suggestion.length;
    });
  }

  const best = matches[0];
  const ghostSuggestion = best ? best.suggestion : "";
  const ghostAnswer = best ? best.answer || "" : "";

  if (commandResults.length === 0) {
    return { results: baseResults, ghostSuggestion, ghostAnswer };
  }

  return {
    results: [...commandResults, ...baseResults],
    ghostSuggestion,
    ghostAnswer,
  };
}

async function sortTabsByTitle() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return;
  }

  const pinnedTabs = tabs.filter((tab) => tab.pinned);
  const unpinnedTabs = tabs.filter((tab) => !tab.pinned);
  const pinnedCount = pinnedTabs.length;

  unpinnedTabs.sort((a, b) => {
    const titleA = (a.title || a.url || "").toLocaleLowerCase();
    const titleB = (b.title || b.url || "").toLocaleLowerCase();
    return titleA.localeCompare(titleB);
  });

  try {
    for (let index = 0; index < unpinnedTabs.length; index += 1) {
      const tab = unpinnedTabs[index];
      const targetIndex = pinnedCount + index;
      if (tab.index === targetIndex) {
        continue;
      }
      if (tab.id === undefined) {
        continue;
      }
      await chrome.tabs.move(tab.id, { index: targetIndex });
    }
  } catch (err) {
    throw new Error(err?.message || "Failed to reorder tabs");
  }
}

async function handleCommand(command) {
  switch (command) {
    case "tab-sort":
      await sortTabsByTitle();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function sendToggleMessage() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id !== undefined) {
      await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
    }
  } catch (err) {
    console.warn("Spotlight: unable to toggle overlay", err);
  }
}

async function openItem(itemId) {
  const data = await ensureIndex();
  const item = data.items[itemId];
  if (!item) {
    throw new Error("Item not found");
  }

  if (item.type === "tab" && item.tabId !== undefined) {
    try {
      await chrome.tabs.update(item.tabId, { active: true });
      if (item.windowId !== undefined) {
        await chrome.windows.update(item.windowId, { focused: true });
      }
    } catch (err) {
      console.warn("Spotlight: failed to focus tab, opening new tab instead", err);
      await chrome.tabs.create({ url: item.url });
    }
  } else {
    await chrome.tabs.create({ url: item.url });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildIndex();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildIndex();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-launcher" || command === "open-launcher-alt") {
    sendToggleMessage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "SPOTLIGHT_QUERY") {
    ensureIndex()
      .then((data) => {
        const baseResults = runSearch(message.query || "", data);
        const augmented = buildQueryAugmentations(message.query || "", data, baseResults);
        sendResponse({
          results: augmented.results,
          ghostSuggestion: augmented.ghostSuggestion,
          ghostAnswer: augmented.ghostAnswer,
          requestId: message.requestId,
        });
      })
      .catch((err) => {
        console.error("Spotlight: query failed", err);
        sendResponse({ results: [], error: true, requestId: message.requestId });
      });
    return true;
  }

  if (message.type === "SPOTLIGHT_OPEN") {
    openItem(message.itemId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Spotlight: open failed", err);
        sendResponse({ success: false, error: err?.message });
      });
    return true;
  }

  if (message.type === "SPOTLIGHT_REINDEX") {
    rebuildIndex()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Spotlight: reindex failed", err);
        sendResponse({ success: false, error: err?.message });
      });
    return true;
  }

  if (message.type === "SPOTLIGHT_COMMAND") {
    handleCommand(message.command)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Spotlight: command failed", err);
        sendResponse({ success: false, error: err?.message });
      });
    return true;
  }
});

chrome.tabs.onCreated.addListener(() => scheduleRebuild());
chrome.tabs.onRemoved.addListener(() => scheduleRebuild());
chrome.tabs.onUpdated.addListener(() => scheduleRebuild(1500));
chrome.bookmarks.onCreated.addListener(() => scheduleRebuild(1500));
chrome.bookmarks.onRemoved.addListener(() => scheduleRebuild(1500));
chrome.bookmarks.onChanged.addListener(() => scheduleRebuild(1500));
chrome.history.onVisited.addListener(() => scheduleRebuild(2000));
chrome.history.onTitleChanged?.addListener(() => scheduleRebuild(2000));
chrome.history.onVisitRemoved?.addListener(() => scheduleRebuild(2000));
chrome.action?.onClicked?.addListener(() => {
  sendToggleMessage();
});
