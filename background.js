import { buildIndex } from "./indexer.js";
import { runSearch } from "./search.js";

let indexData = null;
let buildingPromise = null;
let rebuildTimer = null;
const faviconCache = new Map();
const pendingFavicons = new Map();

function buildChromeFaviconUrl(url) {
  if (!url) return null;
  return `chrome://favicon/size/32@1x/${url}`;
}

function buildGoogleFaviconUrl(url) {
  if (!url) return null;
  return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read favicon"));
    reader.readAsDataURL(blob);
  });
}

async function fetchDataUrl(candidateUrl) {
  if (!candidateUrl) return null;
  try {
    const response = await fetch(candidateUrl);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (err) {
    return null;
  }
}

async function fetchFirstAvailableDataUrl(candidates) {
  for (const candidate of candidates) {
    const dataUrl = await fetchDataUrl(candidate);
    if (dataUrl) {
      return dataUrl;
    }
  }
  return null;
}

async function fetchFaviconForSource(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  if (source.kind === "tab" && typeof source.tabId === "number") {
    const candidates = [];
    try {
      const tab = await chrome.tabs.get(source.tabId);
      if (tab?.favIconUrl) {
        candidates.push(tab.favIconUrl);
      }
      if (tab?.url) {
        candidates.push(buildChromeFaviconUrl(tab.url));
        candidates.push(buildGoogleFaviconUrl(tab.url));
      }
    } catch (err) {
      // tab might have closed; ignore
    }
    if (source.url) {
      candidates.push(buildChromeFaviconUrl(source.url));
      candidates.push(buildGoogleFaviconUrl(source.url));
    }
    return fetchFirstAvailableDataUrl(candidates);
  }

  if (source.kind === "url" && source.url) {
    return fetchFirstAvailableDataUrl([
      buildChromeFaviconUrl(source.url),
      buildGoogleFaviconUrl(source.url),
    ]);
  }

  return null;
}

async function resolveFavicon(iconKey, source) {
  if (!iconKey || !source) {
    return null;
  }
  if (faviconCache.has(iconKey)) {
    return faviconCache.get(iconKey);
  }
  let pending = pendingFavicons.get(iconKey);
  if (!pending) {
    pending = fetchFaviconForSource(source)
      .catch((err) => {
        console.warn("Spotlight: favicon fetch failed", err);
        return null;
      })
      .then((dataUrl) => {
        pendingFavicons.delete(iconKey);
        if (dataUrl) {
          faviconCache.set(iconKey, dataUrl);
        }
        return dataUrl;
      });
    pendingFavicons.set(iconKey, pending);
  }
  return pending;
}

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

function tabTitle(tab) {
  return tab.title || tab.url || "";
}

function tabDomain(tab) {
  if (!tab.url) {
    return "";
  }
  try {
    const url = new URL(tab.url);
    return url.hostname || "";
  } catch (err) {
    return "";
  }
}

function compareTabsByDomainAndTitle(a, b) {
  const domainA = tabDomain(a).toLowerCase();
  const domainB = tabDomain(b).toLowerCase();
  if (domainA !== domainB) {
    return domainA.localeCompare(domainB);
  }

  const titleA = tabTitle(a).toLowerCase();
  const titleB = tabTitle(b).toLowerCase();
  if (titleA !== titleB) {
    return titleA.localeCompare(titleB);
  }

  const urlA = (a.url || "").toLowerCase();
  const urlB = (b.url || "").toLowerCase();
  if (urlA !== urlB) {
    return urlA.localeCompare(urlB);
  }

  const idA = a.id === undefined ? "" : String(a.id);
  const idB = b.id === undefined ? "" : String(b.id);
  return idA.localeCompare(idB);
}

async function sortAllTabsByDomainAndTitle() {
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

function shuffleInPlace(tabs) {
  for (let i = tabs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  }
}

async function shuffleTabs() {
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

function getDomainFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

async function closeTabById(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (err) {
    console.warn("Spotlight: failed to close tab", err);
  }
}

async function closeAllTabsExceptActive() {
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

async function closeTabsByDomain(domain) {
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

async function executeCommand(commandId, args = {}) {
  switch (commandId) {
    case "tab-sort":
      await sortAllTabsByDomainAndTitle();
      scheduleRebuild(400);
      return;
    case "tab-shuffle":
      await shuffleTabs();
      scheduleRebuild(400);
      return;
    case "tab-close":
      await closeTabById(args.tabId);
      scheduleRebuild(200);
      return;
    case "tab-close-all":
      await closeAllTabsExceptActive();
      scheduleRebuild(400);
      return;
    case "tab-close-domain":
      await closeTabsByDomain(args.domain);
      scheduleRebuild(400);
      return;
    default:
      throw new Error(`Unknown command: ${commandId}`);
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
        const payload = runSearch(message.query || "", data) || {};
        if (!payload.results || !Array.isArray(payload.results)) {
          payload.results = [];
        }
        sendResponse({ ...payload, requestId: message.requestId });
      })
      .catch((err) => {
        console.error("Spotlight: query failed", err);
        sendResponse({ results: [], error: true, requestId: message.requestId });
      });
    return true;
  }

  if (message.type === "SPOTLIGHT_FAVICON") {
    const { iconKey, source } = message;
    if (!iconKey || !source) {
      sendResponse({ success: false, dataUrl: null });
      return;
    }
    const cached = faviconCache.get(iconKey);
    if (cached) {
      sendResponse({ success: true, dataUrl: cached });
      return;
    }
    resolveFavicon(iconKey, source)
      .then((dataUrl) => {
        if (dataUrl) {
          sendResponse({ success: true, dataUrl });
        } else {
          sendResponse({ success: false, dataUrl: null });
        }
      })
      .catch((err) => {
        console.warn("Spotlight: favicon response failed", err);
        sendResponse({ success: false, dataUrl: null });
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
    executeCommand(message.command, message.args)
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
