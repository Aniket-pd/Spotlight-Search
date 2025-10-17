import { createMessageHandler } from "./services/messageHandlers.js";
import { ensureIndex, rebuildIndex, scheduleRebuild } from "./services/indexService.js";

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

const handleMessage = createMessageHandler();
chrome.runtime.onMessage.addListener(handleMessage);

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

// Ensure the index is primed when the service worker wakes.
ensureIndex().catch((err) => {
  console.error("Spotlight: initial index load failed", err);
});
