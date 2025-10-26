const PROMPT_TEMPLATE = `You are "Smart History Search", the conversational history assistant for a Chrome extension.
Your job is to interpret the user's plain-language request about their browsing history and translate it
into structured intent for search, reopening, or deleting history entries.

Follow these guidelines:
• Choose action "search" when the user wants to review, list, or filter history entries.
• Choose "open" only when the user clearly wants to reopen pages or resume work.
• Choose "delete" when the user wants history removed. Prefer deleteScope "range" for broad time spans
  ("everything from Saturday"), otherwise use "urls".
• Choose "clarify" if the request is ambiguous, lacks a target, or mixes conflicting intents. Pair it with a
  follow-up question to resolve the uncertainty.
• Confidence must be a value between 0 and 1. Only exceed 0.6 when the request is explicit.
• Convert relative times ("last weekend", "yesterday morning") into ISO 8601 UTC timestamps covering the
  requested window. Use start at 00:00 and end at 23:59 when only a day is specified. Include a short label
  (for example "Last weekend" or "Yesterday morning").
• Provide up to four concise topic keywords that help filter titles/URLs (lowercase, no punctuation, omit duplicates).
• Capture requested counts in "quantity" (e.g., "three tabs" → 3). Leave null when unspecified.
• Keep "ack" to a brief friendly acknowledgement (< 120 characters) that mirrors the user's intent and any
  interpreted time window.
• Output JSON only, with no extra prose.

Return a JSON object following this schema:
{
  "action": "search" | "open" | "delete" | "clarify",
  "confidence": number,
  "topics": string[],
  "timeRange": {
    "start": string | null,
    "end": string | null,
    "label": string | null
  } | null,
  "quantity": number | null,
  "deleteScope": "urls" | "range" | null,
  "followup": {
    "required": boolean,
    "question": string,
    "hint": string | null
  } | null,
  "ack": string | null
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    action: { type: "string", enum: ["search", "open", "delete", "clarify"] },
    confidence: { type: "number" },
    topics: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    timeRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            start: { anyOf: [{ type: "string" }, { type: "null" }] },
            end: { anyOf: [{ type: "string" }, { type: "null" }] },
            label: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      ],
    },
    quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
    deleteScope: { anyOf: [{ type: "string" }, { type: "null" }] },
    followup: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            required: { type: "boolean" },
            question: { type: "string" },
            hint: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      ],
    },
    ack: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["action", "confidence"],
};

const DEFAULT_SEARCH_LIMIT = 120;
const MAX_OPEN_COUNT = 10;
const MAX_DELETE_PREVIEW = 40;
const CONFIDENCE_THRESHOLD = 0.45;
const CONFIDENCE_STRONG = 0.68;
const CONFIRMATION_TTL = 10 * 60 * 1000;
const UNDO_TTL = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatPrompt(query) {
  return `${PROMPT_TEMPLATE}\n\nUser request:\n${query.trim()}`;
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampQuantity(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.max(1, Math.round(value));
  return Number.isFinite(rounded) ? rounded : fallback;
}

function pickAction(action) {
  if (action === "search" || action === "open" || action === "delete" || action === "clarify") {
    return action;
  }
  return "search";
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const topic of topics) {
    if (typeof topic !== "string") {
      continue;
    }
    const trimmed = topic.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= 6) {
      break;
    }
  }
  return normalized;
}

function normalizeFollowup(followup) {
  if (!followup || typeof followup !== "object") {
    return null;
  }
  const required = Boolean(followup.required);
  const question = typeof followup.question === "string" ? followup.question.trim() : "";
  const hint = typeof followup.hint === "string" ? followup.hint.trim() : "";
  if (!required && !question) {
    return null;
  }
  return {
    required: required || !question,
    question: question || "Could you clarify what you'd like me to do with your history?",
    hint: hint || "",
  };
}

function normalizeTimeRange(range) {
  if (!range || typeof range !== "object") {
    return { start: null, end: null, label: "" };
  }
  const start = parseTimestamp(range.start);
  const end = parseTimestamp(range.end);
  const label = typeof range.label === "string" ? range.label.trim() : "";
  return { start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null, label };
}

function startOfDay(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayLabel(timestamp) {
  const dayStart = startOfDay(timestamp);
  if (!Number.isFinite(dayStart)) {
    return "";
  }
  const todayStart = startOfDay(Date.now());
  if (Number.isFinite(todayStart)) {
    const diffDays = Math.round((dayStart - todayStart) / DAY_MS);
    if (diffDays === 0) {
      return "Today";
    }
    if (diffDays === -1) {
      return "Yesterday";
    }
    if (diffDays === 1) {
      return "Tomorrow";
    }
    if (diffDays >= -6 && diffDays <= 6) {
      const rel = relativeFormatter.format(diffDays, "day");
      return `${rel} · ${dayFormatter.format(dayStart)}`;
    }
  }
  return dayFormatter.format(dayStart);
}

function extractHost(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch (err) {
    return "";
  }
}

function formatTimeWindow(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const times = entries
    .map((entry) => (Number.isFinite(entry.lastVisitTime) ? entry.lastVisitTime : null))
    .filter((value) => Number.isFinite(value));
  if (!times.length) {
    return "";
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const startLabel = timeFormatter.format(new Date(min));
  const endLabel = timeFormatter.format(new Date(max));
  if (startLabel === endLabel) {
    return startLabel;
  }
  return `${startLabel} – ${endLabel}`;
}

function formatEntry(entry, index) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const url = typeof entry.url === "string" ? entry.url : "";
  if (!url) {
    return null;
  }
  const id = entry.id ? `history-${entry.id}` : `history-${index}`;
  const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : url;
  const lastVisitTime = Number.isFinite(entry.lastVisitTime) ? entry.lastVisitTime : null;
  const host = extractHost(url);
  return {
    id,
    url,
    title,
    host,
    lastVisitTime,
    timeLabel: lastVisitTime ? timeFormatter.format(new Date(lastVisitTime)) : "",
    visitCount: Number.isFinite(entry.visitCount) ? entry.visitCount : 0,
  };
}

function buildGroupKey(entry) {
  const timestamp = Number.isFinite(entry.lastVisitTime) ? entry.lastVisitTime : Date.now();
  const dayStart = startOfDay(timestamp);
  const host = entry.host || "other";
  return {
    key: `${dayStart || ""}-${host}`,
    dayStart,
    host,
  };
}

function groupEntries(entries) {
  const groupsByKey = new Map();
  const orderedKeys = [];

  entries.forEach((entry) => {
    const { key, dayStart, host } = buildGroupKey(entry);
    if (!groupsByKey.has(key)) {
      const label = formatDayLabel(dayStart);
      const hostLabel = host && host !== "other" ? host : "Multiple sites";
      const group = {
        id: key,
        dayStart,
        host,
        label: host ? `${label} · ${hostLabel}` : label,
        entries: [],
      };
      groupsByKey.set(key, group);
      orderedKeys.push(key);
    }
    const group = groupsByKey.get(key);
    group.entries.push(entry);
  });

  const groups = orderedKeys
    .map((key) => groupsByKey.get(key))
    .filter(Boolean)
    .sort((a, b) => {
      if (Number.isFinite(b.dayStart) && Number.isFinite(a.dayStart) && b.dayStart !== a.dayStart) {
        return b.dayStart - a.dayStart;
      }
      return (b.entries[0]?.lastVisitTime || 0) - (a.entries[0]?.lastVisitTime || 0);
    })
    .slice(0, 12);

  groups.forEach((group) => {
    group.entries.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
    group.timeWindow = formatTimeWindow(group.entries);
    group.entries = group.entries.slice(0, 12);
  });

  return groups;
}

function filterByTopics(entries, topics) {
  if (!topics || !topics.length) {
    return entries;
  }
  const lowered = topics.map((topic) => topic.toLowerCase());
  const filtered = entries.filter((entry) => {
    const haystack = `${entry.title || ""} ${entry.url || ""}`.toLowerCase();
    return lowered.every((topic) => haystack.includes(topic));
  });
  return filtered.length ? filtered : entries;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry || typeof entry.url !== "string") {
      continue;
    }
    const key = entry.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function summarizeTopics(topics) {
  if (!topics || !topics.length) {
    return "";
  }
  if (topics.length === 1) {
    return topics[0];
  }
  if (topics.length === 2) {
    return `${topics[0]} and ${topics[1]}`;
  }
  const head = topics.slice(0, topics.length - 1).join(", ");
  return `${head}, and ${topics[topics.length - 1]}`;
}

function buildSearchFeedback(count, topics, rangeLabel, ack) {
  const topicLabel = summarizeTopics(topics);
  const countLabel = count === 0 ? "didn't surface anything" : count === 1 ? "found 1 entry" : `found ${count} entries`;
  const parts = [];
  if (ack) {
    parts.push(ack);
  } else {
    const base = topicLabel ? `${countLabel} for ${topicLabel}` : countLabel;
    parts.push(base.charAt(0).toUpperCase() + base.slice(1));
  }
  if (rangeLabel) {
    parts.push(`(${rangeLabel})`);
  }
  return parts.join(" ").trim();
}

function buildOpenFeedback(count, topics, rangeLabel, ack) {
  if (ack) {
    return ack;
  }
  const topicLabel = summarizeTopics(topics);
  const parts = [];
  if (count <= 0) {
    parts.push("Nothing looked ready to reopen.");
  } else if (count === 1) {
    parts.push("Opening 1 page");
  } else {
    parts.push(`Opening ${count} pages`);
  }
  if (topicLabel) {
    parts.push(`for ${topicLabel}`);
  }
  if (rangeLabel) {
    parts.push(`(${rangeLabel})`);
  }
  return parts.join(" ").trim();
}

function buildDeletePreviewFeedback(count, topics, rangeLabel, ack) {
  if (ack) {
    return ack;
  }
  const topicLabel = summarizeTopics(topics);
  const base = count === 1 ? "Ready to remove 1 entry" : `Ready to remove ${count} entries`;
  const parts = [base];
  if (topicLabel) {
    parts.push(`about ${topicLabel}`);
  }
  if (rangeLabel) {
    parts.push(`(${rangeLabel})`);
  }
  return parts.join(" ").trim();
}

function buildDeleteFeedback(count, topics, rangeLabel) {
  const topicLabel = summarizeTopics(topics);
  const base = count === 1 ? "Removed 1 entry" : `Removed ${count} entries`;
  const parts = [base];
  if (topicLabel) {
    parts.push(`for ${topicLabel}`);
  }
  if (rangeLabel) {
    parts.push(`(${rangeLabel})`);
  }
  parts.push("— undo available for a minute.");
  return parts.join(" ").trim();
}

function createConfirmationToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `confirm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pruneMapByAge(map, ttl, now = Date.now()) {
  if (!map || typeof map.forEach !== "function") {
    return;
  }
  for (const [key, value] of map.entries()) {
    if (!value || !Number.isFinite(value.createdAt)) {
      continue;
    }
    if (now - value.createdAt > ttl) {
      map.delete(key);
    }
  }
}

async function openUrls(urls = []) {
  const valid = Array.from(
    new Set(
      urls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url) => url && /^https?:/i.test(url))
    )
  );
  if (!valid.length) {
    return { opened: 0 };
  }
  const results = await Promise.allSettled(valid.map((url) => chrome.tabs.create({ url })));
  const opened = results.filter((result) => result.status === "fulfilled").length;
  return { opened };
}

async function searchHistory(options = {}) {
  const {
    text = "",
    startTime = null,
    endTime = null,
    maxResults = DEFAULT_SEARCH_LIMIT,
  } = options;
  const params = {
    text: typeof text === "string" ? text : "",
    maxResults: Math.max(10, Math.min(maxResults, 500)),
  };
  if (Number.isFinite(startTime)) {
    params.startTime = startTime;
  }
  if (Number.isFinite(endTime)) {
    params.endTime = endTime;
  }
  const results = await chrome.history.search(params);
  const sorted = Array.isArray(results)
    ? results
        .filter((entry) => entry && typeof entry.url === "string")
        .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
    : [];
  return sorted;
}

function prepareEntries(rawEntries, topics) {
  const deduped = dedupeEntries(rawEntries);
  const filtered = filterByTopics(deduped, topics);
  return filtered
    .map((entry, index) => formatEntry(entry, index))
    .filter(Boolean);
}

function formatConfirmationEntries(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    url: entry.url,
    title: entry.title,
    host: entry.host,
    timeLabel: entry.timeLabel,
    lastVisitTime: entry.lastVisitTime,
  }));
}

export function createHistoryAssistantService() {
  let session = null;
  let sessionPromise = null;
  const pendingConfirmations = new Map();
  const undoHistory = new Map();

  async function ensureSession() {
    if (session) {
      return session;
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
            console.info(`Spotlight history assistant model download ${percent}%`);
          }
        });
      },
    })
      .then((instance) => {
        session = instance;
        sessionPromise = null;
        return instance;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
    return sessionPromise;
  }

  async function interpret(query) {
    const sessionInstance = await ensureSession();
    const prompt = formatPrompt(query);
    const raw = await sessionInstance.prompt(prompt, { responseConstraint: RESPONSE_SCHEMA });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("History assistant returned invalid JSON");
    }
    const action = pickAction(parsed.action);
    const confidence = Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
    const topics = normalizeTopics(parsed.topics);
    const timeRange = normalizeTimeRange(parsed.timeRange);
    const quantity = clampQuantity(parsed.quantity, null);
    const deleteScope = typeof parsed.deleteScope === "string" ? parsed.deleteScope : null;
    const followup = normalizeFollowup(parsed.followup);
    const ack = typeof parsed.ack === "string" ? parsed.ack.trim() : "";
    return { action, confidence, topics, timeRange, quantity, deleteScope, followup, ack };
  }

  function buildSearchText(topics, query) {
    if (topics && topics.length) {
      return topics.join(" ");
    }
    if (typeof query === "string" && query.trim()) {
      return query.trim();
    }
    return "";
  }

  function sanitizeRange(range) {
    if (!range) {
      return { start: null, end: null, label: "" };
    }
    const { start, end, label } = range;
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      return { start: end, end: start, label };
    }
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      label: typeof label === "string" ? label : "",
    };
  }

  function rememberConfirmation(token, entries, context) {
    pendingConfirmations.set(token, {
      token,
      entries,
      createdAt: Date.now(),
      context,
    });
    pruneMapByAge(pendingConfirmations, CONFIRMATION_TTL);
  }

  function rememberUndo(token, urls, context) {
    if (!urls || !urls.length) {
      return;
    }
    undoHistory.set(token, {
      token,
      urls: Array.from(new Set(urls)),
      createdAt: Date.now(),
      context,
    });
    pruneMapByAge(undoHistory, UNDO_TTL);
  }

  function buildSearchPayload(entries, topics, range, ack) {
    const groups = groupEntries(entries);
    const feedback = buildSearchFeedback(entries.length, topics, range.label, ack);
    return {
      success: true,
      action: "search",
      groups,
      feedback,
      rangeLabel: range.label,
      topics,
    };
  }

  async function handleOpenRequest(entries, topics, range, ack, quantity) {
    const limit = Math.min(MAX_OPEN_COUNT, Math.max(1, quantity || 3));
    const selection = entries.slice(0, limit);
    const urls = selection.map((entry) => entry.url);
    const { opened } = await openUrls(urls);
    const groups = groupEntries(selection);
    const feedback = buildOpenFeedback(opened, topics, range.label, ack);
    return {
      success: true,
      action: "open",
      opened,
      groups,
      feedback,
      rangeLabel: range.label,
      topics,
    };
  }

  async function handleDeleteRequest(entries, topics, range, ack, deleteScope) {
    const preview = entries.slice(0, MAX_DELETE_PREVIEW);
    if (!preview.length) {
      return {
        success: true,
        action: "delete",
        requiresConfirmation: false,
        feedback: "I couldn't spot any matching history to delete.",
        rangeLabel: range.label,
        topics,
        removedCount: 0,
      };
    }
    const token = createConfirmationToken();
    rememberConfirmation(token, preview, { topics, range, deleteScope });
    const groups = groupEntries(preview);
    const feedback = buildDeletePreviewFeedback(preview.length, topics, range.label, ack);
    return {
      success: true,
      action: "delete",
      requiresConfirmation: true,
      confirmation: {
        token,
        entries: formatConfirmationEntries(preview),
        deleteScope: deleteScope || "urls",
        rangeLabel: range.label,
        summary: feedback,
      },
      groups,
      feedback,
      rangeLabel: range.label,
      topics,
    };
  }

  async function processRequest({ query }) {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (!trimmed) {
      return {
        success: false,
        error: "Tell me what to look for in your history.",
      };
    }
    const interpretation = await interpret(trimmed);
    const { action, confidence, topics, timeRange, quantity, deleteScope, followup, ack } = interpretation;
    const range = sanitizeRange(timeRange);

    if (action === "clarify" || confidence < CONFIDENCE_THRESHOLD || (followup && followup.required)) {
      return {
        success: true,
        action: "clarify",
        feedback: ack || "I'm not completely sure what to do yet.",
        followupQuestion: followup?.question || "Could you clarify what you'd like me to do with your history?",
        followupHint: followup?.hint || "",
        confidence,
        rangeLabel: range.label,
        topics,
      };
    }

    const searchText = buildSearchText(topics, trimmed);
    const rawResults = await searchHistory({ text: searchText, startTime: range.start, endTime: range.end });
    const prepared = prepareEntries(rawResults, topics);

    if (!prepared.length) {
      return {
        success: true,
        action: "search",
        groups: [],
        feedback: buildSearchFeedback(0, topics, range.label, ack),
        rangeLabel: range.label,
        topics,
      };
    }

    if (action === "open") {
      return handleOpenRequest(prepared, topics, range, ack, quantity);
    }

    if (action === "delete") {
      return handleDeleteRequest(prepared, topics, range, ack, deleteScope);
    }

    return buildSearchPayload(prepared, topics, range, ack);
  }

  async function confirmDeletion(token, selectedIds = []) {
    if (!token || typeof token !== "string") {
      throw new Error("Missing confirmation token");
    }
    pruneMapByAge(pendingConfirmations, CONFIRMATION_TTL);
    const record = pendingConfirmations.get(token);
    if (!record) {
      throw new Error("Deletion request expired");
    }
    const { entries, context } = record;
    const selectionSet = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
    const selectedEntries = selectionSet.size
      ? entries.filter((entry) => selectionSet.has(entry.id))
      : entries.slice();
    if (!selectedEntries.length) {
      throw new Error("Select at least one item to delete");
    }
    const urls = selectedEntries.map((entry) => entry.url).filter(Boolean);
    await Promise.allSettled(urls.map((url) => chrome.history.deleteUrl({ url })));
    pendingConfirmations.delete(token);
    const rangeLabel = context?.range?.label || "";
    const topics = Array.isArray(context?.topics) ? context.topics : [];
    const feedback = buildDeleteFeedback(selectedEntries.length, topics, rangeLabel);
    const undoToken = createConfirmationToken();
    rememberUndo(undoToken, urls, { range: context?.range, topics });
    return {
      success: true,
      action: "delete",
      removedCount: selectedEntries.length,
      feedback,
      undoToken,
      rangeLabel,
      topics,
    };
  }

  async function undoDeletion(token) {
    if (!token || typeof token !== "string") {
      throw new Error("Missing undo token");
    }
    pruneMapByAge(undoHistory, UNDO_TTL);
    const record = undoHistory.get(token);
    if (!record) {
      throw new Error("Undo is no longer available");
    }
    const { urls, context } = record;
    await Promise.allSettled(urls.map((url) => chrome.history.addUrl({ url })));
    undoHistory.delete(token);
    const rangeLabel = context?.range?.label || "";
    const topics = Array.isArray(context?.topics) ? context.topics : [];
    return {
      success: true,
      restoredCount: urls.length,
      feedback: "Restored those items to your history.",
      rangeLabel,
      topics,
    };
  }

  async function deleteEntries(entries, context = {}) {
    const sanitized = Array.isArray(entries)
      ? entries
          .map((entry) => {
            if (!entry || typeof entry.url !== "string") {
              return null;
            }
            return {
              url: entry.url,
              title: typeof entry.title === "string" ? entry.title : "",
            };
          })
          .filter(Boolean)
      : [];
    if (!sanitized.length) {
      throw new Error("Nothing selected to delete");
    }
    const urls = sanitized.map((entry) => entry.url);
    await Promise.allSettled(urls.map((url) => chrome.history.deleteUrl({ url })));
    const rangeLabel = typeof context.rangeLabel === "string" ? context.rangeLabel : "";
    const topics = Array.isArray(context.topics)
      ? context.topics.map((topic) => (typeof topic === "string" ? topic : "")).filter(Boolean)
      : [];
    const feedback = buildDeleteFeedback(sanitized.length, topics, rangeLabel);
    const undoToken = createConfirmationToken();
    rememberUndo(undoToken, urls, { range: { label: rangeLabel }, topics });
    return {
      success: true,
      action: "delete",
      removedCount: sanitized.length,
      feedback,
      undoToken,
      rangeLabel,
      topics,
    };
  }

  return {
    processRequest,
    confirmDeletion,
    undoDeletion,
    openUrls,
    deleteEntries,
  };
}
