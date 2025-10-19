const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 500;
const DOWNLOAD_SEARCH_LIMIT = 200;
const RECENT_SESSION_LIMIT = 50;
export const BOOKMARK_ROOT_FOLDER_KEY = "__SPOTLIGHT_ROOT_FOLDER__";

function normalize(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(text = "") {
  const normalized = normalize(text);
  if (!normalized) {
    return [];
  }
  return normalized.split(/\s+/).filter(Boolean);
}

function addToIndex(indexMap, termBuckets, itemId, text, weightMultiplier) {
  const tokens = tokenize(text);
  for (const token of tokens) {
    if (!token) continue;
    let termEntry = indexMap.get(token);
    if (!termEntry) {
      termEntry = new Map();
      indexMap.set(token, termEntry);
    }
    termEntry.set(itemId, (termEntry.get(itemId) || 0) + weightMultiplier);

    const key = token[0] || "";
    let bucket = termBuckets.get(key);
    if (!bucket) {
      bucket = new Set();
      termBuckets.set(key, bucket);
    }
    bucket.add(token);
  }
}

function extractOrigin(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

function extractHostname(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function parseDownloadTime(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

function getDownloadDisplayName(filename = "") {
  if (!filename) {
    return "";
  }
  const parts = filename.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) {
    return filename;
  }
  return parts[parts.length - 1];
}

function getDownloadDisplayPath(filename = "") {
  if (!filename) {
    return "";
  }
  const parts = filename.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) {
    return filename;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const name = parts.pop();
  const folder = parts.pop();
  if (folder) {
    return `${folder} / ${name}`;
  }
  return name || filename;
}

function parseSessionTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = new Date(value);
    const timestamp = parsed.getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return 0;
}

function formatHost(hostname) {
  if (!hostname) {
    return "";
  }
  return hostname.replace(/^www\./i, "");
}

function formatRecentDescription({ sessionType, tabCount, urls = [], fallback }) {
  const hosts = Array.from(
    new Set(
      urls
        .map((url) => formatHost(extractHostname(url)))
        .filter(Boolean)
    )
  );
  const hostSummary = hosts.length === 1 ? hosts[0] : hosts.length > 1 ? `${hosts[0]} +${hosts.length - 1}` : "";
  if (sessionType === "window") {
    const base = tabCount === 1 ? "Window · 1 tab" : `Window · ${tabCount || 0} tabs`;
    if (hostSummary) {
      return `${base} · ${hostSummary}`;
    }
    if (fallback) {
      return `${base} · ${fallback}`;
    }
    return base;
  }

  const base = "Tab";
  if (hostSummary) {
    return `${base} · ${hostSummary}`;
  }
  if (fallback) {
    return `${base} · ${fallback}`;
  }
  if (urls[0]) {
    return `${base} · ${urls[0]}`;
  }
  return base;
}

function normalizeRecentlyClosedEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lastModified = parseSessionTimestamp(entry.lastModified);

  if (entry.tab) {
    const tab = entry.tab;
    const sessionId = tab?.sessionId;
    if (!sessionId) {
      return null;
    }
    const url = typeof tab.url === "string" ? tab.url : "";
    const urls = url ? [url] : [];
    const title = tab.title || url || "Recently closed tab";
    const origin = extractOrigin(url);
    const faviconUrl = typeof tab.favIconUrl === "string" && tab.favIconUrl ? tab.favIconUrl : null;
    const fallback = tab.title || formatHost(extractHostname(url));
    const description = formatRecentDescription({
      sessionType: "tab",
      tabCount: 1,
      urls,
      fallback,
    });
    const searchTexts = [tab.title, url];
    return {
      sessionType: "tab",
      sessionId,
      title,
      url,
      urls,
      tabCount: 1,
      lastModified,
      description,
      origin,
      faviconUrl,
      searchTexts,
    };
  }

  if (entry.window) {
    const windowEntry = entry.window;
    const sessionId = windowEntry?.sessionId;
    if (!sessionId) {
      return null;
    }
    const rawTabs = Array.isArray(windowEntry.tabs) ? windowEntry.tabs : [];
    const normalizedTabs = rawTabs
      .map((tab) => {
        if (!tab || typeof tab !== "object") {
          return null;
        }
        const tabUrl = typeof tab.url === "string" ? tab.url : "";
        const tabTitle = typeof tab.title === "string" && tab.title ? tab.title : tabUrl;
        if (!tabTitle && !tabUrl) {
          return null;
        }
        return {
          title: tabTitle || "Untitled tab",
          url: tabUrl,
          faviconUrl: typeof tab.favIconUrl === "string" && tab.favIconUrl ? tab.favIconUrl : null,
        };
      })
      .filter(Boolean);

    if (!normalizedTabs.length) {
      return null;
    }

    const firstTabWithUrl = normalizedTabs.find((tab) => tab.url) || normalizedTabs[0];
    const tabCount = normalizedTabs.length;
    const url = firstTabWithUrl?.url || "";
    const title = firstTabWithUrl?.title || (tabCount === 1 ? normalizedTabs[0].title : "Recently closed window");
    const origin = extractOrigin(url);
    const faviconUrl = firstTabWithUrl?.faviconUrl || null;
    const urls = normalizedTabs.map((tab) => tab.url).filter(Boolean);
    const fallback = firstTabWithUrl?.title || formatHost(extractHostname(url));
    const description = formatRecentDescription({
      sessionType: "window",
      tabCount,
      urls,
      fallback,
    });
    const searchTexts = [title, ...normalizedTabs.map((tab) => tab.title), ...urls];

    return {
      sessionType: "window",
      sessionId,
      title: title || (tabCount === 1 ? "Window · 1 tab" : `Window · ${tabCount} tabs`),
      url,
      urls,
      tabCount,
      lastModified,
      description,
      origin,
      faviconUrl,
      searchTexts,
    };
  }

  return null;
}

async function indexTabs(indexMap, termBuckets, items) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith("chrome://")) continue;
    const itemId = items.length;
    items.push({
      id: itemId,
      type: "tab",
      title: tab.title || tab.url,
      url: tab.url,
      tabId: tab.id,
      windowId: tab.windowId,
      active: Boolean(tab.active),
      lastAccessed: tab.lastAccessed || Date.now(),
      origin: extractOrigin(tab.url),
    });

    addToIndex(indexMap, termBuckets, itemId, tab.title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, tab.url, URL_WEIGHT);
    try {
      const url = new URL(tab.url);
      addToIndex(indexMap, termBuckets, itemId, url.hostname, URL_WEIGHT);
    } catch (err) {
      // ignore malformed URL
    }
  }
}

function computeFolderKey(path = []) {
  const parts = Array.isArray(path) ? path.filter(Boolean) : [];
  if (!parts.length) {
    return BOOKMARK_ROOT_FOLDER_KEY;
  }
  return parts.join("||");
}

function collectBookmarkNodes(nodes, list = [], path = []) {
  for (const node of nodes) {
    const nodeTitle = typeof node.title === "string" ? node.title.trim() : "";
    if (node.url) {
      const folders = Array.isArray(path) ? path.filter(Boolean) : [];
      list.push({
        id: node.id,
        url: node.url,
        title: node.title,
        dateAdded: node.dateAdded,
        folders,
        folderKey: computeFolderKey(folders),
      });
    }
    if (node.children && node.children.length) {
      const nextPath = nodeTitle ? [...path, nodeTitle] : path;
      collectBookmarkNodes(node.children, list, nextPath);
    }
  }
  return list;
}

async function indexBookmarks(indexMap, termBuckets, items) {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = collectBookmarkNodes(tree, []);
  for (const bookmark of bookmarks) {
    if (!bookmark.url) continue;
    const itemId = items.length;
    items.push({
      id: itemId,
      type: "bookmark",
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      bookmarkId: bookmark.id,
      dateAdded: bookmark.dateAdded,
      origin: extractOrigin(bookmark.url),
      folderPath: Array.isArray(bookmark.folders) ? bookmark.folders : [],
      folderKey: bookmark.folderKey || computeFolderKey(bookmark.folders),
    });

    addToIndex(indexMap, termBuckets, itemId, bookmark.title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, bookmark.url, URL_WEIGHT);
    try {
      const url = new URL(bookmark.url);
      addToIndex(indexMap, termBuckets, itemId, url.hostname, URL_WEIGHT);
    } catch (err) {
      // ignore malformed URL
    }
  }
}

async function indexHistory(indexMap, termBuckets, items) {
  const historyItems = await chrome.history.search({
    text: "",
    maxResults: HISTORY_LIMIT,
    startTime: 0,
  });

  for (const entry of historyItems) {
    if (!entry.url) continue;
    const lastVisitTime = typeof entry.lastVisitTime === "number" ? entry.lastVisitTime : Number(entry.lastVisitTime) || 0;
    const itemId = items.length;
    items.push({
      id: itemId,
      type: "history",
      title: entry.title || entry.url,
      url: entry.url,
      lastVisitTime,
      visitCount: entry.visitCount,
      origin: extractOrigin(entry.url),
    });

    addToIndex(indexMap, termBuckets, itemId, entry.title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, entry.url, URL_WEIGHT);
    try {
      const url = new URL(entry.url);
      addToIndex(indexMap, termBuckets, itemId, url.hostname, URL_WEIGHT);
    } catch (err) {
      // ignore malformed URL
    }
  }
}

async function indexDownloads(indexMap, termBuckets, items) {
  let downloads = [];
  try {
    downloads = await chrome.downloads.search({ orderBy: ["-startTime"], limit: DOWNLOAD_SEARCH_LIMIT });
  } catch (err) {
    console.warn("Spotlight: failed to query downloads", err);
    return;
  }

  for (const entry of downloads) {
    if (!entry) {
      continue;
    }

    const filename = typeof entry.filename === "string" ? entry.filename : "";
    const title = getDownloadDisplayName(filename) || entry.url || "Download";
    const displayPath = getDownloadDisplayPath(filename);
    const finalUrl = typeof entry.finalUrl === "string" && entry.finalUrl ? entry.finalUrl : entry.url || "";
    const itemId = items.length;
    const endTime = parseDownloadTime(entry.endTime);
    const startTime = parseDownloadTime(entry.startTime);
    const createdAt = endTime || startTime || Date.now();
    const fileUrl = typeof entry.fileUrl === "string" && entry.fileUrl
      ? entry.fileUrl
      : filename
      ? `file://${filename}`
      : "";

    const item = {
      id: itemId,
      type: "download",
      title,
      url: finalUrl,
      downloadId: entry.id,
      state: entry.state || "in_progress",
      filename,
      displayPath,
      fileUrl,
      createdAt,
      startTime: startTime || null,
      endTime: endTime || null,
      totalBytes: typeof entry.totalBytes === "number" ? entry.totalBytes : null,
      bytesReceived: typeof entry.bytesReceived === "number" ? entry.bytesReceived : null,
      danger: entry.danger || "safe",
      opened: Boolean(entry.opened),
      origin: extractOrigin(finalUrl),
      iconHint: "download",
    };

    items.push(item);

    addToIndex(indexMap, termBuckets, itemId, title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, filename, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, finalUrl, URL_WEIGHT);
    if (entry.mime) {
      addToIndex(indexMap, termBuckets, itemId, entry.mime, 1);
    }
  }
}

async function indexRecentlyClosed(indexMap, termBuckets, items) {
  if (typeof chrome.sessions?.getRecentlyClosed !== "function") {
    return;
  }
  let sessions = [];
  try {
    sessions = await chrome.sessions.getRecentlyClosed({ maxResults: RECENT_SESSION_LIMIT });
  } catch (err) {
    console.warn("Spotlight: failed to query recently closed sessions", err);
    return;
  }

  for (const entry of sessions) {
    const normalized = normalizeRecentlyClosedEntry(entry);
    if (!normalized || !normalized.sessionId) {
      continue;
    }
    const itemId = items.length;
    const item = {
      id: itemId,
      type: "recent",
      title: normalized.title || "Recently closed",
      url: normalized.url || normalized.urls?.[0] || "",
      urls: Array.isArray(normalized.urls) ? normalized.urls : [],
      sessionId: normalized.sessionId,
      sessionType: normalized.sessionType,
      tabCount: typeof normalized.tabCount === "number" ? normalized.tabCount : null,
      lastModified: normalized.lastModified || 0,
      description: normalized.description || "Recently closed",
      origin: normalized.origin || "",
      faviconUrl: normalized.faviconUrl || null,
    };

    items.push(item);

    addToIndex(indexMap, termBuckets, itemId, normalized.title, TAB_TITLE_WEIGHT);
    if (Array.isArray(normalized.searchTexts)) {
      for (const text of normalized.searchTexts) {
        addToIndex(indexMap, termBuckets, itemId, text, TAB_TITLE_WEIGHT);
      }
    }
    if (Array.isArray(item.urls)) {
      for (const url of item.urls) {
        addToIndex(indexMap, termBuckets, itemId, url, URL_WEIGHT);
        const hostname = extractHostname(url);
        if (hostname) {
          addToIndex(indexMap, termBuckets, itemId, hostname, URL_WEIGHT);
        }
      }
    }
  }
}

export async function buildIndex() {
  const items = [];
  const indexMap = new Map();
  const termBuckets = new Map();

  await Promise.all([
    indexTabs(indexMap, termBuckets, items),
    indexBookmarks(indexMap, termBuckets, items),
    indexHistory(indexMap, termBuckets, items),
    indexDownloads(indexMap, termBuckets, items),
    indexRecentlyClosed(indexMap, termBuckets, items),
  ]);

  const buckets = {};
  const allTerms = new Set();
  for (const [key, set] of termBuckets.entries()) {
    const values = Array.from(set);
    buckets[key] = values;
    values.forEach((term) => allTerms.add(term));
  }
  buckets["*"] = Array.from(allTerms);

  const metadata = {
    tabCount: items.reduce((count, item) => (item.type === "tab" ? count + 1 : count), 0),
    downloadCount: items.reduce((count, item) => (item.type === "download" ? count + 1 : count), 0),
    recentCount: items.reduce((count, item) => (item.type === "recent" ? count + 1 : count), 0),
  };

  return {
    items,
    index: indexMap,
    termBuckets: buckets,
    metadata,
    createdAt: Date.now(),
  };
}
