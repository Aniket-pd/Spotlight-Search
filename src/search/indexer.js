const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 1500;
const DOWNLOAD_SEARCH_LIMIT = 200;
const RECENT_SESSION_LIMIT = 60;
const RECENT_SESSION_SECONDARY_TITLE_WEIGHT = 1.4;
const RECENT_SESSION_SECONDARY_URL_WEIGHT = 1.1;
const RECENT_WINDOW_PREVIEW_LIMIT = 6;

const TOP_SITE_TITLE_WEIGHT = TAB_TITLE_WEIGHT;

function extractHostname(url) {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}
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

function normalizeSessionTabEntry(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  const rawTitle = typeof tab.title === "string" ? tab.title.trim() : "";
  const url = typeof tab.url === "string" ? tab.url : "";
  const title = rawTitle || url || "Untitled tab";
  const favIconUrl = typeof tab.favIconUrl === "string" && tab.favIconUrl ? tab.favIconUrl : null;
  const hostname = extractHostname(url);
  return {
    title,
    url,
    hostname,
    favIconUrl,
    active: Boolean(tab.active),
  };
}

function buildSessionPreviewTabs(tabs, limit = RECENT_WINDOW_PREVIEW_LIMIT, primary = null) {
  if (!Array.isArray(tabs) || !tabs.length) {
    return [];
  }
  const normalizedLimit = Math.max(1, limit);
  const ordered = [];
  if (primary) {
    ordered.push(primary);
  }
  for (const tab of tabs) {
    if (!tab) {
      continue;
    }
    if (primary && tab === primary) {
      continue;
    }
    ordered.push(tab);
  }
  if (!ordered.length) {
    ordered.push(...tabs.filter(Boolean));
  }
  return ordered.slice(0, normalizedLimit).map((tab) => ({
    title: tab.title || "",
    url: tab.url || "",
  }));
}

function formatTabCountLabel(count) {
  if (count === 1) {
    return "1 tab";
  }
  return `${count} tabs`;
}

function normalizeSessionEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lastModifiedRaw = typeof entry.lastModified === "number" ? entry.lastModified : Number(entry.lastModified) || 0;
  const closedAt = lastModifiedRaw > 0 ? lastModifiedRaw : Date.now();

  if (entry.tab && typeof entry.tab === "object") {
    const tab = entry.tab;
    const url = typeof tab.url === "string" ? tab.url : "";
    const sessionId = typeof entry.sessionId === "string" && entry.sessionId
      ? entry.sessionId
      : typeof tab.sessionId === "string" && tab.sessionId
      ? tab.sessionId
      : null;
    if (!sessionId) {
      return null;
    }
    const rawTitle = typeof tab.title === "string" ? tab.title.trim() : "";
    const title = rawTitle || url || "Closed tab";
    const hostname = extractHostname(url);
    const descriptionParts = ["Closed tab"];
    if (hostname) {
      descriptionParts.push(hostname);
    }
    return {
      type: "recentSession",
      title,
      url,
      sessionId,
      sessionType: "tab",
      tabCount: 1,
      closedAt,
      createdAt: closedAt,
      lastAccessed: closedAt,
      description: descriptionParts.join(" · "),
      origin: extractOrigin(url),
      faviconUrl: typeof tab.favIconUrl === "string" && tab.favIconUrl ? tab.favIconUrl : null,
      sessionTabs: url || title
        ? [
            {
              title,
              url,
            },
          ]
        : [],
    };
  }

  if (entry.window && typeof entry.window === "object") {
    const sessionWindow = entry.window;
    const rawTabs = Array.isArray(sessionWindow.tabs) ? sessionWindow.tabs : [];
    const normalizedTabs = rawTabs.map((tab) => normalizeSessionTabEntry(tab)).filter(Boolean);
    if (!normalizedTabs.length) {
      return null;
    }
    const sessionId = typeof entry.sessionId === "string" && entry.sessionId
      ? entry.sessionId
      : typeof sessionWindow.sessionId === "string" && sessionWindow.sessionId
      ? sessionWindow.sessionId
      : null;
    if (!sessionId) {
      return null;
    }
    const tabCount = normalizedTabs.length;
    const primaryTab = normalizedTabs.find((tab) => tab.active && tab.url) || normalizedTabs.find((tab) => tab.url) || normalizedTabs[0];
    const rawTitle = typeof sessionWindow.title === "string" ? sessionWindow.title.trim() : "";
    const title = rawTitle || primaryTab?.title || (tabCount === 1 ? normalizedTabs[0].title : "Recently closed window");
    const hostname = primaryTab?.hostname || extractHostname(primaryTab?.url || "");
    const descriptionParts = ["Closed window", formatTabCountLabel(tabCount)];
    if (hostname) {
      descriptionParts.push(hostname);
    }
    const previewTabs = buildSessionPreviewTabs(normalizedTabs, RECENT_WINDOW_PREVIEW_LIMIT, primaryTab);
    return {
      type: "recentSession",
      title,
      url: primaryTab?.url || "",
      sessionId,
      sessionType: "window",
      tabCount,
      closedAt,
      createdAt: closedAt,
      lastAccessed: closedAt,
      description: descriptionParts.join(" · "),
      origin: extractOrigin(primaryTab?.url || ""),
      faviconUrl: primaryTab?.favIconUrl || null,
      iconHint: "recent-window",
      sessionTabs: previewTabs,
      hasAdditionalTabs: normalizedTabs.length > previewTabs.length,
    };
  }

  return null;
}

function requestTopSites() {
  if (!chrome?.topSites || typeof chrome.topSites.get !== "function") {
    return Promise.resolve([]);
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.topSites.get((entries) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(Array.isArray(entries) ? entries : []);
      });
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    console.warn("Spotlight: failed to query top sites", err);
    return [];
  });
}

async function indexTopSites(indexMap, termBuckets, items) {
  const topSites = await requestTopSites();
  for (const entry of topSites) {
    if (!entry || !entry.url) {
      continue;
    }
    const title = entry.title || entry.url;
    const visitCount = typeof entry.visitCount === "number" ? entry.visitCount : null;
    const hostname = extractHostname(entry.url);
    const itemId = items.length;
    const item = {
      id: itemId,
      type: "topSite",
      title,
      url: entry.url,
      visitCount,
      origin: extractOrigin(entry.url),
      description: hostname || entry.url,
    };
    items.push(item);

    addToIndex(indexMap, termBuckets, itemId, title, TOP_SITE_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, entry.url, URL_WEIGHT);
    if (hostname) {
      addToIndex(indexMap, termBuckets, itemId, hostname, URL_WEIGHT);
    }
  }
  return topSites.length;
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
      audible: Boolean(tab.audible),
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

async function indexRecentSessions(indexMap, termBuckets, items) {
  if (!chrome?.sessions || typeof chrome.sessions.getRecentlyClosed !== "function") {
    return 0;
  }

  let sessions = [];
  try {
    sessions = await chrome.sessions.getRecentlyClosed({ maxResults: RECENT_SESSION_LIMIT });
  } catch (err) {
    console.warn("Spotlight: failed to query recently closed sessions", err);
    return 0;
  }

  let indexed = 0;

  for (const entry of Array.isArray(sessions) ? sessions : []) {
    const normalized = normalizeSessionEntry(entry);
    if (!normalized) {
      continue;
    }

    const itemId = items.length;
    const item = { ...normalized, id: itemId };
    items.push(item);
    indexed += 1;

    addToIndex(indexMap, termBuckets, itemId, item.title, TAB_TITLE_WEIGHT);

    const primaryUrl = typeof item.url === "string" ? item.url : "";
    if (primaryUrl) {
      addToIndex(indexMap, termBuckets, itemId, primaryUrl, URL_WEIGHT);
      const primaryHost = extractHostname(primaryUrl);
      if (primaryHost) {
        addToIndex(indexMap, termBuckets, itemId, primaryHost, URL_WEIGHT);
      }
    }

    if (Array.isArray(item.sessionTabs)) {
      item.sessionTabs.forEach((tab, index) => {
        if (!tab) {
          return;
        }
        if (tab.title) {
          const weight = index === 0 ? TAB_TITLE_WEIGHT : RECENT_SESSION_SECONDARY_TITLE_WEIGHT;
          addToIndex(indexMap, termBuckets, itemId, tab.title, weight);
        }
        if (tab.url) {
          const weight = index === 0 ? URL_WEIGHT : RECENT_SESSION_SECONDARY_URL_WEIGHT;
          addToIndex(indexMap, termBuckets, itemId, tab.url, weight);
          const host = extractHostname(tab.url);
          if (host) {
            addToIndex(indexMap, termBuckets, itemId, host, weight);
          }
        }
      });
    }
  }

  return indexed;
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
    indexRecentSessions(indexMap, termBuckets, items),
    indexTopSites(indexMap, termBuckets, items),
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
    bookmarkCount: items.reduce((count, item) => (item.type === "bookmark" ? count + 1 : count), 0),
    downloadCount: items.reduce((count, item) => (item.type === "download" ? count + 1 : count), 0),
    topSiteCount: items.reduce((count, item) => (item.type === "topSite" ? count + 1 : count), 0),
    recentSessionCount: items.reduce((count, item) => (item.type === "recentSession" ? count + 1 : count), 0),
  };

  return {
    items,
    index: indexMap,
    termBuckets: buckets,
    metadata,
    createdAt: Date.now(),
  };
}
