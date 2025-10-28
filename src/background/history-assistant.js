const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 7 * DAY_MS;
const MAX_DATASET_ENTRIES = 240;
const MAX_RESULT_IDS = 48;
const MAX_ACTION_TABS = 8;
const LOCAL_RESULT_LIMIT = 60;

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

const HISTORY_ACTION_HINTS = [
  "list",
  "show",
  "find",
  "search",
  "open",
  "delete",
  "remove",
  "clear",
  "erase",
  "locate",
  "look",
  "summarize",
  "summarise",
  "recap",
];

const HISTORY_OBJECT_HINTS = [
  "tab",
  "tabs",
  "history",
  "site",
  "sites",
  "page",
  "pages",
  "visit",
  "visits",
  "activity",
  "records",
  "entries",
  "browsing",
];

const GENERAL_INQUIRY_REGEX = [
  /\bwho\s+are\s+(you|u)\b/,
  /\bwhat\s+(are|is)\s+(you|this|spotlight)\b/,
  /\bwhat\s+can\s+(you|this)\s+do\b/,
  /\bwhat\s+do\s+(you|this)\s+do\b/,
  /\bhow\s+(can|do|are)\s+(you|this)\s+(help|assist|support)\b/,
  /\bhow\s+(can|do|are)\s+(you|this)\s+usef(?:ul|ull)\b/,
  /\bwhat\s+can\s+you\s+help\s+with\b/,
  /\bwhat\s+are\s+your\s+capabilities\b/,
  /\bwhat\s+can\s+i\s+ask\b/,
  /\btell\s+me\s+about\s+(yourself|you)\b/,
  /\bintroduce\s+yourself\b/,
  /\bhow\s+do\s+i\s+use\s+(you|this|spotlight)\b/,
];

const GENERAL_RESPONSE_SUGGESTIONS = [
  "List all YouTube tabs from yesterday.",
  "Summarize what I did this morning.",
  "Delete Google results from the last hour.",
  "Open the sites I visited 20 minutes ago.",
];

const GENERAL_GREETING_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    suggestions: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
  required: ["message"],
  additionalProperties: false,
};

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

const SEARCH_PLAN_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "unknown"],
    },
    mustInclude: {
      type: "array",
      items: { type: "string" },
    },
    shouldInclude: {
      type: "array",
      items: { type: "string" },
    },
    exclude: {
      type: "array",
      items: { type: "string" },
    },
    domainHints: {
      type: "array",
      items: { type: "string" },
    },
    searchPhrases: {
      type: "array",
      items: { type: "string" },
    },
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
    maxResults: { type: "number" },
    requireModel: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["intent"],
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

function isGeneralInquiryPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return false;
  }
  const collapsed = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return false;
  }
  const cleaned = collapsed.replace(/[^a-z0-9\s?]/g, " ");
  const padded = ` ${cleaned} `;

  const actionHint = HISTORY_ACTION_HINTS.some((keyword) => padded.includes(` ${keyword} `));
  const objectHint = HISTORY_OBJECT_HINTS.some((keyword) => padded.includes(` ${keyword} `));
  const hasHistoryIntent = actionHint && objectHint;

  if (hasHistoryIntent) {
    return false;
  }

  const matchesGeneralRegex = GENERAL_INQUIRY_REGEX.some((regex) => regex.test(padded));
  const containsGeneralKeyword = /\b(usef(?:ul|ull)|capab(?:le|ilities?|ility)|capabilities|abilities)\b/.test(
    padded
  );
  const helpOnly =
    /\bhelp\b/.test(padded) &&
    !/\bhelp\s+me\s+(find|show|locate|search|open|delete|clear|remove|summarize|summarise|list|look)\b/.test(
      padded
    );

  return matchesGeneralRegex || containsGeneralKeyword || helpOnly;
}

function buildGeneralInquiryPrompt(prompt) {
  return `You are the Smart History Search Assistant living inside the Spotlight interface of a web browser. A user who has the history filter enabled asked: """${prompt}""".\n\nRespond with JSON that matches this schema exactly:\n{\n  "message": string (a single friendly sentence that explains how you can help with browsing history),\n  "suggestions": string[] (up to four short example requests they can try next, each under 80 characters)\n}\n\nGuidelines:\n- Keep the message in the second person (e.g., "I can help you...").\n- Highlight that you understand natural language history questions and can search, open, delete, or summarize entries.\n- Tailor the wording so it feels responsive to the user's question.\n- Provide diverse suggestions that demonstrate useful history-related prompts.`;
}

async function buildGeneralInquiryResponse(state, prompt) {
  const defaultMessage =
    "I'm the Spotlight history assistant. I can search, open, delete, and summarize your browsing history with natural language.";
  let message = defaultMessage;
  let suggestionList = [...GENERAL_RESPONSE_SUGGESTIONS];
  let usedModel = false;

  try {
    const session = await ensureSessionInstance(state);
    const result = await runPrompt(session, buildGeneralInquiryPrompt(prompt), GENERAL_GREETING_SCHEMA);
    const parsedMessage = typeof result?.message === "string" ? result.message.trim() : "";
    if (parsedMessage) {
      message = parsedMessage;
      usedModel = true;
    }
    if (Array.isArray(result?.suggestions)) {
      const filtered = result.suggestions
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .slice(0, 4);
      if (filtered.length) {
        suggestionList = filtered;
      }
    }
  } catch (error) {
    console.warn("Spotlight: general inquiry prompt failed", error);
  }

  const suggestionText = suggestionList.length
    ? `Try prompts like ${suggestionList.map((example) => `"${example}"`).join(" ")}`
    : "";

  return {
    response: {
      action: "show",
      message,
      notes: suggestionText,
      results: [],
      timeRange: null,
      datasetSize: 0,
      confidence: 1,
    },
    usedModel,
    suggestions: suggestionList,
  };
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

function normalizePlanArray(value) {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push({ value: trimmed, normalized });
  }
  return result;
}

function normalizeDomainHint(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.hostname) {
      return url.hostname.toLowerCase();
    }
  } catch (err) {
    // fall through to fallback parsing
  }
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function normalizePromptKeywords(keywords) {
  if (!Array.isArray(keywords) || !keywords.length) {
    return [];
  }
  return normalizePlanArray(
    keywords
      .map((keyword) => (typeof keyword === "string" ? keyword : ""))
      .filter(Boolean)
  );
}

function mergeEntrySets(primary, fallback) {
  const result = [];
  const seen = new Set();
  for (const entry of [].concat(primary || [], fallback || [])) {
    if (!entry || !entry.normalized) {
      continue;
    }
    if (seen.has(entry.normalized)) {
      continue;
    }
    seen.add(entry.normalized);
    result.push(entry);
  }
  return result;
}

function parseSearchPlan(rawPlan, fallbackIntent = "show") {
  const planObject = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const intent = normalizeAction(planObject.intent || fallbackIntent);
  const must = normalizePlanArray(planObject.mustInclude);
  const should = normalizePlanArray(planObject.shouldInclude);
  const exclude = normalizePlanArray(planObject.exclude);
  const domainValues = Array.isArray(planObject.domainHints)
    ? planObject.domainHints.map((value) => normalizeDomainHint(value)).filter(Boolean)
    : [];
  const domainHints = normalizePlanArray(domainValues);
  const phrases = normalizePlanArray(planObject.searchPhrases);
  const maxResults = Number.isFinite(planObject.maxResults) ? Math.max(1, Math.floor(planObject.maxResults)) : null;
  const requireModel = Boolean(planObject.requireModel);
  const reasoning = typeof planObject.reasoning === "string" ? planObject.reasoning.trim() : "";
  const rawTimeRange = planObject.timeRange && typeof planObject.timeRange === "object" ? planObject.timeRange : null;
  return {
    intent,
    must,
    should,
    exclude,
    domainHints,
    phrases,
    maxResults,
    requireModel,
    reasoning,
    rawTimeRange,
  };
}

function applySearchPlanToItems(items, plan, promptKeywords = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const fallbackOptional = normalizePromptKeywords(promptKeywords);
  const optionalEntries = plan && plan.should && plan.should.length
    ? mergeEntrySets(plan.should, fallbackOptional)
    : fallbackOptional;
  const mustEntries = Array.isArray(plan?.must) ? plan.must : [];
  const excludeEntries = Array.isArray(plan?.exclude) ? plan.exclude : [];
  const domainEntries = Array.isArray(plan?.domainHints) ? plan.domainHints : [];
  const phraseEntries = Array.isArray(plan?.phrases) ? plan.phrases : [];

  const annotated = [];

  for (const item of items) {
    if (!item) {
      continue;
    }

    if (excludeEntries.length && excludeEntries.some((entry) => itemMatchesKeyword(item, entry.normalized))) {
      continue;
    }

    const host = typeof item.host === "string" ? item.host.toLowerCase() : "";
    const origin = typeof item.origin === "string" ? item.origin.toLowerCase() : "";
    const url = typeof item.url === "string" ? item.url.toLowerCase() : "";

    const domainMatches = domainEntries.filter(
      (entry) => host.includes(entry.normalized) || origin.includes(entry.normalized) || url.includes(entry.normalized)
    );
    if (domainEntries.length && !domainMatches.length) {
      continue;
    }

    const mustMatches = mustEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));
    if (mustEntries.length && mustMatches.length !== mustEntries.length) {
      continue;
    }

    const optionalMatches = optionalEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));
    const phraseMatches = phraseEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));

    let score = Number(item.lastVisitTime) || 0;
    if (!Number.isFinite(score)) {
      score = 0;
    }

    score += mustMatches.length * 6 * 60 * 60 * 1000;
    score += optionalMatches.length * 4 * 60 * 60 * 1000;
    score += phraseMatches.length * 3 * 60 * 60 * 1000;
    score += domainMatches.length * 5 * 60 * 60 * 1000;

    if (plan?.intent === "summarize" && typeof item.visitCount === "number") {
      score += Math.min(48, item.visitCount) * 30 * 60 * 1000;
    }

    annotated.push({
      item,
      score,
      matches: {
        required: mustMatches.map((entry) => entry.value),
        optional: optionalMatches.map((entry) => entry.value),
        phrases: phraseMatches.map((entry) => entry.value),
        domains: domainMatches.map((entry) => entry.value),
      },
    });
  }

  annotated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aVisits = typeof a.item.visitCount === "number" ? a.item.visitCount : 0;
    const bVisits = typeof b.item.visitCount === "number" ? b.item.visitCount : 0;
    if (bVisits !== aVisits) {
      return bVisits - aVisits;
    }
    const aTime = Number(a.item.lastVisitTime) || 0;
    const bTime = Number(b.item.lastVisitTime) || 0;
    return bTime - aTime;
  });

  if (plan?.maxResults && Number.isFinite(plan.maxResults)) {
    const limit = Math.max(1, Math.min(MAX_DATASET_ENTRIES, Math.floor(plan.maxResults)));
    return annotated.slice(0, limit);
  }

  return annotated;
}

function summarizePlan(plan) {
  if (!plan) {
    return "Intent: show\nNo additional filters were derived.";
  }
  const parts = [`Intent: ${plan.intent}`];
  if (plan.must && plan.must.length) {
    parts.push(`Must include: ${plan.must.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.should && plan.should.length) {
    parts.push(`Should include: ${plan.should.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.domainHints && plan.domainHints.length) {
    parts.push(`Domain hints: ${plan.domainHints.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.exclude && plan.exclude.length) {
    parts.push(`Exclude: ${plan.exclude.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.phrases && plan.phrases.length) {
    parts.push(`Search phrases: ${plan.phrases.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.maxResults) {
    parts.push(`Max results requested: ${plan.maxResults}`);
  }
  if (plan.requireModel) {
    parts.push("Model reasoning required: true");
  }
  if (plan.reasoning) {
    parts.push(`Reasoning: ${plan.reasoning}`);
  }
  return parts.join("\n");
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

function toDatasetEntry(item, annotations = {}) {
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
  const entry = {
    id: item.id,
    title: item.title || item.url || "Untitled",
    url: item.url,
    host: hostname,
    lastVisitTime: lastVisitIso,
    visitCount: typeof item.visitCount === "number" ? item.visitCount : 0,
  };
  if (annotations && typeof annotations === "object") {
    for (const [key, value] of Object.entries(annotations)) {
      if (value === undefined) {
        continue;
      }
      entry[key] = value;
    }
  }
  return entry;
}

function buildInterpretationPrompt({
  prompt,
  dataset,
  nowIso,
  range,
  confidence,
  planSummary,
  datasetSize,
  totalAvailable,
  maxReturn,
}) {
  const datasetJson = JSON.stringify(dataset, null, 2);
  const rangeText = range ? `\nDetected range: ${range.start} to ${range.end}` : "";
  const confidenceText = Number.isFinite(confidence) ? `\nTime range confidence: ${confidence.toFixed(2)}` : "";
  const summaryText = planSummary ? `\nSearch plan:\n${planSummary}` : "";
  const datasetInfo = `\nProvided dataset entries: ${dataset.length} (focused from ${datasetSize} plan matches, ${totalAvailable} total in range)`;
  const returnLimit = Math.max(1, Math.min(MAX_RESULT_IDS, maxReturn || MAX_RESULT_IDS));
  return `You are the Smart History Search Assistant. Interpret the user's request using the provided browser history entries.\n\nCurrent UTC time: ${nowIso}${rangeText}${confidenceText}${summaryText}${datasetInfo}\nUser request: """${prompt}"""\n\nThe dataset below contains browser history entries in reverse chronological order. Only use these entries when selecting results. Return JSON that matches this schema exactly:\n{\n  "action": "show" | "open" | "delete" | "summarize" | "unknown",\n  "outputMessage": string,\n  "filteredResultIds": number[],\n  "notes": string (optional explanatory text)\n}\n\nRules:\n- Choose result ids only from the dataset.\n- Limit filteredResultIds to at most ${returnLimit} entries, ordered by relevance.\n- Prefer entries that match the user's intent, domains, or topics.\n- When the user asks for "all" or a broad result, include as many entries as allowed by the limit.\n- If nothing matches, return an empty filteredResultIds array and craft a helpful outputMessage explaining that no history was found.\n- Use the "delete" action only if the user clearly wants to remove history entries.\n- Use the "open" action only if the user wants tabs reopened. Otherwise default to "show".\n- Summaries should still list relevant result ids.\n- Respond with JSON only.\n\nHistory dataset:\n${datasetJson}`;
}

function buildTimeRangePrompt(prompt, nowIso) {
  return `You analyze natural language history queries and extract an explicit UTC time range.\nCurrent UTC time: ${nowIso}\nUser request: """${prompt}"""\n\nRespond with JSON only:\n{\n  "timeRange": { "start": "<ISO8601 UTC>", "end": "<ISO8601 UTC>" } | null,\n  "confidence": number between 0 and 1 (optional)\n}\n\nGuidance:\n- Interpret relative phrases like "past 3 hours" or "23 minutes ago".\n- When the request mentions a single instant (for example "around 9 PM"), create a narrow window that includes that instant.\n- Clamp the end time so it is not in the future.\n- If you cannot determine a range, return null.`;
}

function buildSearchPlanPrompt({ prompt, nowIso, range, confidence, keywords }) {
  const keywordText = keywords?.length ? keywords.join(", ") : "(none)";
  const rangeText = range ? `start=${range.start}, end=${range.end}` : "(none)";
  const confidenceText = Number.isFinite(confidence) ? confidence.toFixed(2) : "unknown";
  return `You are a planning agent that translates natural language history questions into structured search filters.\nCurrent UTC time: ${nowIso}\nUser request: """${prompt}"""\nHeuristic time range: ${rangeText}\nHeuristic confidence: ${confidenceText}\nCandidate keywords from prompt: ${keywordText}\n\nRespond with JSON only:\n{\n  "intent": "show" | "open" | "delete" | "summarize" | "unknown",\n  "mustInclude": string[] (terms that must appear),\n  "shouldInclude": string[] (terms to boost),\n  "exclude": string[] (terms to remove),\n  "domainHints": string[] (hostnames or domains),\n  "searchPhrases": string[] (longer phrases to match),\n  "timeRange": { "start": "<ISO8601 UTC>", "end": "<ISO8601 UTC>" } | null,\n  "maxResults": number (desired result cap),\n  "requireModel": boolean (true if model reasoning is essential),\n  "reasoning": string (brief explanation)\n}\n\nGuidance:\n- Reuse the heuristic range if it fits the request; otherwise tighten or broaden it as needed.\n- Include hostnames (like "youtube.com") in domainHints when the request targets a site.\n- Increase maxResults when the user asks for "all" or a broad list, up to ${MAX_RESULT_IDS}.\n- Set requireModel to true when semantic understanding beyond keyword filtering is necessary.\n- Leave arrays empty when they are not needed.`;
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

function maybeHandleLocally({
  prompt,
  annotatedItems,
  limit = LOCAL_RESULT_LIMIT,
  range,
  confidence,
  plan,
}) {
  const intent = plan?.intent || detectPromptAction(prompt);
  if (intent !== "show") {
    return null;
  }
  if (plan?.requireModel) {
    return null;
  }
  if (!Array.isArray(annotatedItems) || !annotatedItems.length) {
    return null;
  }

  const maxPlanLimit = plan?.maxResults && Number.isFinite(plan.maxResults) ? plan.maxResults : null;
  const limitCandidates = [Math.max(1, limit), LOCAL_RESULT_LIMIT, MAX_RESULT_IDS];
  if (maxPlanLimit) {
    limitCandidates.push(Math.max(1, Math.floor(maxPlanLimit)));
  }
  const effectiveLimit = Math.max(1, Math.min(...limitCandidates));
  const limitedItems = annotatedItems.slice(0, effectiveLimit);
  const results = limitedItems.map((entry) => createResultPayload(entry.item)).filter(Boolean);
  if (!results.length) {
    return null;
  }

  const planKeywords = [];
  if (Array.isArray(plan?.must) && plan.must.length) {
    planKeywords.push(...plan.must.map((entry) => entry.value));
  }
  if (Array.isArray(plan?.should) && plan.should.length) {
    planKeywords.push(...plan.should.map((entry) => entry.value));
  }
  if (!planKeywords.length) {
    planKeywords.push(...extractMeaningfulKeywords(prompt));
  }
  const uniqueKeywords = Array.from(new Set(planKeywords.filter(Boolean)));

  let message;
  if (uniqueKeywords.length) {
    const keywordText = uniqueKeywords.map((keyword) => `"${keyword}"`).join(", ");
    message = `Here are the history entries matching ${keywordText}.`;
  } else {
    message = "Here are the history entries from your selected time range.";
  }

  const totalCount = annotatedItems.length;
  const notesParts = [];
  notesParts.push(totalCount === 1 ? "Found 1 entry." : `Found ${totalCount} entries.`);
  if (results.length < totalCount) {
    notesParts.push(`Showing the first ${results.length}. Refine your request to narrow the results.`);
  }
  if (plan?.reasoning) {
    notesParts.push(plan.reasoning);
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
    if (isGeneralInquiryPrompt(trimmed)) {
      const generalInquiry = await buildGeneralInquiryResponse(state, trimmed);
      console.info("Spotlight history assistant general inquiry", {
        prompt: trimmed,
        handled: "general",
        responseSource: generalInquiry.usedModel ? "promptApi" : "fallback",
        suggestionCount: Array.isArray(generalInquiry.suggestions)
          ? generalInquiry.suggestions.length
          : 0,
      });
      return generalInquiry.response;
    }
    const nowIso = new Date(now).toISOString();
    const promptKeywords = extractMeaningfulKeywords(trimmed);
    const heuristicIntent = detectPromptAction(trimmed);
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

    const heuristicRangeIso = {
      start: formatIso(detectedRange.start),
      end: formatIso(detectedRange.end),
    };

    let planResponse = null;
    let plan = null;
    try {
      if (!session) {
        session = await ensureSessionInstance(state);
      }
      let plannerSession = session;
      if (plannerSession && typeof plannerSession.clone === "function") {
        try {
          plannerSession = await plannerSession.clone();
        } catch (err) {
          plannerSession = session;
        }
      }
      planResponse = await runPrompt(
        plannerSession,
        buildSearchPlanPrompt({
          prompt: trimmed,
          nowIso,
          range: heuristicRangeIso,
          confidence,
          keywords: promptKeywords,
        }),
        SEARCH_PLAN_SCHEMA
      );
    } catch (err) {
      console.warn("Spotlight: search plan generation failed", err);
    }

    plan = parseSearchPlan(planResponse, heuristicIntent);

    if (plan?.rawTimeRange) {
      const planRange = clampTimeRange(plan.rawTimeRange, now);
      if (planRange) {
        if (detectedRange) {
          const intersectStart = Math.max(detectedRange.start, planRange.start);
          const intersectEnd = Math.min(detectedRange.end, planRange.end);
          if (intersectEnd > intersectStart) {
            detectedRange = { start: intersectStart, end: intersectEnd };
          } else {
            detectedRange = planRange;
          }
        } else {
          detectedRange = planRange;
        }
        confidence = typeof confidence === "number" ? Math.max(confidence, 0.75) : 0.75;
      }
    }

    const timeRangeIso = {
      start: formatIso(detectedRange.start),
      end: formatIso(detectedRange.end),
    };

    const rangeItems = dedupeByUrl(selectHistoryItems(items, detectedRange));
    const totalRangeCount = rangeItems.length;
    if (!totalRangeCount) {
      return {
        action: "show",
        message: "No history entries were found in that time range.",
        results: [],
        timeRange: timeRangeIso,
        datasetSize: 0,
        confidence,
      };
    }

    let annotatedItems = applySearchPlanToItems(rangeItems, plan, promptKeywords);
    if (!annotatedItems.length) {
      annotatedItems = rangeItems.map((item) => ({
        item,
        score: Number(item.lastVisitTime) || 0,
        matches: { required: [], optional: [], phrases: [], domains: [] },
      }));
    }
    const planMatchCount = annotatedItems.length;

    const datasetAnnotated = annotatedItems.slice(0, MAX_DATASET_ENTRIES);
    const dataset = datasetAnnotated
      .map(({ item, score, matches }) => {
        const sanitizedMatches = {};
        if (Array.isArray(matches?.required) && matches.required.length) {
          sanitizedMatches.required = matches.required;
        }
        if (Array.isArray(matches?.optional) && matches.optional.length) {
          sanitizedMatches.optional = matches.optional;
        }
        if (Array.isArray(matches?.phrases) && matches.phrases.length) {
          sanitizedMatches.phrases = matches.phrases;
        }
        if (Array.isArray(matches?.domains) && matches.domains.length) {
          sanitizedMatches.domains = matches.domains;
        }
        const annotations = { score: Math.round(score) };
        if (Object.keys(sanitizedMatches).length) {
          annotations.matches = sanitizedMatches;
        }
        return toDatasetEntry(item, annotations);
      })
      .filter(Boolean);

    if (!dataset.length) {
      return {
        action: "show",
        message: "No matching history entries were found for that request.",
        results: [],
        timeRange: timeRangeIso,
        datasetSize: 0,
        confidence,
      };
    }

    const planSummary = summarizePlan(plan);
    const maxReturn = plan?.maxResults ? Math.min(MAX_RESULT_IDS, Math.max(1, plan.maxResults)) : MAX_RESULT_IDS;

    const localResponse = maybeHandleLocally({
      prompt: trimmed,
      annotatedItems,
      limit: LOCAL_RESULT_LIMIT,
      range: timeRangeIso,
      confidence,
      plan,
    });

    console.info("Spotlight history assistant dataset", {
      prompt: trimmed,
      timeRange: timeRangeIso,
      count: dataset.length,
      planMatches: planMatchCount,
      total: totalRangeCount,
      truncated: planMatchCount > dataset.length,
      handledLocally: Boolean(localResponse),
      plan: {
        intent: plan?.intent || null,
        must: Array.isArray(plan?.must) ? plan.must.map((entry) => entry.value) : [],
        should: Array.isArray(plan?.should) ? plan.should.map((entry) => entry.value) : [],
        exclude: Array.isArray(plan?.exclude) ? plan.exclude.map((entry) => entry.value) : [],
        domainHints: Array.isArray(plan?.domainHints) ? plan.domainHints.map((entry) => entry.value) : [],
        phrases: Array.isArray(plan?.phrases) ? plan.phrases.map((entry) => entry.value) : [],
        maxResults: plan?.maxResults || null,
        requireModel: Boolean(plan?.requireModel),
      },
      tabs: dataset,
    });

    if (localResponse) {
      return {
        ...localResponse,
        timeRange: timeRangeIso,
        datasetSize: planMatchCount,
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
        planSummary,
        datasetSize: planMatchCount,
        totalAvailable: totalRangeCount,
        maxReturn,
      }),
      INTERPRETATION_SCHEMA
    );

    const normalizedAction = normalizeAction(interpretation?.action);
    const requestedIds = Array.isArray(interpretation?.filteredResultIds)
      ? interpretation.filteredResultIds
      : [];
    const idToAnnotated = new Map(datasetAnnotated.map((entry) => [entry.item.id, entry]));
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
      const annotated = idToAnnotated.get(numericId);
      if (!annotated) {
        continue;
      }
      const payload = createResultPayload(annotated.item);
      if (payload) {
        results.push(payload);
      }
      if (results.length >= maxReturn) {
        break;
      }
    }

    const message = typeof interpretation?.outputMessage === "string" && interpretation.outputMessage
      ? interpretation.outputMessage.trim()
      : buildFallbackMessage(detectedRange);

    const interpretationNotes = typeof interpretation?.notes === "string" ? interpretation.notes.trim() : "";
    const notesParts = [];
    if (interpretationNotes) {
      notesParts.push(interpretationNotes);
    }
    if (plan?.reasoning && (!interpretationNotes || !interpretationNotes.includes(plan.reasoning))) {
      notesParts.push(plan.reasoning);
    }

    return {
      action: normalizedAction === "unknown" ? plan.intent : normalizedAction,
      message,
      notes: notesParts.join(" ").trim(),
      results,
      timeRange: timeRangeIso,
      datasetSize: planMatchCount,
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

