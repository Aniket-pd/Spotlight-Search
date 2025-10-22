(() => {
  const SYSTEM_PROMPT = `You are the Smart History Search interpreter for the Spotlight launcher.
- Input: a JSON object { "query": string, "now": ISO 8601 date-time, "historyFilterActive": boolean }.
- Only return a result when historyFilterActive is true; otherwise reply with { "confidence": 0 }.
- Extract:
  • action: "open" when the user wants tabs opened automatically, "show" when they just want suggestions.
  • topics: array of keywords or short phrases describing what to match in browsing history.
  • dateRange: { "start": ISO 8601 date, "end": ISO 8601 date } when the user specifies a time window (e.g., “last week”, “yesterday”, “September 2024”). Leave null when no constraint is present.
  • maxItems: integer (default 5) when the user specifies a quantity (e.g., “first three”, “all”, “the top result” → 1).
  • followUp: string question to disambiguate when intent is unclear; empty string when confident.
  • confidence: number from 0–1 summarizing how certain you are about the interpretation.

Guidelines:
- Map “open” / “launch” / “reopen” intents to action "open". Map “show”, “find”, “what were”, “list” to action "show".
- Interpret relative dates relative to `now`.
- When the request references parts of a browsing session (“the ones after Amazon”), include key terms in topics to help the search ranker.
- If you cannot determine any topics, set topics to an empty array and confidence to ≤0.25.
- Never fabricate URLs or tab IDs. Your job is only to translate the natural language into filters.
Return JSON only, matching this schema:
{
  "action": "open" | "show",
  "topics": string[],
  "dateRange": { "start": string | null, "end": string | null },
  "maxItems": number | null,
  "followUp": string,
  "confidence": number
}`;

  const RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["action", "topics", "dateRange", "maxItems", "followUp", "confidence"],
    properties: {
      action: { type: "string", enum: ["open", "show"] },
      topics: {
        type: "array",
        items: { type: "string" },
      },
      dateRange: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: {
              start: { type: ["string", "null"] },
              end: { type: ["string", "null"] },
            },
          },
          { type: "null" },
        ],
      },
      maxItems: { type: ["integer", "null"] },
      followUp: { type: "string" },
      confidence: { type: "number" },
    },
  };

  const state = {
    availabilityPromise: null,
    sessionPromise: null,
  };

  function resolveLanguageModel() {
    if (typeof self !== "undefined") {
      if (self.ai && self.ai.languageModel) {
        return self.ai.languageModel;
      }
      if (typeof self.LanguageModel !== "undefined") {
        return self.LanguageModel;
      }
    }
    if (typeof chrome !== "undefined" && chrome.ai && chrome.ai.languageModel) {
      return chrome.ai.languageModel;
    }
    return null;
  }

  async function ensureAvailability() {
    if (state.availabilityPromise) {
      return state.availabilityPromise;
    }
    const languageModel = resolveLanguageModel();
    if (!languageModel || typeof languageModel.availability !== "function") {
      state.availabilityPromise = Promise.resolve("unavailable");
      return state.availabilityPromise;
    }
    state.availabilityPromise = languageModel
      .availability()
      .then((result) => (typeof result === "string" ? result : "unknown"))
      .catch((err) => {
        console.warn("Spotlight: language model availability check failed", err);
        return "error";
      });
    return state.availabilityPromise;
  }

  async function ensureSession() {
    if (state.sessionPromise) {
      return state.sessionPromise;
    }
    const languageModel = resolveLanguageModel();
    if (!languageModel || typeof languageModel.create !== "function") {
      state.sessionPromise = Promise.resolve(null);
      return state.sessionPromise;
    }

    state.sessionPromise = (async () => {
      const availability = await ensureAvailability();
      if (availability === "unavailable" || availability === "no" || availability === "error") {
        return null;
      }
      try {
        return await languageModel.create({
          initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
        });
      } catch (err) {
        console.warn("Spotlight: failed to create language model session", err);
        return null;
      }
    })();

    return state.sessionPromise;
  }

  function normalizeDateRange(rawRange) {
    if (!rawRange || typeof rawRange !== "object") {
      return { start: null, end: null };
    }
    const start = typeof rawRange.start === "string" && rawRange.start ? rawRange.start : null;
    const end = typeof rawRange.end === "string" && rawRange.end ? rawRange.end : null;
    return { start, end };
  }

  function normalizeInterpretation(raw) {
    const normalized = raw && typeof raw === "object" ? raw : {};
    const action = normalized.action === "open" ? "open" : "show";
    const topics = Array.isArray(normalized.topics)
      ? normalized.topics
          .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
          .filter(Boolean)
      : [];
    const dateRange = normalizeDateRange(
      normalized.dateRange === null ? null : normalized.dateRange
    );
    const maxItems =
      typeof normalized.maxItems === "number" && Number.isFinite(normalized.maxItems)
        ? Math.max(1, Math.floor(normalized.maxItems))
        : null;
    const followUp = typeof normalized.followUp === "string" ? normalized.followUp.trim() : "";
    let confidence =
      typeof normalized.confidence === "number" && Number.isFinite(normalized.confidence)
        ? normalized.confidence
        : 0;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    return { action, topics, dateRange, maxItems, followUp, confidence };
  }

  async function interpret(payload = {}) {
    const historyFilterActive = Boolean(payload.historyFilterActive);
    if (!historyFilterActive) {
      return { action: "show", topics: [], dateRange: { start: null, end: null }, maxItems: null, followUp: "", confidence: 0 };
    }

    const session = await ensureSession();
    if (!session || typeof session.prompt !== "function") {
      return { action: "show", topics: [], dateRange: { start: null, end: null }, maxItems: null, followUp: "", confidence: 0 };
    }

    const query = typeof payload.query === "string" ? payload.query : "";
    const now = typeof payload.now === "string" && payload.now ? payload.now : new Date().toISOString();
    const input = { query, now, historyFilterActive: true };

    try {
      const response = await session.prompt(
        [{ role: "user", content: JSON.stringify(input) }],
        { responseConstraint: RESPONSE_SCHEMA }
      );
      if (!response || typeof response !== "string") {
        return { action: "show", topics: [], dateRange: { start: null, end: null }, maxItems: null, followUp: "", confidence: 0 };
      }
      const parsed = JSON.parse(response);
      return normalizeInterpretation(parsed);
    } catch (err) {
      console.warn("Spotlight: history intent parsing failed", err);
      if (session && typeof session.destroy === "function") {
        try {
          session.destroy();
        } catch (destroyError) {
          console.warn("Spotlight: failed to destroy history intent session", destroyError);
        }
      }
      state.sessionPromise = null;
      return { action: "show", topics: [], dateRange: { start: null, end: null }, maxItems: null, followUp: "", confidence: 0 };
    }
  }

  if (!globalThis.SpotlightHistoryIntent) {
    globalThis.SpotlightHistoryIntent = {
      interpret,
    };
  }
})();
