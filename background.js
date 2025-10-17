import { buildIndex } from "./indexer.js";
import { runSearch } from "./search.js";

let indexData = null;
let buildingPromise = null;
let rebuildTimer = null;
const faviconCache = new Map();

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

function getOriginFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

function isHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchFaviconData(url) {
  if (!isHttpUrl(url)) {
    return null;
  }
  const requestUrl = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 3000) : null;
  try {
    const response = await fetch(requestUrl, {
      signal: controller?.signal,
      cache: "force-cache",
      mode: "cors",
    });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return null;
    }
    const buffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = blob.type || "image/png";
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.warn("Spotlight: favicon fetch failed", err);
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function resolveTabFavicon(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      return tab.favIconUrl;
    }
  } catch (err) {
    // tab may have closed; ignore
  }
  return null;
}

async function resolveFaviconForTarget(target) {
  if (!target) {
    return { origin: "", faviconUrl: null };
  }
  const origin = target.origin || getOriginFromUrl(target.url) || "";
  if (!origin) {
    return { origin: "", faviconUrl: null };
  }

  if (faviconCache.has(origin)) {
    return { origin, faviconUrl: faviconCache.get(origin) };
  }

  let faviconUrl = null;

  if (target.type === "tab") {
    faviconUrl = await resolveTabFavicon(target.tabId);
  }

  if (!faviconUrl && target.url) {
    faviconUrl = await fetchFaviconData(target.url);
  }

  faviconCache.set(origin, faviconUrl || null);
  return { origin, faviconUrl: faviconUrl || null };
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
    ensureIndex()
      .then(async (data) => {
        const item = typeof message.itemId === "number" ? data.items[message.itemId] : null;
        const target = {
          type: item?.type || message.resultType || null,
          tabId:
            typeof item?.tabId === "number"
              ? item.tabId
              : typeof message.tabId === "number"
              ? message.tabId
              : null,
          url: item?.url || message.url || "",
          origin: item?.origin || message.origin || "",
        };
        const { origin, faviconUrl } = await resolveFaviconForTarget(target);
        sendResponse({ success: Boolean(faviconUrl), faviconUrl, origin });
      })
      .catch((err) => {
        console.warn("Spotlight: favicon resolve failed", err);
        sendResponse({ success: false, faviconUrl: null, origin: message.origin || "" });
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
