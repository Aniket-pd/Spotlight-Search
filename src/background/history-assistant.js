const HISTORY_DATASET_LIMIT = 120;
const MAX_ASSISTANT_RESULTS = 12;
const MIN_RANGE_WINDOW_MS = 5 * 60 * 1000;
const SINGLE_POINT_WINDOW_MS = 60 * 60 * 1000;

const TIME_RANGE_SCHEMA = {
  type: "object",
  properties: {
    timeRange: {
      type: ["object", "null"],
      properties: {
        start: { type: ["string", "null"] },
        end: { type: ["string", "null"] },
      },
      required: ["start", "end"],
      additionalProperties: false,
    },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  },
  required: ["timeRange"],
  additionalProperties: false,
};

const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "unknown"],
    },
    filteredResults: {
      type: "array",
      items: {
        type: "object",
        properties: {
          datasetId: { type: ["string", "null"] },
          id: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
        },
        required: [],
        additionalProperties: true,
      },
    },
    outputMessage: { type: ["string", "null"] },
  },
  required: ["action", "filteredResults", "outputMessage"],
  additionalProperties: false,
};

function toIsoTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return new Date(value).toISOString();
    } catch (err) {
      return null;
    }
  }
  if (value instanceof Date) {
    try {
      return value.toISOString();
    } catch (err) {
      return null;
    }
  }
  return null;
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, value));
  return clamped;
}

function sanitizeTimeRangeResult(result, now) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const rawRange = result.timeRange;
  if (!rawRange || typeof rawRange !== "object") {
    return null;
  }
  let startMs = parseTimestamp(rawRange.start);
  let endMs = parseTimestamp(rawRange.end);
  if (!startMs && !endMs) {
    return null;
  }
  if (!endMs) {
    endMs = now;
  }
  if (!startMs) {
    startMs = endMs - SINGLE_POINT_WINDOW_MS;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  if (endMs < startMs) {
    const tmp = endMs;
    endMs = startMs;
    startMs = tmp;
  }
  const nowClamped = Math.min(endMs, now);
  if (nowClamped !== endMs) {
    endMs = nowClamped;
  }
  if (endMs - startMs < MIN_RANGE_WINDOW_MS) {
    startMs = endMs - MIN_RANGE_WINDOW_MS;
  }
  if (startMs < 0) {
    startMs = 0;
  }
  const confidence = clampConfidence(result.confidence);
  return {
    start: startMs,
    end: endMs,
    confidence: confidence === null ? undefined : confidence,
  };
}

function filterHistoryItemsByRange(items, range) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  const start = typeof range?.start === "number" ? range.start : null;
  const end = typeof range?.end === "number" ? range.end : null;
  return items.filter((item) => {
    if (!item || item.type !== "history") {
      return false;
    }
    const timestamp = typeof item.lastVisitTime === "number" ? item.lastVisitTime : 0;
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return false;
    }
    if (start !== null && timestamp < start) {
      return false;
    }
    if (end !== null && timestamp > end) {
      return false;
    }
    return true;
  });
}

function formatRangeLabel(range, now) {
  if (!range || (!range.start && !range.end)) {
    return "";
  }
  const startDate = typeof range.start === "number" ? new Date(range.start) : null;
  const endDate = typeof range.end === "number" ? new Date(range.end) : new Date(now);
  if ((startDate && Number.isNaN(startDate.getTime())) || Number.isNaN(endDate.getTime())) {
    return "";
  }
  try {
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    if (!startDate) {
      return dateFormatter.format(endDate);
    }
    const sameDay = startDate.toDateString() === endDate.toDateString();
    if (sameDay) {
      const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
      return `${dateFormatter.format(startDate)} · ${timeFormatter.format(startDate)} – ${timeFormatter.format(endDate)}`;
    }
    return `${dateFormatter.format(startDate)} → ${dateFormatter.format(endDate)}`;
  } catch (err) {
    return "";
  }
}

function extractHostname(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function buildDatasetEntry(item) {
  const id = typeof item?.id === "number" ? item.id : null;
  const title = typeof item?.title === "string" ? item.title : item?.url || "";
  const url = typeof item?.url === "string" ? item.url : "";
  const lastVisit = typeof item?.lastVisitTime === "number" ? item.lastVisitTime : null;
  return {
    datasetId: id !== null ? String(id) : null,
    title,
    url,
    lastVisitTime: lastVisit ? toIsoTimestamp(lastVisit) : null,
    hostname: extractHostname(url),
  };
}

function normalizeAction(action) {
  if (typeof action !== "string") {
    return "show";
  }
  const lowered = action.toLowerCase();
  if (lowered === "show" || lowered === "open" || lowered === "delete" || lowered === "summarize") {
    return lowered;
  }
  if (lowered === "unknown") {
    return "show";
  }
  if (lowered.includes("delete")) {
    return "delete";
  }
  if (lowered.includes("open")) {
    return "open";
  }
  if (lowered.includes("summarize")) {
    return "summarize";
  }
  return "show";
}

function buildFallbackMessage(action, count, range, now) {
  const plural = count === 1 ? "entry" : "entries";
  const rangeLabel = formatRangeLabel(range, now);
  if (!count) {
    return rangeLabel ? `No history ${plural} found for ${rangeLabel}.` : "No matching history entries found.";
  }
  const verb = action === "delete" ? "delete" : action === "open" ? "open" : action === "summarize" ? "summarize" : "view";
  if (rangeLabel) {
    return `Found ${count} history ${plural} to ${verb} for ${rangeLabel}.`;
  }
  return `Found ${count} history ${plural} to ${verb}.`;
}

let rangeSessionInstance = null;
let rangeSessionPromise = null;
let interpretSessionInstance = null;
let interpretSessionPromise = null;

async function ensureRangeSession() {
  if (rangeSessionInstance) {
    return rangeSessionInstance;
  }
  if (rangeSessionPromise) {
    return rangeSessionPromise;
  }
  if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
    throw new Error("Prompt API unavailable");
  }
  const availability = await globalThis.LanguageModel.availability();
  if (availability === "unavailable") {
    throw new Error("Prompt model unavailable");
  }
  rangeSessionPromise = globalThis.LanguageModel.create()
    .then((instance) => {
      rangeSessionInstance = instance;
      rangeSessionPromise = null;
      return instance;
    })
    .catch((error) => {
      rangeSessionPromise = null;
      throw error;
    });
  return rangeSessionPromise;
}

async function ensureInterpretSession() {
  if (interpretSessionInstance) {
    return interpretSessionInstance;
  }
  if (interpretSessionPromise) {
    return interpretSessionPromise;
  }
  if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
    throw new Error("Prompt API unavailable");
  }
  const availability = await globalThis.LanguageModel.availability();
  if (availability === "unavailable") {
    throw new Error("Prompt model unavailable");
  }
  interpretSessionPromise = globalThis.LanguageModel.create()
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

async function detectTimeRange(prompt, now) {
  const session = await ensureRangeSession();
  const nowIso = toIsoTimestamp(now);
  const request = `You detect precise UTC time ranges from natural language.
Current time: ${nowIso}.
User request: """${prompt}""".
Provide a JSON object {"timeRange": {"start": ISO8601 string or null, "end": ISO8601 string or null}, "confidence": number between 0 and 1}.
Prefer tight intervals and ensure start <= end. Use a roughly one-hour window when a single moment is referenced.`;
  const raw = await session.prompt(request, { responseConstraint: TIME_RANGE_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("Spotlight: failed to parse history time range", error);
    return null;
  }
  return sanitizeTimeRangeResult(parsed, now);
}

function sanitizeInterpretation(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const action = normalizeAction(result.action);
  const outputMessage = typeof result.outputMessage === "string" ? result.outputMessage.trim() : "";
  const filteredResults = Array.isArray(result.filteredResults) ? result.filteredResults : [];
  return { action, outputMessage, filteredResults };
}

async function interpretHistory(prompt, dataset, range, now) {
  const session = await ensureInterpretSession();
  const nowIso = toIsoTimestamp(now);
  const startIso = range.start ? toIsoTimestamp(range.start) : null;
  const endIso = range.end ? toIsoTimestamp(range.end) : null;
  const datasetJson = JSON.stringify(dataset, null, 2);
  const request = `You select browser history entries based on a request.
Current time: ${nowIso}.
Time window start: ${startIso || "null"}.
Time window end: ${endIso || "null"}.
History dataset (JSON array):
${datasetJson}

Only choose from provided entries. Decide the user's intent (show/open/delete/summarize) and keep filteredResults ordered by relevance. Limit to at most ${MAX_ASSISTANT_RESULTS} items. Respond with JSON {"action": "show|open|delete|summarize|unknown", "filteredResults": [{"datasetId": string, "title": string, "url": string, ...}], "outputMessage": string}. If no matches, return an empty array and explain why.`;
  const raw = await session.prompt(request, { responseConstraint: INTERPRETATION_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("Spotlight: failed to parse history interpretation", error);
    return null;
  }
  return sanitizeInterpretation(parsed);
}

export function createHistoryAssistantService() {
  async function processQuery(options = {}) {
    const prompt = typeof options.prompt === "string" ? options.prompt.trim() : "";
    if (!prompt) {
      return null;
    }
    const items = Array.isArray(options.items) ? options.items : [];
    const historyItems = items.filter((item) => item && item.type === "history" && typeof item.url === "string" && item.url);
    if (!historyItems.length) {
      return null;
    }
    const now = typeof options.now === "number" && Number.isFinite(options.now) ? options.now : Date.now();

    let range;
    try {
      range = await detectTimeRange(prompt, now);
    } catch (error) {
      console.warn("Spotlight: history assistant time detection failed", error);
      return null;
    }
    if (!range) {
      return null;
    }

    const filtered = filterHistoryItemsByRange(historyItems, range);
    const sorted = filtered
      .slice()
      .sort((a, b) => {
        const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
        const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
        return bTime - aTime;
      });
    const limited = sorted.slice(0, HISTORY_DATASET_LIMIT);
    const datasetEntries = limited.map((item) => ({ item, payload: buildDatasetEntry(item) }));
    const dataset = datasetEntries.map((entry) => entry.payload);
    const datasetMap = new Map();
    datasetEntries.forEach((entry) => {
      if (entry.payload.datasetId) {
        datasetMap.set(entry.payload.datasetId, entry);
      }
    });

    let interpretation;
    try {
      interpretation = await interpretHistory(prompt, dataset, range, now);
    } catch (error) {
      console.warn("Spotlight: history assistant interpretation failed", error);
      return null;
    }
    if (!interpretation) {
      return null;
    }

    const selectedItems = [];
    const seenIds = new Set();
    interpretation.filteredResults.forEach((entry) => {
      if (!entry) return;
      const explicitId = typeof entry.datasetId === "string" && entry.datasetId ? entry.datasetId : typeof entry.id === "string" ? entry.id : null;
      let match = explicitId ? datasetMap.get(explicitId) : null;
      if (!match && typeof entry.url === "string" && entry.url) {
        match = datasetEntries.find((candidate) => candidate.item.url === entry.url);
      }
      if (match && !seenIds.has(match.item.id)) {
        selectedItems.push(match.item);
        seenIds.add(match.item.id);
      }
    });

    if (!selectedItems.length && datasetEntries.length) {
      for (const entry of datasetEntries) {
        if (!seenIds.has(entry.item.id)) {
          selectedItems.push(entry.item);
          seenIds.add(entry.item.id);
        }
        if (selectedItems.length >= MAX_ASSISTANT_RESULTS) {
          break;
        }
      }
    }

    const trimmedMessage = interpretation.outputMessage && interpretation.outputMessage.trim();
    const action = normalizeAction(interpretation.action);
    const finalItems = selectedItems.slice(0, MAX_ASSISTANT_RESULTS);
    const message = trimmedMessage || buildFallbackMessage(action, finalItems.length, range, now);
    const rangeLabel = formatRangeLabel(range, now);

    return {
      action,
      message,
      items: finalItems,
      itemIds: finalItems.map((item) => item.id),
      timeRange: {
        start: range.start,
        end: range.end,
        confidence: typeof range.confidence === "number" ? range.confidence : undefined,
      },
      rangeLabel: rangeLabel || undefined,
    };
  }

  return {
    processQuery,
  };
}
