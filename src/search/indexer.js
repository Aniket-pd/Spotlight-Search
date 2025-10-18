const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 500;
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

function extractFilename(path) {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const last = parts[parts.length - 1];
  return last || path;
}

function parseChromeTime(value) {
  if (!value) {
    return 0;
  }
  try {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  } catch (err) {
    return 0;
  }
}

function computeDownloadProgress(bytesReceived, totalBytes) {
  if (typeof totalBytes !== "number" || totalBytes <= 0) {
    return null;
  }
  if (typeof bytesReceived !== "number" || bytesReceived < 0) {
    return 0;
  }
  return Math.min(1, bytesReceived / totalBytes);
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
    const itemId = items.length;
    items.push({
      id: itemId,
      type: "history",
      title: entry.title || entry.url,
      url: entry.url,
      lastVisitTime: entry.lastVisitTime,
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
    downloads = await chrome.downloads.search({});
  } catch (err) {
    console.warn("Spotlight: unable to index downloads", err);
    return;
  }

  downloads = downloads
    .slice()
    .sort((a, b) => parseChromeTime(b.startTime) - parseChromeTime(a.startTime))
    .slice(0, 200);

  for (const entry of downloads) {
    const itemId = items.length;
    const filename = extractFilename(entry.filename || "");
    const url = entry.finalUrl || entry.url || "";
    const downloadId = typeof entry.id === "number" ? entry.id : null;
    const bytesReceived = typeof entry.bytesReceived === "number" ? entry.bytesReceived : 0;
    const totalBytes = typeof entry.totalBytes === "number" && entry.totalBytes >= 0 ? entry.totalBytes : null;
    const progress = computeDownloadProgress(bytesReceived, totalBytes);
    const startedAt = parseChromeTime(entry.startTime);
    const completedAt = entry.state === "complete" ? parseChromeTime(entry.endTime) : 0;
    const estimatedEndTime = entry.estimatedEndTime ? parseChromeTime(entry.estimatedEndTime) : 0;

    items.push({
      id: itemId,
      type: "download",
      title: filename || url || "Download",
      url,
      downloadId,
      filename: entry.filename || "",
      state: entry.state || "in_progress",
      danger: entry.danger || "safe",
      bytesReceived,
      totalBytes,
      progress,
      startedAt,
      completedAt,
      estimatedEndTime,
      canResume: Boolean(entry.canResume),
      paused: Boolean(entry.paused),
      exists: entry.exists !== false,
      originalUrl: entry.url || "",
      referrer: entry.referrer || "",
      speedBytesPerSecond: null,
      etaSeconds: null,
    });

    addToIndex(indexMap, termBuckets, itemId, filename, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, url, URL_WEIGHT);
    if (entry.referrer) {
      addToIndex(indexMap, termBuckets, itemId, entry.referrer, URL_WEIGHT);
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
  };

  return {
    items,
    index: indexMap,
    termBuckets: buckets,
    metadata,
    createdAt: Date.now(),
  };
}
