const PROMPT_TEMPLATE = `You are the "Smart Bookmark Organizer" for a browser extension. Your job is to turn messy bookmark metadata into a tidy catalog that people can scan, search, and maintain quickly.

Follow these rules carefully:
1. Work strictly with the bookmark data supplied in the input payload. Do not invent URLs or content.
2. For every bookmark, emit a JSON object containing:
   - \`id\`: the id from the input.
   - \`cleanTitle\`: polished title text. Fix obvious casing/punctuation.
   - \`primaryCategory\`: 1–3 word label that captures the main theme.
   - \`secondaryTags\`: 1–4 optional lowerCamelCase tags for finer grouping.
   - \`keywords\`: 3–6 short search tokens that help retrieve the bookmark.
   - \`summary\`: one sentence (≤18 words) highlighting why the bookmark matters.
   - \`action\`: one of \`keep\`, \`archive\`, or \`reviewDuplicate\`.
   - \`duplicateOf\`: the id of the suspected duplicate when \`action\` is \`reviewDuplicate\`; otherwise \`null\`.
   - \`notes\`: practical tip or follow-up (≤120 characters). Use an empty string when nothing is needed.
3. Choose categories that resemble real bookmark folders (e.g., "Research", "Learning", "Entertainment", "Tools", "Shopping", "Personal"). Use "Unsorted" if the theme is unclear and explain why in \`notes\`.
4. If two bookmarks look like duplicates (same topic + nearly identical titles or URLs), set \`action\` to \`reviewDuplicate\`, point \`duplicateOf\` to the matching id, and mention the reason in \`notes\`.
5. Keep \`secondaryTags\` and \`keywords\` relevant—avoid generic terms such as "misc" or "link".
6. Do not include prose outside the JSON response.

Output schema:
{
  "collectionSummary": {
    "dominantCategories": string[],
    "bookmarksNeedingAttention": string[],
    "suggestedFolders": {
      category: {
        "count": number,
        "sampleIds": string[]
      }
    }
  },
  "bookmarks": BookmarkResult[]
}

BookmarkResult = {
  "id": string,
  "cleanTitle": string,
  "primaryCategory": string,
  "secondaryTags": string[],
  "keywords": string[],
  "summary": string,
  "action": "keep" | "archive" | "reviewDuplicate",
  "duplicateOf": string | null,
  "notes": string
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    collectionSummary: {
      type: "object",
      additionalProperties: false,
      properties: {
        dominantCategories: {
          type: "array",
          items: { type: "string" },
        },
        bookmarksNeedingAttention: {
          type: "array",
          items: { type: "string" },
        },
        suggestedFolders: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              count: { type: "number" },
              sampleIds: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["count", "sampleIds"],
          },
        },
      },
      required: ["dominantCategories", "bookmarksNeedingAttention", "suggestedFolders"],
    },
    bookmarks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          cleanTitle: { type: "string" },
          primaryCategory: { type: "string" },
          secondaryTags: {
            type: "array",
            items: { type: "string" },
          },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          summary: { type: "string" },
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
          "secondaryTags",
          "keywords",
          "summary",
          "action",
          "duplicateOf",
          "notes",
        ],
      },
    },
  },
  required: ["collectionSummary", "bookmarks"],
};

const DEFAULT_LANGUAGE = "English";
const DEFAULT_BOOKMARK_LIMIT = 60;
const MAX_BOOKMARK_LIMIT = 200;

function createProgressEmitter(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  return (update = {}) => {
    if (!update || typeof update !== "object") {
      return;
    }
    const payload = { ...update };
    if (typeof payload.timestamp !== "number") {
      payload.timestamp = Date.now();
    }
    try {
      callback(payload);
    } catch (error) {
      console.warn("Spotlight bookmark organizer progress listener failed", error);
    }
  };
}

function formatProgressTitle(title, maxLength = 54) {
  if (typeof title !== "string") {
    return "";
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxLength - 1))}…`;
}

function formatChangeCountsSummary(counts = {}) {
  const renameCount = Number.isFinite(counts.renamed) ? counts.renamed : 0;
  const movedCount = Number.isFinite(counts.moved) ? counts.moved : 0;
  const folderCount = Number.isFinite(counts.createdFolders) ? counts.createdFolders : 0;
  const parts = [];
  if (movedCount > 0) {
    parts.push(`${movedCount} moved`);
  }
  if (renameCount > 0) {
    parts.push(`${renameCount} renamed`);
  }
  if (folderCount > 0) {
    parts.push(`${folderCount} new folder${folderCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

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

function createTraversalMeta() {
  return {
    bookmarks: [],
    folderLookup: new Map(),
    nodeMap: new Map(),
  };
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

function flattenBookmarkTree(nodes, ancestry = [], meta = createTraversalMeta()) {
  if (!Array.isArray(nodes)) {
    return meta;
  }

  for (const node of nodes) {
    if (!node) {
      continue;
    }

    const id = normalizeId(node.id);
    const parentId = normalizeId(
      node.parentId !== undefined ? node.parentId : ancestry.length ? ancestry[ancestry.length - 1].id : null
    );
    const title = typeof node.title === "string" ? node.title : "";
    const isFolder = !node.url;

    if (!meta.nodeMap.has(id)) {
      meta.nodeMap.set(id, {
        id,
        title,
        parentId,
        isFolder,
        children: Array.isArray(node.children) ? node.children.map((child) => normalizeId(child.id)) : [],
      });
    }

    if (Array.isArray(node.children) && node.children.length) {
      let folderMap = meta.folderLookup.get(id);
      if (!folderMap) {
        folderMap = new Map();
        meta.folderLookup.set(id, folderMap);
      }
      for (const child of node.children) {
        if (!child || child.url) {
          continue;
        }
        const childId = normalizeId(child.id);
        const childTitle = typeof child.title === "string" ? child.title.trim() : "";
        const normalized = normalizeFolderName(childTitle);
        if (normalized) {
          folderMap.set(normalized, { id: childId, title: childTitle });
        }
      }
    }

    const nextAncestry = isFolder
      ? [...ancestry, { id, title, parentId }]
      : ancestry;

    if (node.url) {
      const folders = ancestry.filter((ancestor) => ancestor && ancestor.title).map((ancestor) => ancestor.title);
      const entry = {
        id,
        title: title || node.url || "Untitled bookmark",
        url: node.url,
        dateAdded: typeof node.dateAdded === "number" ? node.dateAdded : null,
        parentId,
        parentTitle: ancestry.length ? ancestry[ancestry.length - 1].title || "" : "",
        path: folders.join(" / "),
        ancestors: ancestry.map((ancestor) => ({
          id: ancestor.id,
          title: ancestor.title,
          parentId: ancestor.parentId,
        })),
      };
      entry.userNotes = formatBookmarkNotes(entry);
      meta.bookmarks.push(entry);
    }

    if (Array.isArray(node.children) && node.children.length) {
      flattenBookmarkTree(node.children, nextAncestry, meta);
    }
  }

  return meta;
}

function getBookmarkTree() {
  return new Promise((resolve, reject) => {
    try {
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getBookmarkChildren(parentId) {
  return new Promise((resolve, reject) => {
    if (!parentId && parentId !== "0") {
      resolve([]);
      return;
    }
    try {
      chrome.bookmarks.getChildren(parentId, (nodes) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function clampLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_BOOKMARK_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_BOOKMARK_LIMIT);
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

async function ensureFolder(parentId, title, folderLookup, createdFolders, nodeMap) {
  const sanitizedTitle = sanitizeFolderName(title);
  const normalized = normalizeFolderName(sanitizedTitle);
  if (!normalized) {
    return { id: parentId, title: sanitizedTitle || "", created: false };
  }
  const cacheKey = `${parentId || "root"}::${normalized}`;
  if (createdFolders.has(cacheKey)) {
    return createdFolders.get(cacheKey);
  }

  let folderMap = folderLookup.get(parentId);
  if (!folderMap || !folderMap.has(normalized)) {
    folderMap = await refreshFolderLookup(parentId, folderLookup, nodeMap);
  }
  if (folderMap && folderMap.has(normalized)) {
    const existing = folderMap.get(normalized);
    const folderId = existing?.id || existing;
    const folderTitle = typeof existing?.title === "string" ? existing.title : sanitizedTitle;
    const record = { id: folderId, title: folderTitle, created: false };
    createdFolders.set(cacheKey, record);
    if (!nodeMap.has(folderId)) {
      nodeMap.set(folderId, {
        id: folderId,
        title: folderTitle,
        parentId,
        isFolder: true,
        children: [],
      });
    }
    return record;
  }

  const folder = await chrome.bookmarks.create({ parentId, title: sanitizedTitle });
  if (!folder || !folder.id) {
    throw new Error(`Failed to create folder "${sanitizedTitle}"`);
  }
  const folderId = String(folder.id);

  if (!folderMap) {
    folderMap = new Map();
    folderLookup.set(parentId, folderMap);
  }
  const record = { id: folderId, title: sanitizedTitle, created: true };
  folderMap.set(normalized, { id: folderId, title: sanitizedTitle });
  createdFolders.set(cacheKey, record);
  nodeMap.set(folderId, {
    id: folderId,
    title: sanitizedTitle,
    parentId,
    isFolder: true,
    children: [],
  });

  return record;
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
  const createdFolders = new Map();
  const reportProgress = typeof context.reportProgress === "function" ? context.reportProgress : () => {};
  const sourceMap = new Map(sourceBookmarks.map((entry) => [String(entry.id), entry]));

  const total = bookmarkResults.length;
  let processed = 0;
  let renamed = 0;
  let moved = 0;
  let createdFolderCount = 0;

  const getCounts = () => ({
    total,
    processed,
    renamed,
    moved,
    createdFolders: createdFolderCount,
  });

  for (const resultEntry of bookmarkResults) {
    if (!resultEntry || typeof resultEntry.id === "undefined") {
      continue;
    }
    const bookmarkId = String(resultEntry.id);
    const source = sourceMap.get(bookmarkId);
    if (!source) {
      continue;
    }

    processed += 1;
    let changed = false;

    const cleanTitle = typeof resultEntry.cleanTitle === "string" ? resultEntry.cleanTitle.trim() : "";
    if (cleanTitle && cleanTitle !== source.title) {
      await chrome.bookmarks.update(bookmarkId, { title: cleanTitle });
      source.title = cleanTitle;
      renamed += 1;
      const counts = getCounts();
      const summary = formatChangeCountsSummary(counts);
      const progressTitle = formatProgressTitle(cleanTitle);
      const message = summary ? `Renamed "${progressTitle}" · ${summary}` : `Renamed "${progressTitle}"`;
      reportProgress({
        stage: "rename",
        label: `Organizing ${processed}/${total}`,
        message,
        status: message,
        counts,
      });
      changed = true;
    }

    const parentId = source.parentId || (source.ancestors?.length ? source.ancestors[source.ancestors.length - 1].id : null);
    if (!parentId) {
      if (!changed) {
        const counts = getCounts();
        const progressTitle = formatProgressTitle(source.title || cleanTitle || resultEntry.cleanTitle || "Bookmark");
        const message = `Reviewed "${progressTitle}"`;
        reportProgress({
          stage: "review",
          label: `Organizing ${processed}/${total}`,
          message,
          status: message,
          counts,
        });
      }
      continue;
    }

    const targetFolderName = determineTargetFolderName(resultEntry);
    const normalizedTarget = normalizeFolderName(targetFolderName);
    if (!normalizedTarget) {
      if (!changed) {
        const counts = getCounts();
        const progressTitle = formatProgressTitle(source.title || cleanTitle || resultEntry.cleanTitle || "Bookmark");
        const message = `Reviewed "${progressTitle}"`;
        reportProgress({
          stage: "review",
          label: `Organizing ${processed}/${total}`,
          message,
          status: message,
          counts,
        });
      }
      continue;
    }

    const currentParentInfo = nodeMap.get(source.parentId);
    const currentParentTitle = currentParentInfo?.title || "";
    if (normalizeFolderName(currentParentTitle) === normalizedTarget) {
      if (!changed) {
        const counts = getCounts();
        const progressTitle = formatProgressTitle(source.title || cleanTitle || resultEntry.cleanTitle || "Bookmark");
        const message = `Reviewed "${progressTitle}"`;
        reportProgress({
          stage: "review",
          label: `Organizing ${processed}/${total}`,
          message,
          status: message,
          counts,
        });
      }
      continue;
    }

    const folderResult = await ensureFolder(parentId, targetFolderName, folderLookup, createdFolders, nodeMap);
    const folderId = folderResult?.id || folderResult;
    if (!folderId || folderId === source.parentId) {
      if (!changed) {
        const counts = getCounts();
        const progressTitle = formatProgressTitle(source.title || cleanTitle || resultEntry.cleanTitle || "Bookmark");
        const message = `Reviewed "${progressTitle}"`;
        reportProgress({
          stage: "review",
          label: `Organizing ${processed}/${total}`,
          message,
          status: message,
          counts,
        });
      }
      continue;
    }

    if (folderResult?.created) {
      createdFolderCount += 1;
      const counts = getCounts();
      const summary = formatChangeCountsSummary(counts);
      const folderTitle = formatProgressTitle(folderResult.title || targetFolderName || "New folder");
      const message = summary ? `Created folder "${folderTitle}" · ${summary}` : `Created folder "${folderTitle}"`;
      reportProgress({
        stage: "folder",
        label: `Organizing ${processed}/${total}`,
        message,
        status: message,
        counts,
      });
      changed = true;
    }

    await chrome.bookmarks.move(bookmarkId, { parentId: folderId });
    source.parentId = folderId;
    moved += 1;
    const counts = getCounts();
    const summary = formatChangeCountsSummary(counts);
    const folderTitle = formatProgressTitle(folderResult?.title || targetFolderName || "Organized");
    const message = summary ? `Moved to "${folderTitle}" · ${summary}` : `Moved to "${folderTitle}"`;
    reportProgress({
      stage: "move",
      label: `Organizing ${processed}/${total}`,
      message,
      status: message,
      counts,
    });
    changed = true;
  }

  return { renamed, moved, createdFolders: createdFolderCount };
}

async function collectRecentBookmarks(limit) {
  const tree = await getBookmarkTree();
  const meta = flattenBookmarkTree(tree);
  const flattened = meta.bookmarks;
  if (!flattened.length) {
    return { bookmarks: [], folderLookup: meta.folderLookup, nodeMap: meta.nodeMap };
  }
  const sorted = flattened.sort((a, b) => {
    const aTime = typeof a.dateAdded === "number" ? a.dateAdded : 0;
    const bTime = typeof b.dateAdded === "number" ? b.dateAdded : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return (a.title || "").localeCompare(b.title || "");
  });
  const limited = sorted.slice(0, clampLimit(limit));
  return { bookmarks: limited, folderLookup: meta.folderLookup, nodeMap: meta.nodeMap };
}

export function createBookmarkOrganizerService(options = {}) {
  const { scheduleRebuild } = options;
  let sessionInstance = null;
  let sessionPromise = null;
  let activeRequest = null;

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
    const progress = createProgressEmitter(options.onProgress);
    const task = (async () => {
      progress({ stage: "init", label: "Preparing…", message: "Preparing bookmark organizer" });
      const limit = clampLimit(options.limit);
      const language =
        typeof options.language === "string" && options.language ? options.language : DEFAULT_LANGUAGE;
      try {
        progress({ stage: "collect:start", label: "Collecting…", message: "Collecting recent bookmarks" });
        const { bookmarks, folderLookup, nodeMap } = await collectRecentBookmarks(limit);
        if (!bookmarks.length) {
          throw new Error("No bookmarks available to organize");
        }
        const total = bookmarks.length;
        progress({
          stage: "collect:complete",
          label: "Collecting…",
          message: `Collected ${total} bookmark${total === 1 ? "" : "s"}`,
          counts: { total },
        });
        const payload = buildPromptPayload(bookmarks, language);
        progress({
          stage: "prompt",
          label: "Asking Gemini…",
          message: "Generating organization plan",
          counts: { total },
        });
        const { raw, parsed } = await runPrompt(payload);
        progress({
          stage: "apply:start",
          label: "Organizing…",
          message: `Applying plan to ${total} bookmark${total === 1 ? "" : "s"}`,
          counts: { total },
        });
        const changes = await applyOrganizerChanges(bookmarks, parsed, {
          folderLookup,
          nodeMap,
          reportProgress: progress,
        });
        const changeCounts = {
          total,
          renamed: Number.isFinite(changes?.renamed) ? changes.renamed : 0,
          moved: Number.isFinite(changes?.moved) ? changes.moved : 0,
          createdFolders: Number.isFinite(changes?.createdFolders) ? changes.createdFolders : 0,
        };
        const changeSummary = formatChangeCountsSummary(changeCounts);
        progress({
          stage: "finalizing",
          label: "Finishing…",
          message: changeSummary ? `Wrapping up · ${changeSummary}` : "Wrapping up",
          counts: changeCounts,
        });
        if (
          typeof scheduleRebuild === "function" &&
          (changeCounts.renamed > 0 || changeCounts.moved > 0 || changeCounts.createdFolders > 0)
        ) {
          scheduleRebuild(200);
        }
        const completionMessage = changeSummary
          ? `Organized ${total} bookmark${total === 1 ? "" : "s"} · ${changeSummary}`
          : `Organized ${total} bookmark${total === 1 ? "" : "s"}`;
        progress({
          stage: "complete",
          label: "Organized",
          message: completionMessage,
          status: completionMessage,
          counts: changeCounts,
          done: true,
        });
        return {
          generatedAt: Date.now(),
          payload,
          sourceBookmarks: bookmarks,
          result: parsed,
          rawText: raw,
          changes,
        };
      } catch (error) {
        const errorMessage = error?.message || "Unable to organize bookmarks";
        progress({ stage: "error", label: "Try Again", message: errorMessage, status: errorMessage, error: true });
        throw error;
      }
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
