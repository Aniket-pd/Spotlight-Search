const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 500;
export const BOOKMARK_ROOT_FOLDER_KEY = "__SPOTLIGHT_ROOT_FOLDER__";

function extractFileName(path = "") {
  if (!path) return "";
  const normalized = String(path);
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (!segments.length) {
    return normalized.trim();
  }
  return segments[segments.length - 1] || normalized.trim();
}

function buildDownloadTitle(entry) {
  if (!entry) return "Download";
  const fileName = extractFileName(entry.filename || "");
  if (fileName) {
    return fileName;
  }
  if (entry.byExtensionName) {
    return entry.byExtensionName;
  }
  return extractFileName(entry.finalUrl || entry.url || "") || "Download";
}

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
  if (!chrome?.downloads?.search) {
    return;
  }

  let downloads = [];
  try {
    downloads = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 400 });
  } catch (err) {
    console.warn("Spotlight: failed to query downloads", err);
    return;
  }

  for (const download of downloads) {
    if (!download || typeof download.id !== "number") {
      continue;
    }

    const itemId = items.length;
    const title = buildDownloadTitle(download);
    const url = download.finalUrl || download.url || "";
    const startTime = download.startTime ? Date.parse(download.startTime) : Date.now();
    const endTime = download.endTime ? Date.parse(download.endTime) : null;
    const estimatedEndTime = download.estimatedEndTime ? Date.parse(download.estimatedEndTime) : null;
    const bytesReceived = typeof download.bytesReceived === "number" ? download.bytesReceived : 0;
    const totalBytes = typeof download.totalBytes === "number" ? download.totalBytes : 0;

    const item = {
      id: itemId,
      type: "download",
      title: title || url || "Download",
      url,
      downloadId: download.id,
      state: download.state || "in_progress",
      danger: download.danger || "safe",
      startTime: Number.isFinite(startTime) ? startTime : Date.now(),
      endTime: Number.isFinite(endTime) ? endTime : null,
      estimatedEndTime: Number.isFinite(estimatedEndTime) ? estimatedEndTime : null,
      bytesReceived,
      totalBytes,
      paused: Boolean(download.paused),
      canResume: Boolean(download.canResume),
      filename: extractFileName(download.filename || ""),
      filePath: download.filename || "",
      fileSize: typeof download.fileSize === "number" ? download.fileSize : totalBytes,
      referrer: download.referrer || "",
      byExtensionName: download.byExtensionName || "",
      dangerDescription: download.dangerDescription || "",
      iconUrl: download.mime || "",
      bytesPerSecond: 0,
      etaSeconds: null,
      origin: extractOrigin(url),
    };

    item.dateAdded = item.endTime || item.startTime || Date.now();
    item.lastUpdated = Date.now();

    items.push(item);

    addToIndex(indexMap, termBuckets, itemId, item.title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, url, URL_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, item.filename, TAB_TITLE_WEIGHT);
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
