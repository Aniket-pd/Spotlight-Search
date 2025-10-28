const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 7 * DAY_MS;
const MAX_DATASET_ENTRIES = 160;
const MAX_RESULT_IDS = 24;
const MAX_ACTION_TABS = 8;
const LOCAL_RESULT_LIMIT = 50;

const NUMBER_WORDS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const STOP_WORDS = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "any",
  "ask",
  "assistant",
  "at",
  "be",
  "browser",
  "browsing",
  "can",
  "did",
  "do",
  "entries",
  "entry",
  "for",
  "from",
  "have",
  "history",
  "i",
  "in",
  "just",
  "list",
  "me",
  "my",
  "of",
  "on",
  "please",
  "records",
  "show",
  "site",
  "sites",
  "tab",
  "tabs",
  "the",
  "these",
  "those",
  "visit",
  "visited",
  "was",
  "were",
  "what",
  "which",
]);

const TIME_WORDS = new Set([
  "ago",
  "earlier",
  "day",
  "days",
  "hour",
  "hours",
  "minute",
  "minutes",
  "month",
  "months",
  "past",
  "previous",
  "recent",
  "recently",
  "this",
  "today",
  "week",
  "weeks",
  "yesterday",
  "last",
  "tonight",
  "morning",
  "afternoon",
  "evening",
  "night",
]);

const TIME_RANGE_SCHEMA = {
  type: "object",
  properties: {
    timeRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
          additionalProperties: false,
        },
      ],
    },
    confidence: { type: "number" },
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
    outputMessage: { type: "string" },
    filteredResultIds: {
      type: "array",
      items: {
        anyOf: [
          { type: "number" },
          { type: "string" },
        ],
      },
    },
    notes: { type: "string" },
  },
  required: ["action", "outputMessage", "filteredResultIds"],
  additionalProperties: false,
};

function startOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function parseQuantityToken(token, fallback = 1) {
  if (!token) {
    return fallback;
  }
  const numeric = Number(token);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const normalized = token.toLowerCase();
  if (NUMBER_WORDS.has(normalized)) {
    return NUMBER_WORDS.get(normalized);
  }
  if (normalized === "a" || normalized === "an") {
    return 1;
  }
  if (normalized === "couple") {
    return 2;
  }
  if (normalized === "few" || normalized === "several") {
    return 3;
  }
  return fallback;
}

function deriveTimeRangeFromPrompt(prompt, now = Date.now()) {
  if (!prompt || typeof prompt !== "string") {
    return null;
  }
  const normalized = prompt.toLowerCase();

  if (normalized.includes("yesterday")) {
    const end = startOfLocalDay(now);
    const start = Math.max(0, end - DAY_MS);
    if (end > start) {
      return { range: { start, end }, confidence: 0.9 };
    }
  }

  if (normalized.includes("today")) {
    const start = startOfLocalDay(now);
    const end = Math.max(start + 60 * 1000, Math.min(now, endOfLocalDay(now)));
    if (end > start) {
      return { range: { start, end }, confidence: 0.75 };
    }
  }

  const relativeMatch = normalized.match(
    /\b(?:past|last)\s+(?:the\s+)?(?:(\d+|[a-z]+)\s+)?(minute|hour|day|week|month)s?\b/
  );
  if (relativeMatch) {
    const [, quantityToken, unit] = relativeMatch;
    const count = parseQuantityToken(quantityToken, 1);
    const unitLower = unit.toLowerCase();
    const unitToMs = {
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: DAY_MS,
      week: 7 * DAY_MS,
      month: 30 * DAY_MS,
    };
    const duration = unitToMs[unitLower];
    if (duration) {
      const total = duration * Math.max(1, count);
      if (unitLower === "day") {
        const alignedStart = startOfLocalDay(now - (count - 1) * DAY_MS);
        const end = Math.min(now, endOfLocalDay(now));
        if (end > alignedStart) {
          return { range: { start: Math.max(0, alignedStart), end }, confidence: 0.8 };
        }
      }
      const start = Math.max(0, now - total);
      if (now > start) {
        return { range: { start, end: now }, confidence: 0.8 };
      }
    }
  }

  const lastWeekMatch = normalized.match(/\b(last|previous)\s+week\b/);
  if (lastWeekMatch) {
    const end = startOfLocalDay(now);
    const start = Math.max(0, end - 7 * DAY_MS);
    if (end > start) {
      return { range: { start, end }, confidence: 0.7 };
    }
  }

  return null;
}

function formatIso(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  try {
    return new Date(timestamp).toISOString();
  } catch (err) {
    return null;
  }
}

function clampTimeRange(range, now = Date.now()) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const startValue = Date.parse(range.start);
  const endValue = Date.parse(range.end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return null;
  }
  if (endValue <= startValue) {
    return null;
  }
  const clampedEnd = Math.min(endValue, now);
  const clampedStart = Math.min(startValue, clampedEnd - 60 * 1000);
  return { start: clampedStart, end: clampedEnd };
}

function fallbackTimeRange(now = Date.now(), lookback = DEFAULT_LOOKBACK_MS) {
  const end = now;
  const start = Math.max(0, end - lookback);
  return { start, end };
}

function normalizeAction(action) {
  if (!action || typeof action !== "string") {
    return "show";
  }
  const normalized = action.toLowerCase().trim();
  if (["show", "open", "delete", "summarize"].includes(normalized)) {
    return normalized;
  }
  return "show";
}

function detectPromptAction(prompt) {
  const normalized = typeof prompt === "string" ? prompt.toLowerCase() : "";
  if (/\b(delete|remove|clear|erase|forget)\b/.test(normalized)) {
    return "delete";
  }
  if (/\b(open|reopen|launch|restore)\b/.test(normalized)) {
    return "open";
  }
  if (
    /\b(summarize|summary|recap|overview|explain)\b/.test(normalized) ||
    /\bwhat\s+(did|have)\s+i\s+(do|done)\b/.test(normalized)
  ) {
    return "summarize";
  }
  return "show";
}

function extractMeaningfulKeywords(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return [];
  }
  const tokens = prompt.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens) {
    return [];
  }
  const keywords = [];
  const seen = new Set();
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || TIME_WORDS.has(token) || NUMBER_WORDS.has(token)) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      continue;
    }
    if (token.length < 2) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}

function itemMatchesKeyword(item, keyword) {
  if (!item || !keyword) {
    return false;
  }
  const normalized = keyword.toLowerCase();
  if (!normalized) {
    return false;
  }
  const title = typeof item.title === "string" ? item.title.toLowerCase() : "";
  const url = typeof item.url === "string" ? item.url.toLowerCase() : "";
  const origin = typeof item.origin === "string" ? item.origin.toLowerCase() : "";
  return title.includes(normalized) || url.includes(normalized) || origin.includes(normalized);
}

function filterItemsByKeywords(items, keywords) {
  if (!Array.isArray(items) || !keywords?.length) {
    return Array.isArray(items) ? items.slice() : [];
  }
  return items.filter((item) => keywords.every((keyword) => itemMatchesKeyword(item, keyword)));
}

function dedupeByUrl(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    const key = item.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function toDatasetEntry(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const lastVisitIso = formatIso(item.lastVisitTime);
  const hostname = (() => {
    try {
      const parsed = new URL(item.url);
      return parsed.hostname || "";
    } catch (err) {
      return "";
    }
  })();
  return {
    id: item.id,
    title: item.title || item.url || "Untitled",
    url: item.url,
    host: hostname,
    lastVisitTime: lastVisitIso,
    visitCount: typeof item.visitCount === "number" ? item.visitCount : 0,
  };
}

function buildInterpretationPrompt({ prompt, dataset, nowIso, range, confidence }) {
  const datasetJson = JSON.stringify(dataset, null, 2);
  const rangeText = range ? `\nDetected range: ${range.start} to ${range.end}` : "";
  const confidenceText = Number.isFinite(confidence) ? `\nTime range confidence: ${confidence.toFixed(2)}` : "";
  return `You are the Smart History Search Assistant. Interpret the user's request using the provided browser history entries.\n\nCurrent UTC time: ${nowIso}${rangeText}${confidenceText}\nUser request: """${prompt}"""\n\nThe dataset below contains browser history entries in reverse chronological order. Only use these entries when selecting results. Return JSON that matches this schema exactly:\n{\n  "action": "show" | "open" | "delete" | "summarize" | "unknown",\n  "outputMessage": string,\n  "filteredResultIds": number[],\n  "notes": string (optional explanatory text)\n}\n\nRules:\n- Choose result ids only from the dataset.\n- Limit filteredResultIds to at most ${MAX_RESULT_IDS} entries, ordered by relevance.\n- Prefer entries that match the user's intent, domains, or topics.\n- If nothing matches, return an empty filteredResultIds array and craft a helpful outputMessage explaining that no history was found.\n- Use the "delete" action only if the user clearly wants to remove history entries.\n- Use the "open" action only if the user wants tabs reopened. Otherwise default to "show".\n- Summaries should still list relevant result ids.\n- Respond with JSON only.\n\nHistory dataset:\n${datasetJson}`;
}

function buildTimeRangePrompt(prompt, nowIso) {
  return `You analyze natural language history queries and extract an explicit UTC time range.\nCurrent UTC time: ${nowIso}\nUser request: """${prompt}"""\n\nRespond with JSON only:\n{\n  "timeRange": { "start": "<ISO8601 UTC>", "end": "<ISO8601 UTC>" } | null,\n  "confidence": number between 0 and 1 (optional)\n}\n\nGuidance:\n- Interpret relative phrases like "past 3 hours" or "23 minutes ago".\n- When the request mentions a single instant (for example "around 9 PM"), create a narrow window that includes that instant.\n- Clamp the end time so it is not in the future.\n- If you cannot determine a range, return null.`;
}

async function ensureSessionInstance(state) {
  if (state.sessionInstance) {
    return state.sessionInstance;
  }
  if (state.sessionPromise) {
    return state.sessionPromise;
  }
  if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
    throw new Error("Prompt API unavailable");
  }
  state.sessionPromise = globalThis.LanguageModel.create({
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
    .then((session) => {
      state.sessionInstance = session;
      state.sessionPromise = null;
      return session;
    })
    .catch((error) => {
      state.sessionPromise = null;
      throw error;
    });
  return state.sessionPromise;
}

async function runPrompt(session, text, schema) {
  const raw = await session.prompt(text, schema ? { responseConstraint: schema } : undefined);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("History assistant returned invalid JSON");
  }
}

function selectHistoryItems(items, range) {
  if (!Array.isArray(items)) {
    return [];
  }
  const { start, end } = range || {};
  return items
    .filter((item) => {
      if (!item || item.type !== "history") {
        return false;
      }
      const timestamp = Number(item.lastVisitTime) || 0;
      if (!Number.isFinite(timestamp)) {
        return false;
      }
      if (Number.isFinite(start) && timestamp < start) {
        return false;
      }
      if (Number.isFinite(end) && timestamp > end) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = Number(a.lastVisitTime) || 0;
      const bTime = Number(b.lastVisitTime) || 0;
      return bTime - aTime;
    });
}

function createResultPayload(item) {
  if (!item) {
    return null;
  }
  const payload = {
    id: item.id,
    type: item.type,
    title: item.title || item.url || "Untitled",
    url: item.url,
    description: item.url || "",
    lastVisitTime: item.lastVisitTime || null,
    visitCount: item.visitCount,
    origin: item.origin,
    historyAssistant: true,
  };
  if (item.faviconUrl) {
    payload.faviconUrl = item.faviconUrl;
  } else if (item.favIconUrl) {
    payload.faviconUrl = item.favIconUrl;
  }
  return payload;
}

function maybeHandleLocally({ prompt, items, limit = LOCAL_RESULT_LIMIT, range, confidence }) {
  const action = detectPromptAction(prompt);
  if (action !== "show") {
    return null;
  }
  const keywords = extractMeaningfulKeywords(prompt);
  const filteredItems = filterItemsByKeywords(items, keywords);
  if (!filteredItems.length) {
    return null;
  }
  const limitedItems = filteredItems.slice(0, Math.max(1, limit));
  const results = limitedItems.map((item) => createResultPayload(item)).filter(Boolean);
  if (!results.length) {
    return null;
  }

  let message;
  if (keywords.length) {
    const keywordText = keywords.map((keyword) => `"${keyword}"`).join(", ");
    message = `Here are the history entries matching ${keywordText}.`;
  } else {
    message = "Here are the history entries from your selected time range.";
  }

  const totalCount = filteredItems.length;
  const notesParts = [];
  notesParts.push(totalCount === 1 ? "Found 1 entry." : `Found ${totalCount} entries.`);
  if (results.length < totalCount) {
    notesParts.push(`Showing the first ${results.length}. Refine your request to narrow the results.`);
  }

  return {
    action: "show",
    message,
    notes: notesParts.join(" ").trim(),
    results,
    timeRange: range,
    datasetSize: totalCount,
    confidence: typeof confidence === "number" ? confidence : null,
  };
}

function buildFallbackMessage(range) {
  if (!range) {
    return "Here are the history results I found.";
  }
  try {
    const start = new Date(range.start).toLocaleString();
    const end = new Date(range.end).toLocaleString();
    return `Here are the history results between ${start} and ${end}.`;
  } catch (err) {
    return "Here are the history results I found.";
  }
}

async function performDelete(items, scheduleRebuild) {
  if (!Array.isArray(items) || !items.length) {
    return { deleted: 0 };
  }
  const uniqueUrls = new Set();
  const targets = [];
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    const key = item.url;
    if (uniqueUrls.has(key)) {
      continue;
    }
    uniqueUrls.add(key);
    targets.push(item.url);
  }
  let deleted = 0;
  for (const url of targets) {
    try {
      await chrome.history.deleteUrl({ url });
      deleted += 1;
    } catch (err) {
      console.warn("Spotlight: failed to delete history entry", err);
    }
  }
  if (typeof scheduleRebuild === "function" && deleted > 0) {
    scheduleRebuild(400);
  }
  return { deleted };
}

async function performOpen(items) {
  if (!Array.isArray(items) || !items.length) {
    return { opened: 0 };
  }
  const uniqueUrls = new Set();
  let opened = 0;
  for (const item of items.slice(0, MAX_ACTION_TABS)) {
    if (!item || typeof item.url !== "string" || !item.url) {
      continue;
    }
    if (uniqueUrls.has(item.url)) {
      continue;
    }
    uniqueUrls.add(item.url);
    try {
      await chrome.tabs.create({ url: item.url });
      opened += 1;
    } catch (err) {
      console.warn("Spotlight: failed to open history entry", err);
    }
  }
  return { opened };
}

export function createHistoryAssistantService(options = {}) {
  const state = {
    sessionInstance: null,
    sessionPromise: null,
  };
  const { scheduleRebuild } = options;

  async function analyzeHistoryRequest({ prompt, items, now = Date.now() }) {
    const trimmed = typeof prompt === "string" ? prompt.trim() : "";
    if (!trimmed) {
      throw new Error("Enter a history request to analyze");
    }
    const nowIso = new Date(now).toISOString();
    let session = null;
    let detectedRangeInfo = deriveTimeRangeFromPrompt(trimmed, now);
    let detectedRange = detectedRangeInfo?.range || null;
    let confidence = typeof detectedRangeInfo?.confidence === "number" ? detectedRangeInfo.confidence : null;

    if (!detectedRange) {
      session = await ensureSessionInstance(state);
      try {
        const timeResponse = await runPrompt(session, buildTimeRangePrompt(trimmed, nowIso), TIME_RANGE_SCHEMA);
        const clamped = clampTimeRange(timeResponse?.timeRange, now);
        if (clamped) {
          detectedRange = clamped;
        }
        if (typeof timeResponse?.confidence === "number") {
          confidence = Math.max(0, Math.min(1, timeResponse.confidence));
        }
      } catch (err) {
        console.warn("Spotlight: time range detection failed", err);
      }
    }

    if (!detectedRange) {
      detectedRange = fallbackTimeRange(now);
    }

    const allRelevantItems = dedupeByUrl(selectHistoryItems(items, detectedRange));
    const datasetSize = allRelevantItems.length;
    if (!datasetSize) {
      return {
        action: "show",
        message: "No history entries were found in that time range.",
        results: [],
        timeRange: {
          start: formatIso(detectedRange.start),
          end: formatIso(detectedRange.end),
        },
        datasetSize: 0,
        confidence,
      };
    }

    const relevantItems = allRelevantItems.slice(0, MAX_DATASET_ENTRIES);
    const dataset = relevantItems
      .map((item) => toDatasetEntry(item))
      .filter(Boolean);

    const timeRangeIso = {
      start: formatIso(detectedRange.start),
      end: formatIso(detectedRange.end),
    };

    const localResponse = maybeHandleLocally({
      prompt: trimmed,
      items: allRelevantItems,
      limit: LOCAL_RESULT_LIMIT,
      range: timeRangeIso,
      confidence,
    });

    console.info("Spotlight history assistant dataset", {
      prompt: trimmed,
      timeRange: timeRangeIso,
      count: dataset.length,
      total: datasetSize,
      truncated: datasetSize > dataset.length,
      handledLocally: Boolean(localResponse),
      tabs: dataset,
    });

    if (localResponse) {
      return {
        ...localResponse,
        timeRange: timeRangeIso,
        datasetSize,
        confidence: typeof localResponse.confidence === "number" ? localResponse.confidence : confidence,
      };
    }

    if (!session) {
      session = await ensureSessionInstance(state);
    }

    let stage2Session = session;
    if (session && typeof session.clone === "function") {
      try {
        stage2Session = await session.clone();
      } catch (err) {
        stage2Session = session;
      }
    }

    const interpretation = await runPrompt(
      stage2Session,
      buildInterpretationPrompt({
        prompt: trimmed,
        dataset,
        nowIso,
        range: timeRangeIso,
        confidence,
      }),
      INTERPRETATION_SCHEMA
    );

    const normalizedAction = normalizeAction(interpretation?.action);
    const requestedIds = Array.isArray(interpretation?.filteredResultIds)
      ? interpretation.filteredResultIds
      : [];
    const idSet = new Set();
    const results = [];
    for (const idValue of requestedIds) {
      const numericId = Number(idValue);
      if (!Number.isFinite(numericId)) {
        continue;
      }
      if (idSet.has(numericId)) {
        continue;
      }
      idSet.add(numericId);
      const match = relevantItems.find((entry) => entry.id === numericId);
      if (!match) {
        continue;
      }
      const payload = createResultPayload(match);
      if (payload) {
        results.push(payload);
      }
      if (results.length >= MAX_RESULT_IDS) {
        break;
      }
    }

    const message = typeof interpretation?.outputMessage === "string" && interpretation.outputMessage
      ? interpretation.outputMessage.trim()
      : buildFallbackMessage(detectedRange);

    return {
      action: normalizedAction,
      message,
      notes: typeof interpretation?.notes === "string" ? interpretation.notes.trim() : "",
      results,
      timeRange: timeRangeIso,
      datasetSize,
      confidence,
    };
  }

  async function executeAction(action, itemIds, items) {
    const normalizedAction = normalizeAction(action);
    const uniqueIds = Array.isArray(itemIds)
      ? Array.from(new Set(itemIds.map((id) => Number(id)).filter((value) => Number.isFinite(value))))
      : [];
    if (!uniqueIds.length) {
      throw new Error("No history entries available for the requested action");
    }
    const matches = uniqueIds
      .map((id) => (Array.isArray(items) ? items.find((entry) => entry && entry.id === id) : null))
      .filter(Boolean);

    if (!matches.length) {
      throw new Error("History entries are no longer available");
    }

    if (normalizedAction === "delete") {
      return performDelete(matches, scheduleRebuild);
    }
    if (normalizedAction === "open") {
      return performOpen(matches);
    }
    throw new Error("Unsupported action");
  }

  return {
    analyzeHistoryRequest,
    executeAction,
  };
}

