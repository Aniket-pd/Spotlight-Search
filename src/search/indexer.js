const TAB_TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const HISTORY_LIMIT = 500;
const DOWNLOAD_SEARCH_LIMIT = 200;
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

function parseChromeTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return 0;
}

function extractFilename(path) {
  if (typeof path !== "string" || !path) {
    return "";
  }
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (!segments.length) {
    return path;
  }
  return segments[segments.length - 1];
}

function formatDownloadState(state, { paused = false } = {}) {
  if (paused) {
    return "Paused";
  }
  switch (state) {
    case "complete":
      return "Completed";
    case "in_progress":
      return "In Progress";
    case "interrupted":
      return "Interrupted";
    default:
      return "Download";
  }
}

async function indexDownloads(indexMap, termBuckets, items) {
  if (!chrome.downloads || typeof chrome.downloads.search !== "function") {
    return;
  }

  let downloads = [];
  try {
    downloads = await chrome.downloads.search({ orderBy: ["-startTime"], limit: DOWNLOAD_SEARCH_LIMIT });
  } catch (err) {
    try {
      downloads = await chrome.downloads.search({});
    } catch (fallbackError) {
      console.warn("Spotlight: unable to index downloads", fallbackError);
      return;
    }
  }

  const limitedDownloads = Array.isArray(downloads)
    ? downloads.slice(0, DOWNLOAD_SEARCH_LIMIT)
    : [];

  const now = Date.now();

  for (const download of limitedDownloads) {
    if (!download || typeof download.id !== "number") {
      continue;
    }

    const finalUrl = download.finalUrl || download.url || "";
    const origin = extractOrigin(finalUrl);
    const hostname = extractHostname(finalUrl);
    const title = extractFilename(download.filename) || hostname || finalUrl || `Download ${download.id}`;
    const startedAt = parseChromeTimestamp(download.startTime);
    const completedAt = parseChromeTimestamp(download.endTime);
    const estimatedEndAt = parseChromeTimestamp(download.estimatedEndTime);
    const timestamp = completedAt || startedAt || now;
    const state = download.state || "";
    const paused = Boolean(download.paused);
    const stateLabel = formatDownloadState(state, { paused });
    const descriptionParts = [stateLabel];
    if (hostname) {
      descriptionParts.push(hostname);
    } else if (download.filename) {
      descriptionParts.push(extractFilename(download.filename));
    }
    const description = descriptionParts.join(" · ");

    const bytesReceived = typeof download.bytesReceived === "number" && Number.isFinite(download.bytesReceived)
      ? Math.max(download.bytesReceived, 0)
      : 0;
    let totalBytes = typeof download.totalBytes === "number" && Number.isFinite(download.totalBytes)
      ? Math.max(download.totalBytes, 0)
      : 0;
    if (!totalBytes && typeof download.fileSize === "number" && Number.isFinite(download.fileSize)) {
      totalBytes = Math.max(download.fileSize, 0);
    }
    if (!totalBytes && state === "complete" && bytesReceived) {
      totalBytes = bytesReceived;
    }

    let progress = null;
    let progressPercent = null;
    if (totalBytes > 0) {
      progress = Math.min(1, Math.max(0, bytesReceived / totalBytes));
      progressPercent = Math.round(progress * 100);
    }

    let speedBytesPerSecond = 0;
    if (state === "in_progress" && bytesReceived > 0 && startedAt) {
      const elapsedMs = Math.max(now - startedAt, 0);
      const elapsedSeconds = elapsedMs / 1000;
      if (elapsedSeconds > 0.5) {
        speedBytesPerSecond = bytesReceived / elapsedSeconds;
      }
    }
    if (state === "in_progress" && speedBytesPerSecond <= 0 && totalBytes > 0 && estimatedEndAt > now) {
      const remainingBytes = Math.max(totalBytes - bytesReceived, 0);
      const remainingSeconds = (estimatedEndAt - now) / 1000;
      if (remainingBytes > 0 && remainingSeconds > 0.5) {
        speedBytesPerSecond = remainingBytes / remainingSeconds;
      }
    }

    const sizeBytes = totalBytes || bytesReceived || 0;

    const itemId = items.length;
    items.push({
      id: itemId,
      type: "download",
      title,
      url: finalUrl,
      description,
      downloadId: download.id,
      state,
      stateLabel,
      filePath: download.filename || "",
      startedAt,
      completedAt,
      timestamp,
      origin,
      hostname,
      bytesReceived,
      totalBytes,
      sizeBytes,
      progress,
      progressPercent,
      speedBytesPerSecond,
      paused,
      canResume: Boolean(download.canResume),
      exists: typeof download.exists === "boolean" ? download.exists : true,
      danger: download.danger || "safe",
      estimatedEndAt,
    });

    addToIndex(indexMap, termBuckets, itemId, title, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, download.filename, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, description, TAB_TITLE_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, finalUrl, URL_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, hostname, URL_WEIGHT);
    addToIndex(indexMap, termBuckets, itemId, stateLabel, URL_WEIGHT);
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
    downloadStateCounts: items.reduce((acc, item) => {
      if (item.type !== "download") {
        return acc;
      }
      const key = item.state || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    items,
    index: indexMap,
    termBuckets: buckets,
    metadata,
    createdAt: Date.now(),
  };
}
