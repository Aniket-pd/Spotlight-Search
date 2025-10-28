import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";

const ALLOWED_ACTIONS = new Set(["show", "open", "delete", "summarize", "frequent", "info"]);
const MAX_DATASET_ENTRIES = 120;
const MAX_RESPONSE_RESULTS = 60;

const TIME_RANGE_SYSTEM_PROMPT =
  "You are Spotlight's time-range analyst. You read a user's natural-language history request and" +
  " identify the smallest UTC time window that captures the activity they're asking about." +
  " Always respond with JSON that matches the provided schema. If the user gives no time clues," +
  " leave both start and end null and label the window 'all time'." +
  " Accept relative (e.g. 'last 4 days'), absolute (e.g. 'on Monday'), and partial references" +
  " (e.g. 'around 9 PM yesterday').";

const ASSISTANT_SYSTEM_PROMPT =
  "You are Spotlight's Smart History Assistant running on-device." +
  " A JSON array of history entries is supplied. Each entry has an id, title, url," +
  " lastVisitTime (UTC ms), visitCount, and domain. Interpret the user's request, pick an intent," +
  " and choose the matching entries." +
  " Only return entries from the dataset—never invent new URLs or titles." +
  " For each match, return its id inside filteredResults so Spotlight can map it back." +
  " Keep outputMessage short, friendly, and ready for the UI." +
  " Use intents show (list results), open (immediately reopen), delete (remove from history)," +
  " summarize (summarize activity), frequent (top repeated items), or info (about yourself)." +
  " Prefer concise labels like 'past 4 days'.";

const TIME_RANGE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["timeRange"],
  properties: {
    timeRange: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: {
        start: { anyOf: [{ type: "string" }, { type: "null" }] },
        end: { anyOf: [{ type: "string" }, { type: "null" }] },
        label: { type: "string" },
        raw: { type: "string" },
      },
    },
    confidence: { type: "number" },
  },
};

const ASSISTANT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["action", "outputMessage"],
  properties: {
    action: { type: "string", enum: Array.from(ALLOWED_ACTIONS) },
    outputMessage: { type: "string" },
    searchQuery: { type: "string" },
    topic: { type: "string" },
    site: { type: "string" },
    limit: { type: "integer", minimum: 1 },
    timeRangeLabel: { type: "string" },
    filteredResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 },
          notes: { type: "string" },
        },
      },
    },
  },
};

function sanitizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function sanitizeIntent(value) {
  if (typeof value !== "string") {
    return "show";
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_ACTIONS.has(normalized) ? normalized : "show";
}

function normalizeLimit(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function extractDomain(value) {
  const text = sanitizeString(value);
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch (error) {
    return text.replace(/^[^a-z0-9]+/i, "").replace(/[^a-z0-9.-]+/gi, "").toLowerCase();
  }
}

function toMillis(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}

function clampTimestamp(value) {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function ensureRangeOrder(start, end) {
  if (start !== null && end !== null && start > end) {
    return { start: end, end: start };
  }
  return { start, end };
}

function formatDateLabel(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeRangeLabel(start, end) {
  if (start === null && end === null) {
    return "all time";
  }
  if (start !== null && end !== null) {
    const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
    if (sameDay) {
      return formatDateLabel(start);
    }
    return `${formatDateLabel(start)} – ${formatDateLabel(end)}`;
  }
  if (start !== null) {
    return `since ${formatDateLabel(start)}`;
  }
  if (end !== null) {
    return `before ${formatDateLabel(end)}`;
  }
  return "all time";
}

function buildTimeRangePayload(range, label, now) {
  const payload = {
    presetId: null,
    raw: label || "",
    label: label || "",
    kind: "detected",
    resolvedAt: clampTimestamp(now) ?? Date.now(),
  };
  if (range.start !== null) {
    payload.from = clampTimestamp(range.start);
  }
  if (range.end !== null) {
    payload.to = clampTimestamp(range.end);
  }
  return payload;
}

function normalizeDatasetEntry(item, index) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const datasetId = `h${index}`;
  const title = sanitizeString(item.title) || sanitizeString(item.url) || "Untitled";
  const url = sanitizeString(item.url);
  if (!url) {
    return null;
  }
  const lastVisitTime = clampTimestamp(item.lastVisitTime);
  const visitCount = Number.isFinite(item.visitCount) && item.visitCount > 0 ? Math.floor(item.visitCount) : null;
  const domain = sanitizeString(item.origin) || extractDomain(url);
  return {
    id: datasetId,
    itemId: item.id,
    title,
    url,
    lastVisitTime,
    visitCount,
    domain,
  };
}

function mapAssistantResults(results, datasetMap) {
  if (!Array.isArray(results) || !results.length) {
    return [];
  }
  const mapped = [];
  const seen = new Set();
  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const id = sanitizeString(entry.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const datasetEntry = datasetMap.get(id);
    if (!datasetEntry) {
      continue;
    }
    mapped.push({
      id: datasetEntry.itemId,
      type: "history",
      title: datasetEntry.title,
      url: datasetEntry.url,
      lastVisitTime: datasetEntry.lastVisitTime ?? null,
      visitCount: datasetEntry.visitCount ?? null,
      domain: datasetEntry.domain,
    });
    if (mapped.length >= MAX_RESPONSE_RESULTS) {
      break;
    }
  }
  return mapped;
}

async function loadHistoryDataset(ensureIndex, range) {
  const data = await ensureIndex();
  const items = Array.isArray(data?.items) ? data.items : [];
  const historyItems = items.filter((entry) => entry && entry.type === "history");
  const filtered = historyItems.filter((entry) => {
    const timestamp = clampTimestamp(entry?.lastVisitTime);
    if (!Number.isFinite(timestamp)) {
      return true;
    }
    if (range.start !== null && timestamp < range.start) {
      return false;
    }
    if (range.end !== null && timestamp > range.end) {
      return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    const aTime = clampTimestamp(a?.lastVisitTime) ?? 0;
    const bTime = clampTimestamp(b?.lastVisitTime) ?? 0;
    return bTime - aTime;
  });
  const limited = filtered.slice(0, MAX_DATASET_ENTRIES);
  const dataset = [];
  const datasetMap = new Map();
  limited.forEach((item, index) => {
    const entry = normalizeDatasetEntry(item, index);
    if (!entry) {
      return;
    }
    dataset.push(entry);
    datasetMap.set(entry.id, entry);
  });
  return {
    entries: dataset,
    map: datasetMap,
    totalMatches: filtered.length,
    totalAvailable: historyItems.length,
  };
}

async function detectTimeRange(session, text, now) {
  const isoNow = new Date(now).toISOString();
  const prompt = [
    {
      role: "user",
      content: `Current UTC time: ${isoNow}\nUser request:\n"""${text}"""`,
    },
  ];
  const raw = await session.prompt(prompt, { responseConstraint: TIME_RANGE_RESPONSE_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Time range detector returned invalid JSON");
  }
  const rangeObject = parsed?.timeRange || {};
  const start = toMillis(rangeObject.start);
  const end = toMillis(rangeObject.end);
  const ordered = ensureRangeOrder(start, end);
  const labelCandidate = sanitizeString(rangeObject.label);
  const rawLabel = sanitizeString(rangeObject.raw);
  const label = labelCandidate || rawLabel || formatTimeRangeLabel(ordered.start, ordered.end);
  return {
    start: ordered.start,
    end: ordered.end,
    label,
    rawLabel,
    confidence: Number.isFinite(parsed?.confidence) ? parsed.confidence : null,
  };
}

async function interpretWithDataset(session, options) {
  const text = options.text;
  const datasetEntries = Array.isArray(options.dataset?.entries) ? options.dataset.entries : [];
  const datasetSummary = `Showing ${datasetEntries.length} entr${datasetEntries.length === 1 ? "y" : "ies"} out of ${options.dataset?.totalMatches || 0} in range.`;
  const datasetJson = JSON.stringify(datasetEntries, null, 2);
  const isoNow = new Date(options.now).toISOString();
  const timeLabel = sanitizeString(options.timeLabel) || "all time";
  const prompt = [
    {
      role: "user",
      content:
        `Current UTC time: ${isoNow}\n` +
        `Focused time range: ${timeLabel}\n` +
        `${datasetSummary}\n\n` +
        `History dataset (use ids exactly as provided):\n${datasetJson}\n\n` +
        `User request:\n"""${text}"""`,
    },
  ];
  const raw = await session.prompt(prompt, { responseConstraint: ASSISTANT_RESPONSE_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Assistant returned invalid JSON");
  }
  return parsed;
}

export function createSmartHistoryAssistant({ ensureIndex } = {}) {
  if (typeof ensureIndex !== "function") {
    throw new Error("Missing ensureIndex dependency for history assistant");
  }

  let availabilityChecked = false;
  let availabilityPromise = null;
  let timeSessionInstance = null;
  let timeSessionPromise = null;
  let interpretSessionInstance = null;
  let interpretSessionPromise = null;

  async function ensureAvailability() {
    if (availabilityChecked) {
      return;
    }
    if (availabilityPromise) {
      return availabilityPromise;
    }
    availabilityPromise = (async () => {
      if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
        throw new Error("Prompt API unavailable");
      }
      const availability = await globalThis.LanguageModel.availability();
      if (availability === "unavailable") {
        throw new Error("Prompt model unavailable");
      }
      availabilityChecked = true;
    })();
    return availabilityPromise;
  }

  async function ensureTimeSession() {
    if (timeSessionInstance) {
      return timeSessionInstance;
    }
    if (timeSessionPromise) {
      return timeSessionPromise;
    }
    timeSessionPromise = globalThis.LanguageModel.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      initialPrompts: [{ role: "system", content: TIME_RANGE_SYSTEM_PROMPT }],
    })
      .then((instance) => {
        timeSessionInstance = instance;
        timeSessionPromise = null;
        return instance;
      })
      .catch((error) => {
        timeSessionPromise = null;
        throw error;
      });
    return timeSessionPromise;
  }

  async function ensureInterpretSession() {
    if (interpretSessionInstance) {
      return interpretSessionInstance;
    }
    if (interpretSessionPromise) {
      return interpretSessionPromise;
    }
    interpretSessionPromise = globalThis.LanguageModel.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      initialPrompts: [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }],
    })
      .then((instance) => {
        interpretSessionInstance = instance;
        interpretSessionPromise = null;
        return instance;
      })
      .catch((error) => {
        interpretSessionPromise = null;
        throw error;
      });
    return interpretSessionPromise;
  }

  async function interpret(options = {}) {
    if (!isSmartHistoryAssistantEnabled()) {
      throw new Error("Smart history assistant disabled");
    }
    const text = sanitizeString(options.text);
    if (!text) {
      throw new Error("Ask something about your history to get started");
    }

    await ensureAvailability();
    const now = Date.now();
    const timeSession = await ensureTimeSession();
    const detectedRange = await detectTimeRange(timeSession, text, now).catch((error) => {
      console.warn("Spotlight: time-range detection failed", error);
      return { start: null, end: null, label: "all time", rawLabel: "" };
    });
    const range = {
      start: detectedRange.start ?? null,
      end: detectedRange.end ?? null,
    };
    const dataset = await loadHistoryDataset(ensureIndex, range).catch((error) => {
      console.warn("Spotlight: failed to load history dataset", error);
      return { entries: [], map: new Map(), totalMatches: 0, totalAvailable: 0 };
    });
    const timeLabel = detectedRange.label || formatTimeRangeLabel(range.start, range.end);
    const interpretSession = await ensureInterpretSession();
    const assistantResponse = await interpretWithDataset(interpretSession, {
      text,
      dataset,
      now,
      timeLabel,
    });

    const intent = sanitizeIntent(assistantResponse?.action);
    const message = sanitizeString(assistantResponse?.outputMessage);
    const searchQuery = sanitizeString(assistantResponse?.searchQuery);
    const topic = sanitizeString(assistantResponse?.topic);
    const site = extractDomain(assistantResponse?.site);
    const limit = normalizeLimit(assistantResponse?.limit);
    const responseLabel = sanitizeString(assistantResponse?.timeRangeLabel);
    const effectiveLabel = responseLabel || timeLabel || "all time";
    const results = mapAssistantResults(assistantResponse?.filteredResults, dataset.map);

    const timeRangePayload = buildTimeRangePayload(range, effectiveLabel, now);

    return {
      intent,
      message: message ||
        (intent === "info"
          ? "I'm Spotlight's on-device history assistant."
          : "Ready to help with your history."),
      query: searchQuery,
      topic,
      site,
      limit,
      timeRange: timeRangePayload,
      results,
      totalCount: dataset.totalMatches,
      evaluatedCount: dataset.entries.length,
      filteredCount: results.length,
      rangeConfidence: detectedRange.confidence,
    };
  }

  return { interpret };
}
