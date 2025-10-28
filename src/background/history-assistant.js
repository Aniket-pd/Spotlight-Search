const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 7 * DAY_MS;
const MAX_DATASET_ENTRIES = 160;
const MAX_RESULT_IDS = 12;
const MAX_ACTION_TABS = 8;

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
    const session = await ensureSessionInstance(state);
    const nowIso = new Date(now).toISOString();
    let detectedRange = null;
    let confidence = null;
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

    if (!detectedRange) {
      detectedRange = fallbackTimeRange(now);
    }

    const relevantItems = dedupeByUrl(selectHistoryItems(items, detectedRange)).slice(0, MAX_DATASET_ENTRIES);
    if (!relevantItems.length) {
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

    const dataset = relevantItems
      .map((item) => toDatasetEntry(item))
      .filter(Boolean);

    const timeRangeIso = {
      start: formatIso(detectedRange.start),
      end: formatIso(detectedRange.end),
    };

    console.info("Spotlight history assistant dataset", {
      prompt: trimmed,
      timeRange: timeRangeIso,
      count: dataset.length,
      tabs: dataset,
    });

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
      datasetSize: relevantItems.length,
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

