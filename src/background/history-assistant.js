import "../shared/web-search.js";

const FEATURE_STORAGE_KEY = "spotlightFeatureFlags";
const FEATURE_FLAG_NAME = "smartHistoryAssistant";
const MAX_RESULTS = 12;
const MAX_OPEN_TARGETS = 8;
const PROMPT_TIMEOUT = 450;
const HISTORY_SEARCH_DEFAULT_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const COMMAND_SCHEMA = {
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "meta", "none"],
    },
    query: { type: "string" },
    domain: { type: "string" },
    timeRange: {
      type: "string",
      enum: [
        "any",
        "today",
        "yesterday",
        "last_3_days",
        "last_7_days",
        "last_30_days",
        "custom",
      ],
    },
    startDaysAgo: { type: "integer", minimum: 0, maximum: 365 },
    endDaysAgo: { type: "integer", minimum: 0, maximum: 365 },
    limit: { type: "integer", minimum: 1, maximum: 25 },
    urls: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
    response: { type: "string" },
    summaryStyle: {
      type: "string",
      enum: ["key-points", "tldr"],
    },
  },
};

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let handle;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      handle = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => {
    if (handle) {
      clearTimeout(handle);
    }
  });
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function parseHostname(url) {
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

function computeTimeBounds(command) {
  const now = Date.now();
  let startTime = null;
  let endTime = null;
  const { timeRange, startDaysAgo, endDaysAgo } = command || {};

  if (Number.isFinite(startDaysAgo)) {
    startTime = now - Math.max(0, startDaysAgo) * DAY_MS;
  }
  if (Number.isFinite(endDaysAgo)) {
    endTime = now - Math.max(0, endDaysAgo) * DAY_MS;
  }

  switch (timeRange) {
    case "today": {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      startTime = today.getTime();
      break;
    }
    case "yesterday": {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const start = today.getTime() - DAY_MS;
      startTime = start;
      endTime = today.getTime();
      break;
    }
    case "last_3_days":
      startTime = now - 3 * DAY_MS;
      break;
    case "last_7_days":
      startTime = now - 7 * DAY_MS;
      break;
    case "last_30_days":
      startTime = now - 30 * DAY_MS;
      break;
    case "any":
    default:
      break;
  }

  if (startTime && endTime && startTime > endTime) {
    const temp = startTime;
    startTime = endTime;
    endTime = temp;
  }

  return { startTime, endTime };
}

function formatTimeLabel(timestamp) {
  if (!timestamp) {
    return "";
  }
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (err) {
    return "";
  }
}

function isPromptApiAvailable() {
  return typeof globalThis !== "undefined" && typeof globalThis.LanguageModel === "object";
}

function isSummarizerAvailable() {
  return typeof globalThis !== "undefined" && typeof globalThis.Summarizer === "function";
}

function buildAssistantTag(command) {
  if (!command || typeof command.action !== "string") {
    return "History Assistant";
  }
  switch (command.action) {
    case "show":
      return "History Assistant";
    case "open":
      return "Reopened";
    case "delete":
      return "Removed";
    case "summarize":
      return "Summary";
    case "meta":
      return "Assistant";
    default:
      return "History Assistant";
  }
}

function mapHistoryEntries(entries, command, options = {}) {
  const tag = buildAssistantTag(command);
  return entries.slice(0, MAX_RESULTS).map((entry, index) => {
    const hostname = parseHostname(entry.url);
    const timestampLabel = formatTimeLabel(entry.lastVisitTime);
    const descriptionParts = [];
    if (hostname) {
      descriptionParts.push(hostname);
    }
    if (timestampLabel) {
      descriptionParts.push(timestampLabel);
    }
    const description = descriptionParts.join(" · ");
    let origin = "";
    if (entry.url) {
      try {
        origin = new URL(entry.url).origin;
      } catch (err) {
        origin = "";
      }
    }
    return {
      id: `assistant-history-${index}-${entry.id ?? parseHostname(entry.url)}`,
      type: "history",
      title: entry.title || entry.url || "History Entry",
      url: entry.url,
      description,
      lastVisitTime: entry.lastVisitTime || Date.now(),
      visitCount: entry.visitCount || 0,
      origin,
      assistantTag: tag,
      assistantAction: {
        type: "openHistoryUrl",
        url: entry.url,
      },
    };
  });
}

async function fetchHistory(command) {
  const { startTime, endTime } = computeTimeBounds(command);
  const text = normalizeText(command?.query) || "";
  const domain = normalizeText(command?.domain) || "";
  const limit = Number.isFinite(command?.limit) ? Math.min(command.limit, HISTORY_SEARCH_DEFAULT_LIMIT) : HISTORY_SEARCH_DEFAULT_LIMIT;
  try {
    const results = await chrome.history.search({
      text,
      maxResults: Math.max(limit, MAX_RESULTS),
      startTime: startTime || undefined,
    });
    if (!Array.isArray(results)) {
      return [];
    }
    return results.filter((entry) => {
      if (!entry || !entry.url) {
        return false;
      }
      if (endTime && entry.lastVisitTime && entry.lastVisitTime > 0 && entry.lastVisitTime > endTime) {
        return false;
      }
      if (domain) {
        const hostname = parseHostname(entry.url);
        if (!hostname.includes(domain)) {
          return false;
        }
      }
      return true;
    });
  } catch (err) {
    console.warn("Spotlight: history assistant search failed", err);
    return [];
  }
}

async function openHistoryTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) {
    return 0;
  }
  const limited = targets.slice(0, MAX_OPEN_TARGETS).filter((url) => typeof url === "string" && url);
  if (!limited.length) {
    return 0;
  }
  let opened = 0;
  await Promise.all(
    limited.map(async (url) => {
      try {
        await chrome.tabs.create({ url });
        opened += 1;
      } catch (err) {
        console.warn("Spotlight: failed to open history target", err);
      }
    })
  );
  return opened;
}

async function deleteHistoryTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) {
    return 0;
  }
  let removed = 0;
  await Promise.all(
    targets.map(async (url) => {
      if (typeof url !== "string" || !url) {
        return;
      }
      try {
        await chrome.history.deleteUrl({ url });
        removed += 1;
      } catch (err) {
        console.warn("Spotlight: failed to delete history target", err);
      }
    })
  );
  return removed;
}

async function ensureSession(state) {
  if (!state.enabled) {
    return null;
  }
  if (!isPromptApiAvailable()) {
    return null;
  }
  if (state.sessionPromise) {
    return state.sessionPromise;
  }
  state.sessionPromise = (async () => {
    try {
      const availability = await globalThis.LanguageModel.availability?.();
      if (!availability || availability === "unavailable") {
        return null;
      }
      const params = await globalThis.LanguageModel.params?.();
      const topK = params?.defaultTopK ?? 3;
      const temperature = params?.defaultTemperature ?? 1;
      const session = await globalThis.LanguageModel.create({
        topK,
        temperature,
        initialPrompts: [
          {
            role: "system",
            content:
              "You are Spotlight's Smart History Assistant living inside a Chrome extension. " +
              "Convert user requests about browser history, tabs, bookmarks, and downloads into structured JSON. " +
              "Only reference data that the browser can access locally. Use the user's language when relevant. " +
              "Allowed actions: show, open, delete, summarize, meta, none. Never fabricate URLs. " +
              "If unsure, respond with action none."
          },
        ],
      });
      return session;
    } catch (err) {
      console.warn("Spotlight: unable to initialize history assistant session", err);
      return null;
    }
  })();
  return state.sessionPromise;
}

async function ensureSummarizer(state, style = "key-points") {
  if (!state.enabled || !isSummarizerAvailable()) {
    return null;
  }
  const key = style === "tldr" ? "tldr" : "key";
  if (state.summarizers[key]) {
    return state.summarizers[key];
  }
  state.summarizers[key] = (async () => {
    try {
      const availability = await globalThis.Summarizer.availability?.();
      if (!availability || availability === "unavailable") {
        return null;
      }
      const summarizer = await globalThis.Summarizer.create({
        type: style === "tldr" ? "tldr" : "key-points",
        format: "markdown",
        length: "medium",
        sharedContext:
          "Summaries describe a person's recent Chrome browsing history. Be factual, concise, and avoid speculation.",
      });
      return summarizer;
    } catch (err) {
      console.warn("Spotlight: unable to initialize summarizer", err);
      return null;
    }
  })();
  return state.summarizers[key];
}

async function interpretQuery(state, query) {
  if (!state.enabled || !query) {
    return null;
  }
  const session = await ensureSession(state);
  if (!session) {
    return null;
  }
  try {
    const result = await withTimeout(
      session.prompt(
        [
          {
            role: "user",
            content:
              "Return JSON only. Interpret the request and choose the appropriate action. " +
              "The JSON must follow this schema strictly: " +
              JSON.stringify(COMMAND_SCHEMA) +
              ". Use the smallest necessary subset of fields."
          },
          {
            role: "user",
            content: query,
          },
          {
            role: "assistant",
            content: "",
            prefix: true,
          },
        ],
        {
          responseConstraint: COMMAND_SCHEMA,
        }
      ),
      PROMPT_TIMEOUT
    );
    if (!result) {
      return null;
    }
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("Spotlight: history assistant interpretation failed", err);
    return null;
  }
}

function shouldHandleQuery(query) {
  const trimmed = normalizeText(query);
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith(">")) {
    return false;
  }
  if (trimmed.includes(":")) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

async function summarizeHistory(state, entries, command) {
  if (!entries.length) {
    return "";
  }
  const style = command?.summaryStyle === "tldr" ? "tldr" : "key-points";
  const summarizerPromise = await ensureSummarizer(state, style);
  if (!summarizerPromise) {
    return "";
  }
  const summarizer = await summarizerPromise;
  if (!summarizer) {
    return "";
  }
  const lines = entries.slice(0, 40).map((entry) => {
    const time = formatTimeLabel(entry.lastVisitTime);
    const host = parseHostname(entry.url);
    const title = entry.title || entry.url;
    return `${time ? `[${time}] ` : ""}${title}${host ? ` (${host})` : ""}`;
  });
  const text = lines.join("\n");
  if (!text) {
    return "";
  }
  try {
    const summary = await summarizer.summarize(text, {
      context: "Summarize the person's recent browsing history. Highlight concrete activities.",
    });
    if (typeof summary === "string") {
      return summary.trim();
    }
    return "";
  } catch (err) {
    console.warn("Spotlight: summarizer request failed", err);
    return "";
  }
}

export function createHistoryAssistantService() {
  const state = {
    enabled: false,
    sessionPromise: null,
    summarizers: {},
  };

  async function refreshEnabled() {
    try {
      const stored = await chrome.storage.local.get(FEATURE_STORAGE_KEY);
      const flags = stored?.[FEATURE_STORAGE_KEY];
      const nextEnabled = Boolean(flags && flags[FEATURE_FLAG_NAME]);
      if (state.enabled !== nextEnabled) {
        state.enabled = nextEnabled;
        if (!state.enabled) {
          state.sessionPromise = null;
          state.summarizers = {};
        }
      }
    } catch (err) {
      console.warn("Spotlight: failed to read feature flags", err);
      state.enabled = false;
    }
    return state.enabled;
  }

  refreshEnabled();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes && Object.prototype.hasOwnProperty.call(changes, FEATURE_STORAGE_KEY)) {
      refreshEnabled();
    }
  });

  async function processQuery(query) {
    if (!state.enabled) {
      return null;
    }
    if (!shouldHandleQuery(query)) {
      return null;
    }
    const interpretation = await interpretQuery(state, query);
    if (!interpretation || interpretation.action === "none") {
      return null;
    }

    const payload = { results: [], answer: "", filter: null };
    const entries = await fetchHistory(interpretation);

    if (interpretation.action === "show") {
      if (!entries.length) {
        payload.answer = "No matching history found";
        return payload;
      }
      payload.results = mapHistoryEntries(entries, interpretation);
      payload.filter = "history";
      payload.answer =
        typeof interpretation.response === "string" && interpretation.response
          ? interpretation.response
          : "Showing relevant history";
      return payload;
    }

    if (interpretation.action === "open") {
      const targets = Array.isArray(interpretation.urls) && interpretation.urls.length
        ? interpretation.urls
        : entries.slice(0, MAX_OPEN_TARGETS).map((entry) => entry.url).filter(Boolean);
      const opened = await openHistoryTargets(targets);
      if (opened > 0) {
        const fallback = `Opened ${opened} history item${opened === 1 ? "" : "s"}`;
        payload.answer =
          typeof interpretation.response === "string" && interpretation.response
            ? interpretation.response
            : fallback;
      } else {
        payload.answer = "Nothing to open";
      }
      return payload;
    }

    if (interpretation.action === "delete") {
      const targets = Array.isArray(interpretation.urls) && interpretation.urls.length
        ? interpretation.urls
        : entries.slice(0, MAX_OPEN_TARGETS).map((entry) => entry.url).filter(Boolean);
      const removed = await deleteHistoryTargets(targets);
      if (removed > 0) {
        const fallback = `Removed ${removed} history item${removed === 1 ? "" : "s"}`;
        payload.answer =
          typeof interpretation.response === "string" && interpretation.response
            ? interpretation.response
            : fallback;
      } else {
        payload.answer = "No history entries removed";
      }
      return payload;
    }

    if (interpretation.action === "summarize") {
      const summary = await summarizeHistory(state, entries, interpretation);
      const fallback =
        typeof interpretation.response === "string" && interpretation.response
          ? interpretation.response
          : "Summary unavailable";
      payload.answer = summary || fallback;
      payload.filter = "history";
      return payload;
    }

    if (interpretation.action === "meta") {
      payload.answer =
        typeof interpretation.response === "string" && interpretation.response
          ? interpretation.response
          : "I'm Spotlight's on-device assistant for your browsing";
      return payload;
    }

    return null;
  }

  async function handleAction(action) {
    if (!state.enabled) {
      return { success: false, error: "History assistant disabled" };
    }
    if (!action || typeof action !== "object") {
      return { success: false, error: "Invalid action" };
    }
    const { type } = action;
    if (type === "openHistoryUrl") {
      const url = typeof action.url === "string" ? action.url : "";
      if (!url) {
        return { success: false, error: "Missing URL" };
      }
      try {
        await chrome.tabs.create({ url });
        return { success: true };
      } catch (err) {
        console.warn("Spotlight: failed to open assistant URL", err);
        return { success: false, error: err?.message || "Unable to open" };
      }
    }
    if (type === "deleteHistoryUrl") {
      const url = typeof action.url === "string" ? action.url : "";
      if (!url) {
        return { success: false, error: "Missing URL" };
      }
      try {
        await chrome.history.deleteUrl({ url });
        return { success: true };
      } catch (err) {
        console.warn("Spotlight: failed to delete assistant URL", err);
        return { success: false, error: err?.message || "Unable to delete" };
      }
    }
    return { success: false, error: "Unsupported action" };
  }

  return {
    refreshEnabled,
    isEnabled: () => state.enabled,
    processQuery,
    handleAction,
  };
}
