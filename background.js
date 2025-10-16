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
        const { results, meta } = runSearch(message.query || "", data);
        sendResponse({ results, meta, requestId: message.requestId });
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
