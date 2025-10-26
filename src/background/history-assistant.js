const SMART_HISTORY_FLAG_KEY = "spotlightSmartHistoryAssistant";
const DEFAULT_LIMITS = {
  show: 20,
  open: 5,
  delete: 10,
  summarize: 24,
};
const MAX_LIMIT = 50;
const RANGE_PRESETS = new Map([
  ["today", () => ({ startTime: toStartOfDay(Date.now()) })],
  ["yesterday", () => ({ startTime: toStartOfDay(Date.now()) - DAY_MS, endTime: toStartOfDay(Date.now()) })],
  ["last7", () => ({ startTime: Date.now() - 7 * DAY_MS })],
  ["last30", () => ({ startTime: Date.now() - 30 * DAY_MS })],
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

async function readFlagValue() {
  if (!chrome?.storage?.local) {
    return false;
  }
  try {
    const data = await chrome.storage.local.get([
      SMART_HISTORY_FLAG_KEY,
      "spotlightFeatureFlags",
      "smartHistoryAssistant",
    ]);
    if (typeof data?.[SMART_HISTORY_FLAG_KEY] === "boolean") {
      return data[SMART_HISTORY_FLAG_KEY];
    }
    if (data?.[SMART_HISTORY_FLAG_KEY] && typeof data[SMART_HISTORY_FLAG_KEY] === "object") {
      const value = data[SMART_HISTORY_FLAG_KEY];
      if (typeof value.enabled === "boolean") {
        return value.enabled;
      }
    }
    const legacy = data?.smartHistoryAssistant;
    if (typeof legacy === "boolean") {
      return legacy;
    }
    if (legacy && typeof legacy === "object" && typeof legacy.enabled === "boolean") {
      return legacy.enabled;
    }
    const group = data?.spotlightFeatureFlags;
    if (group && typeof group === "object" && typeof group.smartHistoryAssistant === "boolean") {
      return group.smartHistoryAssistant;
    }
  } catch (error) {
    console.warn("Spotlight: failed to read Smart History Assistant flag", error);
  }
  return false;
}

function normalizeLimit(value, action) {
  if (!Number.isFinite(value)) {
    const fallback = DEFAULT_LIMITS[action] || DEFAULT_LIMITS.show;
    return fallback;
  }
  const fallback = DEFAULT_LIMITS[action] || DEFAULT_LIMITS.show;
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT) || fallback;
}

function applyTimeRange(command) {
  if (!command || typeof command !== "object") {
    return {};
  }
  if (typeof command.startTime === "number") {
    const range = { startTime: Math.max(0, command.startTime) };
    if (typeof command.endTime === "number" && command.endTime > 0) {
      range.endTime = Math.max(range.startTime, command.endTime);
    }
    return range;
  }
  const key = typeof command.timeRange === "string" ? command.timeRange.toLowerCase() : "";
  if (RANGE_PRESETS.has(key)) {
    return RANGE_PRESETS.get(key)();
  }
  return {};
}

async function queryHistory(command, limit) {
  const text = typeof command?.query === "string" ? command.query : "";
  const range = applyTimeRange(command);
  const options = {
    text,
    maxResults: Math.min(MAX_LIMIT, Math.max(limit * 2, limit + 5)),
  };
  if (Number.isFinite(range.startTime)) {
    options.startTime = range.startTime;
  }
  const rawEntries = await chrome.history.search(options);
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    return [];
  }
  const endTime = Number.isFinite(range.endTime) ? range.endTime : null;
  const filtered = rawEntries
    .filter((entry) => {
      if (!entry || typeof entry.url !== "string") {
        return false;
      }
      if (endTime && typeof entry.lastVisitTime === "number" && entry.lastVisitTime > endTime) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
      const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
      return bTime - aTime;
    });
  return filtered.slice(0, limit);
}

async function buildEntriesFromUrls(urls, limit) {
  if (!Array.isArray(urls) || !urls.length) {
    return [];
  }
  const unique = Array.from(new Set(urls.filter((url) => typeof url === "string" && url.trim())));
  if (!unique.length) {
    return [];
  }
  const capped = unique.slice(0, limit);
  const lookups = capped.map(async (url) => {
    try {
      const matches = await chrome.history.search({ text: url, maxResults: 6 });
      if (Array.isArray(matches) && matches.length) {
        const direct = matches.find((item) => item && item.url === url);
        if (direct) {
          return direct;
        }
        return matches[0];
      }
    } catch (error) {
      console.warn("Spotlight: failed to lookup history entry by URL", error, url);
    }
    return { url, title: url };
  });
  return Promise.all(lookups);
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    id: entry.id || null,
    url: typeof entry.url === "string" ? entry.url : "",
    title: typeof entry.title === "string" && entry.title ? entry.title : entry.url || "",
    lastVisitTime: typeof entry.lastVisitTime === "number" ? entry.lastVisitTime : null,
    visitCount: typeof entry.visitCount === "number" ? entry.visitCount : null,
    typedCount: typeof entry.typedCount === "number" ? entry.typedCount : null,
  };
}

async function openHistoryEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return 0;
  }
  let opened = 0;
  for (const entry of entries) {
    if (!entry?.url) {
      continue;
    }
    try {
      await chrome.tabs.create({ url: entry.url, active: false });
      opened += 1;
    } catch (error) {
      console.warn("Spotlight: failed to open history entry", error, entry?.url);
    }
  }
  return opened;
}

async function deleteHistoryEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry?.url) {
      continue;
    }
    try {
      await chrome.history.deleteUrl({ url: entry.url });
      removed += 1;
    } catch (error) {
      console.warn("Spotlight: failed to delete history entry", error, entry?.url);
    }
  }
  return removed;
}

function buildSummaryContext(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const lines = entries.map((entry, index) => {
    const title = entry.title || entry.url || "Untitled";
    const url = entry.url || "";
    const time = entry.lastVisitTime ? new Date(entry.lastVisitTime).toISOString() : "";
    return `${index + 1}. ${title}\nURL: ${url}${time ? `\nVisited: ${time}` : ""}`;
  });
  return lines.join("\n\n");
}

export function createHistoryAssistantService() {
  return {
    async isEnabled() {
      return readFlagValue();
    },

    async handleRequest(command) {
      const enabled = await readFlagValue();
      if (!enabled) {
        return { success: false, error: "Smart History Assistant is disabled" };
      }
      if (!command || typeof command !== "object" || typeof command.action !== "string") {
        return { success: false, error: "Invalid history assistant command" };
      }

      const action = command.action.toLowerCase();
      if (!["show", "open", "delete", "summarize"].includes(action)) {
        return { success: false, error: `Unsupported history assistant action: ${action}` };
      }

      const limit = normalizeLimit(command.limit, action);
      const explicitUrls = Array.isArray(command.urls)
        ? command.urls.filter((url) => typeof url === "string" && url.trim())
        : [];
      const entries = explicitUrls.length
        ? await buildEntriesFromUrls(explicitUrls, limit)
        : await queryHistory(command, limit);
      const sanitizedEntries = entries.map(sanitizeHistoryEntry).filter(Boolean);

      if (action === "show") {
        return {
          success: true,
          action,
          entries: sanitizedEntries,
          message: sanitizedEntries.length
            ? `Found ${sanitizedEntries.length} matching history entr${sanitizedEntries.length === 1 ? "y" : "ies"}.`
            : "No matching history found.",
        };
      }

      if (!sanitizedEntries.length) {
        return { success: false, action, error: "No matching history entries" };
      }

      if (action === "open") {
        const opened = await openHistoryEntries(sanitizedEntries);
        return {
          success: Boolean(opened),
          action,
          opened,
          entries: sanitizedEntries.slice(0, opened || 0),
          message: opened
            ? `Opened ${opened} histor${opened === 1 ? "y entry" : "y entries"} in new tabs.`
            : "Unable to open requested history entries.",
        };
      }

      if (action === "delete") {
        const removed = await deleteHistoryEntries(sanitizedEntries);
        return {
          success: Boolean(removed),
          action,
          deleted: removed,
          message: removed
            ? `Deleted ${removed} histor${removed === 1 ? "y entry" : "y entries"}.`
            : "Unable to delete requested history entries.",
        };
      }

      if (action === "summarize") {
        return {
          success: true,
          action,
          entries: sanitizedEntries,
          summaryContext: buildSummaryContext(sanitizedEntries),
          message: sanitizedEntries.length
            ? `Summarizing ${sanitizedEntries.length} histor${sanitizedEntries.length === 1 ? "y entry" : "y entries"}.`
            : "No history entries available to summarize.",
        };
      }

      return { success: false, error: "Unknown history assistant action" };
    },
  };
}

export const __test__ = {
  toStartOfDay,
  applyTimeRange,
  normalizeLimit,
  buildSummaryContext,
};
