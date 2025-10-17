import { compareTabsByDomainAndTitle } from "./tabOrdering.js";
import { getDomainFromUrl } from "../../common/urls.js";

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export async function sortAllTabsByDomainAndTitle() {
  const tabs = await chrome.tabs.query({});
  const windows = new Map();

  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) {
      windows.set(tab.windowId, []);
    }
    windows.get(tab.windowId).push(tab);
  }

  for (const [, windowTabs] of windows.entries()) {
    const pinned = windowTabs
      .filter((tab) => tab.pinned)
      .sort((a, b) => a.index - b.index);
    const unpinned = windowTabs
      .filter((tab) => !tab.pinned)
      .sort(compareTabsByDomainAndTitle);

    let targetIndex = pinned.length;
    for (const tab of unpinned) {
      if (tab.index !== targetIndex) {
        try {
          await chrome.tabs.move(tab.id, { index: targetIndex });
        } catch (err) {
          console.warn("Spotlight: failed to move tab during sort", err);
        }
      }
      targetIndex += 1;
    }
  }
}

export async function shuffleTabs() {
  const tabs = await chrome.tabs.query({});
  const windows = new Map();

  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) {
      windows.set(tab.windowId, []);
    }
    windows.get(tab.windowId).push(tab);
  }

  for (const [, windowTabs] of windows.entries()) {
    const pinned = windowTabs
      .filter((tab) => tab.pinned)
      .sort((a, b) => a.index - b.index);
    const unpinned = windowTabs.filter((tab) => !tab.pinned);
    shuffleInPlace(unpinned);

    let targetIndex = pinned.length;
    for (const tab of unpinned) {
      if (tab.index !== targetIndex) {
        try {
          await chrome.tabs.move(tab.id, { index: targetIndex });
        } catch (err) {
          console.warn("Spotlight: failed to move tab during shuffle", err);
        }
      }
      targetIndex += 1;
    }
  }
}

export async function closeTabById(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (err) {
    console.warn("Spotlight: failed to close tab", err);
  }
}

export async function closeAllTabsExceptActive() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const toClose = allTabs
      .filter((tab) => tab.id !== undefined && (!activeTab || tab.id !== activeTab.id))
      .map((tab) => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  } catch (err) {
    console.warn("Spotlight: failed to close all tabs", err);
  }
}

export async function closeTabsByDomain(domain) {
  if (!domain) {
    return;
  }
  const normalized = domain.toLowerCase();
  try {
    const tabs = await chrome.tabs.query({});
    const toClose = tabs
      .filter((tab) => {
        if (tab.id === undefined || !tab.url) {
          return false;
        }
        const tabDomain = getDomainFromUrl(tab.url).toLowerCase();
        return tabDomain === normalized;
      })
      .map((tab) => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  } catch (err) {
    console.warn("Spotlight: failed to close tabs by domain", err);
  }
}
