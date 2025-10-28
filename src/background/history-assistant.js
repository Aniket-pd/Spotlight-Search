const TIME_RANGE_SCHEMA = {
  type: "object",
  properties: {
    timeRange: {
      anyOf: [
        {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    confidence: { type: "number" },
  },
  required: ["timeRange"],
  additionalProperties: false,
};

const INTERPRET_SCHEMA = {
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
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          lastVisitTime: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    outputMessage: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["action", "filteredResults", "outputMessage"],
  additionalProperties: false,
};

const MAX_DATASET_ITEMS = 120;
const MIN_CONFIDENCE = 0.55;

function normalizeIso(date) {
  if (!date) {
    return null;
  }
  try {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  } catch (err) {
    return null;
  }
}

function createSessionFactory() {
  let sessionInstance = null;
  let sessionPromise = null;

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
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

  return { ensureSession };
}

async function promptJson(session, messages, schema) {
  const raw = await session.prompt(messages, { responseConstraint: schema });
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("History assistant returned invalid JSON");
  }
}

export function createHistoryAssistantService() {
  if (typeof globalThis === "undefined") {
    return {
      async runSmartHistorySearch() {
        return null;
      },
    };
  }

  const timeSessionFactory = createSessionFactory();
  const interpretSessionFactory = createSessionFactory();

  async function detectTimeRange(prompt, nowIso) {
    const session = await timeSessionFactory.ensureSession();
    const messages = [
      {
        role: "system",
        content:
          "Extract the exact time range requested for reviewing browser history. Respond with JSON following the provided schema.",
      },
      {
        role: "user",
        content: `Current time (UTC): ${nowIso}\nHistory request: ${prompt}\n\nReturn timeRange.start and timeRange.end as ISO-8601 timestamps in UTC when a range is implied. Use null if no range can be inferred. Include a confidence score between 0 and 1.`,
      },
    ];
    return promptJson(session, messages, TIME_RANGE_SCHEMA);
  }

  async function interpretRequest(prompt, dataset, nowIso) {
    const session = await interpretSessionFactory.ensureSession();
    const datasetJson = JSON.stringify(dataset, null, 2);
    const messages = [
      {
        role: "system",
        content:
          "You filter browser history records. Only reference entries from the supplied dataset. Classify the requested action and respond with concise, user-friendly messaging.",
      },
      {
        role: "user",
        content: `Current time (UTC): ${nowIso}\nUser request: ${prompt}\n\nDataset (each entry has a stable id):\n${datasetJson}\n\nReturn filteredResults referencing the ids of matching entries. Choose an action (show, open, delete, summarize, or unknown). Provide a short outputMessage (<=120 characters). Include confidence between 0 and 1.`,
      },
    ];
    return promptJson(session, messages, INTERPRET_SCHEMA);
  }

  function normalizeTimeRange(range) {
    if (!range || typeof range !== "object") {
      return null;
    }
    const startIso = normalizeIso(range.start);
    const endIso = normalizeIso(range.end);
    if (!startIso || !endIso) {
      return null;
    }
    if (new Date(startIso).getTime() > new Date(endIso).getTime()) {
      return null;
    }
    return { start: startIso, end: endIso };
  }

  function buildDataset(historyItems) {
    const sorted = historyItems
      .slice()
      .filter((item) => item && typeof item.id !== "undefined")
      .sort((a, b) => {
        const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
        const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
        return bTime - aTime;
      });
    const limited = sorted.slice(0, MAX_DATASET_ITEMS);
    return limited.map((item) => ({
      id: String(item.id),
      title: typeof item.title === "string" && item.title ? item.title : item.url || "Untitled",
      url: item.url || "",
      lastVisitTime:
        typeof item.lastVisitTime === "number" && Number.isFinite(item.lastVisitTime)
          ? new Date(item.lastVisitTime).toISOString()
          : null,
      visitCount: typeof item.visitCount === "number" ? item.visitCount : null,
    }));
  }

  return {
    async runSmartHistorySearch(query, options = {}) {
      const prompt = typeof query === "string" ? query.trim() : "";
      if (!prompt) {
        return null;
      }
      const historyItems = Array.isArray(options.historyItems) ? options.historyItems.slice() : [];
      if (!historyItems.length) {
        return null;
      }
      const now = typeof options.now === "number" ? options.now : Date.now();
      const nowIso = new Date(now).toISOString();

      let timeRangeResult = null;
      try {
        timeRangeResult = await detectTimeRange(prompt, nowIso);
      } catch (error) {
        console.warn("Spotlight: history assistant time range failed", error);
      }

      let activeItems = historyItems;
      let normalizedRange = null;
      if (timeRangeResult && timeRangeResult.timeRange) {
        const normalized = normalizeTimeRange(timeRangeResult.timeRange);
        if (normalized) {
          normalizedRange = normalized;
          const startMs = new Date(normalized.start).getTime();
          const endMs = new Date(normalized.end).getTime();
          activeItems = historyItems.filter((item) => {
            const ts = typeof item.lastVisitTime === "number" ? item.lastVisitTime : 0;
            return ts >= startMs && ts <= endMs;
          });
        }
      }

      if (!activeItems.length) {
        activeItems = historyItems;
      }

      const dataset = buildDataset(activeItems);
      if (!dataset.length) {
        return null;
      }

      let interpretResult;
      try {
        interpretResult = await interpretRequest(prompt, dataset, nowIso);
      } catch (error) {
        console.warn("Spotlight: history assistant interpret failed", error);
        return null;
      }

      if (!interpretResult || typeof interpretResult !== "object") {
        return null;
      }

      const confidence = typeof interpretResult.confidence === "number" ? interpretResult.confidence : null;
      if (confidence !== null && confidence < MIN_CONFIDENCE) {
        return null;
      }

      const message =
        typeof interpretResult.outputMessage === "string" && interpretResult.outputMessage.trim()
          ? interpretResult.outputMessage.trim()
          : "";
      if (!message) {
        return null;
      }

      const action =
        typeof interpretResult.action === "string" && interpretResult.action
          ? interpretResult.action
          : "show";
      const datasetMap = new Map(dataset.map((entry) => [entry.id, entry]));
      const itemIds = [];
      if (Array.isArray(interpretResult.filteredResults)) {
        for (const entry of interpretResult.filteredResults) {
          const id = entry && typeof entry.id === "string" ? entry.id : null;
          if (!id || !datasetMap.has(id)) {
            continue;
          }
          if (!itemIds.includes(id)) {
            itemIds.push(id);
          }
        }
      }

      return {
        message,
        action,
        itemIds,
        confidence,
        timeRange: normalizedRange,
        hasResults: itemIds.length > 0,
      };
    },
  };
}

