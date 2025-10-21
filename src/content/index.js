const OVERLAY_ID = "spotlight-overlay";
const RESULTS_LIST_ID = "spotlight-results-list";
const RESULT_OPTION_ID_PREFIX = "spotlight-option-";
const SHADOW_HOST_ID = "spotlight-root";
const LAZY_INITIAL_BATCH = 30;
const LAZY_BATCH_SIZE = 24;
const LAZY_LOAD_THRESHOLD = 160;
let shadowHostEl = null;
let shadowRootEl = null;
let shadowContentEl = null;
let shadowStyleLinkEl = null;
let shadowHostObserver = null;
let observedBody = null;
let overlayEl = null;
let containerEl = null;
let inputWrapperEl = null;
let inputEl = null;
let resultsEl = null;
let resultsState = [];
let activeIndex = -1;
let isOpen = false;
let requestCounter = 0;
let pendingQueryTimeout = null;
let lastRequestId = 0;
let bodyOverflowBackup = "";
let statusEl = null;
let ghostEl = null;
let inputContainerEl = null;
let ghostSuggestionText = "";
let statusSticky = false;
let activeFilter = null;
let subfilterContainerEl = null;
let subfilterScrollerEl = null;
let subfilterState = { type: null, options: [], activeId: null };
let selectedSubfilter = null;
let slashMenuEl = null;
let slashMenuOptions = [];
let slashMenuVisible = false;
let slashMenuActiveIndex = -1;
let pointerNavigationSuspended = false;
let shadowStylesLoaded = false;
let shadowStylesPromise = null;
let overlayPreparationPromise = null;
let overlayGuardsInstalled = false;
let activityContainerEl = null;
let activeActivity = null;

const typingTestElements = {
  root: null,
  viewport: null,
  wordsWrap: null,
  caret: null,
  timer: null,
  durations: null,
  durationButtons: [],
  results: null,
  wpmValue: null,
  rawValue: null,
  accuracyValue: null,
  correctValue: null,
  incorrectValue: null,
  extraValue: null,
  missedValue: null,
  instructions: null,
  languageLabel: null,
};

let typingTestState = null;
let typingTestDurationIndex = 0;
let typingTestWordIdCounter = 0;
let typingTestCaretFrameId = null;
let typingTestCaretTrackUntil = 0;

const lazyList = createLazyList(
  { initial: LAZY_INITIAL_BATCH, step: LAZY_BATCH_SIZE, threshold: LAZY_LOAD_THRESHOLD },
  () => {
    if (!isOpen) {
      return;
    }
    scheduleIdleWork(() => {
      if (!isOpen) {
        return;
      }
      renderResults();
    });
  }
);

const iconCache = new Map();
const pendingIconOrigins = new Set();
let faviconQueue = [];
let faviconProcessing = false;
const DOWNLOAD_ICON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3QgeD0iNiIgeT0iMjAiIHdpZHRoPSIyMCIgaGVpZ2h0PSI2IiByeD0iMi41IiBmaWxsPSIjMEVBNUU5Ii8+PHBhdGggZD0iTTE2IDV2MTMuMTdsNC41OS00LjU4TDIyIDE1bC02IDYtNi02IDEuNDEtMS40MUwxNCAxOC4xN1Y1aDJ6IiBmaWxsPSIjRTBGMkZFIi8+PC9zdmc+";
const DEFAULT_ICON_URL = chrome.runtime.getURL("icons/default.svg");
const PLACEHOLDER_COLORS = [
  "#A5B4FC",
  "#7DD3FC",
  "#FBCFE8",
  "#FDE68A",
  "#FECACA",
  "#C4B5FD",
  "#BBF7D0",
  "#F9A8D4",
  "#FCA5A5",
  "#FDBA74",
  "#F97316",
  "#FBBF24",
];

const SLASH_OPTION_ID_PREFIX = "spotlight-slash-option-";
const SLASH_COMMAND_DEFINITIONS = [
  {
    id: "slash-tab",
    label: "Tabs",
    hint: "Show open tabs",
    value: "tab:",
    keywords: ["tab", "tabs", "open tabs", "t"],
  },
  {
    id: "slash-bookmark",
    label: "Bookmarks",
    hint: "Search saved bookmarks",
    value: "bookmark:",
    keywords: ["bookmark", "bookmarks", "bm", "saved"],
  },
  {
    id: "slash-history",
    label: "History",
    hint: "Browse recent history",
    value: "history:",
    keywords: ["history", "hist", "recent", "visited"],
  },
  {
    id: "slash-download",
    label: "Downloads",
    hint: "Review downloaded files",
    value: "download:",
    keywords: ["download", "downloads", "dl", "files"],
  },
  {
    id: "slash-back",
    label: "Back",
    hint: "Current tab back history",
    value: "back:",
    keywords: ["back", "previous", "history", "navigate"],
  },
  {
    id: "slash-forward",
    label: "Forward",
    hint: "Current tab forward history",
    value: "forward:",
    keywords: ["forward", "ahead", "history", "navigate"],
  },
];

const SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map((definition) => ({
  ...definition,
  searchTokens: [definition.label, ...(definition.keywords || [])]
    .map((token) => (token || "").toLowerCase())
    .filter(Boolean),
}));

const TYPING_TEST_DURATIONS = [15, 30, 60];
const TYPING_TEST_INITIAL_WORDS = 120;
const TYPING_TEST_MIN_BUFFER = 40;
const TYPING_TEST_WORDS = [
  "able",
  "about",
  "above",
  "accept",
  "across",
  "act",
  "action",
  "add",
  "after",
  "again",
  "age",
  "agency",
  "agent",
  "agree",
  "ahead",
  "air",
  "alike",
  "allow",
  "almost",
  "alone",
  "along",
  "already",
  "also",
  "always",
  "among",
  "amount",
  "animal",
  "answer",
  "anyone",
  "apart",
  "apple",
  "area",
  "arrive",
  "around",
  "ask",
  "assume",
  "attack",
  "aunt",
  "author",
  "awake",
  "baby",
  "back",
  "balance",
  "ball",
  "band",
  "bank",
  "base",
  "basic",
  "basket",
  "beach",
  "bear",
  "beat",
  "beauty",
  "became",
  "become",
  "before",
  "begin",
  "behind",
  "believe",
  "below",
  "benefit",
  "best",
  "better",
  "between",
  "beyond",
  "bike",
  "bird",
  "birth",
  "black",
  "blade",
  "blank",
  "block",
  "blood",
  "board",
  "body",
  "book",
  "border",
  "born",
  "borrow",
  "both",
  "bottom",
  "brain",
  "branch",
  "brave",
  "bread",
  "break",
  "bridge",
  "bright",
  "bring",
  "broad",
  "brother",
  "brown",
  "build",
  "busy",
  "buyer",
  "cabin",
  "cable",
  "calm",
  "camera",
  "camp",
  "capital",
  "captain",
  "car",
  "card",
  "care",
  "carry",
  "case",
  "cash",
  "catch",
  "cause",
  "center",
  "chain",
  "chair",
  "chance",
  "change",
  "chart",
  "cheap",
  "check",
  "child",
  "choice",
  "choose",
  "circle",
  "city",
  "civil",
  "claim",
  "class",
  "clean",
  "clear",
  "climb",
  "clock",
  "close",
  "cloud",
  "coast",
  "coffee",
  "cold",
  "color",
  "come",
  "common",
  "cook",
  "cool",
  "copy",
  "corner",
  "cotton",
  "count",
  "couple",
  "course",
  "cover",
  "craft",
  "create",
  "credit",
  "crew",
  "crowd",
  "culture",
  "cup",
  "cycle",
  "daily",
  "damage",
  "dance",
  "danger",
  "dark",
  "date",
  "dawn",
  "deal",
  "debate",
  "debt",
  "decide",
  "deep",
  "degree",
  "delay",
  "deliver",
  "demand",
  "deny",
  "depend",
  "design",
  "detail",
  "develop",
  "device",
  "differ",
  "dinner",
  "direct",
  "doctor",
  "dollar",
  "double",
  "doubt",
  "draft",
  "drama",
  "draw",
  "dream",
  "dress",
  "drink",
  "drive",
  "drop",
  "early",
  "earth",
  "east",
  "easy",
  "echo",
  "edge",
  "edit",
  "effort",
  "eight",
  "either",
  "elder",
  "elect",
  "email",
  "empty",
  "energy",
  "enjoy",
  "enter",
  "equal",
  "error",
  "event",
  "every",
  "exact",
  "expert",
  "extra",
  "fabric",
  "face",
  "fact",
  "fair",
  "faith",
  "fall",
  "family",
  "farm",
  "fast",
  "fate",
  "fault",
  "favor",
  "fear",
  "feed",
  "feel",
  "field",
  "fight",
  "final",
  "find",
  "fine",
  "fire",
  "firm",
  "first",
  "fish",
  "fit",
  "five",
  "fixed",
  "flat",
  "flight",
  "floor",
  "flow",
  "focus",
  "force",
  "forest",
  "forget",
  "form",
  "frame",
  "fresh",
  "friend",
  "front",
  "fruit",
  "gain",
  "game",
  "garden",
  "gather",
  "gentle",
  "giant",
  "gift",
  "girl",
  "give",
  "glass",
  "global",
  "goal",
  "golden",
  "good",
  "grand",
  "grant",
  "grass",
  "great",
  "green",
  "ground",
  "group",
  "grow",
  "guard",
  "guess",
  "guide",
  "habit",
  "happy",
  "harsh",
  "hate",
  "health",
  "heart",
  "heavy",
  "help",
  "hero",
  "hide",
  "high",
  "hill",
  "home",
  "honor",
  "hope",
  "horse",
  "hotel",
  "hour",
  "house",
  "human",
  "humor",
  "ideal",
  "image",
  "impact",
  "include",
  "index",
  "inside",
  "invest",
  "invite",
  "island",
  "issue",
  "item",
  "job",
  "join",
  "judge",
  "jump",
  "keep",
  "key",
  "kid",
  "kind",
  "king",
  "kiss",
  "knee",
  "knife",
  "label",
  "lake",
  "land",
  "large",
  "last",
  "laugh",
  "lead",
  "learn",
  "leave",
  "legal",
  "level",
  "light",
  "limit",
  "listen",
  "little",
  "local",
  "logic",
  "long",
  "loose",
  "lose",
  "loud",
  "love",
  "lucky",
  "lunch",
  "magic",
  "major",
  "make",
  "manage",
  "market",
  "marry",
  "match",
  "maybe",
  "mayor",
  "meal",
  "media",
  "meet",
  "member",
  "memory",
  "mental",
  "menu",
  "merit",
  "metal",
  "middle",
  "might",
  "minor",
  "minute",
  "mirror",
  "model",
  "modern",
  "money",
  "month",
  "moral",
  "motor",
  "mount",
  "move",
  "movie",
  "music",
  "narrow",
  "nation",
  "nature",
  "near",
  "neat",
  "need",
  "never",
  "night",
  "noble",
  "noise",
  "north",
  "note",
  "novel",
  "nurse",
  "object",
  "ocean",
  "offer",
  "office",
  "often",
  "open",
  "option",
  "order",
  "other",
  "ought",
  "owner",
  "pack",
  "page",
  "paint",
  "pair",
  "paper",
  "park",
  "part",
  "party",
  "peace",
  "people",
  "period",
  "phone",
  "phrase",
  "piano",
  "piece",
  "pilot",
  "pitch",
  "place",
  "plain",
  "plan",
  "plant",
  "plate",
  "play",
  "point",
  "police",
  "policy",
  "pool",
  "poor",
  "popular",
  "power",
  "press",
  "price",
  "pride",
  "prime",
  "print",
  "prize",
  "proof",
  "proud",
  "public",
  "pure",
  "push",
  "quick",
  "quiet",
  "radio",
  "raise",
  "range",
  "rapid",
  "reach",
  "ready",
  "real",
  "reason",
  "recall",
  "record",
  "reduce",
  "refer",
  "region",
  "relax",
  "rely",
  "remain",
  "remind",
  "remove",
  "renew",
  "rent",
  "reply",
  "report",
  "rest",
  "result",
  "return",
  "review",
  "reward",
  "rhythm",
  "rice",
  "rich",
  "ride",
  "right",
  "ring",
  "rise",
  "river",
  "road",
  "rock",
  "role",
  "room",
  "rough",
  "round",
  "route",
  "royal",
  "rule",
  "rural",
  "safe",
  "sail",
  "salad",
  "sale",
  "salt",
  "same",
  "save",
  "scale",
  "scene",
  "school",
  "score",
  "scout",
  "screen",
  "search",
  "seat",
  "second",
  "secret",
  "section",
  "secure",
  "seed",
  "seek",
  "seem",
  "select",
  "self",
  "sell",
  "send",
  "sense",
  "series",
  "serve",
  "set",
  "settle",
  "seven",
  "shadow",
  "share",
  "shift",
  "shine",
  "short",
  "show",
  "side",
  "sight",
  "signal",
  "silent",
  "silver",
  "simple",
  "since",
  "skill",
  "sleep",
  "small",
  "smart",
  "smile",
  "smooth",
  "social",
  "soft",
  "solid",
  "solve",
  "sorry",
  "sound",
  "source",
  "south",
  "space",
  "spare",
  "speak",
  "speed",
  "spend",
  "spirit",
  "split",
  "sport",
  "spread",
  "spring",
  "square",
  "staff",
  "stage",
  "stand",
  "start",
  "state",
  "stay",
  "steel",
  "step",
  "stick",
  "still",
  "stock",
  "stone",
  "stop",
  "store",
  "storm",
  "story",
  "street",
  "strong",
  "study",
  "style",
  "submit",
  "sugar",
  "summer",
  "supply",
  "sure",
  "surface",
  "sweet",
  "table",
  "tail",
  "take",
  "talent",
  "talk",
  "taste",
  "teach",
  "team",
  "tell",
  "tend",
  "term",
  "test",
  "text",
  "thank",
  "theme",
  "there",
  "thick",
  "thing",
  "think",
  "third",
  "though",
  "three",
  "throw",
  "tight",
  "time",
  "tiny",
  "tired",
  "title",
  "today",
  "topic",
  "total",
  "touch",
  "tough",
  "track",
  "trade",
  "train",
  "travel",
  "treat",
  "tree",
  "trend",
  "trial",
  "trust",
  "truth",
  "twice",
  "type",
  "under",
  "union",
  "unique",
  "unit",
  "upper",
  "urban",
  "usage",
  "use",
  "usual",
  "value",
  "vast",
  "video",
  "visit",
  "voice",
  "vote",
  "wait",
  "wake",
  "walk",
  "wall",
  "want",
  "warm",
  "waste",
  "watch",
  "water",
  "wave",
  "wear",
  "week",
  "weight",
  "welcome",
  "west",
  "wheel",
  "while",
  "white",
  "whole",
  "wide",
  "wife",
  "wild",
  "will",
  "wind",
  "window",
  "wine",
  "wing",
  "winner",
  "winter",
  "wise",
  "wish",
  "woman",
  "wonder",
  "world",
  "worry",
  "worth",
  "would",
  "write",
  "yard",
  "year",
  "young",
  "youth",
  "zone",
];

const TYPING_TEST_FALLBACK_WORDS = [
  "time",
  "type",
  "code",
  "fast",
  "word",
  "focus",
  "swift",
  "skill",
  "speed",
  "light",
];

function getTypingTestWordSource() {
  if (Array.isArray(TYPING_TEST_WORDS) && TYPING_TEST_WORDS.length >= 50) {
    return TYPING_TEST_WORDS;
  }
  return TYPING_TEST_FALLBACK_WORDS;
}

function createTypingTestWord() {
  const source = getTypingTestWordSource();
  const index = Math.floor(Math.random() * source.length);
  const text = source[index] || "word";
  return { id: typingTestWordIdCounter++, text, typed: "", locked: false };
}

function createTypingTestState(duration) {
  return {
    duration,
    phase: "idle",
    words: [],
    currentIndex: 0,
    startTimestamp: null,
    deadline: null,
    remainingMs: duration * 1000,
    elapsedMs: 0,
    timerRafId: null,
    scrollOffset: 0,
    scrollRow: 0,
    results: null,
  };
}

function ensureTypingTestElements() {
  if (!activityContainerEl) {
    return;
  }

  if (typingTestElements.root && typingTestElements.root.parentElement !== activityContainerEl) {
    activityContainerEl.appendChild(typingTestElements.root);
  }

  if (typingTestElements.root) {
    return;
  }

  const root = document.createElement("div");
  root.className = "typing-test";
  root.setAttribute("role", "application");

  const header = document.createElement("div");
  header.className = "typing-test-header";
  root.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "typing-test-meta";
  header.appendChild(meta);

  const language = document.createElement("div");
  language.className = "typing-test-language";

  const languageDot = document.createElement("span");
  languageDot.className = "typing-test-language-dot";
  languageDot.setAttribute("aria-hidden", "true");
  language.appendChild(languageDot);

  const languageLabel = document.createElement("span");
  languageLabel.className = "typing-test-language-label";
  languageLabel.textContent = "english";
  language.appendChild(languageLabel);

  meta.appendChild(language);

  const timerEl = document.createElement("div");
  timerEl.className = "typing-test-timer";
  timerEl.textContent = "15";
  header.appendChild(timerEl);

  const durationsEl = document.createElement("div");
  durationsEl.className = "typing-test-durations";
  durationsEl.setAttribute("role", "group");
  header.appendChild(durationsEl);

  typingTestElements.durationButtons = [];
  typingTestElements.durations = durationsEl;

  TYPING_TEST_DURATIONS.forEach((duration, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "typing-test-duration";
    button.textContent = `${duration}s`;
    button.setAttribute("aria-label", `${duration}-second test`);
    button.dataset.index = String(index);
    button.addEventListener("click", () => {
      setTypingTestDurationIndex(index);
    });
    durationsEl.appendChild(button);
    typingTestElements.durationButtons.push(button);
  });

  const viewport = document.createElement("div");
  viewport.className = "typing-test-viewport";
  root.appendChild(viewport);

  const wordsWrap = document.createElement("div");
  wordsWrap.className = "typing-test-words";
  viewport.appendChild(wordsWrap);

  const caret = document.createElement("span");
  caret.className = "typing-test-caret typing-test-caret-hidden";
  viewport.appendChild(caret);

  const results = document.createElement("div");
  results.className = "typing-test-results";
  results.setAttribute("hidden", "true");
  results.setAttribute("aria-live", "polite");
  root.appendChild(results);

  const primary = document.createElement("div");
  primary.className = "typing-test-results-primary";
  results.appendChild(primary);

  const wpmStat = createTypingTestStat("WPM", { emphasize: true });
  primary.appendChild(wpmStat.container);

  const accuracyStat = createTypingTestStat("Accuracy");
  primary.appendChild(accuracyStat.container);

  const rawStat = createTypingTestStat("Raw WPM");
  primary.appendChild(rawStat.container);

  const breakdown = document.createElement("div");
  breakdown.className = "typing-test-breakdown";
  results.appendChild(breakdown);

  typingTestElements.correctValue = createTypingTestBreakdownItem(breakdown, "Correct");
  typingTestElements.incorrectValue = createTypingTestBreakdownItem(breakdown, "Incorrect");
  typingTestElements.extraValue = createTypingTestBreakdownItem(breakdown, "Extra");
  typingTestElements.missedValue = createTypingTestBreakdownItem(breakdown, "Missed");

  const footer = document.createElement("div");
  footer.className = "typing-test-footer";
  footer.textContent = "enter restart · tab change time · esc exit";
  root.appendChild(footer);

  typingTestElements.root = root;
  typingTestElements.timer = timerEl;
  typingTestElements.viewport = viewport;
  typingTestElements.wordsWrap = wordsWrap;
  typingTestElements.caret = caret;
  typingTestElements.results = results;
  typingTestElements.wpmValue = wpmStat.value;
  typingTestElements.accuracyValue = accuracyStat.value;
  typingTestElements.rawValue = rawStat.value;
  typingTestElements.instructions = footer;
  typingTestElements.languageLabel = languageLabel;

  activityContainerEl.appendChild(root);
}

function createTypingTestStat(label, options = {}) {
  const container = document.createElement("div");
  container.className = "typing-test-stat";
  if (options.emphasize) {
    container.classList.add("typing-test-stat-primary");
  }

  const labelEl = document.createElement("div");
  labelEl.className = "typing-test-stat-label";
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "typing-test-stat-value";
  valueEl.textContent = label === "Accuracy" ? "--%" : "--";
  container.appendChild(valueEl);

  return { container, value: valueEl };
}

function createTypingTestBreakdownItem(container, label) {
  const item = document.createElement("div");
  item.className = "typing-test-breakdown-item";

  const nameEl = document.createElement("span");
  nameEl.className = "typing-test-breakdown-label";
  nameEl.textContent = label;
  item.appendChild(nameEl);

  const valueEl = document.createElement("span");
  valueEl.className = "typing-test-breakdown-value";
  valueEl.textContent = "0";
  item.appendChild(valueEl);

  container.appendChild(item);
  return valueEl;
}

function renderTypingTestDurations() {
  if (!typingTestElements.durationButtons) {
    return;
  }
  typingTestElements.durationButtons.forEach((button, index) => {
    if (!button) return;
    if (index === typingTestDurationIndex) {
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    }
  });
}

function renderTypingTestTimer() {
  const timerEl = typingTestElements.timer;
  if (!timerEl) {
    return;
  }
  const state = typingTestState;
  let displayMs = TYPING_TEST_DURATIONS[typingTestDurationIndex] * 1000;
  if (state) {
    if (state.phase === "running" || state.phase === "finished") {
      displayMs = state.remainingMs;
    } else {
      displayMs = state.duration * 1000;
    }
    if (state.phase === "finished") {
      displayMs = 0;
    }
  }
  const seconds = Math.max(0, displayMs) / 1000;
  const decimals = seconds < 10 ? 1 : 0;
  timerEl.textContent = seconds.toFixed(decimals);
}

function renderTypingTestWords() {
  if (!typingTestElements.wordsWrap || !typingTestState) {
    return;
  }

  const state = typingTestState;
  const wordsWrap = typingTestElements.wordsWrap;
  const fragment = document.createDocumentFragment();
  const startIndex = Math.max(0, state.currentIndex - 12);
  const endIndex = Math.min(state.words.length, state.currentIndex + 80);

  for (let index = startIndex; index < endIndex; index += 1) {
    const word = state.words[index];
    if (!word) continue;
    const wordEl = document.createElement("span");
    wordEl.className = "typing-word";
    if (index === state.currentIndex) {
      wordEl.classList.add("active");
    } else if (index < state.currentIndex) {
      wordEl.classList.add("completed");
    }

    const expected = word.text || "";
    const typed = word.typed || "";
    const locked = Boolean(word.locked);
    const limit = Math.max(expected.length, typed.length);

    for (let charIndex = 0; charIndex < limit; charIndex += 1) {
      const charSpan = document.createElement("span");
      charSpan.className = "typing-char";
      const expectedChar = expected[charIndex] || "";
      const typedChar = typed[charIndex] || "";

      if (charIndex < expected.length) {
        if (typedChar) {
          charSpan.textContent = typedChar;
          if (typedChar === expectedChar) {
            charSpan.classList.add("correct");
          } else {
            charSpan.classList.add("incorrect");
          }
        } else {
          charSpan.textContent = expectedChar;
          if (locked) {
            charSpan.classList.add("missed");
          }
        }
      } else {
        charSpan.textContent = typedChar;
        charSpan.classList.add("extra");
      }

      wordEl.appendChild(charSpan);
    }

    if (index === state.currentIndex) {
      const caretIndex = typed.length;
      const charCount = wordEl.children.length;
      if (caretIndex < charCount) {
        wordEl.children[caretIndex].classList.add("caret");
      } else {
        const caretSpan = document.createElement("span");
        caretSpan.className = "typing-char caret placeholder";
        caretSpan.setAttribute("aria-hidden", "true");
        caretSpan.textContent = "";
        wordEl.appendChild(caretSpan);
      }
    }

    fragment.appendChild(wordEl);
  }

  wordsWrap.replaceChildren(fragment);
  updateTypingTestScroll();
  updateTypingTestCaret();
  scheduleTypingTestCaretUpdate();
}

function updateTypingTestScroll() {
  if (!typingTestElements.wordsWrap || !typingTestElements.viewport || !typingTestState) {
    return;
  }

  const { wordsWrap, viewport } = typingTestElements;
  const state = typingTestState;
  const activeEl = wordsWrap.querySelector(".typing-word.active");

  if (!activeEl) {
    state.scrollOffset = 0;
    state.scrollRow = 0;
    wordsWrap.style.setProperty("--typing-offset", "0px");
    return;
  }

  const viewportRect = viewport.getBoundingClientRect();
  if (viewportRect.height <= 0 || viewportRect.width <= 0) {
    state.scrollOffset = 0;
    state.scrollRow = 0;
    wordsWrap.style.setProperty("--typing-offset", "0px");
    return;
  }

  const styles = getComputedStyle(wordsWrap);

  let rowGap = parseFloat(styles.rowGap || styles.getPropertyValue("row-gap"));
  if (!Number.isFinite(rowGap)) {
    const gapValue = styles.gap || styles.getPropertyValue("gap");
    rowGap = parseFloat(gapValue);
  }
  if (!Number.isFinite(rowGap)) {
    rowGap = 0;
  }

  const activeRect = activeEl.getBoundingClientRect();
  let lineHeight = activeRect.height;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    lineHeight = parseFloat(styles.lineHeight);
  }
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    const fontSize = parseFloat(styles.fontSize);
    if (Number.isFinite(fontSize)) {
      lineHeight = fontSize * 1.4;
    } else {
      lineHeight = viewportRect.height / 3;
    }
  }

  const rowHeight = Math.max(1, lineHeight + rowGap);
  const currentOffset = Number.isFinite(state.scrollOffset) ? state.scrollOffset : 0;
  const currentRow = Number.isFinite(state.scrollRow)
    ? state.scrollRow
    : Math.max(0, Math.round(currentOffset / rowHeight));
  const maxOffset = Math.max(0, wordsWrap.scrollHeight - viewportRect.height);
  const maxRow = Math.max(0, Math.floor(maxOffset / rowHeight + 0.0001));

  const relativeTop = activeRect.top - viewportRect.top + currentOffset;
  const rowIndex = Math.max(0, Math.floor(relativeTop / rowHeight + 0.0001));

  let nextRow = currentRow;
  if (rowIndex - nextRow > 1) {
    nextRow = rowIndex - 1;
  } else if (rowIndex < nextRow) {
    nextRow = rowIndex;
  }

  if (!Number.isFinite(nextRow)) {
    nextRow = 0;
  }

  nextRow = Math.min(Math.max(nextRow, 0), maxRow);
  const appliedOffset = Math.min(Math.max(nextRow * rowHeight, 0), maxOffset);
  const appliedRow = Math.max(0, Math.floor(appliedOffset / rowHeight + 0.0001));

  state.scrollRow = appliedRow;
  state.scrollOffset = appliedOffset;
  const nextValue = `${-appliedOffset}px`;
  if (wordsWrap.style.getPropertyValue("--typing-offset") !== nextValue) {
    wordsWrap.style.setProperty("--typing-offset", nextValue);
  }
}

function scheduleTypingTestCaretUpdate() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const trackingWindowMs = 240;
  typingTestCaretTrackUntil = Math.max(typingTestCaretTrackUntil, now + trackingWindowMs);
  if (typingTestCaretFrameId !== null) {
    return;
  }
  typingTestCaretFrameId = requestAnimationFrame(runTypingTestCaretFrame);
}

function runTypingTestCaretFrame() {
  typingTestCaretFrameId = null;
  updateTypingTestCaret();
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now < typingTestCaretTrackUntil) {
    typingTestCaretFrameId = requestAnimationFrame(runTypingTestCaretFrame);
  } else {
    typingTestCaretTrackUntil = 0;
  }
}

function cancelTypingTestCaretUpdate() {
  if (typingTestCaretFrameId !== null) {
    cancelAnimationFrame(typingTestCaretFrameId);
    typingTestCaretFrameId = null;
  }
  typingTestCaretTrackUntil = 0;
}

function updateTypingTestCaret() {
  if (
    !typingTestElements.caret ||
    !typingTestElements.viewport ||
    !typingTestElements.wordsWrap
  ) {
    return;
  }

  const { caret, viewport, wordsWrap } = typingTestElements;
  const state = typingTestState;

  if (!isOpen || activeActivity !== "typing-test" || !state || state.phase === "finished") {
    caret.classList.add("typing-test-caret-hidden");
    return;
  }

  const anchor = wordsWrap.querySelector(".typing-word.active .typing-char.caret");
  if (!anchor) {
    caret.classList.add("typing-test-caret-hidden");
    return;
  }

  const viewportRect = viewport.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  if (viewportRect.width === 0 || viewportRect.height === 0) {
    caret.classList.add("typing-test-caret-hidden");
    return;
  }

  const fontSize = parseFloat(getComputedStyle(wordsWrap).fontSize || "16");
  const fallbackWidth = Number.isFinite(fontSize) ? Math.max(fontSize * 0.55, 6) : 12;
  const caretWidth = Math.max(anchorRect.width, fallbackWidth);
  const caretHeight = caret.offsetHeight || 2;
  const x = anchorRect.left - viewportRect.left;
  const y = anchorRect.bottom - viewportRect.top - caretHeight;

  caret.style.width = `${caretWidth}px`;
  caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  caret.classList.remove("typing-test-caret-hidden");
}

function renderTypingTestResults() {
  const resultsContainer = typingTestElements.results;
  if (!resultsContainer) {
    return;
  }
  const {
    wpmValue,
    rawValue,
    accuracyValue,
    correctValue,
    incorrectValue,
    extraValue,
    missedValue,
  } = typingTestElements;
  if (!wpmValue || !rawValue || !accuracyValue || !correctValue || !incorrectValue || !extraValue || !missedValue) {
    return;
  }
  const state = typingTestState;
  if (!state || !state.results) {
    resultsContainer.setAttribute("hidden", "true");
    if (typingTestElements.root) {
      typingTestElements.root.classList.remove("typing-test-finished");
    }
    wpmValue.textContent = "--";
    rawValue.textContent = "--";
    accuracyValue.textContent = "--%";
    correctValue.textContent = "0";
    incorrectValue.textContent = "0";
    extraValue.textContent = "0";
    missedValue.textContent = "0";
    return;
  }

  resultsContainer.removeAttribute("hidden");
  if (typingTestElements.root) {
    typingTestElements.root.classList.add("typing-test-finished");
  }

  const { wpm, rawWpm, accuracy, correct, incorrect, extra, missed } = state.results;
  wpmValue.textContent = formatTypingValue(wpm);
  rawValue.textContent = formatTypingValue(rawWpm);
  accuracyValue.textContent = `${formatTypingAccuracy(accuracy)}%`;
  correctValue.textContent = String(correct);
  incorrectValue.textContent = String(incorrect);
  extraValue.textContent = String(extra);
  missedValue.textContent = String(missed);
}

function ensureTypingTestWordBuffer(state, targetCount) {
  const target = Math.max(targetCount || 0, state.words.length);
  while (state.words.length < target) {
    state.words.push(createTypingTestWord());
  }
}

function maybeExtendTypingTestWords(state) {
  const remaining = state.words.length - state.currentIndex - 1;
  if (remaining >= TYPING_TEST_MIN_BUFFER) {
    return;
  }
  const target = state.words.length + (TYPING_TEST_MIN_BUFFER - remaining) + 20;
  ensureTypingTestWordBuffer(state, target);
}

function restartTypingTest() {
  ensureTypingTestElements();
  const duration = TYPING_TEST_DURATIONS[typingTestDurationIndex] || TYPING_TEST_DURATIONS[0];
  if (typingTestState && typingTestState.timerRafId) {
    cancelAnimationFrame(typingTestState.timerRafId);
  }
  typingTestState = createTypingTestState(duration);
  typingTestWordIdCounter = 0;
  ensureTypingTestWordBuffer(typingTestState, TYPING_TEST_INITIAL_WORDS);
  typingTestState.remainingMs = duration * 1000;
  typingTestState.scrollOffset = 0;
  typingTestState.scrollRow = 0;
  renderTypingTestDurations();
  renderTypingTestTimer();
  renderTypingTestWords();
  renderTypingTestResults();
  if (typingTestElements.wordsWrap) {
    typingTestElements.wordsWrap.style.setProperty("--typing-offset", "0px");
  }
}

function setTypingTestDurationIndex(index) {
  const total = TYPING_TEST_DURATIONS.length;
  if (!total) {
    return;
  }
  let nextIndex = index % total;
  if (nextIndex < 0) {
    nextIndex += total;
  }
  typingTestDurationIndex = nextIndex;
  restartTypingTest();
}

function cycleTypingTestDuration(step) {
  setTypingTestDurationIndex(typingTestDurationIndex + step);
}

function ensureTypingTestStarted() {
  if (!typingTestState || typingTestState.phase !== "idle") {
    return;
  }
  typingTestState.phase = "running";
  typingTestState.startTimestamp = performance.now();
  typingTestState.deadline = typingTestState.startTimestamp + typingTestState.duration * 1000;
  typingTestState.remainingMs = typingTestState.duration * 1000;
  typingTestState.timerRafId = requestAnimationFrame(updateTypingTestTimerFrame);
}

function getTypingTestWordAt(index) {
  if (!typingTestState) {
    return null;
  }
  if (!typingTestState.words[index]) {
    typingTestState.words[index] = createTypingTestWord();
  }
  return typingTestState.words[index];
}

function typingTestInsertChar(char) {
  if (!typingTestState) {
    return;
  }
  const current = getTypingTestWordAt(typingTestState.currentIndex);
  ensureTypingTestStarted();
  current.typed = `${current.typed || ""}${char}`;
  renderTypingTestWords();
}

function typingTestBackspace() {
  if (!typingTestState) {
    return;
  }
  const state = typingTestState;
  const current = getTypingTestWordAt(state.currentIndex);
  if (!current) {
    return;
  }

  if (current.typed) {
    current.typed = current.typed.slice(0, -1);
  } else if (state.currentIndex > 0) {
    const previousIndex = state.currentIndex - 1;
    const previous = getTypingTestWordAt(previousIndex);
    if (previous) {
      state.currentIndex = previousIndex;
      previous.locked = false;
      if (previous.typed) {
        previous.typed = previous.typed.slice(0, -1);
      }
    }
  }

  renderTypingTestWords();
}

function typingTestCommitWord() {
  if (!typingTestState) {
    return;
  }
  const state = typingTestState;
  const current = getTypingTestWordAt(state.currentIndex);
  ensureTypingTestStarted();
  current.locked = true;
  state.currentIndex += 1;
  getTypingTestWordAt(state.currentIndex);
  maybeExtendTypingTestWords(state);
  renderTypingTestWords();
}

function updateTypingTestTimerFrame(now) {
  if (!typingTestState || typingTestState.phase !== "running") {
    return;
  }
  const state = typingTestState;
  const remaining = state.deadline - now;
  state.remainingMs = Math.max(0, remaining);
  state.elapsedMs = Math.min(state.duration * 1000, Math.max(0, now - state.startTimestamp));
  renderTypingTestTimer();
  if (remaining <= 0) {
    finishTypingTest();
    return;
  }
  state.timerRafId = requestAnimationFrame(updateTypingTestTimerFrame);
}

function finishTypingTest() {
  if (!typingTestState || typingTestState.phase === "finished") {
    return;
  }
  const state = typingTestState;
  if (state.timerRafId) {
    cancelAnimationFrame(state.timerRafId);
    state.timerRafId = null;
  }
  state.phase = "finished";
  if (state.startTimestamp) {
    const now = performance.now();
    state.elapsedMs = Math.min(state.duration * 1000, Math.max(0, now - state.startTimestamp));
  }
  state.remainingMs = 0;
  const current = getTypingTestWordAt(state.currentIndex);
  if (current) {
    current.locked = true;
  }
  const includeCount = state.currentIndex + (current && (current.typed || "").length > 0 ? 1 : 0);
  state.results = computeTypingTestResults(state, includeCount);
  renderTypingTestTimer();
  renderTypingTestWords();
  renderTypingTestResults();
}

function computeTypingTestResults(state, includeCount) {
  const limit = Math.min(includeCount, state.words.length);
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;

  for (let index = 0; index < limit; index += 1) {
    const word = state.words[index];
    if (!word) continue;
    const expected = word.text || "";
    const typed = word.typed || "";
    const length = Math.min(expected.length, typed.length);
    for (let i = 0; i < length; i += 1) {
      if (typed[i] === expected[i]) {
        correct += 1;
      } else {
        incorrect += 1;
      }
    }
    if (typed.length > expected.length) {
      extra += typed.length - expected.length;
    } else if (expected.length > typed.length) {
      missed += expected.length - typed.length;
    }
  }

  const totalTyped = correct + incorrect + extra;
  const elapsedMs = state.elapsedMs > 0 ? state.elapsedMs : state.duration * 1000;
  const minutes = Math.max(elapsedMs / 60000, state.duration / 60);
  const wpm = totalTyped > 0 ? (correct / 5) / minutes : 0;
  const rawWpm = totalTyped > 0 ? (totalTyped / 5) / minutes : 0;
  const accuracy = totalTyped > 0 ? (correct / totalTyped) * 100 : 0;

  return {
    wpm,
    rawWpm,
    accuracy,
    correct,
    incorrect,
    extra,
    missed,
    elapsedMs,
  };
}

function startTypingTestActivity() {
  ensureTypingTestElements();
  restartTypingTest();
  if (activityContainerEl) {
    activityContainerEl.focus({ preventScroll: true });
  }
}

function exitTypingTestActivity() {
  if (typingTestState && typingTestState.timerRafId) {
    cancelAnimationFrame(typingTestState.timerRafId);
    typingTestState.timerRafId = null;
  }
  cancelTypingTestCaretUpdate();
  typingTestState = null;
  if (typingTestElements.root) {
    typingTestElements.root.classList.remove("typing-test-finished");
  }
  if (typingTestElements.results) {
    typingTestElements.results.setAttribute("hidden", "true");
  }
  if (typingTestElements.caret) {
    typingTestElements.caret.classList.add("typing-test-caret-hidden");
  }
  renderTypingTestResults();
}

function handleTypingTestKeydown(event) {
  if (!isOpen || activeActivity !== "typing-test") {
    return;
  }

  const state = typingTestState;
  const key = event.key;

  if (key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeActivityView({ restoreFocus: true });
    return;
  }

  if (key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    restartTypingTest();
    return;
  }

  if (key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    cycleTypingTestDuration(event.shiftKey ? -1 : 1);
    return;
  }

  if (!state || state.phase === "finished") {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    typingTestBackspace();
    return;
  }

  if (key === " ") {
    event.preventDefault();
    event.stopPropagation();
    typingTestCommitWord();
    return;
  }

  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (/^[a-z]$/.test(lower)) {
      event.preventDefault();
      event.stopPropagation();
      typingTestInsertChar(lower);
    }
  }
}

function formatTypingValue(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function formatTypingAccuracy(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 99.5) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function ensureShadowRoot() {
  if (!document.body) {
    return null;
  }

  if (shadowRootEl && shadowContentEl) {
    if (shadowHostEl && !shadowHostEl.parentElement) {
      document.body.appendChild(shadowHostEl);
    }
    return shadowRootEl;
  }

  shadowHostEl = document.createElement("div");
  shadowHostEl.id = SHADOW_HOST_ID;
  shadowHostEl.style.position = "fixed";
  shadowHostEl.style.inset = "0";
  shadowHostEl.style.zIndex = "2147483647";
  shadowHostEl.style.display = "none";
  shadowHostEl.style.contain = "layout style paint";
  shadowHostEl.style.pointerEvents = "none";

  shadowRootEl = shadowHostEl.attachShadow({ mode: "open", delegatesFocus: true });

  shadowStyleLinkEl = document.createElement("link");
  shadowStyleLinkEl.rel = "stylesheet";
  shadowStyleLinkEl.href = chrome.runtime.getURL("src/content/styles.css");

  shadowStylesPromise = new Promise((resolve) => {
    const markReady = () => {
      shadowStylesLoaded = true;
      resolve();
    };
    shadowStyleLinkEl.addEventListener("load", markReady, { once: true });
    shadowStyleLinkEl.addEventListener("error", markReady, { once: true });
    shadowRootEl.appendChild(shadowStyleLinkEl);
    if (shadowStyleLinkEl.sheet) {
      markReady();
    }
  });

  shadowContentEl = document.createElement("div");
  shadowContentEl.className = "spotlight-root";
  shadowRootEl.appendChild(shadowContentEl);

  document.body.appendChild(shadowHostEl);

  ensureShadowHostObserver();

  return shadowRootEl;
}

function ensureShadowHostObserver() {
  if (!document.body || shadowHostObserver) {
    return;
  }

  shadowHostObserver = new MutationObserver(() => {
    if (!shadowHostEl || !document.body) {
      return;
    }

    if (shadowHostEl.parentElement !== document.body) {
      document.body.appendChild(shadowHostEl);
    }

    if (observedBody !== document.body) {
      if (document.body) {
        shadowHostObserver.observe(document.body, { childList: true });
        observedBody = document.body;
      }
    }
  });

  shadowHostObserver.observe(document.documentElement, { childList: true });
  shadowHostObserver.observe(document.body, { childList: true });
  observedBody = document.body;
}

async function prepareOverlay() {
  if (overlayPreparationPromise) {
    return overlayPreparationPromise;
  }

  overlayPreparationPromise = (async () => {
    if (!document.body) {
      await new Promise((resolve) => {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", resolve, { once: true });
        } else {
          const observer = new MutationObserver(() => {
            if (document.body) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.documentElement, { childList: true });
          if (document.body) {
            observer.disconnect();
            resolve();
          }
        }
      });
    }

    ensureShadowRoot();

    if (!overlayEl) {
      createOverlay();
    }

    if (overlayEl && shadowContentEl && !shadowContentEl.contains(overlayEl)) {
      shadowContentEl.appendChild(overlayEl);
    }

    if (!shadowStylesLoaded && shadowStylesPromise) {
      try {
        await shadowStylesPromise;
      } catch (error) {
        // Ignore stylesheet loading failures so the overlay can still open unstyled.
      }
    }
  })();

  try {
    await overlayPreparationPromise;
  } finally {
    overlayPreparationPromise = null;
  }
}

function createOverlay() {
  ensureShadowRoot();

  overlayEl = document.createElement("div");
  overlayEl.id = OVERLAY_ID;
  overlayEl.className = "spotlight-overlay";
  overlayEl.setAttribute("role", "presentation");

  containerEl = document.createElement("div");
  containerEl.className = "spotlight-shell";
  containerEl.setAttribute("role", "dialog");
  containerEl.setAttribute("aria-modal", "true");

  const inputWrapper = document.createElement("div");
  inputWrapper.className = "spotlight-input-wrapper";
  inputWrapperEl = inputWrapper;
  inputContainerEl = document.createElement("div");
  inputContainerEl.className = "spotlight-input-container";

  ghostEl = document.createElement("div");
  ghostEl.className = "spotlight-ghost";
  ghostEl.textContent = "";
  inputContainerEl.appendChild(ghostEl);

  inputEl = document.createElement("input");
  inputEl.className = "spotlight-input";
  inputEl.type = "text";
  inputEl.setAttribute("placeholder", "Search tabs, bookmarks, history, downloads… (try \"tab:\")");
  inputEl.setAttribute("spellcheck", "false");
  inputEl.setAttribute("role", "combobox");
  inputEl.setAttribute("aria-haspopup", "listbox");
  inputEl.setAttribute("aria-autocomplete", "both");
  inputContainerEl.appendChild(inputEl);

  slashMenuEl = document.createElement("div");
  slashMenuEl.className = "spotlight-slash-menu";
  slashMenuEl.setAttribute("role", "listbox");
  slashMenuEl.setAttribute("aria-hidden", "true");
  inputContainerEl.appendChild(slashMenuEl);

  inputWrapper.appendChild(inputContainerEl);

  subfilterContainerEl = document.createElement("div");
  subfilterContainerEl.className = "spotlight-subfilters";
  subfilterContainerEl.setAttribute("role", "group");
  subfilterContainerEl.setAttribute("aria-label", "Subfilters");
  subfilterScrollerEl = document.createElement("div");
  subfilterScrollerEl.className = "spotlight-subfilters-scroll";
  subfilterContainerEl.appendChild(subfilterScrollerEl);
  inputWrapper.appendChild(subfilterContainerEl);

  statusEl = document.createElement("div");
  statusEl.className = "spotlight-status";
  statusEl.textContent = "";
  statusEl.setAttribute("role", "status");
  inputWrapper.appendChild(statusEl);

  resultsEl = document.createElement("ul");
  resultsEl.className = "spotlight-results";
  resultsEl.setAttribute("role", "listbox");
  resultsEl.id = RESULTS_LIST_ID;
  inputEl.setAttribute("aria-controls", RESULTS_LIST_ID);
  lazyList.attach(resultsEl);
  resultsEl.addEventListener("pointermove", handleResultsPointerMove);

  containerEl.appendChild(inputWrapper);
  containerEl.appendChild(resultsEl);

  activityContainerEl = document.createElement("div");
  activityContainerEl.className = "spotlight-activity";
  activityContainerEl.setAttribute("tabindex", "-1");
  activityContainerEl.setAttribute("role", "document");
  activityContainerEl.setAttribute("hidden", "true");
  containerEl.appendChild(activityContainerEl);
  overlayEl.appendChild(containerEl);

  if (shadowContentEl && !shadowContentEl.contains(overlayEl)) {
    shadowContentEl.appendChild(overlayEl);
  }

  renderSubfilters();

  overlayEl.addEventListener("click", (event) => {
    if (event.target !== overlayEl) {
      return;
    }
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeOverlay();
  });

  inputEl.addEventListener("input", (event) => {
    event.stopPropagation();
    handleInputChange();
  });
  inputEl.addEventListener("keydown", (event) => {
    event.stopPropagation();
    handleInputKeydown(event);
  });
  inputEl.addEventListener("keyup", (event) => {
    event.stopPropagation();
  });
  inputEl.addEventListener("focus", () => {
    if (inputContainerEl) {
      inputContainerEl.classList.add("focused");
    }
  });
  inputEl.addEventListener("blur", () => {
    if (inputContainerEl) {
      inputContainerEl.classList.remove("focused");
    }
  });
  document.addEventListener("keydown", handleGlobalKeydown, true);

  installOverlayGuards();
}

function openActivityView(viewId) {
  if (!containerEl || !activityContainerEl) {
    return;
  }

  if (activeActivity === viewId) {
    if (viewId === "typing-test") {
      startTypingTestActivity();
    }
    activityContainerEl.focus({ preventScroll: true });
    return;
  }

  closeActivityView({ restoreFocus: false });

  activeActivity = viewId;
  containerEl.classList.add("activity-mode");
  activityContainerEl.dataset.activity = viewId;
  activityContainerEl.removeAttribute("hidden");

  if (inputEl) {
    inputEl.blur();
    inputEl.setAttribute("disabled", "true");
  }
  if (inputWrapperEl) {
    inputWrapperEl.setAttribute("aria-hidden", "true");
  }
  if (resultsEl) {
    resultsEl.setAttribute("aria-hidden", "true");
  }
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
    pendingQueryTimeout = null;
  }

  switch (viewId) {
    case "typing-test":
      startTypingTestActivity();
      break;
    default:
      break;
  }

  activityContainerEl.focus({ preventScroll: true });
}

function closeActivityView(options = {}) {
  if (!activeActivity) {
    return;
  }

  switch (activeActivity) {
    case "typing-test":
      exitTypingTestActivity();
      break;
    default:
      break;
  }

  activeActivity = null;
  if (containerEl) {
    containerEl.classList.remove("activity-mode");
  }
  if (activityContainerEl) {
    activityContainerEl.setAttribute("hidden", "true");
    delete activityContainerEl.dataset.activity;
  }
  if (resultsEl) {
    resultsEl.removeAttribute("aria-hidden");
  }
  if (inputWrapperEl) {
    inputWrapperEl.removeAttribute("aria-hidden");
  }
  if (inputEl) {
    inputEl.removeAttribute("disabled");
    if (options.restoreFocus) {
      setTimeout(() => {
        inputEl.focus({ preventScroll: true });
        inputEl.select();
      }, 0);
    }
  }
}

function installOverlayGuards() {
  if (!overlayEl || overlayGuardsInstalled) {
    return;
  }

  overlayGuardsInstalled = true;

  const bubbleBlockers = [
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "pointermove",
    "click",
    "dblclick",
    "contextmenu",
    "wheel",
    "touchstart",
    "touchmove",
    "touchend",
    "focusin",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "paste",
    "copy",
    "cut",
  ];

  const blockIfOpen = (event) => {
    if (!isOpen) {
      return;
    }
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  bubbleBlockers.forEach((type) => {
    overlayEl.addEventListener(type, blockIfOpen);
  });

  if (shadowRootEl) {
    const stopKeys = (event) => {
      if (!isOpen) {
        return;
      }
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    ["keydown", "keypress", "keyup"].forEach((type) => {
      shadowRootEl.addEventListener(type, stopKeys);
    });
  }
}

function resetSlashMenuState() {
  slashMenuOptions = [];
  slashMenuVisible = false;
  slashMenuActiveIndex = -1;
  if (slashMenuEl) {
    slashMenuEl.innerHTML = "";
    slashMenuEl.classList.remove("visible");
    slashMenuEl.setAttribute("aria-hidden", "true");
    slashMenuEl.removeAttribute("aria-activedescendant");
  }
}

function extractSlashQuery(value, caretIndex) {
  if (!value || value[0] !== "/") {
    return null;
  }
  const caret = typeof caretIndex === "number" ? caretIndex : value.length;
  if (caret < 0) {
    return null;
  }
  const beforeCaret = value.slice(0, caret);
  if (beforeCaret.includes("\n")) {
    return null;
  }
  if (beforeCaret.indexOf(" ") !== -1) {
    return null;
  }
  return beforeCaret.slice(1);
}

function computeSlashCandidates(query) {
  const normalized = (query || "").trim().toLowerCase();
  const scored = SLASH_COMMANDS.map((option) => {
    if (!normalized) {
      return { option, score: 1 };
    }
    let score = 0;
    for (const token of option.searchTokens) {
      if (!token) continue;
      if (token.startsWith(normalized)) {
        score = Math.max(score, 3);
      } else if (token.includes(normalized)) {
        score = Math.max(score, 2);
      }
    }
    return { option, score };
  }).filter((entry) => (normalized ? entry.score > 0 : true));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.option.label.localeCompare(b.option.label);
  });

  return scored.map((entry) => entry.option);
}

function renderSlashMenu() {
  if (!slashMenuEl) {
    return;
  }
  slashMenuEl.innerHTML = "";
  if (!slashMenuVisible || !slashMenuOptions.length) {
    slashMenuEl.classList.remove("visible");
    slashMenuEl.setAttribute("aria-hidden", "true");
    slashMenuEl.removeAttribute("aria-activedescendant");
    return;
  }

  slashMenuEl.classList.add("visible");
  slashMenuEl.setAttribute("aria-hidden", "false");
  slashMenuEl.removeAttribute("aria-activedescendant");

  slashMenuOptions.forEach((option, index) => {
    const optionId = `${SLASH_OPTION_ID_PREFIX}${option.id}`;
    const item = document.createElement("div");
    item.className = "spotlight-slash-option";
    item.id = optionId;
    item.setAttribute("role", "option");
    if (index === slashMenuActiveIndex) {
      item.classList.add("active");
      slashMenuEl.setAttribute("aria-activedescendant", optionId);
    }
    const label = document.createElement("div");
    label.className = "spotlight-slash-option-label";
    label.textContent = option.label;
    item.appendChild(label);

    if (option.hint) {
      const hint = document.createElement("div");
      hint.className = "spotlight-slash-option-hint";
      hint.textContent = option.hint;
      item.appendChild(hint);
    }

    item.addEventListener("pointerenter", () => {
      if (slashMenuActiveIndex !== index) {
        slashMenuActiveIndex = index;
        renderSlashMenu();
      }
    });

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    item.addEventListener("click", () => {
      applySlashSelection(option);
    });

    slashMenuEl.appendChild(item);
  });
}

function updateSlashMenu() {
  if (!inputEl) {
    return;
  }
  const caret = typeof inputEl.selectionStart === "number" ? inputEl.selectionStart : inputEl.value.length;
  const slashSegment = extractSlashQuery(inputEl.value, caret);
  if (slashSegment === null) {
    if (slashMenuVisible) {
      resetSlashMenuState();
    }
    return;
  }

  const normalized = slashSegment.trim().toLowerCase();
  const previousActiveId = slashMenuOptions[slashMenuActiveIndex]?.id || null;
  const nextOptions = computeSlashCandidates(normalized);
  if (!nextOptions.length) {
    resetSlashMenuState();
    return;
  }

  slashMenuOptions = nextOptions;
  slashMenuVisible = true;
  const reuseIndex = previousActiveId
    ? slashMenuOptions.findIndex((option) => option.id === previousActiveId)
    : -1;
  slashMenuActiveIndex = reuseIndex >= 0 ? reuseIndex : 0;
  renderSlashMenu();
  setGhostText("");
}

function getActiveSlashOption() {
  if (!slashMenuVisible || !slashMenuOptions.length) {
    return null;
  }
  return slashMenuOptions[Math.max(0, Math.min(slashMenuActiveIndex, slashMenuOptions.length - 1))] || null;
}

function moveSlashSelection(delta) {
  if (!slashMenuVisible || !slashMenuOptions.length) {
    return;
  }
  const count = slashMenuOptions.length;
  slashMenuActiveIndex = (slashMenuActiveIndex + delta + count) % count;
  renderSlashMenu();
}

function applySlashSelection(option) {
  if (!option || !inputEl) {
    return false;
  }
  const base = option.value.endsWith(" ") ? option.value : `${option.value} `;
  inputEl.focus({ preventScroll: true });
  inputEl.value = base;
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  resetSlashMenuState();
  setGhostText("");
  handleInputChange();
  return true;
}

function resetSubfilterState() {
  subfilterState = { type: null, options: [], activeId: null };
  selectedSubfilter = null;
  renderSubfilters();
}

function updateSubfilterState(payload) {
  if (!payload || typeof payload !== "object") {
    resetSubfilterState();
    return;
  }

  const { type, options = [], activeId } = payload;
  if (!type || !Array.isArray(options)) {
    resetSubfilterState();
    return;
  }

  const sanitizedOptions = options
    .map((option) => {
      if (!option || typeof option.id !== "string") {
        return null;
      }
      return {
        id: option.id,
        label: typeof option.label === "string" ? option.label : option.id,
        hint: typeof option.hint === "string" ? option.hint : "",
        count: typeof option.count === "number" ? option.count : null,
      };
    })
    .filter(Boolean);

  const hasNonAllOption = sanitizedOptions.some((option) => option.id !== "all");
  if (!hasNonAllOption) {
    resetSubfilterState();
    return;
  }

  let resolvedActiveId = typeof activeId === "string" ? activeId : null;
  if (!resolvedActiveId) {
    resolvedActiveId = sanitizedOptions.find((option) => option.id === "all") ? "all" : sanitizedOptions[0]?.id || null;
  }

  subfilterState = { type, options: sanitizedOptions, activeId: resolvedActiveId };
  if (resolvedActiveId && resolvedActiveId !== "all") {
    selectedSubfilter = { type, id: resolvedActiveId };
  } else {
    selectedSubfilter = null;
  }
  renderSubfilters();
}

function getActiveSubfilterLabel() {
  if (!subfilterState || !Array.isArray(subfilterState.options)) {
    return "";
  }
  const activeId = subfilterState.activeId;
  if (!activeId || activeId === "all") {
    return "";
  }
  const option = subfilterState.options.find((entry) => entry && entry.id === activeId);
  return option?.label || "";
}

function renderSubfilters() {
  if (!subfilterContainerEl || !subfilterScrollerEl) {
    return;
  }

  const options = Array.isArray(subfilterState.options) ? subfilterState.options : [];
  const hasType = Boolean(subfilterState.type);
  const hasNonAllOption = options.some((option) => option && option.id && option.id !== "all");
  const shouldShow = hasType && hasNonAllOption;
  subfilterContainerEl.classList.toggle("visible", shouldShow);
  subfilterContainerEl.setAttribute("aria-hidden", shouldShow ? "false" : "true");

  subfilterScrollerEl.innerHTML = "";
  if (!shouldShow) {
    return;
  }

  options.forEach((option) => {
    if (!option || typeof option.id !== "string") {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spotlight-subfilter";
    button.dataset.id = option.id;
    button.title = option.hint || option.label;

    const labelSpan = document.createElement("span");
    labelSpan.className = "spotlight-subfilter-label";
    labelSpan.textContent = option.label;
    button.appendChild(labelSpan);

    if (typeof option.count === "number" && option.count > 0) {
      const countSpan = document.createElement("span");
      countSpan.className = "spotlight-subfilter-count";
      countSpan.textContent = String(option.count);
      button.appendChild(countSpan);
    }

    const isActive = subfilterState.activeId ? subfilterState.activeId === option.id : option.id === "all";
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");

    button.addEventListener("click", () => {
      handleSubfilterClick(option);
    });

    subfilterScrollerEl.appendChild(button);
  });
}

function handleSubfilterClick(option) {
  if (!option || !subfilterState.type) {
    return;
  }

  const currentId = subfilterState.activeId || "all";
  const nextId = option.id;

  if (nextId === currentId) {
    if (nextId === "all") {
      return;
    }
    subfilterState = { ...subfilterState, activeId: "all" };
    selectedSubfilter = null;
    renderSubfilters();
    requestResults(inputEl.value);
    return;
  }

  if (nextId === "all") {
    subfilterState = { ...subfilterState, activeId: "all" };
    selectedSubfilter = null;
    renderSubfilters();
    requestResults(inputEl.value);
    return;
  }

  subfilterState = { ...subfilterState, activeId: nextId };
  selectedSubfilter = { type: subfilterState.type, id: nextId };
  renderSubfilters();
  requestResults(inputEl.value);
}

async function openOverlay() {
  if (isOpen) {
    if (activeActivity === "typing-test" && activityContainerEl) {
      activityContainerEl.focus({ preventScroll: true });
    } else if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
    return;
  }

  await prepareOverlay();

  if (!overlayEl || !shadowHostEl) {
    return;
  }

  isOpen = true;
  closeActivityView({ restoreFocus: false });
  activeIndex = -1;
  resultsState = [];
  lazyList.reset();
  statusEl.textContent = "";
  statusSticky = false;
  activeFilter = null;
  resetSubfilterState();
  resultsEl.innerHTML = "";
  inputEl.value = "";
  setGhostText("");
  resetSlashMenuState();
  pointerNavigationSuspended = true;

  if (!shadowHostEl.parentElement) {
    document.body.appendChild(shadowHostEl);
  }
  shadowHostEl.style.display = "block";
  shadowHostEl.style.pointerEvents = "auto";

  bodyOverflowBackup = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  requestResults("");
  setTimeout(() => {
    inputEl.focus({ preventScroll: true });
    inputEl.select();
  }, 10);
}

function closeOverlay() {
  if (!isOpen) return;

  isOpen = false;
  closeActivityView({ restoreFocus: false });
  if (shadowHostEl) {
    shadowHostEl.style.display = "none";
    shadowHostEl.style.pointerEvents = "none";
  }
  document.body.style.overflow = bodyOverflowBackup;
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
    pendingQueryTimeout = null;
  }
  statusSticky = false;
  activeFilter = null;
  resetSubfilterState();
  setGhostText("");
  resetSlashMenuState();
  resultsState = [];
  lazyList.reset();
  if (resultsEl) {
    resultsEl.innerHTML = "";
  }
  if (inputEl) {
    inputEl.removeAttribute("aria-activedescendant");
  }
}

function handleGlobalKeydown(event) {
  if (!isOpen) return;
  if (activeActivity === "typing-test") {
    handleTypingTestKeydown(event);
    return;
  }
  if (slashMenuVisible && slashMenuOptions.length) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeOverlay();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    navigateResults(event.key === "ArrowDown" ? 1 : -1);
  }
}

function handleInputKeydown(event) {
  if (activeActivity) {
    event.preventDefault();
    return;
  }
  if (slashMenuVisible && slashMenuOptions.length) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSlashSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      const applied = applySlashSelection(getActiveSlashOption());
      if (applied) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetSlashMenuState();
      return;
    }
  }

  const selectionAtEnd =
    inputEl.selectionStart === inputEl.value.length && inputEl.selectionEnd === inputEl.value.length;
  if (
    ((event.key === "Tab" && !event.shiftKey) || event.key === "ArrowRight") &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    selectionAtEnd &&
    ghostSuggestionText &&
    !slashMenuVisible
  ) {
    const applied = applyGhostSuggestion();
    if (applied) {
      event.preventDefault();
      return;
    }
  }

  if (event.key === "Enter") {
    const value = inputEl.value.trim();
    if (value === "> reindex") {
      triggerReindex();
      return;
    }
    if ((!resultsState.length || activeIndex < 0) && ghostSuggestionText) {
      event.preventDefault();
      applyGhostSuggestion();
      return;
    }
    if (resultsState.length > 0 && activeIndex >= 0) {
      event.preventDefault();
      openResult(resultsState[activeIndex]);
    } else if (resultsState.length === 1) {
      event.preventDefault();
      openResult(resultsState[0]);
    }
  }
}

function handleInputChange() {
  if (activeActivity) {
    return;
  }
  const query = inputEl.value;
  updateSlashMenu();
  const trimmed = query.trim();
  if (trimmed === "> reindex") {
    lastRequestId = ++requestCounter;
    setStatus("Press Enter to rebuild index", { sticky: true, force: true });
    setGhostText("");
    resultsState = [];
    lazyList.reset();
    renderResults();
    return;
  }
  setStatus("", { force: true });
  setGhostText("");
  activeIndex = -1;
  updateActiveResult();
  pointerNavigationSuspended = true;
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
  }
  pendingQueryTimeout = setTimeout(() => {
    requestResults(query);
  }, 80);
}

function requestResults(query) {
  lastRequestId = ++requestCounter;
  const message = { type: "SPOTLIGHT_QUERY", query, requestId: lastRequestId };
  if (selectedSubfilter && selectedSubfilter.type && selectedSubfilter.id) {
    message.subfilter = { type: selectedSubfilter.type, id: selectedSubfilter.id };
  }
  chrome.runtime.sendMessage(
    message,
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Spotlight query error", chrome.runtime.lastError);
        if (inputEl.value.trim() !== "> reindex") {
          setGhostText("");
          setStatus("", { force: true });
        }
        return;
      }
      if (!response || response.requestId !== lastRequestId) {
        return;
      }
      resultsState = Array.isArray(response.results) ? response.results.slice() : [];
      lazyList.setItems(resultsState);
      applyCachedFavicons(resultsState);
      activeIndex = resultsState.length > 0 ? 0 : -1;
      activeFilter = typeof response.filter === "string" && response.filter ? response.filter : null;
      pointerNavigationSuspended = true;
      renderResults();
      updateSubfilterState(response.subfilters);

      const trimmed = inputEl.value.trim();
      if (trimmed === "> reindex") {
        setGhostText("");
        return;
      }

      const ghost = response.ghost && typeof response.ghost.text === "string" ? response.ghost.text : "";
      const answer = typeof response.answer === "string" ? response.answer : "";
      setGhostText(slashMenuVisible ? "" : ghost);
      const filterLabel = getFilterStatusLabel(activeFilter);
      const subfilterLabel = getActiveSubfilterLabel();
      let statusMessage = "";
      if (filterLabel) {
        statusMessage = `Filtering ${filterLabel}`;
        if (subfilterLabel) {
          statusMessage = `${statusMessage} · ${subfilterLabel}`;
        }
      }
      if (answer) {
        statusMessage = statusMessage ? `${statusMessage} · ${answer}` : answer;
      }
      if (statusMessage) {
        setStatus(statusMessage, { force: true, sticky: Boolean(filterLabel) });
      } else if (!ghostSuggestionText) {
        setStatus("", { force: true });
      }
    }
  );
}

function setStatus(message, options = {}) {
  const opts = typeof options === "boolean" ? { sticky: options } : options;
  const { sticky = false, force = false } = opts;

  if (statusSticky && !force && !sticky) {
    return;
  }

  statusSticky = Boolean(sticky && message);

  if (statusEl) {
    statusEl.textContent = message || "";
  }

  if (!message && !sticky) {
    statusSticky = false;
  }
}

function matchesGhostPrefix(value, suggestion) {
  if (!value || !suggestion) return false;
  const compactValue = value.toLowerCase().replace(/\s+/g, "");
  const compactSuggestion = suggestion.toLowerCase().replace(/\s+/g, "");
  if (!compactValue) return false;
  return compactSuggestion.startsWith(compactValue);
}

function setGhostText(text) {
  if (!ghostEl || !inputEl) {
    ghostSuggestionText = "";
    return;
  }

  const value = inputEl.value;
  let suggestion = text && matchesGhostPrefix(value, text) ? text : "";
  if (suggestion) {
    const compactValue = value.toLowerCase().replace(/\s+/g, "");
    const compactSuggestion = suggestion.toLowerCase().replace(/\s+/g, "");
    if (compactValue === compactSuggestion) {
      suggestion = "";
    }
  }
  ghostSuggestionText = suggestion;
  ghostEl.textContent = suggestion;
  ghostEl.classList.toggle("visible", Boolean(suggestion));
}

function applyGhostSuggestion() {
  if (!ghostSuggestionText || !inputEl) {
    return false;
  }
  if (!matchesGhostPrefix(inputEl.value, ghostSuggestionText)) {
    setGhostText("");
    return false;
  }
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
    pendingQueryTimeout = null;
  }
  inputEl.value = ghostSuggestionText;
  inputEl.setSelectionRange(ghostSuggestionText.length, ghostSuggestionText.length);
  setGhostText("");
  requestResults(inputEl.value);
  return true;
}

function navigateResults(delta) {
  if (!resultsState.length) return;
  activeIndex = (activeIndex + delta + resultsState.length) % resultsState.length;
  const expanded = lazyList.ensureVisible(activeIndex);
  if (!expanded) {
    updateActiveResult();
  }
}

function handlePointerHover(index, event) {
  if (!Number.isInteger(index) || index < 0 || index >= resultsState.length) {
    return;
  }
  const pointerType = event && typeof event.pointerType === "string" ? event.pointerType : "";
  const isMouseLike = pointerType === "" || pointerType === "mouse";
  const force = Boolean(event && event.forceUpdate);
  if (!force && isMouseLike && pointerNavigationSuspended) {
    pointerNavigationSuspended = false;
    return;
  }
  pointerNavigationSuspended = false;
  if (activeIndex !== index) {
    activeIndex = index;
    if (!lazyList.ensureVisible(activeIndex)) {
      updateActiveResult();
    }
  }
}

function handleResultsPointerMove(event) {
  if (!resultsEl || !event || typeof event.target === "undefined") {
    return;
  }
  const target = event.target;
  if (!target || typeof target.closest !== "function") {
    return;
  }
  const item = target.closest("li.spotlight-result[role='option']");
  if (!item || !resultsEl.contains(item)) {
    return;
  }
  const indexAttr = item.dataset ? item.dataset.index : undefined;
  const itemIndex = typeof indexAttr === "string" ? Number(indexAttr) : Number.NaN;
  if (!Number.isInteger(itemIndex)) {
    return;
  }
  handlePointerHover(itemIndex, { pointerType: event.pointerType, forceUpdate: true });
}

function updateActiveResult() {
  if (!resultsEl || !inputEl) {
    return;
  }
  const items = resultsEl.querySelectorAll("li");
  let activeItem = null;
  items.forEach((item) => {
    const indexAttr = item.dataset ? item.dataset.index : undefined;
    const itemIndex = typeof indexAttr === "string" ? Number(indexAttr) : Number.NaN;
    const isActive = Number.isInteger(itemIndex) && itemIndex === activeIndex;
    item.classList.toggle("active", isActive);
    if (item.getAttribute("role") === "option") {
      item.setAttribute("aria-selected", isActive ? "true" : "false");
    } else {
      item.removeAttribute("aria-selected");
    }
    if (isActive) {
      activeItem = item;
      item.scrollIntoView({ block: "nearest" });
    }
  });
  if (activeItem && activeItem.id) {
    inputEl.setAttribute("aria-activedescendant", activeItem.id);
  } else {
    inputEl.removeAttribute("aria-activedescendant");
  }
}

function openResult(result) {
  if (!result) return;
  if (result.type === "command") {
    if (result.view) {
      openActivityView(result.view);
      return;
    }
    if (!result.command) {
      return;
    }
    const payload = { type: "SPOTLIGHT_COMMAND", command: result.command };
    if (result.args) {
      payload.args = result.args;
    }
    chrome.runtime.sendMessage(payload);
    closeOverlay();
    return;
  }
  if (result.type === "navigation") {
    if (typeof result.navigationDelta === "number" && typeof result.tabId === "number") {
      chrome.runtime.sendMessage(
        { type: "SPOTLIGHT_NAVIGATE", tabId: result.tabId, delta: result.navigationDelta },
        () => {
          if (chrome.runtime.lastError) {
            console.warn("Spotlight navigation error", chrome.runtime.lastError);
          }
        }
      );
    }
    closeOverlay();
    return;
  }
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_OPEN", itemId: result.id });
  closeOverlay();
}

function renderResults() {
  if (!resultsEl) {
    return;
  }

  resultsEl.innerHTML = "";

  if (inputEl.value.trim() === "> reindex") {
    const li = document.createElement("li");
    li.className = "spotlight-result reindex";
    li.textContent = "Press Enter to rebuild the search index";
    resultsEl.appendChild(li);
    if (inputEl) {
      inputEl.removeAttribute("aria-activedescendant");
    }
    return;
  }

  if (!resultsState.length) {
    const li = document.createElement("li");
    li.className = "spotlight-result empty";
    const scopeLabel = getFilterStatusLabel(activeFilter);
    const emptyLabel = activeFilter === "history" && scopeLabel ? "history results" : scopeLabel;
    li.textContent = emptyLabel ? `No ${emptyLabel} match your search` : "No matches";
    resultsEl.appendChild(li);
    if (inputEl) {
      inputEl.removeAttribute("aria-activedescendant");
    }
    return;
  }

  activeIndex = Math.min(activeIndex, resultsState.length - 1);
  if (activeIndex < 0 && resultsState.length > 0) {
    activeIndex = 0;
  }

  const visibleResults = lazyList.getVisibleItems();
  const itemsToRender = visibleResults.length ? visibleResults : resultsState.slice(0, LAZY_INITIAL_BATCH);

  itemsToRender.forEach((result, index) => {
    if (!result) {
      return;
    }
    const displayIndex = index;
    const li = document.createElement("li");
    li.className = "spotlight-result";
    li.setAttribute("role", "option");
    li.id = `${RESULT_OPTION_ID_PREFIX}${displayIndex}`;
    li.dataset.resultId = String(result.id);
    li.dataset.index = String(displayIndex);
    const origin = getResultOrigin(result);
    if (origin) {
      li.dataset.origin = origin;
    } else {
      delete li.dataset.origin;
    }

    const iconEl = createIconElement(result);
    if (iconEl) {
      li.appendChild(iconEl);
    }

    const body = document.createElement("div");
    body.className = "spotlight-result-content";

    const title = document.createElement("div");
    title.className = "spotlight-result-title";
    title.textContent = result.title || result.url;

    const meta = document.createElement("div");
    meta.className = "spotlight-result-meta";

    const url = document.createElement("span");
    url.className = "spotlight-result-url";
    url.textContent = result.description || result.url || "";
    if (url.textContent) {
      url.title = url.textContent;
    }

    const timestampLabel = formatResultTimestamp(result);

    const type = document.createElement("span");
    type.className = `spotlight-result-type type-${result.type}`;
    type.textContent = formatTypeLabel(result.type, result);

    meta.appendChild(url);
    if (result.type === "topSite") {
      const visitLabel = formatVisitCount(result.visitCount);
      if (visitLabel) {
        const visitChip = document.createElement("span");
        visitChip.className = "spotlight-result-tag spotlight-result-tag-topsite";
        visitChip.textContent = visitLabel;
        meta.appendChild(visitChip);
      }
    }
    if (timestampLabel) {
      const timestampEl = document.createElement("span");
      timestampEl.className = "spotlight-result-timestamp";
      timestampEl.textContent = timestampLabel;
      timestampEl.title = timestampLabel;
      meta.appendChild(timestampEl);
    }
    if (result.type === "download") {
      const stateLabel = formatDownloadStateLabel(result.state);
      if (stateLabel) {
        const stateChip = document.createElement("span");
        stateChip.className = `spotlight-result-tag ${getDownloadStateClassName(result.state)}`;
        stateChip.textContent = stateLabel;
        meta.appendChild(stateChip);
      }
    }
    meta.appendChild(type);

    body.appendChild(title);
    body.appendChild(meta);
    li.appendChild(body);

    li.addEventListener("pointerover", (event) => {
      handlePointerHover(displayIndex, event);
    });

    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    li.addEventListener("click", () => {
      const target = resultsState[displayIndex] || result;
      openResult(target);
    });

    if (result.type === "command") {
      li.classList.add("spotlight-result-command");
    }

    resultsEl.appendChild(li);
  });

  enqueueFavicons(itemsToRender);
  updateActiveResult();

  scheduleIdleWork(() => {
    lazyList.maybeFill();
  });
}

function getFilterStatusLabel(type) {
  switch (type) {
    case "tab":
      return "tabs";
    case "bookmark":
      return "bookmarks";
    case "history":
      return "history";
    case "download":
      return "downloads";
    case "back":
      return "back history";
    case "forward":
      return "forward history";
    case "topSite":
      return "top sites";
    default:
      return "";
  }
}

const DOWNLOAD_STATE_LABELS = {
  complete: "Completed",
  in_progress: "In Progress",
  interrupted: "Interrupted",
  paused: "Paused",
  cancelled: "Canceled",
};

function normalizeDownloadState(value) {
  if (typeof value !== "string" || !value) {
    return "unknown";
  }
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (DOWNLOAD_STATE_LABELS[normalized]) {
    return normalized;
  }
  return normalized || "unknown";
}

function formatDownloadStateLabel(state) {
  const normalized = normalizeDownloadState(state);
  if (normalized === "unknown") {
    return "";
  }
  if (DOWNLOAD_STATE_LABELS[normalized]) {
    return DOWNLOAD_STATE_LABELS[normalized];
  }
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function getDownloadStateClassName(state) {
  const normalized = normalizeDownloadState(state);
  return `download-state-${normalized}`;
}

function triggerReindex() {
  setStatus("Rebuilding index...", { sticky: true, force: true });
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_REINDEX" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Unable to rebuild index", { force: true });
      return;
    }
    if (response && response.success) {
      setStatus("Index refreshed", { force: true });
      requestResults(inputEl.value === "> reindex" ? "" : inputEl.value);
    } else {
      setStatus("Rebuild failed", { force: true });
    }
  });
}

function formatTypeLabel(type, result) {
  switch (type) {
    case "tab":
      return "Tab";
    case "bookmark":
      return "Bookmark";
    case "history":
      return "History";
    case "download": {
      const stateLabel = result ? formatDownloadStateLabel(result.state) : "";
      return stateLabel ? `Download · ${stateLabel}` : "Download";
    }
    case "command":
      return (result && result.label) || "Command";
    case "navigation":
      if (result && result.direction === "forward") {
        return "Forward";
      }
      return "Back";
    case "topSite":
      return "Top Site";
    default:
      return type || "";
  }
}

function getResultTimestamp(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidates = [
    result.lastVisitTime,
    result.lastAccessed,
    result.dateAdded,
    result.completedAt,
    result.createdAt,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function formatResultTimestamp(result) {
  const timestamp = getResultTimestamp(result);
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (err) {
    return date.toLocaleString();
  }
}

function formatVisitCount(count) {
  const visits = typeof count === "number" && Number.isFinite(count) ? count : 0;
  if (visits <= 0) {
    return "";
  }
  if (visits === 1) {
    return "1 visit";
  }
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      notation: visits >= 1000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    });
    const formatted = formatter.format(visits);
    return `${formatted} visits`;
  } catch (err) {
    return `${visits} visits`;
  }
}

function scheduleIdleWork(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 500 });
  } else {
    setTimeout(callback, 32);
  }
}

function createLazyList(options = {}, onChange) {
  const { initial = 30, step = 20, threshold = 160 } = options || {};
  let container = null;
  let items = [];
  let visibleCount = 0;
  const changeHandler = typeof onChange === "function" ? onChange : null;

  const handleScroll = () => {
    if (!container || visibleCount >= items.length) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight - (scrollTop + clientHeight) <= threshold) {
      increase(step);
    }
  };

  function attach(element) {
    if (container && container !== element) {
      container.removeEventListener("scroll", handleScroll);
    }
    container = element || null;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }
  }

  function setItems(nextItems) {
    items = Array.isArray(nextItems) ? nextItems : [];
    visibleCount = Math.min(items.length, initial || items.length);
  }

  function getVisibleItems() {
    if (!items.length) {
      return [];
    }
    if (!visibleCount) {
      visibleCount = Math.min(items.length, initial || items.length);
    }
    return items.slice(0, visibleCount);
  }

  function increase(amount = step) {
    if (!items.length) {
      return;
    }
    const next = Math.min(items.length, visibleCount + amount);
    if (next > visibleCount) {
      visibleCount = next;
      if (changeHandler) {
        changeHandler();
      }
    }
  }

  function ensureVisible(index) {
    if (typeof index !== "number" || index < 0) {
      return false;
    }
    if (index < visibleCount) {
      return false;
    }
    const next = Math.min(items.length, index + 1);
    if (next > visibleCount) {
      visibleCount = next;
      if (changeHandler) {
        changeHandler();
      }
      return true;
    }
    return false;
  }

  function reset() {
    items = [];
    visibleCount = 0;
  }

  function hasMore() {
    return visibleCount < items.length;
  }

  function maybeFill() {
    if (!container || !hasMore()) {
      return;
    }
    const { scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight + threshold) {
      increase(step);
    }
  }

  return {
    attach,
    setItems,
    getVisibleItems,
    ensureVisible,
    reset,
    hasMore,
    maybeFill,
  };
}

function getResultOrigin(result) {
  if (!result) return "";
  if (result.type === "command") {
    return typeof result.origin === "string" ? result.origin : "";
  }
  if (typeof result.origin === "string" && result.origin) {
    return result.origin;
  }
  const url = typeof result.url === "string" ? result.url : "";
  if (!url) {
    return "";
  }
  if (!/^https?:/i.test(url)) {
    return "";
  }
  try {
    const parsed = new URL(url, window.location?.href || undefined);
    const origin = parsed.origin || "";
    if (origin && typeof result === "object") {
      result.origin = origin;
    }
    return origin;
  } catch (err) {
    return "";
  }
}

function getPlaceholderInitial(result) {
  if (!result) return "";
  const origin = getResultOrigin(result);
  if (origin) {
    const host = origin.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (host) {
      const letter = host[0];
      if (letter && /[a-z0-9]/i.test(letter)) {
        return letter.toUpperCase();
      }
    }
  }
  const title = typeof result.title === "string" && result.title.trim() ? result.title.trim() : "";
  if (title) {
    const letter = title[0];
    if (letter && /[a-z0-9]/i.test(letter)) {
      return letter.toUpperCase();
    }
  }
  const url = typeof result.url === "string" && result.url.trim() ? result.url.trim() : "";
  if (url) {
    const letter = url.replace(/^https?:\/\//i, "")[0];
    if (letter && /[a-z0-9]/i.test(letter)) {
      return letter.toUpperCase();
    }
  }
  return "";
}

function computePlaceholderColor(origin) {
  if (!origin) {
    return "rgba(148, 163, 184, 0.35)";
  }
  let hash = 0;
  for (let i = 0; i < origin.length; i += 1) {
    hash = (hash << 5) - hash + origin.charCodeAt(i);
    hash |= 0; // eslint-disable-line no-bitwise
  }
  const index = Math.abs(hash) % PLACEHOLDER_COLORS.length;
  return PLACEHOLDER_COLORS[index];
}

function createPlaceholderElement(result) {
  const placeholder = document.createElement("div");
  placeholder.className = "spotlight-result-placeholder";
  const origin = getResultOrigin(result);
  const initial = getPlaceholderInitial(result);
  if (initial) {
    placeholder.textContent = initial;
    placeholder.classList.add("has-initial");
  } else {
    const fallback = document.createElement("img");
    fallback.className = "spotlight-result-placeholder-img";
    fallback.src = DEFAULT_ICON_URL;
    fallback.alt = "";
    fallback.referrerPolicy = "no-referrer";
    placeholder.appendChild(fallback);
  }
  const color = computePlaceholderColor(origin);
  placeholder.style.backgroundColor = color;
  return placeholder;
}

function createIconImage(src) {
  const image = document.createElement("img");
  image.className = "spotlight-result-icon-img";
  image.src = src;
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  return image;
}

function createIconElement(result) {
  const wrapper = document.createElement("div");
  wrapper.className = "spotlight-result-icon";
  if (result && result.iconHint === "download") {
    wrapper.classList.add("spotlight-result-icon-download");
    wrapper.appendChild(createIconImage(DOWNLOAD_ICON_DATA_URL));
    return wrapper;
  }
  const origin = getResultOrigin(result);
  const cached = origin ? iconCache.get(origin) : null;
  const src = result && typeof result.faviconUrl === "string" && result.faviconUrl ? result.faviconUrl : cached;
  if (src) {
    wrapper.appendChild(createIconImage(src));
  } else {
    wrapper.appendChild(createPlaceholderElement(result));
  }
  return wrapper;
}

function applyCachedFavicons(results) {
  if (!Array.isArray(results)) {
    return;
  }
  results.forEach((result) => {
    if (!result) return;
    if (result.iconHint) return;
    const origin = getResultOrigin(result);
    if (!origin) return;
    if (iconCache.has(origin)) {
      const cached = iconCache.get(origin);
      result.faviconUrl = typeof cached === "string" && cached ? cached : null;
    }
  });
}

function shouldRequestFavicon(result) {
  if (!result || result.type === "command" || result.iconHint) {
    return false;
  }
  const origin = getResultOrigin(result);
  if (!origin) {
    return false;
  }
  if (iconCache.has(origin) || pendingIconOrigins.has(origin)) {
    return false;
  }
  if (faviconQueue.some((task) => task.origin === origin)) {
    return false;
  }
  const url = typeof result.url === "string" ? result.url : "";
  if (!/^https?:/i.test(url)) {
    return false;
  }
  return true;
}

function enqueueFavicons(results) {
  if (!Array.isArray(results) || !results.length) {
    return;
  }
  const neededOrigins = new Set();
  results.forEach((result) => {
    const origin = getResultOrigin(result);
    if (origin) {
      neededOrigins.add(origin);
    }
  });
  if (neededOrigins.size) {
    faviconQueue = faviconQueue.filter((task) => neededOrigins.has(task.origin));
  } else {
    faviconQueue = [];
  }
  let added = false;
  results.forEach((result) => {
    if (!shouldRequestFavicon(result)) {
      return;
    }
    const origin = getResultOrigin(result);
    if (!origin) {
      return;
    }
    faviconQueue.push({
      origin,
      itemId: result.id,
      url: result.url,
      type: result.type,
      tabId: typeof result.tabId === "number" ? result.tabId : null,
    });
    added = true;
  });
  if (added) {
    processFaviconQueue();
  }
}

function updateResultsWithIcon(origin, faviconUrl) {
  const normalizedOrigin = origin || "";
  resultsState.forEach((result) => {
    if (!result) return;
    if ((getResultOrigin(result) || "") === normalizedOrigin) {
      if (result.iconHint) {
        return;
      }
      result.faviconUrl = faviconUrl || null;
    }
  });
  applyIconToResults(normalizedOrigin, faviconUrl || null);
}

function processFaviconQueue() {
  if (faviconProcessing || !faviconQueue.length) {
    return;
  }
  faviconProcessing = true;

  const runNext = () => {
    if (!faviconQueue.length) {
      faviconProcessing = false;
      return;
    }

    const task = faviconQueue.shift();
    if (!task) {
      scheduleIdleWork(runNext);
      return;
    }

    if (pendingIconOrigins.has(task.origin)) {
      scheduleIdleWork(runNext);
      return;
    }

    pendingIconOrigins.add(task.origin);

    chrome.runtime.sendMessage(
      {
        type: "SPOTLIGHT_FAVICON",
        itemId: task.itemId,
        origin: task.origin,
        url: task.url,
        tabId: task.tabId,
        resultType: task.type,
      },
      (response) => {
        pendingIconOrigins.delete(task.origin);

        if (chrome.runtime.lastError) {
          scheduleIdleWork(runNext);
          return;
        }

        const faviconUrl =
          response && typeof response.faviconUrl === "string" && response.faviconUrl
            ? response.faviconUrl
            : null;
        iconCache.set(task.origin, faviconUrl);
        updateResultsWithIcon(task.origin, faviconUrl);
        scheduleIdleWork(runNext);
      }
    );
  };

  scheduleIdleWork(runNext);
}

function applyIconToResults(origin, faviconUrl) {
  if (!resultsEl) {
    return;
  }
  const normalizedOrigin = origin || "";
  const items = resultsEl.querySelectorAll("li");
  items.forEach((itemEl) => {
    if ((itemEl.dataset.origin || "") !== normalizedOrigin) {
      return;
    }
    const iconContainer = itemEl.querySelector(".spotlight-result-icon");
    if (!iconContainer) {
      return;
    }
    iconContainer.innerHTML = "";
    const resultId = itemEl.dataset.resultId;
    const result = resultsState.find((entry) => String(entry?.id) === String(resultId));
    if (result && result.iconHint === "download") {
      iconContainer.classList.add("spotlight-result-icon-download");
      iconContainer.appendChild(createIconImage(DOWNLOAD_ICON_DATA_URL));
      return;
    }
    if (faviconUrl) {
      iconContainer.appendChild(createIconImage(faviconUrl));
      return;
    }
    iconContainer.appendChild(createPlaceholderElement(result || null));
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SPOTLIGHT_TOGGLE") {
    return;
  }
  if (isOpen) {
    closeOverlay();
  } else {
    void openOverlay();
  }
});

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      ensureShadowRoot();
    },
    { once: true }
  );
} else {
  ensureShadowRoot();
}
