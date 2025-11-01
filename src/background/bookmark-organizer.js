import { browser } from "../shared/browser-shim.js";

const PROMPT_TEMPLATE = `You are the "Smart Bookmark Organizer" for a browser extension. Your job is to turn messy bookmark metadata into a tidy catalog that people can scan, search, and maintain quickly.

Follow these rules carefully:
1. Work strictly with the bookmark data supplied in the input payload. Do not invent URLs or content.
2. For every bookmark, emit a JSON object containing:
   - \`id\`: the id from the input.
   - \`cleanTitle\`: polished title text. Fix obvious casing/punctuation.
   - \`primaryCategory\`: 1–3 word label that captures the main theme.
   - \`action\`: one of \`keep\`, \`archive\`, or \`reviewDuplicate\`.
   - \`duplicateOf\`: the id of the suspected duplicate when \`action\` is \`reviewDuplicate\`; otherwise \`null\`.
   - \`notes\`: practical tip or follow-up (≤120 characters). Use an empty string when nothing is needed.
3. Choose categories that resemble real bookmark folders (e.g., "Research", "Learning", "Entertainment", "Tools", "Shopping", "Personal"). Use "Unsorted" if the theme is unclear and explain why in \`notes\`.
4. If two bookmarks look like duplicates (same topic + nearly identical titles or URLs), set \`action\` to \`reviewDuplicate\`, point \`duplicateOf\` to the matching id, and mention the reason in \`notes\`.
5. Do not include prose outside the JSON response.

Output schema:
{
  "bookmarks": BookmarkResult[]
}

BookmarkResult = {
  "id": string,
  "cleanTitle": string,
  "primaryCategory": string,
  "action": "keep" | "archive" | "reviewDuplicate",
  "duplicateOf": string | null,
  "notes": string
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bookmarks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          cleanTitle: { type: "string" },
          primaryCategory: { type: "string" },
          action: {
            type: "string",
            enum: ["keep", "archive", "reviewDuplicate"],
          },
          duplicateOf: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          notes: { type: "string" },
        },
        required: [
          "id",
          "cleanTitle",
          "primaryCategory",
          "action",
        ],
      },
    },
  },
  required: ["bookmarks"],
};

const DEFAULT_LANGUAGE = "English";
const DEFAULT_BOOKMARK_LIMIT = 60;
const MAX_BOOKMARK_LIMIT = 200;
const RECENTLY_ORGANIZED_TTL = 10 * 60 * 1000; // 10 minutes
const RECENTLY_ORGANIZED_MAX = 600;

function formatDate(timestamp) {
  if (!timestamp) {
    return "";
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  } catch (err) {
    return "";
  }
}

function formatBookmarkNotes(entry) {
  const parts = [];
  if (entry.path) {
    parts.push(`Folder: ${entry.path}`);
  }
  const added = formatDate(entry.dateAdded);
  if (added) {
    parts.push(`Added: ${added}`);
  }
  return parts.join(" · ");
}

function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function sanitizeFolderName(name = "") {
  return name.replace(/[\\/]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function normalizeFolderName(name = "") {
  return sanitizeFolderName(name).toLowerCase();
}

function createBookmarkSnapshot(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return { ids: new Set(), maxDateAdded: null };
  }

  const ids = new Set();
  let maxDateAdded = null;

  for (const entry of entries) {
    const id = normalizeId(entry?.id);
    if (id) {
      ids.add(id);
    }

    const added = typeof entry?.dateAdded === "number" ? entry.dateAdded : null;
    if (Number.isFinite(added) && (maxDateAdded === null || added > maxDateAdded)) {
      maxDateAdded = added;
    }
  }

  return { ids, maxDateAdded };
}

function hasUnseenBookmarks(entries, snapshot) {
  if (!Array.isArray(entries) || !entries.length) {
    return false;
  }

  if (!snapshot || !(snapshot.ids instanceof Set)) {
    return true;
  }

  const lastMaxDate = Number.isFinite(snapshot.maxDateAdded) ? snapshot.maxDateAdded : null;

  for (const entry of entries) {
    const id = normalizeId(entry?.id);
    if (id && !snapshot.ids.has(id)) {
      return true;
    }

    const added = typeof entry?.dateAdded === "number" ? entry.dateAdded : null;
    if (Number.isFinite(added) && (lastMaxDate === null || added > lastMaxDate)) {
      return true;
    }
  }

  return false;
}

function getBookmarkChildren(parentId) {
  return new Promise((resolve, reject) => {
    if (!parentId && parentId !== "0") {
      resolve([]);
      return;
    }
    try {
      browser.bookmarks.getChildren(parentId, (nodes) => {
        if (browser.runtime.lastError) {
          reject(browser.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function searchBookmarksByTitle(title) {
  return new Promise((resolve, reject) => {
    if (!title) {
      resolve([]);
      return;
    }
    try {
      browser.bookmarks.search({ title }, (nodes) => {
        if (browser.runtime.lastError) {
          reject(browser.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getRecentBookmarks(limit) {
  return new Promise((resolve, reject) => {
    const max = clampLimit(limit);
    try {
      browser.bookmarks.getRecent(max, (nodes) => {
        if (browser.runtime.lastError) {
          reject(browser.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getBookmarkNodeById(id) {
  return new Promise((resolve, reject) => {
    const normalizedId = normalizeId(id);
    if (!normalizedId && normalizedId !== "0") {
      resolve(null);
      return;
    }
    try {
      browser.bookmarks.get(normalizedId, (nodes) => {
        if (browser.runtime.lastError) {
          reject(browser.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) && nodes.length ? nodes[0] : null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeBookmarkNode(node) {
  if (!node) {
    return null;
  }
  const id = normalizeId(node.id);
  if (!id) {
    return null;
  }
  const parentId = normalizeId(node.parentId);
  const title = typeof node.title === "string" ? node.title : "";
  const isFolder = !node.url;
  const children = Array.isArray(node.children)
    ? node.children.map((child) => normalizeId(child.id)).filter(Boolean)
    : [];
  return { id, title, parentId, isFolder, children };
}

async function getOrFetchBookmarkNode(id, nodeMap) {
  const normalizedId = normalizeId(id);
  if (!normalizedId && normalizedId !== "0") {
    return null;
  }
  if (nodeMap.has(normalizedId)) {
    return nodeMap.get(normalizedId);
  }
  const rawNode = await getBookmarkNodeById(normalizedId);
  const normalizedNode = normalizeBookmarkNode(rawNode);
  if (normalizedNode) {
    nodeMap.set(normalizedNode.id, normalizedNode);
  }
  return normalizedNode;
}

async function buildAncestorChain(parentId, nodeMap) {
  const chain = [];
  const visited = new Set();
  let currentId = normalizeId(parentId);
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = await getOrFetchBookmarkNode(currentId, nodeMap);
    if (!node) {
      break;
    }
    chain.push(node);
    currentId = node.parentId;
  }
  return chain.reverse();
}

function clampLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_BOOKMARK_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_BOOKMARK_LIMIT);
}

function compareBookmarksByRecency(a, b) {
  const aTime = typeof a?.dateAdded === "number" ? a.dateAdded : 0;
  const bTime = typeof b?.dateAdded === "number" ? b.dateAdded : 0;
  if (bTime !== aTime) {
    return bTime - aTime;
  }
  const aTitle = typeof a?.title === "string" ? a.title : "";
  const bTitle = typeof b?.title === "string" ? b.title : "";
  return aTitle.localeCompare(bTitle);
}

function binarySearchInsertDescending(array, value, compare) {
  let low = 0;
  let high = array.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compare(value, array[mid]) < 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function selectMostRecentBookmarks(bookmarks, limit, excludeIds) {
  const total = Array.isArray(bookmarks) ? bookmarks : [];
  if (!total.length) {
    return [];
  }
  const max = clampLimit(limit);
  const exclude = excludeIds instanceof Set && excludeIds.size ? excludeIds : null;

  if (!exclude) {
    if (total.length <= max) {
      return [...total].sort(compareBookmarksByRecency);
    }
  } else {
    const filtered = total.filter((entry) => entry && !exclude.has(String(entry.id)));
    if (!filtered.length) {
      return [];
    }
    if (filtered.length <= max) {
      return filtered.sort(compareBookmarksByRecency);
    }
  }

  const selected = [];
  for (const entry of total) {
    if (!entry) {
      continue;
    }
    if (exclude && exclude.has(String(entry.id))) {
      continue;
    }
    const index = binarySearchInsertDescending(selected, entry, compareBookmarksByRecency);
    selected.splice(index, 0, entry);
    if (selected.length > max) {
      selected.pop();
    }
  }
  return selected;
}

function normalizeOrganizerAction(value) {
  if (value === "archive" || value === "reviewDuplicate") {
    return value;
  }
  return "keep";
}

function sanitizeOrganizerResult(rawResult) {
  const sanitized = [];
  const rawBookmarks = Array.isArray(rawResult?.bookmarks) ? rawResult.bookmarks : [];
  for (const entry of rawBookmarks) {
    if (!entry || typeof entry.id === "undefined") {
      continue;
    }
    const id = String(entry.id);
    if (!id) {
      continue;
    }
    const cleanTitle = typeof entry.cleanTitle === "string" ? entry.cleanTitle.trim() : "";
    const primaryCategory = typeof entry.primaryCategory === "string" ? entry.primaryCategory.trim() : "";
    const action = normalizeOrganizerAction(entry.action);
    const duplicateOf =
      action === "reviewDuplicate" && entry.duplicateOf !== null && entry.duplicateOf !== undefined
        ? String(entry.duplicateOf)
        : null;
    const notes = typeof entry.notes === "string" ? entry.notes.trim() : "";
    sanitized.push({ id, cleanTitle, primaryCategory, action, duplicateOf, notes });
  }
  return { bookmarks: sanitized };
}

function buildPromptPayload(bookmarks, language) {
  const payload = {
    language: language || DEFAULT_LANGUAGE,
    bookmarks: bookmarks.map((entry) => {
      const item = {
        id: String(entry.id),
        title: entry.title || entry.url || "Untitled bookmark",
        url: entry.url || "",
      };
      if (entry.userNotes) {
        item.userNotes = entry.userNotes;
      }
      return item;
    }),
  };
  return payload;
}

function buildPromptText(payload) {
  const payloadJson = JSON.stringify(payload, null, 2);
  return `${PROMPT_TEMPLATE}\n\nInput payload:\n${payloadJson}`;
}

function determineTargetFolderName(resultEntry) {
  const action = typeof resultEntry?.action === "string" ? resultEntry.action : "keep";
  if (action === "archive") {
    return "Archive";
  }
  if (action === "reviewDuplicate") {
    return "Duplicates";
  }
  const category = typeof resultEntry?.primaryCategory === "string" ? resultEntry.primaryCategory.trim() : "";
  if (category) {
    return category;
  }
  return "Organized";
}

async function ensureFolder(parentId, title, folderLookup, createdFolders, nodeMap, folderNameCache) {
  const sanitizedTitle = sanitizeFolderName(title);
  const normalized = normalizeFolderName(sanitizedTitle);
  if (!normalized) {
    return parentId;
  }
  const cacheKey = `${parentId || "root"}::${normalized}`;
  if (createdFolders.has(cacheKey)) {
    return createdFolders.get(cacheKey);
  }

  const normalizedParentId = normalizeId(parentId);
  const globalCache = folderNameCache instanceof Map ? folderNameCache : null;
  let cachedFallback = null;
  if (globalCache && globalCache.has(normalized)) {
    const cachedEntry = globalCache.get(normalized);
    const cachedId = normalizeId(cachedEntry?.id);
    if (cachedId || cachedId === "0") {
      const cachedNode = await getOrFetchBookmarkNode(cachedId, nodeMap);
      if (cachedNode?.isFolder) {
        const cachedParentId = normalizeId(cachedNode.parentId);
        const cachedTitle =
          typeof cachedNode.title === "string" && cachedNode.title.trim()
            ? cachedNode.title.trim()
            : sanitizedTitle;

        let cachedFolderMap = folderLookup.get(cachedParentId);
        if (!cachedFolderMap) {
          cachedFolderMap = new Map();
          folderLookup.set(cachedParentId, cachedFolderMap);
        }
        cachedFolderMap.set(normalized, { id: cachedId, title: cachedTitle });

        createdFolders.set(cacheKey, cachedId);

        if (!nodeMap.has(cachedId)) {
          nodeMap.set(cachedId, {
            id: cachedId,
            title: cachedTitle,
            parentId: cachedParentId,
            isFolder: true,
            children: Array.isArray(cachedNode.children)
              ? cachedNode.children.map((child) => normalizeId(child)).filter(Boolean)
              : [],
          });
        }

        if (!normalizedParentId || cachedParentId === normalizedParentId) {
          return cachedId;
        }

        cachedFallback = { id: cachedId, parentId: cachedParentId, title: cachedTitle };
      } else {
        globalCache.delete(normalized);
      }
    } else {
      globalCache.delete(normalized);
    }
  }

  let folderMap = folderLookup.get(parentId);
  folderMap = await refreshFolderLookup(parentId, folderLookup, nodeMap);
  if (folderMap && folderMap.has(normalized)) {
    const existing = folderMap.get(normalized);
    const folderId = normalizeId(existing?.id ?? existing);
    if (!folderId && folderId !== "0") {
      return cachedFallback ? cachedFallback.id : parentId;
    }
    const folderTitle = typeof existing?.title === "string" ? existing.title : sanitizedTitle;
    createdFolders.set(cacheKey, folderId);
    if (globalCache) {
      globalCache.set(normalized, {
        id: folderId,
        parentId: normalizedParentId,
        title: folderTitle,
      });
    }
    if (!nodeMap.has(folderId)) {
      nodeMap.set(folderId, {
        id: folderId,
        title: folderTitle,
        parentId,
        isFolder: true,
        children: [],
      });
    }
    return folderId;
  }

  const located = await locateExistingFolderBySearch(
    parentId,
    normalized,
    sanitizedTitle,
    folderLookup,
    nodeMap,
    folderNameCache
  );
  if (located && located.id) {
    createdFolders.set(cacheKey, located.id);
    if (globalCache) {
      globalCache.set(normalized, {
        id: located.id,
        parentId: normalizeId(located.parentId),
        title: located.title || sanitizedTitle,
      });
    }
    return located.id;
  }

  if (cachedFallback && cachedFallback.id) {
    createdFolders.set(cacheKey, cachedFallback.id);
    return cachedFallback.id;
  }

  const folder = await browser.bookmarks.create({ parentId, title: sanitizedTitle });
  if (!folder || !folder.id) {
    throw new Error(`Failed to create folder "${sanitizedTitle}"`);
  }
  const folderId = String(folder.id);

  folderMap = await refreshFolderLookup(parentId, folderLookup, nodeMap);
  if (folderMap && folderMap.has(normalized)) {
    const refreshed = folderMap.get(normalized);
    const refreshedId = normalizeId(refreshed?.id ?? refreshed) || folderId;
    const refreshedTitle = typeof refreshed?.title === "string" ? refreshed.title : sanitizedTitle;
    createdFolders.set(cacheKey, refreshedId);
    if (globalCache) {
      globalCache.set(normalized, {
        id: refreshedId,
        parentId: normalizedParentId,
        title: refreshedTitle,
      });
    }
    nodeMap.set(refreshedId, {
      id: refreshedId,
      title: refreshedTitle,
      parentId,
      isFolder: true,
      children: [],
    });
    return refreshedId;
  }

  if (!folderMap) {
    folderMap = new Map();
    folderLookup.set(parentId, folderMap);
  }
  folderMap.set(normalized, { id: folderId, title: sanitizedTitle });
  createdFolders.set(cacheKey, folderId);
  if (globalCache) {
    globalCache.set(normalized, {
      id: folderId,
      parentId: normalizedParentId,
      title: sanitizedTitle,
    });
  }
  nodeMap.set(folderId, {
    id: folderId,
    title: sanitizedTitle,
    parentId,
    isFolder: true,
    children: [],
  });

  return folderId;
}

async function locateExistingFolderBySearch(
  parentId,
  normalizedName,
  sanitizedTitle,
  folderLookup,
  nodeMap,
  folderNameCache
) {
  if (!normalizedName || !sanitizedTitle) {
    return null;
  }

  let nodes = [];
  try {
    nodes = await searchBookmarksByTitle(sanitizedTitle);
  } catch (error) {
    console.warn("Failed to search bookmarks while locating organizer folder", error);
    return null;
  }

  if (!nodes.length) {
    return null;
  }

  const normalizedParentId = normalizeId(parentId);
  const globalCache = folderNameCache instanceof Map ? folderNameCache : null;
  let fallback = null;
  for (const node of nodes) {
    if (!node || node.url) {
      continue;
    }
    const nodeId = normalizeId(node.id);
    const nodeParentId = normalizeId(node.parentId);
    if (!nodeId || !nodeParentId) {
      continue;
    }
    const candidateTitle = typeof node.title === "string" ? node.title : "";
    if (normalizeFolderName(candidateTitle) !== normalizedName) {
      continue;
    }

    const normalizedNode = normalizeBookmarkNode(node) || {
      id: nodeId,
      title: sanitizeFolderName(candidateTitle) || sanitizedTitle,
      parentId: nodeParentId,
      isFolder: true,
      children: [],
    };
    nodeMap.set(nodeId, normalizedNode);

    let folderMap = folderLookup.get(nodeParentId);
    if (!folderMap) {
      folderMap = new Map();
      folderLookup.set(nodeParentId, folderMap);
    }
    const sanitizedCandidate =
      typeof node.title === "string" ? sanitizeFolderName(node.title) || sanitizedTitle : sanitizedTitle;
    folderMap.set(normalizedName, {
      id: nodeId,
      title: sanitizedCandidate,
    });

    const resolved = {
      id: nodeId,
      parentId: nodeParentId,
      title: sanitizedCandidate,
    };

    if (!normalizedParentId || nodeParentId === normalizedParentId) {
      if (globalCache) {
        globalCache.set(normalizedName, resolved);
      }
      return resolved;
    }

    if (!fallback) {
      fallback = resolved;
    }
  }

  if (fallback) {
    if (globalCache) {
      globalCache.set(normalizedName, fallback);
    }
    return fallback;
  }

  return null;
}

async function refreshFolderLookup(parentId, folderLookup, nodeMap) {
  if (!parentId && parentId !== "0") {
    return folderLookup.get(parentId) || new Map();
  }

  let children = [];
  try {
    children = await getBookmarkChildren(parentId);
  } catch (error) {
    console.warn("Failed to load bookmark children for organizer", error);
  }

  let folderMap = folderLookup.get(parentId);
  if (!folderMap) {
    folderMap = new Map();
    folderLookup.set(parentId, folderMap);
  }

  for (const child of children) {
    if (!child || child.url) {
      continue;
    }
    const childId = normalizeId(child.id);
    const childTitle = typeof child.title === "string" ? child.title.trim() : "";
    const normalized = normalizeFolderName(childTitle);
    if (!childId || !normalized) {
      continue;
    }
    folderMap.set(normalized, { id: childId, title: childTitle });
    if (!nodeMap.has(childId)) {
      nodeMap.set(childId, {
        id: childId,
        title: childTitle,
        parentId,
        isFolder: true,
        children: Array.isArray(child.children)
          ? child.children.map((entry) => normalizeId(entry.id))
          : [],
      });
    }
  }

  return folderMap;
}

async function applyOrganizerChanges(sourceBookmarks, organizerResult, context = {}) {
  const bookmarkResults = Array.isArray(organizerResult?.bookmarks) ? organizerResult.bookmarks : [];
  if (!bookmarkResults.length || !Array.isArray(sourceBookmarks) || !sourceBookmarks.length) {
    return { renamed: 0, moved: 0, createdFolders: 0 };
  }

  const folderLookup = context.folderLookup instanceof Map ? context.folderLookup : new Map();
  const nodeMap = context.nodeMap instanceof Map ? context.nodeMap : new Map();
  const folderNameCache = context.folderNameCache instanceof Map ? context.folderNameCache : null;
  const createdFolders = new Map();
  const sourceMap = new Map(sourceBookmarks.map((entry) => [String(entry.id), entry]));

  let renamed = 0;
  let moved = 0;

  for (const resultEntry of bookmarkResults) {
    if (!resultEntry || typeof resultEntry.id === "undefined") {
      continue;
    }
    const bookmarkId = String(resultEntry.id);
    const source = sourceMap.get(bookmarkId);
    if (!source) {
      continue;
    }

    const cleanTitle = typeof resultEntry.cleanTitle === "string" ? resultEntry.cleanTitle.trim() : "";
    if (cleanTitle && cleanTitle !== source.title) {
      await browser.bookmarks.update(bookmarkId, { title: cleanTitle });
      source.title = cleanTitle;
      renamed += 1;
    }

    const parentId = source.parentId || (source.ancestors?.length ? source.ancestors[source.ancestors.length - 1].id : null);
    if (!parentId) {
      continue;
    }

    const targetFolderName = determineTargetFolderName(resultEntry);
    const normalizedTarget = normalizeFolderName(targetFolderName);
    if (!normalizedTarget) {
      continue;
    }

    const directParent = Array.isArray(source.ancestors) && source.ancestors.length
      ? source.ancestors[source.ancestors.length - 1]
      : null;
    const currentParentInfo = nodeMap.get(source.parentId);
    const fallbackParentTitle =
      typeof source.parentTitle === "string" && source.parentTitle
        ? source.parentTitle
        : typeof directParent?.title === "string"
        ? directParent.title
        : "";
    const currentParentTitle = currentParentInfo?.title || fallbackParentTitle || "";
    const normalizedCurrentParent = normalizeFolderName(currentParentTitle);
    if (normalizedCurrentParent === normalizedTarget) {
      continue;
    }

    if (
      !normalizedCurrentParent &&
      Array.isArray(source.ancestors) &&
      source.ancestors.some((ancestor) => normalizeFolderName(ancestor?.title) === normalizedTarget)
    ) {
      continue;
    }

    const folderId = await ensureFolder(
      parentId,
      targetFolderName,
      folderLookup,
      createdFolders,
      nodeMap,
      folderNameCache
    );
    if (!folderId || folderId === source.parentId) {
      continue;
    }

    await browser.bookmarks.move(bookmarkId, { parentId: folderId });
    source.parentId = folderId;
    moved += 1;
  }

  return { renamed, moved, createdFolders: createdFolders.size };
}

async function collectRecentBookmarks(limit, excludeIds) {
  const desiredLimit = clampLimit(limit);
  const excludeSet = excludeIds instanceof Set && excludeIds.size ? excludeIds : null;
  const requestSize = Math.min(
    MAX_BOOKMARK_LIMIT,
    Math.max(desiredLimit * 2, desiredLimit + (excludeSet ? excludeSet.size : 0) + 10)
  );
  const recentNodes = await getRecentBookmarks(requestSize);
  if (!recentNodes.length) {
    return { bookmarks: [], folderLookup: new Map(), nodeMap: new Map() };
  }

  const folderLookup = new Map();
  const nodeMap = new Map();
  const bookmarks = [];
  const seenIds = new Set();

  for (const node of recentNodes) {
    if (!node || node.url === undefined) {
      continue;
    }
    const bookmarkId = normalizeId(node.id);
    if (!bookmarkId || seenIds.has(bookmarkId)) {
      continue;
    }
    seenIds.add(bookmarkId);
    if (excludeSet && excludeSet.has(bookmarkId)) {
      continue;
    }

    const ancestry = await buildAncestorChain(node.parentId, nodeMap);
    const parent = ancestry.length ? ancestry[ancestry.length - 1] : null;
    const parentId = normalizeId(node.parentId);
    if (parentId && !folderLookup.has(parentId)) {
      folderLookup.set(parentId, new Map());
    }

    const ancestors = ancestry.map((ancestor) => ({
      id: ancestor.id,
      title: ancestor.title,
      parentId: ancestor.parentId,
    }));
    const path = ancestors.map((ancestor) => ancestor.title).filter(Boolean).join(" / ");
    const entry = {
      id: bookmarkId,
      title: typeof node.title === "string" && node.title ? node.title : node.url || "Untitled bookmark",
      url: typeof node.url === "string" ? node.url : "",
      dateAdded: typeof node.dateAdded === "number" ? node.dateAdded : null,
      parentId,
      parentTitle: parent?.title || "",
      path,
      ancestors,
    };
    entry.userNotes = formatBookmarkNotes(entry);

    nodeMap.set(bookmarkId, {
      id: bookmarkId,
      title: entry.title,
      parentId,
      isFolder: false,
      children: [],
    });

    bookmarks.push(entry);
  }

  const limited = selectMostRecentBookmarks(bookmarks, desiredLimit, excludeSet);
  return { bookmarks: limited, folderLookup, nodeMap };
}

export function createBookmarkOrganizerService(options = {}) {
  const { scheduleRebuild } = options;
  let sessionInstance = null;
  let sessionPromise = null;
  let activeRequest = null;
  const recentlyOrganized = new Map();
  const folderNameCache = new Map();
  let lastOrganizedSnapshot = null;

  function pruneRecentlyOrganized(now = Date.now()) {
    for (const [id, timestamp] of recentlyOrganized) {
      if (!Number.isFinite(timestamp) || now - timestamp > RECENTLY_ORGANIZED_TTL) {
        recentlyOrganized.delete(id);
      }
    }
  }

  function buildExcludeSet(now = Date.now()) {
    pruneRecentlyOrganized(now);
    if (!recentlyOrganized.size) {
      return null;
    }
    return new Set(recentlyOrganized.keys());
  }

  function rememberOrganized(ids, now = Date.now()) {
    if (!Array.isArray(ids) || !ids.length) {
      return;
    }
    pruneRecentlyOrganized(now);
    for (const id of ids) {
      if (!id && id !== "0") {
        continue;
      }
      recentlyOrganized.set(String(id), now);
    }
    if (recentlyOrganized.size > RECENTLY_ORGANIZED_MAX) {
      const entries = [...recentlyOrganized.entries()].sort((a, b) => a[1] - b[1]);
      for (const [id] of entries) {
        if (recentlyOrganized.size <= RECENTLY_ORGANIZED_MAX) {
          break;
        }
        recentlyOrganized.delete(id);
      }
    }
  }

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
    }
    if (sessionPromise) {
      return sessionPromise;
    }
    if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
      throw new Error("Prompt API unavailable");
    }
    const availability = await globalThis.LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Prompt model unavailable");
    }
    sessionPromise = globalThis.LanguageModel.create({
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
          if (percent !== null) {
            console.info(`Spotlight bookmark organizer model download ${percent}%`);
          }
        });
      },
    })
      .then((instance) => {
        sessionInstance = instance;
        sessionPromise = null;
        return instance;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
    return sessionPromise;
  }

  async function runPrompt(payload) {
    const session = await ensureSession();
    const promptText = buildPromptText(payload);
    const raw = await session.prompt(promptText, {
      responseConstraint: RESPONSE_SCHEMA,
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("Bookmark organizer returned invalid JSON");
    }
    return { raw, parsed };
  }

  async function organizeBookmarks(options = {}) {
    if (activeRequest) {
      return activeRequest;
    }
    const task = (async () => {
      const limit = clampLimit(options.limit);
      const language = typeof options.language === "string" && options.language ? options.language : DEFAULT_LANGUAGE;
      const startedAt = Date.now();
      const excludeSet = buildExcludeSet(startedAt);
      const { bookmarks, folderLookup, nodeMap } = await collectRecentBookmarks(limit, excludeSet);
      if (!bookmarks.length) {
        throw new Error("No new bookmarks available to organize");
      }
      if (!hasUnseenBookmarks(bookmarks, lastOrganizedSnapshot)) {
        throw new Error("No new bookmarks added since the last run");
      }
      const payload = buildPromptPayload(bookmarks, language);
      const { raw, parsed } = await runPrompt(payload);
      const sanitizedResult = sanitizeOrganizerResult(parsed);
      const changes = await applyOrganizerChanges(bookmarks, sanitizedResult, {
        folderLookup,
        nodeMap,
        folderNameCache,
      });
      rememberOrganized(
        bookmarks.map((entry) => (entry && typeof entry.id !== "undefined" ? String(entry.id) : null)).filter(Boolean),
        Date.now()
      );
      lastOrganizedSnapshot = createBookmarkSnapshot(bookmarks);
      if (
        typeof scheduleRebuild === "function" &&
        changes &&
        (changes.renamed > 0 || changes.moved > 0 || changes.createdFolders > 0)
      ) {
        scheduleRebuild(200);
      }
      return {
        generatedAt: Date.now(),
        payload,
        sourceBookmarks: bookmarks,
        result: sanitizedResult,
        rawText: raw,
        changes,
      };
    })();
    activeRequest = task
      .then((value) => {
        activeRequest = null;
        return value;
      })
      .catch((error) => {
        activeRequest = null;
        throw error;
      });
    return activeRequest;
  }

  return {
    organizeBookmarks,
  };
}
