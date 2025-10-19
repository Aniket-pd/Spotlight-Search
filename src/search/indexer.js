const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 500;
const DOWNLOAD_SEARCH_LIMIT = 200;

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

export async function buildIndex() {
  const items = [];
  const indexMap = new Map();
  const termBuckets = new Map();

  await Promise.all([
    indexTabs(indexMap, termBuckets, items),
    indexBookmarks(indexMap, termBuckets, items),
    indexHistory(indexMap, termBuckets, items),
    indexDownloads(indexMap, termBuckets, items),
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
    downloadCount: items.reduce((count, item) => (item.type === "download" ? count + 1 : count), 0),
    topSiteCount: items.reduce((count, item) => (item.type === "topSite" ? count + 1 : count), 0),
  };

  return {
    items,
    index: indexMap,
    termBuckets: buckets,
    metadata,
    createdAt: Date.now(),
  };
}
