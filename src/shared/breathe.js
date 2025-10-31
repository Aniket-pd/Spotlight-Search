const MODE_REGEX = /\b(calm|focus|energy)\b/i;
const DURATION_REGEX = /\b(30s|1m|2m)\b/i;
const KEYWORD_REGEX = /\bbreath(?:e)?\b/i;

export const BREATHE_DEFAULT_MODE = "calm";
export const BREATHE_DEFAULT_DURATION = "1m";

export const BREATHE_DURATIONS_MS = {
  "30s": 30_000,
  "1m": 60_000,
  "2m": 120_000,
};

export const BREATHE_MODES = {
  calm: { id: "calm", label: "Calm" },
  focus: { id: "focus", label: "Focus" },
  energy: { id: "energy", label: "Energy" },
};

export function normalizeBreatheMode(value) {
  if (typeof value !== "string") {
    return BREATHE_DEFAULT_MODE;
  }
  const match = value.toLowerCase();
  return BREATHE_MODES[match] ? match : BREATHE_DEFAULT_MODE;
}

export function normalizeBreatheDuration(value) {
  if (typeof value !== "string") {
    return BREATHE_DEFAULT_DURATION;
  }
  const match = value.toLowerCase();
  return BREATHE_DURATIONS_MS[match] ? match : BREATHE_DEFAULT_DURATION;
}

export function parseBreatheArgs(argsString = "") {
  const text = typeof argsString === "string" ? argsString : "";
  const modeMatch = text.match(MODE_REGEX);
  const durationMatch = text.match(DURATION_REGEX);
  const mode = modeMatch ? normalizeBreatheMode(modeMatch[1]) : BREATHE_DEFAULT_MODE;
  const duration = durationMatch
    ? normalizeBreatheDuration(durationMatch[1])
    : BREATHE_DEFAULT_DURATION;
  return {
    action: "breathe",
    mode,
    duration,
  };
}

export function extractBreatheMatchPhrase(query = "") {
  if (typeof query !== "string") {
    return "";
  }
  const match = query.match(KEYWORD_REGEX);
  if (!match) {
    return "";
  }
  return query.slice(0, match.index + match[0].length).trim();
}

export function extractBreatheArgsString(query = "") {
  if (typeof query !== "string") {
    return "";
  }
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  const breatheIndex = tokens.findIndex((token) => /^(?:breathe|breath)$/i.test(token));
  if (breatheIndex === -1) {
    return "";
  }
  const trailing = tokens.slice(breatheIndex + 1);
  if (trailing.length) {
    return trailing.join(" ").trim();
  }
  const leading = tokens.slice(0, breatheIndex);
  return leading.join(" ").trim();
}
