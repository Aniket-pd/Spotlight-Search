import { tokenize } from "../indexer.js";

const TIME_RANGES = [
  { id: "today", patterns: [/\b(?:today|this\s+day|tonight)\b/i], label: "Today" },
  {
    id: "yesterday",
    patterns: [/\b(?:yesterday|last\s+night)\b/i],
    label: "Yesterday",
  },
  {
    id: "last7",
    patterns: [
      /\b(?:last|past)\s+(?:7|seven)\s+days\b/i,
      /\b(?:last|this|past)\s+week\b/i,
    ],
    label: "Last 7 days",
  },
  {
    id: "last30",
    patterns: [
      /\b(?:last|past)\s+(?:30|thirty)\s+days\b/i,
      /\b(?:this|past)\s+month\b/i,
    ],
    label: "Last 30 days",
  },
  {
    id: "older",
    patterns: [/\b(?:older|long\s+ago|a\s+while\s+ago)\b/i],
    label: "Older history",
  },
];

const ACTION_KEYWORDS = [
  { id: "open", patterns: [/\bopen\b/i, /\bshow\b/i] },
  { id: "delete", patterns: [/\bdelete\b/i, /\bremove\b/i, /\bclear\b/i] },
  { id: "summarize", patterns: [/\bsummarize\b/i, /\boverview\b/i, /\brecap\b/i] },
];

const DOMAIN_HINT_PATTERN = /\b(?:from|on|at|visit(?:ed)?\s+)?([a-z0-9.-]+\.[a-z]{2,})(?:\b|\/)/i;
const DOMAIN_TOKEN_PATTERN = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})$/i;
const SITE_PREFIX_PATTERN = /site:([a-z0-9.-]+\.[a-z]{2,})/i;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripPhrases(input, phrases) {
  if (!input) {
    return "";
  }
  let output = input;
  for (const phrase of phrases) {
    if (!phrase) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
    output = output.replace(pattern, " ");
  }
  return output.replace(/\s+/g, " ").trim();
}

function detectTimeRange(query) {
  if (!query) {
    return null;
  }
  for (const range of TIME_RANGES) {
    if (!Array.isArray(range.patterns)) {
      continue;
    }
    for (const pattern of range.patterns) {
      if (pattern.test(query)) {
        return { id: range.id, label: range.label, phrase: query.match(pattern)?.[0] || "" };
      }
    }
  }
  return null;
}

function detectDomain(query, tokens) {
  if (!query) {
    return null;
  }
  const siteMatch = query.match(SITE_PREFIX_PATTERN);
  if (siteMatch && siteMatch[1]) {
    return { domain: siteMatch[1].toLowerCase(), phrase: siteMatch[0] };
  }
  const hint = query.match(DOMAIN_HINT_PATTERN);
  if (hint && hint[1]) {
    return { domain: hint[1].toLowerCase(), phrase: hint[0] };
  }
  for (const token of tokens || []) {
    if (!token) {
      continue;
    }
    const match = token.match(DOMAIN_TOKEN_PATTERN);
    if (match && match[1]) {
      return { domain: match[1].toLowerCase(), phrase: token };
    }
  }
  return null;
}

function detectActions(query) {
  if (!query) {
    return [];
  }
  const actions = [];
  for (const action of ACTION_KEYWORDS) {
    if (!Array.isArray(action.patterns)) {
      continue;
    }
    for (const pattern of action.patterns) {
      if (pattern.test(query)) {
        actions.push(action.id);
        break;
      }
    }
  }
  return Array.from(new Set(actions));
}

function buildAnswer({ timeRange, domain, actions, keywords, confidence }) {
  const parts = [];
  if (timeRange?.label) {
    parts.push(timeRange.label);
  }
  if (domain?.domain) {
    const label = domain.domain.replace(/^www\./, "");
    parts.push(`visits on ${label}`);
  }
  if (Array.isArray(keywords) && keywords.length) {
    parts.push(`matching “${keywords.join(" ")}"`);
  }
  if (!parts.length) {
    return confidence > 0.4 ? "Looking through recent history" : "";
  }
  if (actions?.includes("delete")) {
    parts.push("ready to remove");
  } else if (actions?.includes("open")) {
    parts.push("ready to open");
  }
  return parts.join(" · ");
}

function computeConfidence({ timeRange, domain, actions, keywords }) {
  let confidence = 0;
  if (timeRange) {
    confidence += 0.35;
  }
  if (domain) {
    confidence += 0.25;
  }
  if (Array.isArray(actions) && actions.length) {
    confidence += 0.25;
  }
  if (Array.isArray(keywords) && keywords.length >= 2) {
    confidence += 0.15;
  }
  return Math.min(0.95, confidence);
}

function normalizeKeywords(tokens, removals) {
  return tokens
    .filter((token) => token && !removals.has(token.toLowerCase()))
    .map((token) => token.toLowerCase());
}

export function interpretHistoryQuery(rawQuery, options = {}) {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const tokens = tokenize(query);
  if (!query) {
    return {
      searchQuery: "",
      originalQuery: "",
      keywords: [],
      actions: [],
      confidence: 0,
      explanation: "",
      now,
    };
  }

  const timeRange = detectTimeRange(query);
  const domain = detectDomain(query, tokens);
  const actions = detectActions(query);
  const removals = new Set();
  if (timeRange?.phrase) {
    removals.add(timeRange.phrase.toLowerCase());
  }
  if (domain?.phrase) {
    removals.add(domain.phrase.toLowerCase());
  }
  for (const action of ACTION_KEYWORDS) {
    for (const pattern of action.patterns || []) {
      const match = query.match(pattern);
      if (match && match[0]) {
        removals.add(match[0].toLowerCase());
      }
    }
  }

  const keywordTokens = normalizeKeywords(tokens, removals);
  const stripped = stripPhrases(query, Array.from(removals));
  const searchQuery = stripped || keywordTokens.join(" ");
  const confidence = computeConfidence({ timeRange, domain, actions, keywords: keywordTokens });
  const answer = buildAnswer({ timeRange, domain, actions, keywords: keywordTokens, confidence });
  const fallback = !confidence || confidence < 0.25;
  const explanation = fallback && !answer ? "Using plain keyword history search" : answer;

  return {
    searchQuery,
    originalQuery: query,
    keywords: keywordTokens,
    actions,
    timeRange: timeRange ? { id: timeRange.id, label: timeRange.label } : null,
    domain: domain ? domain.domain : null,
    confidence,
    explanation,
    answer,
    fallback,
    now,
  };
}

export function buildHistoryFiltersFromIntent(intent) {
  if (!intent) {
    return null;
  }
  const filters = {};
  if (intent.timeRange && intent.timeRange.id) {
    filters.subfilter = { type: "history", id: intent.timeRange.id };
  }
  if (intent.domain) {
    filters.domain = intent.domain;
  }
  return filters;
}

