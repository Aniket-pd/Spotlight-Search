const HISTORY_ASSISTANT_FLAG_KEY = "spotlightHistoryAssistantEnabled";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_HISTORY_BATCH = 120;
const MAX_SUMMARY_INPUT = 8000;

const COMMAND_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["show", "open", "delete", "summarize", "meta"] },
    timeframe: {
      type: "string",
      enum: ["today", "yesterday", "last3Days", "last7Days", "last14Days", "last30Days", "all"],
    },
    days: { type: "integer", minimum: 1, maximum: 30 },
    host: { type: "string" },
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    response: { type: "string" },
    keywords: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 6,
    },
    reopen: { type: "boolean" },
  },
  required: ["action"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant living inside a Chrome extension.
Your job is to interpret natural language about the user's browsing history and respond with
precise JSON that matches the provided schema.

Instructions:
- Supported actions: "show" (list history entries), "open" (open matching entries in new tabs),
  "delete" (remove entries from history), "summarize" (summarize recent history), and "meta"
  (answer questions about yourself or available capabilities).
- Only reference browser history, recently closed tabs, or what you can do. Stay factual.
- When the user asks to reopen or restore closed tabs, set reopen=true and action="open".
- Prefer setting timeframe to an enum value; for phrases like "past 3 days" use days=3.
- host should be a bare hostname like "youtube.com" when the query references a site.
- query should contain keywords suitable for chrome.history.search.
- limit defaults to 8 for show/summarize, 5 for open/delete if unspecified.
- For meta responses, put your natural-language reply in the response field and use action="meta".
- Always reply with JSON only.`;

function clampNumber(value, { min = 1, max = 20, fallback = 5 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num < min) {
    return min;
  }
  if (num > max) {
    return max;
  }
  return Math.round(num);
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

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

function matchesHost(url, host) {
  if (!host) {
    return true;
  }
  const normalizedHost = host.toLowerCase();
  const entryHost = extractHostname(url).toLowerCase();
  if (!entryHost) {
    return false;
  }
  if (entryHost === normalizedHost) {
    return true;
  }
  return entryHost.endsWith(`.${normalizedHost}`);
}

function matchesKeywords(entry, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return true;
  }
  const haystack = `${entry.title || ""} ${entry.url || ""}`.toLowerCase();
  return keywords.every((keyword) => {
    const needle = normalizeText(keyword).toLowerCase();
    if (!needle) {
      return true;
    }
    return haystack.includes(needle);
  });
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function computeRange(command) {
  const now = Date.now();
  let startTime = 0;
  let endTime = null;
  const timeframe = typeof command.timeframe === "string" ? command.timeframe : "";
  switch (timeframe) {
    case "today":
      startTime = startOfDay(now);
      break;
    case "yesterday": {
      const todayStart = startOfDay(now);
      startTime = todayStart - DAY_MS;
      endTime = todayStart;
      break;
    }
    case "last3Days":
      startTime = now - 3 * DAY_MS;
      break;
    case "last7Days":
      startTime = now - 7 * DAY_MS;
      break;
    case "last14Days":
      startTime = now - 14 * DAY_MS;
      break;
    case "last30Days":
      startTime = now - 30 * DAY_MS;
      break;
    default:
      startTime = 0;
      break;
  }
  const daySpan = Number(command.days);
  if (Number.isFinite(daySpan) && daySpan > 0) {
    startTime = now - Math.min(Math.max(Math.round(daySpan), 1), 30) * DAY_MS;
  }
  return { startTime, endTime };
}

function toRelativeTime(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const diff = Date.now() - timestamp;
  if (diff < MINUTE_MS) {
    return "moments ago";
  }
  if (diff < HOUR_MS) {
    const minutes = Math.max(1, Math.round(diff / MINUTE_MS));
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY_MS) {
    const hours = Math.max(1, Math.round(diff / HOUR_MS));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.max(1, Math.round(diff / DAY_MS));
  if (days < 7) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return new Date(timestamp).toLocaleString();
}

function formatEntries(entries) {
  return entries.map((entry) => ({
    id: typeof entry.id === "string" ? entry.id : null,
    url: entry.url || "",
    title: entry.title || entry.url || "",
    lastVisitTime: Number(entry.lastVisitTime) || 0,
    relativeTime: toRelativeTime(Number(entry.lastVisitTime) || 0),
    hostname: extractHostname(entry.url || ""),
  }));
}

function safeJsonParse(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeCommand(plan) {
  if (!plan || typeof plan !== "object") {
    return { action: "meta", response: "I can help with your Chrome history. Try asking me to show, open, delete, or summarize it." };
  }
  const action = typeof plan.action === "string" ? plan.action.toLowerCase() : "";
  const allowed = new Set(["show", "open", "delete", "summarize", "meta"]);
  if (!allowed.has(action)) {
    return { action: "meta", response: "I can help with your Chrome history. Try asking me to show, open, delete, or summarize it." };
  }
  const normalized = {
    action,
    timeframe: typeof plan.timeframe === "string" ? plan.timeframe : null,
    days: Number.isFinite(plan.days) ? Math.round(plan.days) : null,
    host: normalizeText(plan.host),
    query: normalizeText(plan.query),
    keywords: Array.isArray(plan.keywords)
      ? plan.keywords.map((keyword) => normalizeText(keyword)).filter(Boolean).slice(0, 6)
      : [],
    reopen: Boolean(plan.reopen),
    limit: clampNumber(plan.limit, {
      min: 1,
      max: action === "show" || action === "summarize" ? 20 : 10,
      fallback: action === "show" || action === "summarize" ? 8 : 5,
    }),
  };
  if (action === "meta") {
    normalized.response = normalizeText(plan.response) ||
      "I'm Spotlight's Smart History Assistant. Ask me to search, reopen, delete, or summarize your browsing history.";
  }
  return normalized;
}

async function ensureLanguageModel() {
  const LanguageModel = globalThis.LanguageModel || globalThis.ai?.languageModel;
  if (!LanguageModel) {
    throw new Error("Prompt API unavailable");
  }
  const availability = await LanguageModel.availability();
  if (availability === "unavailable") {
    throw new Error("Prompt model unavailable");
  }
  return LanguageModel.create({
    initialPrompts: [
      { role: "system", content: SYSTEM_PROMPT },
    ],
    monitor(monitor) {
      if (!monitor || typeof monitor.addEventListener !== "function") {
        return;
      }
      monitor.addEventListener("downloadprogress", (event) => {
        const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
        if (percent !== null) {
          console.info(`Spotlight history assistant download ${percent}%`);
        }
      });
    },
  });
}

async function runPrompt(queryText, contextHint) {
  const session = await ensureLanguageModel();
  const messages = [];
  if (contextHint) {
    messages.push({
      role: "user",
      content: `Context: ${contextHint}`,
    });
  }
  messages.push({ role: "user", content: queryText });
  try {
    const raw = await session.prompt(messages, {
      responseConstraint: COMMAND_SCHEMA,
    });
    return raw;
  } finally {
    if (session && typeof session.destroy === "function") {
      try {
        session.destroy();
      } catch (err) {
        // Ignore destroy errors.
      }
    }
  }
}

async function interpretQuery(queryText, contextHint) {
  const raw = await runPrompt(queryText, contextHint);
  const parsed = safeJsonParse(raw);
  if (!parsed) {
    throw new Error("Unable to understand the request");
  }
  return normalizeCommand(parsed);
}

async function searchHistoryEntries(command) {
  const range = computeRange(command);
  const searchTextParts = [];
  if (command.query) {
    searchTextParts.push(command.query);
  }
  if (command.keywords && command.keywords.length) {
    searchTextParts.push(command.keywords.join(" "));
  }
  const searchText = searchTextParts.join(" ").trim();
  const maxResults = Math.min(command.limit * 5, MAX_HISTORY_BATCH);
  const results = await chrome.history.search({
    text: searchText || "",
    startTime: range.startTime || 0,
    maxResults: maxResults || command.limit,
  });
  const filtered = [];
  for (const entry of results) {
    if (!entry || !entry.url) {
      continue;
    }
    if (range.endTime && Number(entry.lastVisitTime) >= range.endTime) {
      continue;
    }
    if (!matchesHost(entry.url, command.host)) {
      continue;
    }
    if (!matchesKeywords(entry, command.keywords)) {
      continue;
    }
    filtered.push(entry);
    if (filtered.length >= command.limit) {
      break;
    }
  }
  return filtered;
}

async function reopenClosedTabs(urls, limit) {
  if (!Array.isArray(urls) || !urls.length || typeof chrome.sessions?.getRecentlyClosed !== "function") {
    return { restored: 0, urls: [] };
  }
  try {
    const closed = await chrome.sessions.getRecentlyClosed({ maxResults: Math.max(limit * 4, 10) });
    const pool = Array.isArray(closed) ? closed.slice() : [];
    const restoredUrls = [];
    for (const url of urls) {
      if (!url) {
        continue;
      }
      const index = pool.findIndex((item) => item?.tab?.url === url && typeof item.sessionId === "string");
      if (index === -1) {
        continue;
      }
      const entry = pool.splice(index, 1)[0];
      try {
        await chrome.sessions.restore(entry.sessionId);
        restoredUrls.push(url);
      } catch (err) {
        console.warn("Spotlight: failed to restore closed tab", err);
      }
      if (restoredUrls.length >= limit) {
        break;
      }
    }
    return { restored: restoredUrls.length, urls: restoredUrls };
  } catch (error) {
    console.warn("Spotlight: sessions API restore failed", error);
    return { restored: 0, urls: [] };
  }
}

async function openHistoryEntries(entries, command) {
  const urls = Array.from(
    new Set(entries.map((entry) => entry.url).filter(Boolean))
  ).slice(0, command.limit);
  if (!urls.length) {
    return { opened: 0, restored: 0 };
  }
  let restoredCount = 0;
  if (command.reopen) {
    const restored = await reopenClosedTabs(urls, command.limit);
    restoredCount = restored.restored;
  }
  let openedCount = 0;
  for (const url of urls.slice(restoredCount)) {
    try {
      await chrome.tabs.create({ url });
      openedCount += 1;
    } catch (err) {
      console.warn("Spotlight: failed to open history entry", err);
    }
  }
  return { opened: openedCount + restoredCount, restored: restoredCount };
}

async function deleteHistoryEntries(entries, limit) {
  const urls = entries.map((entry) => entry.url).filter(Boolean).slice(0, limit);
  let deleted = 0;
  for (const url of urls) {
    try {
      await chrome.history.deleteUrl({ url });
      deleted += 1;
    } catch (err) {
      console.warn("Spotlight: failed to delete history entry", err);
    }
  }
  return deleted;
}

let historySummarizerInstance = null;
let historySummarizerPromise = null;

async function ensureHistorySummarizer() {
  if (historySummarizerInstance) {
    return historySummarizerInstance;
  }
  if (historySummarizerPromise) {
    return historySummarizerPromise;
  }
  const Summarizer = globalThis.Summarizer;
  if (!Summarizer) {
    throw new Error("Summarizer API unavailable");
  }
  const availability = await Summarizer.availability();
  if (availability === "unavailable") {
    throw new Error("Summarizer model unavailable");
  }
  historySummarizerPromise = Summarizer.create({
    type: "tldr",
    format: "plain-text",
    length: "medium",
    sharedContext: "Summaries of a user's recent browsing history for the Spotlight Chrome extension. Provide concise, factual sentences.",
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
      historySummarizerInstance = instance;
      historySummarizerPromise = null;
      return instance;
    })
    .catch((error) => {
      historySummarizerPromise = null;
      throw error;
    });
  return historySummarizerPromise;
}

function formatSummaryInput(entries) {
  const lines = entries.map((entry, index) => {
    const timestamp = Number(entry.lastVisitTime) || 0;
    const when = timestamp ? new Date(timestamp).toLocaleString() : "Unknown time";
    const title = entry.title || entry.url || "Unknown";
    return `${index + 1}. ${title} — ${entry.url} (${when})`;
  });
  let combined = lines.join("\n");
  if (combined.length > MAX_SUMMARY_INPUT) {
    combined = combined.slice(0, MAX_SUMMARY_INPUT);
  }
  return `User browsing history:\n${combined}`;
}

async function summarizeHistoryEntries(entries, command) {
  if (!entries.length) {
    return { summary: "", message: "No matching history to summarize." };
  }
  const summarizer = await ensureHistorySummarizer();
  const input = formatSummaryInput(entries);
  const contextParts = [];
  if (command.host) {
    contextParts.push(`Focus on activity related to ${command.host}.`);
  }
  if (command.query) {
    contextParts.push(`Keywords: ${command.query}.`);
  }
  const context = contextParts.length ? contextParts.join(" ") : undefined;
  const summary = await summarizer.summarize(input, context ? { context } : undefined);
  return { summary: typeof summary === "string" ? summary.trim() : "" };
}

async function executeCommand(command, options = {}) {
  const normalized = normalizeCommand(command);
  if (normalized.action === "meta") {
    return {
      success: true,
      action: "meta",
      message:
        normalized.response ||
        "I'm Spotlight's Smart History Assistant. Ask me to search, reopen, delete, or summarize your browsing history.",
      plan: normalized,
    };
  }
  let entries = Array.isArray(options.entries) ? options.entries : [];
  if (!entries.length) {
    entries = await searchHistoryEntries(normalized);
  }
  const formatted = formatEntries(entries);
  if (normalized.action === "show") {
    return {
      success: true,
      action: "show",
      items: formatted,
      message: formatted.length
        ? `Found ${formatted.length} matching history item${formatted.length === 1 ? "" : "s"}.`
        : "No matching history found.",
      plan: normalized,
    };
  }
  if (normalized.action === "open") {
    if (!formatted.length) {
      return {
        success: true,
        action: "open",
        items: [],
        message: "No matching history to open.",
        plan: normalized,
      };
    }
    const { opened, restored } = await openHistoryEntries(entries, normalized);
    const messageParts = [];
    if (opened) {
      messageParts.push(`Opened ${opened} tab${opened === 1 ? "" : "s"}.`);
    }
    if (restored) {
      messageParts.push(`Restored ${restored} recently closed tab${restored === 1 ? "" : "s"}.`);
    }
    if (!messageParts.length) {
      messageParts.push("Unable to open matching history.");
    }
    return {
      success: true,
      action: "open",
      items: formatted,
      message: messageParts.join(" "),
      plan: normalized,
    };
  }
  if (normalized.action === "delete") {
    if (!formatted.length) {
      return {
        success: true,
        action: "delete",
        items: [],
        message: "No matching history to delete.",
        plan: normalized,
      };
    }
    const deleted = await deleteHistoryEntries(entries, normalized.limit);
    return {
      success: true,
      action: "delete",
      items: formatted,
      message: deleted
        ? `Deleted ${deleted} history item${deleted === 1 ? "" : "s"}.`
        : "No history entries were deleted.",
      plan: normalized,
    };
  }
  if (normalized.action === "summarize") {
    if (!formatted.length) {
      return {
        success: true,
        action: "summarize",
        items: [],
        message: "No matching history to summarize.",
        summary: "",
        plan: normalized,
      };
    }
    const { summary } = await summarizeHistoryEntries(entries, normalized);
    return {
      success: true,
      action: "summarize",
      items: formatted,
      message: summary ? "Here is what I found:" : "Unable to summarize matching history.",
      summary,
      plan: normalized,
    };
  }
  return {
    success: false,
    action: normalized.action,
    items: [],
    message: "Unsupported action.",
    plan: normalized,
  };
}

export function createHistoryAssistantService() {
  const state = {
    enabled: false,
  };

  async function refreshFlag() {
    try {
      const stored = await chrome.storage.local.get({ [HISTORY_ASSISTANT_FLAG_KEY]: false });
      state.enabled = Boolean(stored[HISTORY_ASSISTANT_FLAG_KEY]);
    } catch (err) {
      console.warn("Spotlight: failed to read history assistant flag", err);
      state.enabled = false;
    }
  }

  refreshFlag();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (HISTORY_ASSISTANT_FLAG_KEY in changes) {
      state.enabled = Boolean(changes[HISTORY_ASSISTANT_FLAG_KEY]?.newValue);
    }
  });

  return {
    isEnabled() {
      return state.enabled;
    },
    async handleQuery(query, options = {}) {
      if (!state.enabled) {
        return { success: false, disabled: true, message: "Smart History Assistant is turned off." };
      }
      const text = normalizeText(query);
      if (!text) {
        return { success: false, message: "Ask me about your browsing history." };
      }
      const contextHint = normalizeText(options?.contextHint || "");
      let plan;
      try {
        plan = await interpretQuery(text, contextHint);
      } catch (error) {
        return { success: false, message: error?.message || "I couldn't understand that request." };
      }
      try {
        return await executeCommand(plan);
      } catch (error) {
        console.error("Spotlight: history assistant execution failed", error);
        return { success: false, message: error?.message || "Unable to complete that request." };
      }
    },
    async runCommand(command, options = {}) {
      if (!state.enabled) {
        return { success: false, disabled: true, message: "Smart History Assistant is turned off." };
      }
      try {
        return await executeCommand(command, options);
      } catch (error) {
        console.error("Spotlight: history assistant command failed", error);
        return { success: false, message: error?.message || "Unable to process that action." };
      }
    },
  };
}

