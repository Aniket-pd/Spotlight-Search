import { SMART_HISTORY_ASSISTANT_FLAG, isFeatureEnabled } from "../shared/features.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const OPEN_LIMIT = 5;
const DELETE_LIMIT = 30;
const HISTORY_ACTIONS = new Set(["show", "open", "delete", "summarize", "meta"]);

const PROMPT_SYSTEM_PROMPT = `You are the Smart History Assistant for Spotlight, a Chrome extension.
Analyze the user's natural-language request about their browsing history and respond ONLY with a JSON object that matches this schema:
{
  "action": "show" | "open" | "delete" | "summarize" | "meta",
  "filters"?: {
    "text"?: string,
    "domains"?: string[],
    "urlContains"?: string[],
    "time"?: {"startTime"?: string, "endTime"?: string, "days"?: number, "hours"?: number}
  },
  "limit"?: number,
  "message"?: string,
  "followUp"?: string
}
Use lowercase action names. When uncertain or asked about the assistant, use action "meta" with a helpful message.
Extract concrete filters: normalize domains to host names, prefer ISO timestamps when explicit dates are given, otherwise use relative durations (days or hours) for past windows. Keep limit at or below 40.
Never include browsing data or prose outside the JSON.`;

const PROMPT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["show", "open", "delete", "summarize", "meta"] },
    filters: {
      type: "object",
      properties: {
        text: { type: "string" },
        domains: {
          type: "array",
          items: { type: "string" },
          maxItems: 8,
        },
        urlContains: {
          type: "array",
          items: { type: "string" },
          maxItems: 8,
        },
        time: {
          type: "object",
          properties: {
            startTime: { type: "string" },
            endTime: { type: "string" },
            days: { type: "number" },
            hours: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    limit: { type: "number" },
    message: { type: "string" },
    followUp: { type: "string" },
  },
  required: ["action"],
  additionalProperties: false,
};

function sanitizeLimit(value, fallback = DEFAULT_LIMIT) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return fallback;
  }
  return Math.min(Math.max(rounded, 1), MAX_LIMIT);
}

function extractHostname(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (error) {
    return "";
  }
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains
    .map((domain) => (typeof domain === "string" ? domain.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeContains(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function parseTimeRange(raw) {
  if (!raw || typeof raw !== "object") {
    return { startTime: null, endTime: null };
  }
  let startTime = null;
  let endTime = null;
  const now = Date.now();
  if (typeof raw.startTime === "string") {
    const parsed = Date.parse(raw.startTime);
    if (!Number.isNaN(parsed)) {
      startTime = parsed;
    }
  }
  if (typeof raw.endTime === "string") {
    const parsed = Date.parse(raw.endTime);
    if (!Number.isNaN(parsed)) {
      endTime = parsed;
    }
  }
  if (typeof raw.days === "number" && !Number.isNaN(raw.days) && raw.days > 0) {
    const offset = Math.min(raw.days, 365) * 24 * 60 * 60 * 1000;
    const candidate = now - offset;
    startTime = startTime ? Math.min(startTime, candidate) : candidate;
    if (!endTime) {
      endTime = now;
    }
  }
  if (typeof raw.hours === "number" && !Number.isNaN(raw.hours) && raw.hours > 0) {
    const offset = Math.min(raw.hours, 24 * 14) * 60 * 60 * 1000;
    const candidate = now - offset;
    startTime = startTime ? Math.min(startTime, candidate) : candidate;
    if (!endTime) {
      endTime = now;
    }
  }
  if (startTime && endTime && startTime > endTime) {
    const tmp = startTime;
    startTime = endTime;
    endTime = tmp;
  }
  return {
    startTime: Number.isFinite(startTime) ? startTime : null,
    endTime: Number.isFinite(endTime) ? endTime : null,
  };
}

function sanitizeFilters(raw = {}) {
  if (!raw || typeof raw !== "object") {
    return {
      text: "",
      domains: [],
      urlContains: [],
      time: { startTime: null, endTime: null },
    };
  }
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const domains = normalizeDomains(raw.domains);
  const urlContains = normalizeContains(raw.urlContains);
  const time = parseTimeRange(raw.time);
  return { text, domains, urlContains, time };
}

function buildHistoryQuery(filters, limit) {
  const query = {
    text: filters.text || "",
    maxResults: Math.min(Math.max(limit * 4, 20), 200),
  };
  if (filters.time.startTime) {
    query.startTime = filters.time.startTime;
  }
  if (filters.time.endTime) {
    query.endTime = filters.time.endTime;
  }
  return query;
}

function filterHistoryItems(items, filters, limit) {
  if (!Array.isArray(items)) {
    return [];
  }
  const domains = filters.domains;
  const fragments = filters.urlContains;
  const results = [];
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    if (domains.length) {
      const host = extractHostname(item.url).toLowerCase();
      if (!host || !domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        continue;
      }
    }
    if (fragments.length) {
      const urlLower = item.url.toLowerCase();
      if (!fragments.some((fragment) => urlLower.includes(fragment))) {
        continue;
      }
    }
    results.push({
      id: item.id || item.url,
      url: item.url,
      title: item.title || item.url,
      lastVisitTime: item.lastVisitTime || 0,
      visitCount: item.visitCount || 0,
      typedCount: item.typedCount || 0,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

function formatDate(when) {
  if (!when) {
    return "";
  }
  try {
    const date = new Date(when);
    return date.toLocaleString();
  } catch (error) {
    return "";
  }
}

function buildSummaryInput(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const lines = entries.map((entry) => {
    const host = extractHostname(entry.url) || "";
    const time = formatDate(entry.lastVisitTime);
    const title = entry.title && entry.title !== entry.url ? entry.title : host || entry.url;
    return `Title: ${title}\nURL: ${entry.url}\nVisited: ${time || "unknown"}`;
  });
  return `The following list describes recent browsing history entries. Summarize the user's activity factually.\n\n${lines.join("\n\n")}`;
}

async function createPromptSession() {
  if (typeof globalThis === "undefined" || typeof globalThis.LanguageModel === "undefined") {
    throw new Error("Prompt API unavailable");
  }
  const availability = typeof LanguageModel.availability === "function" ? await LanguageModel.availability() : "unknown";
  if (availability === "unavailable") {
    throw new Error("Prompt API unavailable");
  }
  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: PROMPT_SYSTEM_PROMPT }],
  });
  return session;
}

async function runPrompt(query) {
  const session = await createPromptSession();
  try {
    const raw = await session.prompt(
      [{ role: "user", content: query }],
      { responseConstraint: PROMPT_RESPONSE_SCHEMA, omitResponseConstraintInput: true }
    );
    if (typeof raw !== "string" || !raw.trim()) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Spotlight: failed to parse assistant response", error, raw);
      return null;
    }
  } finally {
    try {
      session.destroy?.();
    } catch (error) {
      // Ignore destroy errors.
    }
  }
}

let summarizerInstance = null;
let summarizerPromise = null;

async function ensureSummarizer() {
  if (summarizerInstance) {
    return summarizerInstance;
  }
  if (summarizerPromise) {
    return summarizerPromise;
  }
  if (typeof globalThis === "undefined" || typeof globalThis.Summarizer === "undefined") {
    throw new Error("Summarizer API unavailable");
  }
  summarizerPromise = (async () => {
    const availability = typeof Summarizer.availability === "function" ? await Summarizer.availability() : "unknown";
    if (availability === "unavailable") {
      throw new Error("Summarizer API unavailable");
    }
    const instance = await Summarizer.create({
      type: "key-points",
      length: "medium",
      format: "markdown",
      sharedContext:
        "Summarize Chrome browsing history entries for the user. Focus on concise, factual bullet points without speculation.",
      expectedInputLanguages: ["en"],
      expectedContextLanguages: ["en"],
    });
    summarizerInstance = instance;
    summarizerPromise = null;
    return instance;
  })().catch((error) => {
    summarizerPromise = null;
    throw error;
  });
  return summarizerPromise;
}

async function summarizeEntries(entries, contextText) {
  if (!entries.length) {
    return { summary: "I didn't find any matching history to summarize." };
  }
  try {
    const summarizer = await ensureSummarizer();
    const input = buildSummaryInput(entries);
    const summary = await summarizer.summarize(input, {
      context: contextText || "Recent browsing activity",
    });
    return { summary: typeof summary === "string" ? summary.trim() : "" };
  } catch (error) {
    console.warn("Spotlight: summarizer failed", error);
    const fallback = entries
      .slice(0, Math.min(entries.length, 5))
      .map((entry) => {
        const time = formatDate(entry.lastVisitTime);
        const title = entry.title && entry.title !== entry.url ? entry.title : entry.url;
        return `• ${title}${time ? ` (${time})` : ""}`;
      })
      .join("\n");
    return {
      summary: fallback || "Unable to generate a summary right now.",
      fallback: true,
    };
  }
}

export function createSmartHistoryAssistant(options = {}) {
  const historyApi = options.historyApi || chrome?.history;
  const tabsApi = options.tabsApi || chrome?.tabs;
  let cachedEnabled = false;
  let lastFlagCheck = 0;

  async function ensureEnabled() {
    const now = Date.now();
    if (now - lastFlagCheck > 2000) {
      cachedEnabled = await isFeatureEnabled(SMART_HISTORY_ASSISTANT_FLAG);
      lastFlagCheck = now;
    }
    if (!cachedEnabled) {
      throw new Error("Smart History Assistant is disabled");
    }
  }

  async function interpretQuery(query) {
    const result = await runPrompt(query);
    if (!result || typeof result !== "object") {
      return { action: "meta", message: "Sorry, I couldn't understand that request." };
    }
    const action = typeof result.action === "string" ? result.action.toLowerCase() : "meta";
    if (!HISTORY_ACTIONS.has(action)) {
      return { action: "meta", message: "I can search, open, delete, or summarize your history." };
    }
    const limit = sanitizeLimit(result.limit);
    const filters = sanitizeFilters(result.filters);
    const message = typeof result.message === "string" ? result.message.trim() : "";
    const followUp = typeof result.followUp === "string" ? result.followUp.trim() : "";
    return { action, limit, filters, message, followUp };
  }

  async function queryHistory(filters, limit) {
    if (!historyApi || typeof historyApi.search !== "function") {
      return { entries: [], filters };
    }
    try {
      const query = buildHistoryQuery(filters, limit);
      const items = await historyApi.search(query);
      const sorted = Array.isArray(items)
        ? items.slice().sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
        : [];
      const entries = filterHistoryItems(sorted, filters, limit);
      return { entries, filters };
    } catch (error) {
      console.warn("Spotlight: history query failed", error);
      return { entries: [], filters };
    }
  }

  async function openEntries(entries) {
    if (!tabsApi || typeof tabsApi.create !== "function") {
      return 0;
    }
    const slice = entries.slice(0, Math.min(entries.length, OPEN_LIMIT));
    let opened = 0;
    for (const entry of slice) {
      try {
        await tabsApi.create({ url: entry.url, active: false });
        opened += 1;
      } catch (error) {
        console.warn("Spotlight: failed to open history entry", error);
      }
    }
    return opened;
  }

  async function deleteEntries(entries) {
    if (!historyApi || typeof historyApi.deleteUrl !== "function") {
      return 0;
    }
    const slice = entries.slice(0, Math.min(entries.length, DELETE_LIMIT));
    let removed = 0;
    for (const entry of slice) {
      try {
        await historyApi.deleteUrl({ url: entry.url });
        removed += 1;
      } catch (error) {
        console.warn("Spotlight: failed to delete history entry", error);
      }
    }
    return removed;
  }

  async function handleAction(payload) {
    const { action, limit, filters, message, followUp } = payload;
    if (action === "meta") {
      return {
        action,
        message: message || "I'm Spotlight's Smart History Assistant. I help you review and manage your browsing history locally.",
        followUp: followUp || "Try asking me to show, open, delete, or summarize your history.",
        entries: [],
        filters,
      };
    }

    const { entries } = await queryHistory(filters, limit);
    if (!entries.length && action !== "delete") {
      return {
        action,
        message: message || "I couldn't find any matching history for that request.",
        entries: [],
        filters,
      };
    }

    if (action === "show") {
      return {
        action,
        message: message || "Here are the history items I found.",
        entries,
        filters,
        followUp,
      };
    }

    if (action === "open") {
      const opened = await openEntries(entries);
      return {
        action,
        message:
          message ||
          (opened
            ? `Opened ${opened} histor${opened === 1 ? "y item" : "y items"} in new tabs.`
            : "I couldn't open any matching history items."),
        entries,
        opened,
        filters,
        followUp,
      };
    }

    if (action === "delete") {
      if (!entries.length) {
        return {
          action,
          message: message || "I couldn't find any matching history to delete.",
          entries: [],
          filters,
          followUp,
        };
      }
      const removed = await deleteEntries(entries);
      return {
        action,
        message:
          message ||
          (removed
            ? `Removed ${removed} histor${removed === 1 ? "y entry" : "y entries"}.`
            : "I couldn't delete those history items."),
        entries,
        removed,
        filters,
        followUp,
      };
    }

    if (action === "summarize") {
      const summaryResult = await summarizeEntries(entries, message || "Recent browsing activity");
      return {
        action,
        message: summaryResult.summary || message || "Here's what I gathered from your recent browsing.",
        entries,
        filters,
        followUp,
        summary: summaryResult.summary || "",
        summaryFallback: Boolean(summaryResult.fallback),
      };
    }

    return {
      action: "meta",
      message: "I'm not sure how to help with that request.",
      entries: [],
      filters,
      followUp,
    };
  }

  async function handleManualAction(options = {}) {
    await ensureEnabled();
    const operation = typeof options.operation === "string" ? options.operation.toLowerCase() : "";
    const entries = Array.isArray(options.entries)
      ? options.entries.filter((entry) => entry && typeof entry.url === "string")
      : [];
    if (!entries.length) {
      return { success: false, error: "No entries provided" };
    }
    if (operation === "open") {
      const opened = await openEntries(entries);
      return {
        success: opened > 0,
        opened,
        message:
          opened > 0
            ? `Opened ${opened} histor${opened === 1 ? "y item" : "y items"}.`
            : "Unable to open those history items.",
      };
    }
    if (operation === "delete") {
      const removed = await deleteEntries(entries);
      return {
        success: removed > 0,
        removed,
        message:
          removed > 0
            ? `Removed ${removed} histor${removed === 1 ? "y entry" : "y entries"}.`
            : "Unable to delete those history items.",
      };
    }
    return { success: false, error: "Unsupported operation" };
  }

  return {
    async handleRequest({ query }) {
      await ensureEnabled();
      const trimmed = typeof query === "string" ? query.trim() : "";
      if (!trimmed) {
        return {
          action: "meta",
          message: "Ask me something like ‘Show my GitHub visits from today’.",
          entries: [],
        };
      }
      const interpretation = await interpretQuery(trimmed);
      return handleAction(interpretation);
    },
    handleManualAction,
  };
}
