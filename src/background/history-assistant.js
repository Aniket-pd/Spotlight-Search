import { buildResultFromItem } from "../search/search.js";

const DEFAULT_FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DATASET_ENTRIES = 320;
const MAX_ACTION_TARGETS = 12;
const MAX_RESULTS = 12;

const STAGE_ONE_SCHEMA = {
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
    reasoning: { type: "string" },
  },
  additionalProperties: true,
};

const STAGE_TWO_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "none"],
    },
    outputMessage: { type: "string" },
    filteredResults: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { anyOf: [{ type: "number" }, { type: "string" }] },
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    summary: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["action", "outputMessage", "filteredResults"],
  additionalProperties: true,
};

function clampActionTargets(results) {
  if (!Array.isArray(results)) {
    return [];
  }
  const unique = [];
  const seen = new Set();
  for (const item of results) {
    if (!item || !item.url) continue;
    if (seen.has(item.url)) continue;
    unique.push(item);
    seen.add(item.url);
    if (unique.length >= MAX_ACTION_TARGETS) {
      break;
    }
  }
  return unique;
}

function parseDate(value) {
  if (!value) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function sanitizeTimeRange(parsed, now = Date.now()) {
  const fallbackEnd = now;
  const fallbackStart = now - DEFAULT_FALLBACK_WINDOW_MS;
  if (!parsed || typeof parsed !== "object") {
    return {
      start: fallbackStart,
      end: fallbackEnd,
      confidence: 0,
      usedFallback: true,
    };
  }

  const candidate = parsed.timeRange;
  let start = NaN;
  let end = NaN;
  if (candidate && typeof candidate === "object") {
    start = parseDate(candidate.start);
    end = parseDate(candidate.end);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return {
      start: fallbackStart,
      end: fallbackEnd,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      usedFallback: true,
    };
  }

  const clampedEnd = Math.min(end, now);
  const clampedStart = Math.min(start, clampedEnd);
  return {
    start: clampedStart,
    end: clampedEnd,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 1,
    usedFallback: false,
  };
}

function filterHistoryItems(items, range) {
  if (!Array.isArray(items)) {
    return [];
  }
  const { start, end } = range || {};
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return items.filter((item) => item && item.type === "history");
  }
  return items
    .filter((item) => {
      if (!item || item.type !== "history") {
        return false;
      }
      const visited = typeof item.lastVisitTime === "number" ? item.lastVisitTime : Number(item.lastVisitTime) || 0;
      if (!visited) {
        return false;
      }
      return visited >= start && visited <= end;
    })
    .sort((a, b) => {
      const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
      const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
      return bTime - aTime;
    });
}

function buildStageOnePrompt(promptText, now = Date.now()) {
  const currentIso = new Date(now).toISOString();
  return `You are a time range extraction service for a browser history assistant.\nCurrent UTC date/time: ${currentIso}.\n\nInfer the precise UTC start and end times for the user's request. Handle relative expressions ("past 3 hours", "23 minutes ago") and absolute expressions ("yesterday at 9 PM", "on Monday"). When the user references a moment ("what was I watching around 9 PM"), produce a narrow one-hour window centered on that moment. When the user references a span, cover the entire interval.\n\nReturn JSON with fields {"timeRange": {"start": "<ISO UTC>", "end": "<ISO UTC>"}, "confidence": <number between 0 and 1> }. Use ISO 8601 with a trailing Z. If the prompt is ambiguous, choose a reasonable recent default window and set confidence below 0.5.\n\nUser prompt: \n\n"""${promptText}"""`;
}

function normalizeDatasetEntry(item) {
  if (!item || item.type !== "history") {
    return null;
  }
  const lastVisit = typeof item.lastVisitTime === "number" ? item.lastVisitTime : Number(item.lastVisitTime) || 0;
  const visitIso = lastVisit ? new Date(lastVisit).toISOString() : null;
  let domain = "";
  if (item.url) {
    try {
      const parsed = new URL(item.url);
      domain = parsed.hostname || "";
    } catch (err) {
      domain = "";
    }
  }
  return {
    id: item.id,
    title: item.title || item.url || "",
    url: item.url || "",
    lastVisitTime: visitIso,
    visitCount: typeof item.visitCount === "number" ? item.visitCount : 0,
    domain,
  };
}

function buildStageTwoPrompt({ promptText, dataset, range, now = Date.now() }) {
  const rangeLines = range
    ? `Time window start (UTC): ${new Date(range.start).toISOString()}\nTime window end (UTC): ${new Date(range.end).toISOString()}\n`
    : "";
  const datasetJson = JSON.stringify(dataset, null, 2);
  return `You are the Smart History Search Assistant for a browser. Interpret the user's request, analyze the provided history entries, and respond with concise JSON.\n\nCurrent UTC date/time: ${new Date(now).toISOString()}\n${rangeLines}\nUser prompt:\n"""${promptText}"""\n\nHistory entries (chronological, most recent first). Each entry uses the id that must be echoed back exactly:\n${datasetJson}\n\nRules:\n- Only reference entries from the dataset.\n- Choose action from: "show" (default), "open" (open the matching sites), "delete" (remove them from history), "summarize" (summarize their content), or "none" when nothing applies.\n- When deleting or opening, return only the entries that should be affected.\n- Return at most ${MAX_RESULTS} entries in filteredResults, ordered from most relevant to least.\n- outputMessage must be a short (<= 140 characters) friendly sentence for the UI.\n- If nothing matches, use action "none" or "show" with an empty filteredResults array and explain why in outputMessage.\n- If the user asks for a summary, include a "summary" field with one or two sentences summarizing the relevant browsing activity.\n\nRespond with JSON only, no code fences.`;
}

async function ensurePromptAvailability() {
  if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
    throw new Error("Prompt API unavailable");
  }
  const availability = await globalThis.LanguageModel.availability();
  if (availability === "unavailable") {
    throw new Error("Prompt model unavailable");
  }
}

function createPromptSession(schema) {
  let sessionInstance = null;
  let sessionPromise = null;

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
    }
    if (sessionPromise) {
      return sessionPromise;
    }

    sessionPromise = (async () => {
      await ensurePromptAvailability();
      const session = await globalThis.LanguageModel.create({
        monitor(monitor) {
          if (!monitor || typeof monitor.addEventListener !== "function") {
            return;
          }
          monitor.addEventListener("downloadprogress", (event) => {
            if (typeof event?.loaded === "number") {
              const percent = Math.round(event.loaded * 100);
              console.info(`Spotlight history assistant model download ${percent}%`);
            }
          });
        },
      });
      return session;
    })()
      .then((instance) => {
        sessionInstance = instance;
        sessionPromise = null;
        return instance;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });

    return sessionPromise;
  }

  async function runPrompt(promptText) {
    const session = await ensureSession();
    try {
      const raw = await session.prompt(promptText, { responseConstraint: schema });
      return raw;
    } catch (error) {
      if (session && typeof session.destroy === "function") {
        try {
          session.destroy();
        } catch (destroyErr) {
          console.warn("Spotlight: failed to destroy history assistant session", destroyErr);
        }
      }
      sessionInstance = null;
      throw error;
    }
  }

  return { runPrompt };
}

function parseJson(raw, errorMessage) {
  if (raw === undefined || raw === null) {
    throw new Error(errorMessage || "Prompt returned empty response");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(errorMessage || "Prompt returned invalid JSON");
  }
}

function normalizeResultIds(results) {
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((entry) => {
      if (!entry) return null;
      const idValue = entry.id;
      const id = typeof idValue === "number" ? idValue : Number(idValue);
      if (!Number.isInteger(id) || id < 0) {
        return null;
      }
      return { id, url: typeof entry.url === "string" ? entry.url : null };
    })
    .filter(Boolean);
}

async function performOpenAction(items) {
  if (!Array.isArray(items) || !items.length) {
    return { type: "open", count: 0 };
  }
  const targets = clampActionTargets(items);
  let opened = 0;
  for (const item of targets) {
    const url = item?.url;
    if (!url) continue;
    try {
      await chrome.tabs.create({ url });
      opened += 1;
    } catch (error) {
      console.warn("Spotlight: failed to open history URL", url, error);
    }
  }
  return { type: "open", count: opened, limited: targets.length < items.length };
}

async function performDeleteAction(items, scheduleRebuild) {
  if (!Array.isArray(items) || !items.length) {
    return { type: "delete", count: 0 };
  }
  const targets = clampActionTargets(items);
  let deleted = 0;
  for (const item of targets) {
    const url = item?.url;
    if (!url) continue;
    try {
      await chrome.history.deleteUrl({ url });
      deleted += 1;
    } catch (error) {
      console.warn("Spotlight: failed to delete history URL", url, error);
    }
  }
  if (deleted > 0 && typeof scheduleRebuild === "function") {
    scheduleRebuild(400);
  }
  return { type: "delete", count: deleted, limited: targets.length < items.length };
}

export function createHistoryAssistantService({ scheduleRebuild } = {}) {
  const stageOneSession = createPromptSession(STAGE_ONE_SCHEMA);
  const stageTwoSession = createPromptSession(STAGE_TWO_SCHEMA);

  async function detectTimeRange(promptText, now) {
    const raw = await stageOneSession.runPrompt(buildStageOnePrompt(promptText, now));
    const parsed = parseJson(raw, "History assistant time-range parsing failed");
    return sanitizeTimeRange(parsed, now);
  }

  function buildDataset(items) {
    const normalized = [];
    for (const item of items) {
      const entry = normalizeDatasetEntry(item);
      if (!entry || !entry.url) {
        continue;
      }
      normalized.push(entry);
      if (normalized.length >= MAX_DATASET_ENTRIES) {
        break;
      }
    }
    return normalized;
  }

  async function interpretPrompt({ promptText, dataset, range, now }) {
    const raw = await stageTwoSession.runPrompt(
      buildStageTwoPrompt({ promptText, dataset, range, now })
    );
    const parsed = parseJson(raw, "History assistant interpretation returned invalid JSON");
    const action = typeof parsed.action === "string" && parsed.action ? parsed.action.toLowerCase() : "show";
    const normalizedAction = ["show", "open", "delete", "summarize", "none"].includes(action)
      ? action
      : "show";
    const filteredResults = normalizeResultIds(parsed.filteredResults).slice(0, MAX_RESULTS);
    const outputMessage = typeof parsed.outputMessage === "string" ? parsed.outputMessage.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    return { action: normalizedAction, filteredResults, outputMessage, summary };
  }

  function mapResultsToItems(filteredResults, allItems) {
    if (!Array.isArray(filteredResults) || !filteredResults.length) {
      return [];
    }
    const lookup = new Map();
    for (const item of allItems) {
      if (!item) continue;
      lookup.set(item.id, item);
    }
    const mapped = [];
    const seen = new Set();
    for (const entry of filteredResults) {
      if (!entry) continue;
      const { id } = entry;
      if (!Number.isInteger(id)) continue;
      if (seen.has(id)) continue;
      const item = lookup.get(id);
      if (!item || item.type !== "history") continue;
      mapped.push(item);
      seen.add(id);
    }
    return mapped;
  }

  async function runAssistant({ prompt: promptText, data, now = Date.now() }) {
    const prompt = typeof promptText === "string" ? promptText.trim() : "";
    if (!prompt) {
      throw new Error("Enter a prompt for the history assistant");
    }
    if (!data || !Array.isArray(data.items)) {
      throw new Error("History data unavailable");
    }

    const timeRange = await detectTimeRange(prompt, now);
    const historyItems = filterHistoryItems(data.items, timeRange);
    const dataset = buildDataset(historyItems);
    const interpretation = await interpretPrompt({ promptText: prompt, dataset, range: timeRange, now });
    const relevantItems = mapResultsToItems(interpretation.filteredResults, historyItems);
    const formattedResults = relevantItems
      .map((item, index) => buildResultFromItem(item, Number.MAX_SAFE_INTEGER - index))
      .filter(Boolean);

    let performedAction = null;
    if (interpretation.action === "open") {
      performedAction = await performOpenAction(relevantItems);
    } else if (interpretation.action === "delete") {
      performedAction = await performDeleteAction(relevantItems, scheduleRebuild);
    }

    const { usedFallback, ...timeRangeInfo } = timeRange || {};
    return {
      results: formattedResults,
      outputMessage: interpretation.outputMessage || "",
      summary: interpretation.summary || "",
      action: interpretation.action,
      performedAction,
      timeRange: timeRangeInfo,
      datasetSize: dataset.length,
      usedFallbackRange: Boolean(usedFallback),
    };
  }

  return { runAssistant };
}

