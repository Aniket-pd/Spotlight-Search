import {
  isSmartHistoryAssistantEnabled,
  observeFeatureFlags,
  setSmartHistoryAssistantEnabled,
} from "../shared/feature-flags.js";

const MAX_HISTORY_RESULTS = 60;
const MAX_ACTION_RESULTS = 12;
const MAX_DELETE_RESULTS = 40;
const MAX_SUMMARY_RESULTS = 40;
const PROMPT_OPTIONS = {};

const PROMPT_INSTRUCTIONS = `You are the Spotlight Smart History Assistant for a Chrome extension.\n\nYour job is to convert a single user request into a structured JSON command so the extension can act locally on the user's browsing data.\n\nRules:\n- Always respond with **only** JSON that matches the provided schema. Never include commentary.\n- Infer the user's intent to one of these actions: \"show\", \"open\", \"delete\", \"summarize\", or \"meta\".\n- \"show\" means return matching history results for the user to review.\n- \"open\" means reopen matching pages in new tabs.\n- \"delete\" removes matching history entries.\n- \"summarize\" produces a concise factual summary of the matching history.\n- \"meta\" is for questions about the assistant itself (for example \"who are you?\"). Provide a friendly short response via the \"response\" field.\n- Use ISO 8601 dates (YYYY-MM-DD) when providing explicit start/end values.\n- Prefer common presets for time windows: today, yesterday, last_24_hours, last_3_days, last_7_days, last_30_days, last_90_days, all_time.\n- For requests about searches, set \"focus\" to \"searches\".\n- For requests about videos or YouTube, set \"focus\" to \"videos\" and include \"domain\" of the relevant site when obvious.\n- If the user mentions reopening or restoring, set \"reopenClosed\" to true.\n- Populate \"query\" with helpful search keywords when appropriate.\n- Populate \"domain\" with a hostname (like \"youtube.com\") when the user names a site.\n- Use \"limit\" to suggest how many results to operate on (between 1 and 20).\n- If unsure, default to the safest interpretation.\n- Keep the response grounded in the user's instructions—never fabricate capabilities beyond history, tabs, and sessions.`;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["action"],
  additionalProperties: true,
  properties: {
    action: { type: "string", enum: ["show", "open", "delete", "summarize", "meta"] },
    query: { anyOf: [{ type: "string" }, { type: "null" }] },
    domain: { anyOf: [{ type: "string" }, { type: "null" }] },
    urlContains: { anyOf: [{ type: "string" }, { type: "null" }] },
    limit: { anyOf: [{ type: "integer", minimum: 1, maximum: 50 }, { type: "null" }] },
    timeRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: true,
          properties: {
            preset: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            days: { type: "number", minimum: 0.5, maximum: 3650 },
          },
        },
      ],
    },
    sort: { anyOf: [{ type: "string", enum: ["recent", "frequent"] }, { type: "null" }] },
    focus: { anyOf: [{ type: "string" }, { type: "null" }] },
    reopenClosed: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    response: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

const TIME_PRESETS = {
  today: () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.getTime(), end: now.getTime(), label: "Today" };
  },
  yesterday: () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.getTime(), end: end.getTime(), label: "Yesterday" };
  },
  last_24_hours: () => {
    const now = Date.now();
    return { start: now - 24 * 60 * 60 * 1000, end: now, label: "Last 24 hours" };
  },
  last_3_days: () => {
    const now = Date.now();
    return { start: now - 3 * 24 * 60 * 60 * 1000, end: now, label: "Last 3 days" };
  },
  last_7_days: () => {
    const now = Date.now();
    return { start: now - 7 * 24 * 60 * 60 * 1000, end: now, label: "Last 7 days" };
  },
  last_week: () => {
    const now = Date.now();
    return { start: now - 7 * 24 * 60 * 60 * 1000, end: now, label: "Last week" };
  },
  last_30_days: () => {
    const now = Date.now();
    return { start: now - 30 * 24 * 60 * 60 * 1000, end: now, label: "Last 30 days" };
  },
  last_month: () => {
    const now = Date.now();
    return { start: now - 30 * 24 * 60 * 60 * 1000, end: now, label: "Last month" };
  },
  last_90_days: () => {
    const now = Date.now();
    return { start: now - 90 * 24 * 60 * 60 * 1000, end: now, label: "Last 90 days" };
  },
  all_time: () => ({ start: 0, end: Date.now(), label: "All time" }),
};

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",
  "tv.apple.com",
]);

const SEARCH_HOST_PATTERNS = [
  /\.google\.[a-z.]+$/i,
  /\.bing\.com$/i,
  /\.duckduckgo\.com$/i,
  /\.brave\.com$/i,
  /\.yahoo\.com$/i,
];

function normalizePresetName(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function clampLimit(limit, fallback, maximum) {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return fallback;
  }
  const rounded = Math.round(limit);
  if (!Number.isFinite(rounded)) {
    return fallback;
  }
  return Math.max(1, Math.min(rounded, maximum));
}

function parseDateString(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function resolveTimeRange(spec) {
  const now = Date.now();
  if (!spec || typeof spec !== "object") {
    return { start: now - 30 * 24 * 60 * 60 * 1000, end: now, preset: "last_30_days", label: "Last 30 days" };
  }
  const presetName = normalizePresetName(spec.preset);
  if (presetName && TIME_PRESETS[presetName]) {
    const presetRange = TIME_PRESETS[presetName]();
    return { ...presetRange, preset: presetName };
  }
  const days = typeof spec.days === "number" && Number.isFinite(spec.days) ? spec.days : null;
  if (days && days > 0) {
    const length = Math.min(days, 3650);
    return { start: now - length * 24 * 60 * 60 * 1000, end: now, preset: null, label: `Last ${Math.round(length)} days` };
  }
  const start = parseDateString(spec.start);
  const end = parseDateString(spec.end) || now;
  if (start && end) {
    const normalizedStart = Math.min(start, end);
    const normalizedEnd = Math.max(start, end);
    return { start: normalizedStart, end: normalizedEnd, preset: null, label: "Custom range" };
  }
  return { start: now - 30 * 24 * 60 * 60 * 1000, end: now, preset: null, label: "Last 30 days" };
}

function parseIntent(raw, fallbackQuery) {
  const result = { action: "show" };
  if (raw && typeof raw === "object") {
    const action = typeof raw.action === "string" ? raw.action.toLowerCase() : "";
    if (["show", "open", "delete", "summarize", "meta"].includes(action)) {
      result.action = action;
    }
    if (typeof raw.query === "string" && raw.query.trim()) {
      result.query = raw.query.trim();
    }
    if (typeof raw.domain === "string" && raw.domain.trim()) {
      result.domain = raw.domain.trim();
    }
    if (typeof raw.urlContains === "string" && raw.urlContains.trim()) {
      result.urlContains = raw.urlContains.trim();
    }
    if (typeof raw.response === "string" && raw.response.trim()) {
      result.response = raw.response.trim();
    }
    if (raw.focus && typeof raw.focus === "string") {
      result.focus = raw.focus.trim().toLowerCase();
    }
    if (typeof raw.reopenClosed === "boolean") {
      result.reopenClosed = raw.reopenClosed;
    }
    if (typeof raw.sort === "string" && raw.sort.trim().toLowerCase() === "frequent") {
      result.sort = "frequent";
    }
    if (typeof raw.limit === "number" && Number.isFinite(raw.limit)) {
      result.limit = clampLimit(raw.limit, null, 50);
    }
    if (raw.timeRange && typeof raw.timeRange === "object") {
      result.timeRange = resolveTimeRange(raw.timeRange);
    }
  }
  if (!result.query && typeof fallbackQuery === "string" && fallbackQuery.trim()) {
    result.query = fallbackQuery.trim();
  }
  if (!result.timeRange) {
    result.timeRange = resolveTimeRange(null);
  }
  return result;
}

function extractHostname(url) {
  if (!url || typeof url !== "string") {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (error) {
    return "";
  }
}

function isVideoUrl(url) {
  const host = extractHostname(url).toLowerCase();
  if (!host) {
    return false;
  }
  if (VIDEO_HOSTS.has(host)) {
    return true;
  }
  return host.includes("youtube") || host.includes("twitch") || host.includes("vimeo");
}

function isSearchUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return false;
    }
    if (parsed.pathname && parsed.pathname.toLowerCase().startsWith("/search")) {
      return true;
    }
    return SEARCH_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname.toLowerCase()));
  } catch (error) {
    return false;
  }
}

function buildHistoryFilters(intent) {
  const filters = {
    queryText: typeof intent.query === "string" ? intent.query : "",
    limit: clampLimit(intent.limit ?? 10, 10, MAX_HISTORY_RESULTS),
    sort: intent.sort === "frequent" ? "frequent" : "recent",
    timeRange: intent.timeRange,
    domain: intent.domain || null,
    urlContains: intent.urlContains || null,
    focus: intent.focus || null,
  };
  if (filters.focus === "videos" && !filters.domain) {
    filters.domain = "youtube.com";
  }
  if (filters.focus === "searches" && !filters.queryText) {
    filters.queryText = "";
  }
  return filters;
}

function formatHistoryEntry(item) {
  const hostname = extractHostname(item.url);
  return {
    id: item.id || null,
    url: item.url,
    title: item.title || item.url,
    lastVisitTime: item.lastVisitTime || null,
    visitCount: item.visitCount || 0,
    typedCount: item.typedCount || 0,
    hostname,
  };
}

function filterHistoryItems(items, filters) {
  if (!Array.isArray(items)) {
    return [];
  }
  const { domain, urlContains, focus, timeRange } = filters;
  const domainLower = domain ? domain.toLowerCase() : null;
  const containsLower = urlContains ? urlContains.toLowerCase() : null;
  const start = typeof timeRange?.start === "number" ? timeRange.start : null;
  const end = typeof timeRange?.end === "number" ? timeRange.end : null;
  return items.filter((item) => {
    if (!item || !item.url) {
      return false;
    }
    if (start && item.lastVisitTime && item.lastVisitTime < start) {
      return false;
    }
    if (end && item.lastVisitTime && item.lastVisitTime > end) {
      return false;
    }
    if (domainLower) {
      const host = extractHostname(item.url).toLowerCase();
      if (!host.includes(domainLower)) {
        return false;
      }
    }
    if (containsLower && !item.url.toLowerCase().includes(containsLower)) {
      return false;
    }
    if (focus === "videos" && !isVideoUrl(item.url)) {
      return false;
    }
    if (focus === "searches" && !isSearchUrl(item.url)) {
      return false;
    }
    return true;
  });
}

function sortHistoryItems(items, sortMode) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (sortMode === "frequent") {
    list.sort((a, b) => {
      const aVisits = a.visitCount || 0;
      const bVisits = b.visitCount || 0;
      if (bVisits !== aVisits) {
        return bVisits - aVisits;
      }
      const aTime = a.lastVisitTime || 0;
      const bTime = b.lastVisitTime || 0;
      return bTime - aTime;
    });
  } else {
    list.sort((a, b) => {
      const aTime = a.lastVisitTime || 0;
      const bTime = b.lastVisitTime || 0;
      return bTime - aTime;
    });
  }
  return list;
}

async function searchHistory(filters) {
  const { queryText, limit, timeRange } = filters;
  const startTime = typeof timeRange?.start === "number" && Number.isFinite(timeRange.start) ? timeRange.start : undefined;
  const searchOptions = {
    text: queryText || "",
    maxResults: Math.min(Math.max(limit * 3, limit + 15), MAX_HISTORY_RESULTS),
  };
  if (startTime) {
    searchOptions.startTime = startTime;
  }
  let items = [];
  try {
    items = await chrome.history.search(searchOptions);
  } catch (error) {
    console.error("Spotlight: history search failed", error);
    throw new Error("History search unavailable");
  }
  const filtered = filterHistoryItems(items, filters);
  const sorted = sortHistoryItems(filtered, filters.sort);
  return {
    items: sorted.slice(0, limit),
    totalMatches: filtered.length,
    fetched: items.length,
  };
}

async function openHistoryEntries(entries) {
  const targets = entries.slice(0, MAX_ACTION_RESULTS).filter((entry) => entry && entry.url);
  let opened = 0;
  for (const [index, entry] of targets.entries()) {
    try {
      await chrome.tabs.create({ url: entry.url, active: index === 0 });
      opened += 1;
    } catch (error) {
      console.warn("Spotlight: failed to open history entry", error);
    }
  }
  return opened;
}

async function deleteHistoryEntries(entries) {
  const targets = entries.slice(0, MAX_DELETE_RESULTS).filter((entry) => entry && entry.url);
  let deleted = 0;
  for (const entry of targets) {
    try {
      await chrome.history.deleteUrl({ url: entry.url });
      deleted += 1;
    } catch (error) {
      console.warn("Spotlight: failed to delete history entry", error);
    }
  }
  return deleted;
}

function buildSummaryInput(entries) {
  return entries
    .map((entry) => {
      const date = entry.lastVisitTime ? new Date(entry.lastVisitTime) : null;
      let timestamp = "";
      if (date && !Number.isNaN(date.getTime())) {
        try {
          timestamp = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        } catch (error) {
          timestamp = date.toISOString();
        }
      }
      const title = entry.title || entry.url;
      return `${timestamp ? `${timestamp} · ` : ""}${title} (${entry.url})`;
    })
    .join("\n");
}

let summaryInstance = null;
let summaryPromise = null;

async function ensureHistorySummarizer() {
  if (summaryInstance) {
    return summaryInstance;
  }
  if (summaryPromise) {
    return summaryPromise;
  }
  if (typeof globalThis.Summarizer !== "function" && typeof globalThis.Summarizer !== "object") {
    throw new Error("Summarizer API unavailable");
  }
  summaryPromise = globalThis.Summarizer.create({
    type: "tldr",
    format: "plain-text",
    length: "medium",
    sharedContext: "Summaries of recent browser history activity for the Spotlight extension.",
    ...PROMPT_OPTIONS,
    monitor(monitor) {
      if (!monitor || typeof monitor.addEventListener !== "function") {
        return;
      }
      monitor.addEventListener("downloadprogress", (event) => {
        const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
        if (percent !== null) {
          console.info(`Spotlight history summarizer download ${percent}%`);
        }
      });
    },
  })
    .then((instance) => {
      summaryInstance = instance;
      summaryPromise = null;
      return instance;
    })
    .catch((error) => {
      summaryPromise = null;
      throw error;
    });
  return summaryPromise;
}

function extractSummaryHighlights(text) {
  if (!text || typeof text !== "string") {
    return [];
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return [];
  }
  if (lines.length <= 3) {
    return lines;
  }
  return lines.slice(0, 5);
}

async function summarizeHistory(entries, context) {
  if (!entries.length) {
    return { text: "", highlights: [] };
  }
  const summarizer = await ensureHistorySummarizer();
  const input = buildSummaryInput(entries);
  const summary = await summarizer.summarize(input, context ? { context } : undefined);
  const text = typeof summary === "string" ? summary.trim() : "";
  return {
    text,
    highlights: extractSummaryHighlights(text),
  };
}

let availabilityCache = null;
let availabilityPromise = null;
let availabilityTimestamp = 0;

async function computeAvailability() {
  const enabled = await isSmartHistoryAssistantEnabled();
  if (!enabled) {
    return { enabled: false, available: false, state: "disabled", reason: "Feature disabled" };
  }
  if (typeof globalThis.LanguageModel !== "function" && typeof globalThis.LanguageModel !== "object") {
    return { enabled: true, available: false, state: "unsupported", reason: "Prompt API unavailable" };
  }
  try {
    const availability = await globalThis.LanguageModel.availability(PROMPT_OPTIONS);
    if (availability === "unavailable") {
      return { enabled: true, available: false, state: "unavailable", reason: "Prompt model unavailable" };
    }
    if (availability === "downloadable") {
      return {
        enabled: true,
        available: true,
        state: "downloadable",
        reason: "Model download required",
      };
    }
    if (availability === "downloading") {
      return {
        enabled: true,
        available: true,
        state: "downloading",
        reason: "Model downloading",
      };
    }
    return { enabled: true, available: true, state: "available", reason: "" };
  } catch (error) {
    console.warn("Spotlight: prompt availability check failed", error);
    return {
      enabled: true,
      available: false,
      state: "error",
      reason: error?.message || "Prompt availability check failed",
    };
  }
}

async function getAvailability() {
  const now = Date.now();
  if (availabilityCache && now - availabilityTimestamp < 30 * 1000) {
    return availabilityCache;
  }
  if (availabilityPromise) {
    return availabilityPromise;
  }
  availabilityPromise = computeAvailability().then((result) => {
    availabilityCache = result;
    availabilityTimestamp = Date.now();
    availabilityPromise = null;
    return result;
  });
  return availabilityPromise;
}

let baseSession = null;
let baseSessionPromise = null;
let featureFlagUnsubscribe = null;

async function ensureBaseSession() {
  if (baseSession) {
    return baseSession;
  }
  if (baseSessionPromise) {
    return baseSessionPromise;
  }
  baseSessionPromise = globalThis.LanguageModel.create({
    ...PROMPT_OPTIONS,
    initialPrompts: [
      {
        role: "system",
        content: PROMPT_INSTRUCTIONS,
      },
    ],
  })
    .then((session) => {
      baseSession = session;
      baseSessionPromise = null;
      return session;
    })
    .catch((error) => {
      baseSessionPromise = null;
      throw error;
    });
  return baseSessionPromise;
}

async function createPromptSession() {
  const base = await ensureBaseSession();
  if (base && typeof base.clone === "function") {
    try {
      return await base.clone();
    } catch (error) {
      console.warn("Spotlight: prompt session clone failed, recreating", error);
    }
  }
  return globalThis.LanguageModel.create({
    ...PROMPT_OPTIONS,
    initialPrompts: [
      {
        role: "system",
        content: PROMPT_INSTRUCTIONS,
      },
    ],
  });
}

async function interpretPrompt(text) {
  const session = await createPromptSession();
  try {
    const response = await session.prompt(
      [
        {
          role: "user",
          content: text,
        },
      ],
      {
        responseConstraint: RESPONSE_SCHEMA,
        omitResponseConstraintInput: true,
      }
    );
    if (typeof response !== "string" || !response.trim()) {
      throw new Error("Empty response from language model");
    }
    try {
      return JSON.parse(response);
    } catch (error) {
      console.warn("Spotlight: failed to parse prompt response", error, response);
      throw new Error("Unable to understand request");
    }
  } finally {
    if (session && session !== baseSession && typeof session.destroy === "function") {
      try {
        session.destroy();
      } catch (error) {
        // ignore
      }
    }
  }
}

function formatTimeLabel(range) {
  if (!range) {
    return "";
  }
  if (range.label) {
    return range.label;
  }
  if (range.preset && TIME_PRESETS[range.preset]) {
    const formatted = TIME_PRESETS[range.preset]();
    return formatted.label || "";
  }
  if (typeof range.start === "number" && typeof range.end === "number") {
    try {
      const start = new Date(range.start);
      const end = new Date(range.end);
      const startLabel = start.toLocaleDateString();
      const endLabel = end.toLocaleDateString();
      if (startLabel === endLabel) {
        return startLabel;
      }
      return `${startLabel} – ${endLabel}`;
    } catch (error) {
      return "";
    }
  }
  return "";
}

function buildContextString(intent, rangeLabel) {
  const parts = [];
  if (intent.query) {
    parts.push(`Query: ${intent.query}`);
  }
  if (intent.domain) {
    parts.push(`Domain: ${intent.domain}`);
  }
  if (rangeLabel) {
    parts.push(`Time: ${rangeLabel}`);
  }
  if (intent.focus === "searches") {
    parts.push("Focus: searches");
  } else if (intent.focus === "videos") {
    parts.push("Focus: videos");
  }
  return parts.join("; ");
}

async function handleSummarize(intent, entries, rangeLabel) {
  try {
    const context = buildContextString(intent, rangeLabel);
    const summary = await summarizeHistory(entries, context);
    return {
      action: "summarize",
      items: entries.map(formatHistoryEntry),
      summary,
      stats: {
        returned: entries.length,
      },
      message: summary.text ? "Summary generated" : "Nothing to summarize",
      timeLabel: rangeLabel,
      query: intent.query || "",
    };
  } catch (error) {
    console.error("Spotlight: history summary failed", error);
    throw new Error(error?.message || "Unable to summarize history");
  }
}

async function runIntent(intent) {
  const filters = buildHistoryFilters(intent);
  const { items, totalMatches } = await searchHistory(filters);
  const formattedItems = items.map(formatHistoryEntry);
  const rangeLabel = formatTimeLabel(filters.timeRange);

  switch (intent.action) {
    case "open": {
      if (!formattedItems.length) {
        return {
          action: "open",
          items: [],
          message: "No matching history items to open",
          stats: { returned: 0, opened: 0 },
          timeLabel: rangeLabel,
          query: intent.query || "",
        };
      }
      const opened = await openHistoryEntries(formattedItems);
      return {
        action: "open",
        items: formattedItems,
        message: opened
          ? `Opened ${opened} histor${opened === 1 ? "y item" : "y items"}`
          : "Unable to open requested history items",
        stats: { returned: formattedItems.length, opened },
        timeLabel: rangeLabel,
        query: intent.query || "",
      };
    }
    case "delete": {
      if (!formattedItems.length) {
        return {
          action: "delete",
          items: [],
          message: "No matching history items to delete",
          stats: { returned: 0, deleted: 0 },
          timeLabel: rangeLabel,
          query: intent.query || "",
        };
      }
      const deleted = await deleteHistoryEntries(formattedItems);
      return {
        action: "delete",
        items: formattedItems,
        message: deleted
          ? `Deleted ${deleted} histor${deleted === 1 ? "y item" : "y items"}`
          : "Unable to delete requested history items",
        stats: { returned: formattedItems.length, deleted },
        timeLabel: rangeLabel,
        query: intent.query || "",
      };
    }
    case "summarize": {
      const limited = formattedItems.slice(0, MAX_SUMMARY_RESULTS);
      return handleSummarize(intent, limited, rangeLabel);
    }
    case "meta": {
      return {
        action: "meta",
        items: [],
        message: intent.response || "I'm the Spotlight Smart History Assistant, here to help with your browsing history.",
        stats: { returned: 0 },
        timeLabel: rangeLabel,
        query: intent.query || "",
      };
    }
    case "show":
    default: {
      return {
        action: "show",
        items: formattedItems,
        message: formattedItems.length
          ? `Showing ${formattedItems.length} histor${formattedItems.length === 1 ? "y item" : "y items"}${totalMatches > formattedItems.length ? ` of ${totalMatches}` : ""}`
          : "No matching history found",
        stats: {
          returned: formattedItems.length,
          totalMatches,
        },
        timeLabel: rangeLabel,
        query: intent.query || "",
      };
    }
  }
}

async function handlePromptRequest(requestText) {
  if (!requestText || typeof requestText !== "string" || !requestText.trim()) {
    throw new Error("Enter a request to continue");
  }
  const availability = await getAvailability();
  if (!availability.enabled) {
    throw new Error("History assistant disabled");
  }
  if (!availability.available) {
    throw new Error(availability.reason || "Assistant unavailable");
  }
  const interpretation = await interpretPrompt(requestText.trim());
  const intent = parseIntent(interpretation, requestText);
  if (intent.action === "meta" && intent.response) {
    return {
      action: "meta",
      items: [],
      message: intent.response,
      stats: { returned: 0 },
      timeLabel: "",
      query: intent.query || "",
    };
  }
  return runIntent(intent);
}

async function handleSingleOperation(operation, url) {
  if (!url || typeof url !== "string") {
    throw new Error("Missing URL");
  }
  if (operation === "open") {
    await chrome.tabs.create({ url, active: true });
    return { success: true };
  }
  if (operation === "delete") {
    await chrome.history.deleteUrl({ url });
    return { success: true };
  }
  throw new Error("Unsupported operation");
}

export function createHistoryAssistantService() {
  observeFeatureFlags(() => {
    availabilityCache = null;
    availabilityTimestamp = 0;
  });

  return {
    async getStatus() {
      return getAvailability();
    },
    async handleRequest({ text }) {
      return handlePromptRequest(text);
    },
    async operate({ operation, url }) {
      return handleSingleOperation(operation, url);
    },
    async setEnabled({ enabled }) {
      await setSmartHistoryAssistantEnabled(Boolean(enabled));
      availabilityCache = null;
      availabilityTimestamp = 0;
      return getAvailability();
    },
  };
}
