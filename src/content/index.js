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
let subfilterState = { type: null, options: [], activeId: null, hasNonAllOption: false };
let selectedSubfilter = null;
let bookmarkOrganizerControl = null;
let bookmarkOrganizerRequestPending = false;
let slashMenuEl = null;
let slashMenuOptions = [];
let slashMenuVisible = false;
let slashMenuActiveIndex = -1;
let pointerNavigationSuspended = false;
let shadowStylesLoaded = false;
let shadowStylesPromise = null;
let overlayPreparationPromise = null;
let overlayGuardsInstalled = false;
let engineMenuEl = null;
let engineMenuOptions = [];
let engineMenuVisible = false;
let engineMenuActiveIndex = -1;
let engineMenuAnchor = null;
let userSelectedWebSearchEngineId = null;
let activeWebSearchEngine = null;
let webSearchPreviewResult = null;
let historyAssistantContainerEl = null;
let historyAssistantFormEl = null;
let historyAssistantInputEl = null;
let historyAssistantSubmitEl = null;
let historyAssistantMessageEl = null;
let historyAssistantSummaryEl = null;
let historyAssistantEnabled = true;
let historyAssistantFilters = null;
let historyAssistantActiveIntent = null;
let historyAssistantOpenCount = 1;
let historyAssistantLastQueryText = null;
let historyAssistantSummaryText = "";
let historyAssistantPendingSubfilterId = null;
let historyAssistantLatestRequestId = 0;
const TAB_SUMMARY_CACHE_LIMIT = 40;
const TAB_SUMMARY_PANEL_CLASS = "spotlight-ai-panel";
const TAB_SUMMARY_COPY_CLASS = "spotlight-ai-panel-copy";
const TAB_SUMMARY_LIST_CLASS = "spotlight-ai-panel-list";
const TAB_SUMMARY_BADGE_CLASS = "spotlight-ai-panel-badge";
const TAB_SUMMARY_STATUS_CLASS = "spotlight-ai-panel-status";
const TAB_SUMMARY_BUTTON_CLASS = "spotlight-result-summary-button";
const tabSummaryState = new Map();
let tabSummaryRequestCounter = 0;

function getWebSearchApi() {
  const api = typeof globalThis !== "undefined" ? globalThis.SpotlightWebSearch : null;
  if (!api || typeof api !== "object") {
    return null;
  }
  return api;
}

function resetWebSearchSelection() {
  const api = getWebSearchApi();
  userSelectedWebSearchEngineId = null;
  activeWebSearchEngine = api && typeof api.getDefaultSearchEngine === "function"
    ? api.getDefaultSearchEngine()
    : null;
  webSearchPreviewResult = null;
}

function getActiveWebSearchEngineId() {
  if (userSelectedWebSearchEngineId) {
    return userSelectedWebSearchEngineId;
  }
  return activeWebSearchEngine ? activeWebSearchEngine.id : null;
}

function getDefaultWebSearchEngineId() {
  const api = getWebSearchApi();
  if (!api || typeof api.getDefaultSearchEngine !== "function") {
    return null;
  }
  const engine = api.getDefaultSearchEngine();
  if (!engine || typeof engine.id !== "string") {
    return null;
  }
  return engine.id;
}

function isHistoryAssistantFeatureEnabled() {
  const features =
    typeof globalThis !== "undefined" &&
    globalThis &&
    typeof globalThis.SpotlightFeatures === "object"
      ? globalThis.SpotlightFeatures
      : null;
  if (features && typeof features.historyAssistant === "boolean") {
    return features.historyAssistant;
  }
  return true;
}

function setHistoryAssistantMessage(text, options = {}) {
  if (!historyAssistantMessageEl) {
    return;
  }
  const { error = false } = typeof options === "object" && options !== null ? options : {};
  historyAssistantMessageEl.textContent = text || "";
  historyAssistantMessageEl.classList.toggle("visible", Boolean(text));
  historyAssistantMessageEl.classList.toggle("error", Boolean(error));
}

function setHistoryAssistantSummary(text) {
  if (!historyAssistantSummaryEl) {
    return;
  }
  historyAssistantSummaryEl.textContent = text || "";
  historyAssistantSummaryEl.classList.toggle("visible", Boolean(text));
}

function setHistoryAssistantLoading(isLoading) {
  if (!historyAssistantContainerEl) {
    return;
  }
  const busy = Boolean(isLoading);
  historyAssistantContainerEl.classList.toggle("loading", busy);
  historyAssistantContainerEl.setAttribute("aria-busy", busy ? "true" : "false");
  if (historyAssistantInputEl) {
    historyAssistantInputEl.disabled = busy || !historyAssistantEnabled;
  }
  if (historyAssistantSubmitEl) {
    historyAssistantSubmitEl.disabled = busy || !historyAssistantEnabled;
  }
}

function clearHistoryAssistantFilters({ resetUI = false } = {}) {
  historyAssistantFilters = null;
  historyAssistantActiveIntent = null;
  historyAssistantOpenCount = 1;
  historyAssistantLastQueryText = null;
  historyAssistantPendingSubfilterId = null;
  if (resetUI) {
    historyAssistantSummaryText = "";
    setHistoryAssistantMessage("");
    setHistoryAssistantSummary("");
  }
}

function resetHistoryAssistantContext() {
  historyAssistantLatestRequestId = 0;
  historyAssistantSummaryText = "";
  clearHistoryAssistantFilters({ resetUI: true });
  if (historyAssistantContainerEl) {
    historyAssistantContainerEl.classList.remove("visible");
    historyAssistantContainerEl.setAttribute("aria-hidden", "true");
  }
  if (historyAssistantInputEl) {
    historyAssistantInputEl.value = "";
    historyAssistantInputEl.disabled = !historyAssistantEnabled;
  }
  if (historyAssistantSubmitEl) {
    historyAssistantSubmitEl.disabled = !historyAssistantEnabled;
  }
  setHistoryAssistantLoading(false);
}

function updateHistoryAssistantVisibility() {
  if (!historyAssistantContainerEl) {
    return;
  }
  const visible = Boolean(historyAssistantEnabled && isOpen && activeFilter === "history");
  historyAssistantContainerEl.classList.toggle("visible", visible);
  historyAssistantContainerEl.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible) {
    setHistoryAssistantSummary("");
  } else if (historyAssistantSummaryText) {
    setHistoryAssistantSummary(historyAssistantSummaryText);
  }
}

function handleHistoryAssistantResults(results) {
  if (!historyAssistantActiveIntent) {
    return;
  }
  const intent = historyAssistantActiveIntent;
  historyAssistantActiveIntent = null;
  if (intent === "open") {
    if (!Array.isArray(results) || !results.length) {
      return;
    }
    const target = results.find((entry) => entry && entry.type === "history");
    if (target) {
      openResult(target);
    }
  }
}

function applyHistoryAssistantPlan(plan) {
  if (!plan || typeof plan !== "object") {
    setHistoryAssistantMessage("I couldn't interpret that request.", { error: true });
    return;
  }

  const answer = typeof plan.answer === "string" ? plan.answer : "";
  if (answer) {
    setHistoryAssistantMessage(answer);
  } else {
    setHistoryAssistantMessage("");
  }

  historyAssistantSummaryText = typeof plan.summary === "string" ? plan.summary : "";
  if (plan.intent === "summarize") {
    if (historyAssistantSummaryText) {
      setHistoryAssistantSummary(historyAssistantSummaryText);
    } else {
      setHistoryAssistantSummary("");
    }
  } else {
    setHistoryAssistantSummary("");
  }

  const filters = plan.filters && typeof plan.filters === "object" ? plan.filters : null;
  if (filters) {
    const tokens = Array.isArray(filters.tokens)
      ? filters.tokens.filter((token) => typeof token === "string")
      : [];
    const siteFilters = Array.isArray(filters.siteFilters)
      ? filters.siteFilters.filter((site) => typeof site === "string")
      : [];
    const timeRange = typeof filters.timeRange === "string" ? filters.timeRange : null;
    const filterAnswer = typeof filters.answer === "string" ? filters.answer : answer;
    historyAssistantFilters = { tokens, siteFilters, timeRange, answer: filterAnswer };
    historyAssistantPendingSubfilterId = timeRange;
  } else {
    historyAssistantFilters = null;
    historyAssistantPendingSubfilterId = null;
  }

  const intent = typeof plan.intent === "string" ? plan.intent : "unknown";
  historyAssistantOpenCount =
    Number.isFinite(plan.openCount) && plan.openCount > 0
      ? Math.min(5, Math.max(1, Math.round(plan.openCount)))
      : 1;
  historyAssistantActiveIntent = intent === "open" ? "open" : null;

  if (!plan.canSearch) {
    historyAssistantFilters = null;
    historyAssistantLastQueryText = null;
    historyAssistantPendingSubfilterId = null;
    return;
  }

  const queryText = typeof plan.query === "string" && plan.query ? plan.query : "history:";
  historyAssistantLastQueryText = queryText;
  if (inputEl) {
    inputEl.value = queryText;
    inputEl.setSelectionRange(queryText.length, queryText.length);
  }
  updateHistoryAssistantVisibility();
  requestResults(queryText);
}

function handleHistoryAssistantSubmit(event) {
  event.preventDefault();
  if (!historyAssistantEnabled || !historyAssistantContainerEl) {
    return;
  }
  if (!historyAssistantContainerEl.classList.contains("visible")) {
    return;
  }
  const prompt = historyAssistantInputEl ? historyAssistantInputEl.value.trim() : "";
  if (!prompt) {
    setHistoryAssistantMessage("Try asking for a site or time range, like ‘Show YouTube from yesterday’.", {
      error: true,
    });
    return;
  }
  const requestId = historyAssistantLatestRequestId + 1;
  historyAssistantLatestRequestId = requestId;
  setHistoryAssistantLoading(true);
  setHistoryAssistantMessage("Thinking…");
  setHistoryAssistantSummary("");
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_HISTORY_ASSISTANT", prompt }, (response) => {
    if (requestId !== historyAssistantLatestRequestId) {
      return;
    }
    setHistoryAssistantLoading(false);
    if (chrome.runtime.lastError) {
      console.error("Spotlight history assistant error", chrome.runtime.lastError);
      setHistoryAssistantMessage("Assistant unavailable. Please try again.", { error: true });
      return;
    }
    if (!response || !response.success || !response.plan) {
      const errorMessage = (response && response.error) || "I couldn't understand that. Try rephrasing.";
      setHistoryAssistantMessage(errorMessage, { error: true });
      return;
    }
    applyHistoryAssistantPlan(response.plan);
  });
}

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
  {
    id: "slash-summarize",
    label: "Summaries",
    hint: "Filter tabs and preview AI key points",
    value: "summarize:",
    keywords: ["summary", "summaries", "digest", "ai", "tab digest"],
  },
];

const SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map((definition) => ({
  ...definition,
  searchTokens: [definition.label, ...(definition.keywords || [])]
    .map((token) => (token || "").toLowerCase())
    .filter(Boolean),
}));

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

  engineMenuEl = document.createElement("div");
  engineMenuEl.className = "spotlight-engine-menu";
  engineMenuEl.setAttribute("role", "listbox");
  engineMenuEl.setAttribute("aria-hidden", "true");
  inputContainerEl.appendChild(engineMenuEl);

  inputWrapper.appendChild(inputContainerEl);

  subfilterContainerEl = document.createElement("div");
  subfilterContainerEl.className = "spotlight-subfilters";
  subfilterContainerEl.setAttribute("role", "group");
  subfilterContainerEl.setAttribute("aria-label", "Subfilters");
  subfilterScrollerEl = document.createElement("div");
  subfilterScrollerEl.className = "spotlight-subfilters-scroll";
  subfilterContainerEl.appendChild(subfilterScrollerEl);
  inputWrapper.appendChild(subfilterContainerEl);
  ensureBookmarkOrganizerControl();

  statusEl = document.createElement("div");
  statusEl.className = "spotlight-status";
  statusEl.textContent = "";
  statusEl.setAttribute("role", "status");
  inputWrapper.appendChild(statusEl);

  historyAssistantEnabled = isHistoryAssistantFeatureEnabled();
  historyAssistantContainerEl = document.createElement("div");
  historyAssistantContainerEl.className = "spotlight-history-assistant";
  historyAssistantContainerEl.setAttribute("aria-hidden", "true");
  historyAssistantContainerEl.setAttribute("aria-busy", "false");
  if (!historyAssistantEnabled) {
    historyAssistantContainerEl.classList.add("feature-disabled");
  }

  historyAssistantFormEl = document.createElement("form");
  historyAssistantFormEl.className = "spotlight-history-assistant-form";
  historyAssistantFormEl.addEventListener("submit", handleHistoryAssistantSubmit);

  historyAssistantInputEl = document.createElement("input");
  historyAssistantInputEl.type = "text";
  historyAssistantInputEl.className = "spotlight-history-assistant-input";
  historyAssistantInputEl.setAttribute("placeholder", "Ask about your browsing history…");
  historyAssistantInputEl.setAttribute("spellcheck", "false");
  historyAssistantInputEl.disabled = !historyAssistantEnabled;

  historyAssistantSubmitEl = document.createElement("button");
  historyAssistantSubmitEl.type = "submit";
  historyAssistantSubmitEl.className = "spotlight-history-assistant-submit";
  historyAssistantSubmitEl.textContent = "Ask";
  historyAssistantSubmitEl.disabled = !historyAssistantEnabled;

  historyAssistantFormEl.appendChild(historyAssistantInputEl);
  historyAssistantFormEl.appendChild(historyAssistantSubmitEl);
  historyAssistantContainerEl.appendChild(historyAssistantFormEl);

  historyAssistantMessageEl = document.createElement("div");
  historyAssistantMessageEl.className = "spotlight-history-assistant-message";
  historyAssistantMessageEl.setAttribute("role", "status");
  historyAssistantContainerEl.appendChild(historyAssistantMessageEl);

  historyAssistantSummaryEl = document.createElement("div");
  historyAssistantSummaryEl.className = "spotlight-history-assistant-summary";
  historyAssistantContainerEl.appendChild(historyAssistantSummaryEl);

  inputWrapper.appendChild(historyAssistantContainerEl);

  if (!historyAssistantEnabled) {
    setHistoryAssistantMessage("Smart history assistant is disabled.", { error: true });
  }

  resultsEl = document.createElement("ul");
  resultsEl.className = "spotlight-results";
  resultsEl.setAttribute("role", "listbox");
  resultsEl.id = RESULTS_LIST_ID;
  inputEl.setAttribute("aria-controls", RESULTS_LIST_ID);
  lazyList.attach(resultsEl);
  resultsEl.addEventListener("pointermove", handleResultsPointerMove);

  containerEl.appendChild(inputWrapper);
  containerEl.appendChild(resultsEl);
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

function resetEngineMenuState() {
  engineMenuOptions = [];
  engineMenuVisible = false;
  engineMenuActiveIndex = -1;
  engineMenuAnchor = null;
  if (engineMenuEl) {
    engineMenuEl.innerHTML = "";
    engineMenuEl.classList.remove("visible");
    engineMenuEl.setAttribute("aria-hidden", "true");
    engineMenuEl.removeAttribute("aria-activedescendant");
  }
}

function extractEngineSegment(value, caretIndex) {
  if (typeof value !== "string") {
    return null;
  }
  const caret = typeof caretIndex === "number" ? caretIndex : value.length;
  if (caret < 0) {
    return null;
  }
  const beforeCaret = value.slice(0, caret);
  const afterCaret = value.slice(caret);
  if (afterCaret.trim()) {
    return null;
  }
  const dashIndex = beforeCaret.lastIndexOf("-");
  if (dashIndex === -1) {
    return null;
  }
  const prefix = beforeCaret.slice(0, dashIndex);
  if (prefix.includes("\n")) {
    return null;
  }
  if (prefix) {
    const preceding = prefix[prefix.length - 1];
    if (preceding && !/\s/.test(preceding)) {
      return null;
    }
  }
  const trailing = beforeCaret.slice(dashIndex + 1);
  if (trailing.includes("\n") || trailing.includes(" ")) {
    if (trailing.trim()) {
      return null;
    }
  }
  return {
    start: dashIndex,
    caret,
    filter: trailing.trim(),
    baseValue: value.slice(0, dashIndex),
  };
}

function renderEngineMenu() {
  if (!engineMenuEl) {
    return;
  }
  engineMenuEl.innerHTML = "";
  if (!engineMenuVisible || !engineMenuOptions.length) {
    engineMenuEl.classList.remove("visible");
    engineMenuEl.setAttribute("aria-hidden", "true");
    engineMenuEl.removeAttribute("aria-activedescendant");
    return;
  }

  engineMenuEl.classList.add("visible");
  engineMenuEl.setAttribute("aria-hidden", "false");
  engineMenuEl.removeAttribute("aria-activedescendant");

  engineMenuOptions.forEach((option, index) => {
    const optionId = `spotlight-engine-option-${option.id}`;
    const item = document.createElement("div");
    item.className = "spotlight-engine-option";
    item.id = optionId;
    item.setAttribute("role", "option");
    if (index === engineMenuActiveIndex) {
      item.classList.add("active");
      engineMenuEl.setAttribute("aria-activedescendant", optionId);
    }

    const iconWrapper = document.createElement("div");
    iconWrapper.className = "spotlight-engine-option-icon";
    iconWrapper.setAttribute("aria-hidden", "true");

    const icon = document.createElement("img");
    icon.className = "spotlight-engine-option-icon-image";
    icon.alt = "";
    icon.loading = "lazy";
    icon.decoding = "async";
    const iconUrl = option.iconUrl || "";
    if (iconUrl) {
      icon.src = iconUrl;
    } else {
      icon.src = DEFAULT_ICON_URL;
    }
    icon.addEventListener("error", () => {
      if (icon.src !== DEFAULT_ICON_URL) {
        icon.src = DEFAULT_ICON_URL;
      }
    });
    iconWrapper.appendChild(icon);
    item.appendChild(iconWrapper);

    const content = document.createElement("div");
    content.className = "spotlight-engine-option-content";

    const label = document.createElement("div");
    label.className = "spotlight-engine-option-label";
    label.textContent = option.name || option.id;
    content.appendChild(label);

    const meta = document.createElement("div");
    meta.className = "spotlight-engine-option-meta";
    if (option.domain) {
      meta.textContent = option.domain;
      meta.title = option.domain;
    } else {
      meta.textContent = "";
    }
    content.appendChild(meta);

    item.appendChild(content);

    item.addEventListener("pointerenter", () => {
      if (engineMenuActiveIndex !== index) {
        engineMenuActiveIndex = index;
        renderEngineMenu();
      }
    });

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    item.addEventListener("click", () => {
      applyEngineSelection(engineMenuOptions[index]);
    });

    engineMenuEl.appendChild(item);
  });
}

function updateEngineMenu() {
  if (!inputEl) {
    return;
  }
  const caret = typeof inputEl.selectionStart === "number" ? inputEl.selectionStart : inputEl.value.length;
  const segment = extractEngineSegment(inputEl.value, caret);
  if (!segment) {
    if (engineMenuVisible) {
      resetEngineMenuState();
      setGhostText("");
    }
    return;
  }

  const api = getWebSearchApi();
  if (!api || typeof api.filterSearchEngines !== "function") {
    resetEngineMenuState();
    return;
  }

  const options = api.filterSearchEngines(segment.filter || "");
  if (!options.length) {
    resetEngineMenuState();
    return;
  }

  engineMenuOptions = options;
  engineMenuVisible = true;
  engineMenuAnchor = segment;

  const preferredId = userSelectedWebSearchEngineId || (activeWebSearchEngine ? activeWebSearchEngine.id : null);
  const previousActiveId = engineMenuOptions[engineMenuActiveIndex]?.id || null;
  let nextIndex = previousActiveId ? engineMenuOptions.findIndex((option) => option.id === previousActiveId) : -1;
  if (nextIndex === -1 && preferredId) {
    nextIndex = engineMenuOptions.findIndex((option) => option.id === preferredId);
  }
  engineMenuActiveIndex = nextIndex >= 0 ? nextIndex : 0;

  renderEngineMenu();
  setGhostText("");
}

function getActiveEngineOption() {
  if (!engineMenuVisible || !engineMenuOptions.length) {
    return null;
  }
  return engineMenuOptions[Math.max(0, Math.min(engineMenuActiveIndex, engineMenuOptions.length - 1))] || null;
}

function moveEngineSelection(delta) {
  if (!engineMenuVisible || !engineMenuOptions.length) {
    return;
  }
  const count = engineMenuOptions.length;
  engineMenuActiveIndex = (engineMenuActiveIndex + delta + count) % count;
  renderEngineMenu();
}

function applyWebSearchPreview(rawQuery, engineIdOverride = null) {
  const trimmed = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!trimmed) {
    webSearchPreviewResult = null;
    return false;
  }
  const api = getWebSearchApi();
  if (!api || typeof api.createWebSearchResult !== "function") {
    webSearchPreviewResult = null;
    return false;
  }
  const desiredEngineId =
    typeof engineIdOverride === "string" && engineIdOverride
      ? engineIdOverride
      : getActiveWebSearchEngineId();
  if (!desiredEngineId) {
    webSearchPreviewResult = null;
    return false;
  }
  if (
    webSearchPreviewResult &&
    webSearchPreviewResult.query === trimmed &&
    webSearchPreviewResult.engineId === desiredEngineId
  ) {
    resultsState = [webSearchPreviewResult];
    lazyList.setItems(resultsState);
    activeIndex = 0;
    pointerNavigationSuspended = true;
    if (pendingQueryTimeout) {
      clearTimeout(pendingQueryTimeout);
      pendingQueryTimeout = null;
    }
    lastRequestId = 0;
    setGhostText("");
    renderResults();
    const existingEngineName =
      webSearchPreviewResult.engineName || activeWebSearchEngine?.name || "";
    if (existingEngineName) {
      setStatus(`Web search: ${existingEngineName}`, { force: true });
    } else {
      setStatus("", { force: true });
    }
    return true;
  }
  const preview = api.createWebSearchResult(trimmed, { engineId: desiredEngineId });
  if (!preview) {
    webSearchPreviewResult = null;
    return false;
  }
  if (preview.engineIconUrl && !preview.faviconUrl) {
    preview.faviconUrl = preview.engineIconUrl;
  }
  preview.preview = true;
  webSearchPreviewResult = preview;
  resultsState = [preview];
  lazyList.setItems(resultsState);
  activeIndex = 0;
  pointerNavigationSuspended = true;
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
    pendingQueryTimeout = null;
  }
  lastRequestId = 0;
  setGhostText("");
  renderResults();
  const engineName = preview.engineName || activeWebSearchEngine?.name || "";
  if (engineName) {
    setStatus(`Web search: ${engineName}`, { force: true });
  } else {
    setStatus("", { force: true });
  }
  return true;
}

function applyEngineSelection(option) {
  if (!option || !inputEl) {
    return false;
  }
  const api = getWebSearchApi();
  const engine = api && typeof api.findSearchEngine === "function" ? api.findSearchEngine(option.id) : option;
  if (!engine) {
    return false;
  }

  userSelectedWebSearchEngineId = engine.id;
  activeWebSearchEngine = engine;

  const value = inputEl.value;
  let nextValue = value;
  if (engineMenuAnchor) {
    const before = value.slice(0, engineMenuAnchor.start).replace(/\s+$/, "");
    const after = value.slice(engineMenuAnchor.caret).replace(/^\s+/, "");
    nextValue = before;
    if (nextValue) {
      nextValue = `${nextValue} `;
    }
    if (after) {
      nextValue += after;
    }
  }

  inputEl.focus({ preventScroll: true });
  inputEl.value = nextValue;
  const newCaret = nextValue.length;
  inputEl.setSelectionRange(newCaret, newCaret);
  resetEngineMenuState();
  setGhostText("");
  handleInputChange();
  return true;
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
  subfilterState = { type: null, options: [], activeId: null, hasNonAllOption: false };
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
  if (!hasNonAllOption && type !== "bookmark") {
    resetSubfilterState();
    return;
  }

  let resolvedActiveId = typeof activeId === "string" ? activeId : null;
  if (type === "history" && historyAssistantPendingSubfilterId) {
    if (sanitizedOptions.some((option) => option.id === historyAssistantPendingSubfilterId)) {
      resolvedActiveId = historyAssistantPendingSubfilterId;
    }
    historyAssistantPendingSubfilterId = null;
  } else if (type !== "history") {
    historyAssistantPendingSubfilterId = null;
  }
  if (!resolvedActiveId) {
    resolvedActiveId = sanitizedOptions.find((option) => option.id === "all") ? "all" : sanitizedOptions[0]?.id || null;
  }

  subfilterState = { type, options: sanitizedOptions, activeId: resolvedActiveId, hasNonAllOption };
  if (hasNonAllOption && resolvedActiveId && resolvedActiveId !== "all") {
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

  const control = ensureBookmarkOrganizerControl();
  const options = Array.isArray(subfilterState.options) ? subfilterState.options : [];
  const hasType = Boolean(subfilterState.type);
  const hasNonAllOption = Boolean(
    subfilterState.hasNonAllOption || options.some((option) => option && option.id && option.id !== "all")
  );
  const showOrganizerButton = Boolean(control && subfilterState.type === "bookmark");
  const shouldShow = hasType && (hasNonAllOption || showOrganizerButton);

  subfilterContainerEl.classList.toggle("visible", shouldShow);
  subfilterContainerEl.classList.toggle("has-subfilters", hasNonAllOption);
  subfilterContainerEl.classList.toggle("has-actions", showOrganizerButton && shouldShow);
  subfilterContainerEl.setAttribute("aria-hidden", shouldShow ? "false" : "true");

  if (control) {
    control.setVisible(showOrganizerButton && shouldShow);
    if (!showOrganizerButton && !bookmarkOrganizerRequestPending) {
      control.reset();
    }
  }

  subfilterScrollerEl.innerHTML = "";
  refreshBookmarkOrganizerControlState();
  if (!shouldShow || !hasNonAllOption) {
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

function ensureBookmarkOrganizerControl() {
  if (!subfilterContainerEl) {
    return null;
  }

  const api = globalThis.SpotlightBookmarkOrganizerUI;
  if (!api || typeof api.createControl !== "function") {
    return bookmarkOrganizerControl;
  }

  const control = api.createControl({
    container: subfilterContainerEl,
    onRequestOrganize: handleBookmarkOrganizeRequest,
  });

  if (control) {
    bookmarkOrganizerControl = control;
  }

  return bookmarkOrganizerControl;
}

function refreshBookmarkOrganizerControlState() {
  if (!bookmarkOrganizerControl || typeof bookmarkOrganizerControl.setEnabled !== "function") {
    return;
  }
  const containerVisible = Boolean(
    subfilterContainerEl && subfilterContainerEl.classList.contains("visible")
  );
  const isBookmarkFilter = subfilterState.type === "bookmark";
  bookmarkOrganizerControl.setEnabled(containerVisible && isBookmarkFilter && !bookmarkOrganizerRequestPending);
}

function handleBookmarkOrganizeRequest() {
  const control = ensureBookmarkOrganizerControl();
  if (!control || bookmarkOrganizerRequestPending) {
    return;
  }

  bookmarkOrganizerRequestPending = true;
  control.setRunning(true);
  refreshBookmarkOrganizerControlState();
  setStatus("Organizing bookmarks…", { force: true, sticky: true });

  chrome.runtime.sendMessage(
    { type: "SPOTLIGHT_BOOKMARK_ORGANIZE" },
    (response) => {
      bookmarkOrganizerRequestPending = false;

      if (chrome.runtime.lastError) {
        console.error("Spotlight bookmark organizer request failed", chrome.runtime.lastError);
        control.showError("Retry");
        refreshBookmarkOrganizerControlState();
        setStatus("Bookmark organizer unavailable", { force: true });
        return;
      }

      if (!response || !response.success) {
        const errorMessage = (response && response.error) || "Unable to organize bookmarks";
        control.showError("Retry");
        refreshBookmarkOrganizerControlState();
        setStatus(errorMessage, { force: true });
        return;
      }

      control.showSuccess("Organized");
      refreshBookmarkOrganizerControlState();

      const bookmarkCount = Number.isFinite(response.bookmarkCount) ? response.bookmarkCount : null;
      const renameCount = Number.isFinite(response?.changes?.renamed) ? response.changes.renamed : 0;
      const movedCount = Number.isFinite(response?.changes?.moved) ? response.changes.moved : 0;
      const folderCount = Number.isFinite(response?.changes?.createdFolders)
        ? response.changes.createdFolders
        : 0;
      const changeDetails = [];
      if (movedCount > 0) {
        changeDetails.push(`${movedCount} moved`);
      }
      if (renameCount > 0) {
        changeDetails.push(`${renameCount} renamed`);
      }
      if (folderCount > 0) {
        changeDetails.push(`${folderCount} new folder${folderCount === 1 ? "" : "s"}`);
      }
      const summary = changeDetails.length ? ` · ${changeDetails.join(" · ")}` : "";
      const statusMessage = bookmarkCount
        ? `Organized ${bookmarkCount} bookmark${bookmarkCount === 1 ? "" : "s"}${summary}`
        : `Bookmarks organized${summary}`;
      setStatus(statusMessage, { force: true });

      setTimeout(() => {
        requestResults(inputEl.value);
      }, 350);
    }
  );
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
    inputEl.focus();
    inputEl.select();
    return;
  }

  await prepareOverlay();

  if (!overlayEl || !shadowHostEl) {
    return;
  }

  isOpen = true;
  activeIndex = -1;
  resultsState = [];
  lazyList.reset();
  statusEl.textContent = "";
  statusSticky = false;
  activeFilter = null;
  resetSubfilterState();
  historyAssistantEnabled = isHistoryAssistantFeatureEnabled();
  if (historyAssistantContainerEl) {
    historyAssistantContainerEl.classList.toggle("feature-disabled", !historyAssistantEnabled);
  }
  if (historyAssistantInputEl) {
    historyAssistantInputEl.disabled = !historyAssistantEnabled;
  }
  if (historyAssistantSubmitEl) {
    historyAssistantSubmitEl.disabled = !historyAssistantEnabled;
  }
  resetHistoryAssistantContext();
  resultsEl.innerHTML = "";
  inputEl.value = "";
  setGhostText("");
  resetSlashMenuState();
  resetEngineMenuState();
  resetWebSearchSelection();
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
  updateHistoryAssistantVisibility();
}

function closeOverlay() {
  if (!isOpen) return;

  isOpen = false;
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
  resetEngineMenuState();
  resetWebSearchSelection();
  resetHistoryAssistantContext();
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
  if (slashMenuVisible && slashMenuOptions.length) {
    return;
  }
  if (engineMenuVisible && engineMenuOptions.length) {
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
  const wantsDefaultWebSearch =
    event.key === "Enter" &&
    !event.altKey &&
    !event.shiftKey &&
    ((event.metaKey && !event.ctrlKey) || (!event.metaKey && event.ctrlKey));

  if (wantsDefaultWebSearch) {
    const trimmed = typeof inputEl.value === "string" ? inputEl.value.trim() : "";
    if (trimmed) {
      const defaultEngineId = getDefaultWebSearchEngineId();
      if (triggerWebSearch(defaultEngineId)) {
        event.preventDefault();
      }
    }
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

  if (engineMenuVisible && engineMenuOptions.length) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveEngineSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      const applied = applyEngineSelection(getActiveEngineOption());
      if (applied) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetEngineMenuState();
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
    !slashMenuVisible &&
    !engineMenuVisible
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
    if (userSelectedWebSearchEngineId && value) {
      if (triggerWebSearch(userSelectedWebSearchEngineId)) {
        event.preventDefault();
      }
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
  const query = inputEl.value;
  if (historyAssistantLastQueryText && query !== historyAssistantLastQueryText) {
    clearHistoryAssistantFilters();
    historyAssistantSummaryText = "";
    setHistoryAssistantSummary("");
  }
  updateSlashMenu();
  updateEngineMenu();
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
    pendingQueryTimeout = null;
  }

  if (userSelectedWebSearchEngineId) {
    if (!trimmed) {
      webSearchPreviewResult = null;
      resultsState = [];
      lazyList.setItems(resultsState);
      if (resultsEl) {
        resultsEl.innerHTML = "";
      }
      if (inputEl) {
        inputEl.removeAttribute("aria-activedescendant");
      }
      lastRequestId = 0;
      const engineName = activeWebSearchEngine?.name || "";
      if (engineName) {
        setStatus(`Web search: ${engineName}`, { force: true });
      }
      return;
    }
    if (applyWebSearchPreview(trimmed, userSelectedWebSearchEngineId)) {
      return;
    }
  } else {
    webSearchPreviewResult = null;
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
  const engineId = getActiveWebSearchEngineId();
  if (engineId) {
    message.webSearch = { engineId };
  }
  if (historyAssistantFilters) {
    message.historyAssistant = { ...historyAssistantFilters };
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
      pruneSummaryState();
      applyCachedFavicons(resultsState);
      activeIndex = resultsState.length > 0 ? 0 : -1;
      activeFilter = typeof response.filter === "string" && response.filter ? response.filter : null;
      pointerNavigationSuspended = true;
      renderResults();
      updateSubfilterState(response.subfilters);
      if (activeFilter !== "history") {
        clearHistoryAssistantFilters();
        historyAssistantSummaryText = "";
        setHistoryAssistantSummary("");
      } else if (historyAssistantSummaryText) {
        setHistoryAssistantSummary(historyAssistantSummaryText);
      }
      updateHistoryAssistantVisibility();
      if (activeFilter === "history") {
        handleHistoryAssistantResults(resultsState);
      }

      if (response.webSearch && typeof response.webSearch.engineId === "string") {
        const api = getWebSearchApi();
        if (api && typeof api.findSearchEngine === "function") {
          const resolved = api.findSearchEngine(response.webSearch.engineId);
          if (resolved) {
            activeWebSearchEngine = resolved;
            if (userSelectedWebSearchEngineId && userSelectedWebSearchEngineId !== resolved.id) {
              userSelectedWebSearchEngineId = resolved.id;
            }
          }
        }
      } else if (!userSelectedWebSearchEngineId) {
        const api = getWebSearchApi();
        if (api && typeof api.getDefaultSearchEngine === "function") {
          activeWebSearchEngine = api.getDefaultSearchEngine();
        }
      }

      const trimmed = inputEl.value.trim();
      if (trimmed === "> reindex") {
        setGhostText("");
        return;
      }

      const ghost = response.ghost && typeof response.ghost.text === "string" ? response.ghost.text : "";
      const answer = typeof response.answer === "string" ? response.answer : "";
      setGhostText(slashMenuVisible || engineMenuVisible ? "" : ghost);
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
      const engineStatusLabel = formatWebSearchStatus(response.webSearch);
      if (engineStatusLabel) {
        statusMessage = statusMessage ? `${statusMessage} · ${engineStatusLabel}` : engineStatusLabel;
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

function triggerWebSearch(engineIdOverride = null) {
  if (!inputEl) {
    return false;
  }
  const query = typeof inputEl.value === "string" ? inputEl.value.trim() : "";
  if (!query) {
    return false;
  }
  const api = getWebSearchApi();
  const desiredEngineId =
    (typeof engineIdOverride === "string" && engineIdOverride) || getActiveWebSearchEngineId();
  if (api && typeof api.createWebSearchResult === "function") {
    const result = api.createWebSearchResult(query, { engineId: desiredEngineId });
    if (result) {
      if (result.engineIconUrl && !result.faviconUrl) {
        result.faviconUrl = result.engineIconUrl;
      }
      openResult(result);
      return true;
    }
  }
  const payload = { type: "webSearch", query };
  if (desiredEngineId) {
    payload.engineId = desiredEngineId;
  }
  openResult(payload);
  return true;
}

function openResult(result) {
  if (!result) return;
  if (result.type === "command") {
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
  if (result.type === "webSearch") {
    const payload = {
      type: "SPOTLIGHT_WEB_SEARCH",
      query:
        typeof result.query === "string" && result.query
          ? result.query
          : inputEl && typeof inputEl.value === "string"
          ? inputEl.value.trim()
          : "",
    };
    if (result.engineId) {
      payload.engineId = result.engineId;
    }
    if (result.url) {
      payload.url = result.url;
    }
    chrome.runtime.sendMessage(payload, () => {
      if (chrome.runtime.lastError) {
        console.warn("Spotlight web search error", chrome.runtime.lastError);
      }
    });
    closeOverlay();
    return;
  }
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_OPEN", itemId: result.id });
  closeOverlay();
}

function shouldSummarizeResult(result) {
  if (!result || typeof result !== "object") {
    return false;
  }
  const type = typeof result.type === "string" ? result.type : "";
  const url = typeof result.url === "string" ? result.url : "";
  if (!type || !url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith("chrome://") || lower.startsWith("chrome-extension://")) {
    return false;
  }

  const isHttp = /^https?:/.test(lower);
  const isFile = lower.startsWith("file://");

  if (type === "tab") {
    if (!isHttp && !isFile) {
      return false;
    }
    if (typeof result.tabId !== "number" || Number.isNaN(result.tabId)) {
      return false;
    }
    return true;
  }

  if (type === "bookmark" || type === "history") {
    return isHttp;
  }

  return false;
}

function pruneSummaryState(limit = TAB_SUMMARY_CACHE_LIMIT) {
  if (tabSummaryState.size <= limit) {
    return;
  }
  const entries = Array.from(tabSummaryState.entries());
  entries.sort((a, b) => {
    const aTime = a[1]?.lastUsed || 0;
    const bTime = b[1]?.lastUsed || 0;
    return aTime - bTime;
  });
  const removed = [];
  while (tabSummaryState.size > limit && entries.length) {
    const [key] = entries.shift();
    if (tabSummaryState.has(key)) {
      tabSummaryState.delete(key);
      removed.push(key);
    }
  }
  removed.forEach((url) => {
    updateSummaryUIForUrl(url);
  });
}

function updateSummaryButtonElement(button, entry) {
  if (!button) {
    return;
  }
  button.disabled = false;
  button.classList.remove("loading");
  button.removeAttribute("aria-busy");
  button.removeAttribute("title");
  if (!entry) {
    button.textContent = "Summarize";
    return;
  }
  if (entry.status === "loading") {
    button.textContent = "Summarizing…";
    button.disabled = true;
    button.classList.add("loading");
    button.setAttribute("aria-busy", "true");
    return;
  }
  if (entry.status === "ready") {
    button.textContent = "Refresh summary";
    if (entry.cached) {
      button.title = "Summary cached from an earlier request";
    }
    return;
  }
  if (entry.status === "error") {
    button.textContent = "Try again";
    if (entry.error) {
      button.title = entry.error;
    }
    return;
  }
  button.textContent = "Summarize";
}

function renderSummaryPanelForElement(item, url, entry) {
  if (!item || !url) {
    return;
  }
  const body = item.querySelector(".spotlight-result-content");
  if (!body) {
    return;
  }
  const existingPanel = body.querySelector(`.${TAB_SUMMARY_PANEL_CLASS}`);
  if (existingPanel) {
    existingPanel.remove();
  }
  if (!entry || !entry.status) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = TAB_SUMMARY_PANEL_CLASS;
  panel.dataset.url = url;

  const header = document.createElement("div");
  header.className = "spotlight-ai-panel-header";
  const title = document.createElement("span");
  title.className = "spotlight-ai-panel-title";
  title.textContent = "Tab Digest";
  header.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "spotlight-ai-panel-controls";
  let hasControls = false;

  if (entry.cached) {
    const badge = document.createElement("span");
    badge.className = TAB_SUMMARY_BADGE_CLASS;
    badge.textContent = "Cached";
    controls.appendChild(badge);
    hasControls = true;
  }

  const canCopy =
    entry.status === "ready" &&
    (Array.isArray(entry.bullets) ? entry.bullets.length > 0 : Boolean(entry.raw));
  if (canCopy) {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = TAB_SUMMARY_COPY_CLASS;
    copyButton.textContent = "Copy";
    copyButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    copyButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleSummaryCopy(url);
    });
    controls.appendChild(copyButton);
    hasControls = true;
  }

  if (hasControls) {
    header.appendChild(controls);
  }

  panel.appendChild(header);

  if (entry.status === "loading") {
    if (Array.isArray(entry.bullets) && entry.bullets.length) {
      const list = document.createElement("ul");
      list.className = `${TAB_SUMMARY_LIST_CLASS} loading`;
      entry.bullets.slice(0, 3).forEach((bullet) => {
        const itemEl = document.createElement("li");
        itemEl.textContent = bullet;
        list.appendChild(itemEl);
      });
      panel.appendChild(list);
    } else if (entry.raw) {
      const preview = document.createElement("div");
      preview.className = `${TAB_SUMMARY_STATUS_CLASS} loading-preview`;
      preview.textContent = entry.raw;
      panel.appendChild(preview);
    }
    const status = document.createElement("div");
    status.className = `${TAB_SUMMARY_STATUS_CLASS} loading`;
    status.textContent = "Summarizing…";
    panel.appendChild(status);
  } else if (entry.status === "error") {
    const status = document.createElement("div");
    status.className = `${TAB_SUMMARY_STATUS_CLASS} error`;
    status.textContent = entry.error || "Summary unavailable";
    panel.appendChild(status);
  } else if (entry.status === "ready") {
    if (Array.isArray(entry.bullets) && entry.bullets.length) {
      const list = document.createElement("ul");
      list.className = TAB_SUMMARY_LIST_CLASS;
      entry.bullets.slice(0, 3).forEach((bullet) => {
        const itemEl = document.createElement("li");
        itemEl.textContent = bullet;
        list.appendChild(itemEl);
      });
      panel.appendChild(list);
    } else if (entry.raw) {
      const fallback = document.createElement("div");
      fallback.className = TAB_SUMMARY_STATUS_CLASS;
      fallback.textContent = entry.raw;
      panel.appendChild(fallback);
    } else {
      const empty = document.createElement("div");
      empty.className = `${TAB_SUMMARY_STATUS_CLASS} empty`;
      empty.textContent = "No summary available.";
      panel.appendChild(empty);
    }
  } else {
    const status = document.createElement("div");
    status.className = `${TAB_SUMMARY_STATUS_CLASS} loading`;
    status.textContent = "Preparing summary…";
    panel.appendChild(status);
  }

  entry.lastUsed = Date.now();
  body.appendChild(panel);
}

function updateSummaryUIForUrl(url) {
  if (!resultsEl || !url) {
    return;
  }
  const entry = tabSummaryState.get(url);
  const items = resultsEl.querySelectorAll("li.spotlight-result");
  items.forEach((item) => {
    if (!item || !item.dataset || item.dataset.url !== url) {
      return;
    }
    const button = item.querySelector(`.${TAB_SUMMARY_BUTTON_CLASS}`);
    if (button) {
      updateSummaryButtonElement(button, entry);
    }
    renderSummaryPanelForElement(item, url, entry);
  });
}

function buildSummaryCopyText(entry) {
  if (!entry) {
    return "";
  }
  if (Array.isArray(entry.bullets) && entry.bullets.length) {
    return entry.bullets.map((bullet) => `• ${bullet}`).join("\n");
  }
  if (typeof entry.raw === "string" && entry.raw) {
    return entry.raw;
  }
  return "";
}

function handleSummaryCopy(url) {
  if (!url) {
    return;
  }
  const entry = tabSummaryState.get(url);
  if (!entry || entry.status !== "ready") {
    return;
  }
  entry.lastUsed = Date.now();
  const text = buildSummaryCopyText(entry);
  if (!text) {
    setStatus("No summary available", { force: true });
    return;
  }
  const onSuccess = () => {
    setStatus("Summary copied to clipboard", { force: true });
  };
  const onError = (error) => {
    console.warn("Spotlight: failed to copy summary", error);
    setStatus("Unable to copy summary", { force: true });
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
    return;
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    onSuccess();
  } catch (err) {
    onError(err);
  }
}

function handleSummaryProgress(message) {
  if (!message || typeof message.url !== "string") {
    return;
  }
  const url = message.url;
  const entry = tabSummaryState.get(url);
  if (!entry) {
    return;
  }
  if (
    typeof message.requestId === "number" &&
    Number.isFinite(message.requestId) &&
    typeof entry.requestId === "number" &&
    entry.requestId !== message.requestId
  ) {
    return;
  }
  const now = Date.now();
  if (Array.isArray(message.bullets)) {
    entry.bullets = message.bullets.filter(Boolean).slice(0, 3);
  }
  if (typeof message.raw === "string") {
    entry.raw = message.raw.trim();
  }
  if (typeof message.source === "string") {
    entry.source = message.source;
  }
  if (typeof message.cached === "boolean") {
    entry.cached = message.cached;
  }
  if (message.done) {
    entry.status = "ready";
    entry.error = "";
  } else if (entry.status !== "error") {
    entry.status = "loading";
    entry.error = "";
  }
  entry.lastUsed = now;
  tabSummaryState.set(url, entry);
  pruneSummaryState();
  updateSummaryUIForUrl(url);
}

function requestSummaryForResult(result, options = {}) {
  if (!shouldSummarizeResult(result)) {
    return;
  }
  const url = typeof result.url === "string" ? result.url : "";
  if (!url) {
    return;
  }
  const { forceRefresh = false } = options || {};
  const now = Date.now();
  const existing = tabSummaryState.get(url);
  if (!forceRefresh && existing && (existing.status === "loading" || existing.status === "ready")) {
    updateSummaryUIForUrl(url);
    return;
  }
  if (existing) {
    existing.lastUsed = now;
  }
  const requestId = ++tabSummaryRequestCounter;
  const entry = {
    status: "loading",
    requestId,
    bullets: Array.isArray(existing?.bullets) ? existing.bullets.slice() : [],
    raw: typeof existing?.raw === "string" ? existing.raw : "",
    error: "",
    cached: Boolean(existing?.cached),
    source: typeof existing?.source === "string" ? existing.source : "",
    lastUsed: now,
  };
  tabSummaryState.set(url, entry);
  pruneSummaryState();
  updateSummaryUIForUrl(url);
  const payload = {
    type: "SPOTLIGHT_SUMMARIZE",
    url,
    summaryRequestId: requestId,
  };
  if (typeof result.tabId === "number" && !Number.isNaN(result.tabId)) {
    payload.tabId = result.tabId;
  }
  try {
    chrome.runtime.sendMessage(payload, (response) => {
      const current = tabSummaryState.get(url);
      if (!current || current.requestId !== requestId) {
        if (response && response.success) {
          tabSummaryState.set(url, {
            status: "ready",
            requestId,
            bullets: Array.isArray(response.bullets) ? response.bullets.filter(Boolean) : [],
            raw: typeof response.raw === "string" ? response.raw : "",
            error: "",
            cached: Boolean(response.cached),
            source: typeof response.source === "string" ? response.source : "",
            lastUsed: Date.now(),
          });
          pruneSummaryState();
          updateSummaryUIForUrl(url);
        }
        return;
      }
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMessage =
          (response && response.error) ||
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          "Summary unavailable";
        current.status = "error";
        current.error = errorMessage;
        current.cached = false;
        current.lastUsed = Date.now();
        tabSummaryState.set(url, current);
        pruneSummaryState();
        updateSummaryUIForUrl(url);
        return;
      }
      current.status = "ready";
      current.bullets = Array.isArray(response.bullets) ? response.bullets.filter(Boolean) : [];
      current.raw = typeof response.raw === "string" ? response.raw : "";
      current.error = "";
      current.cached = Boolean(response.cached);
      current.source = typeof response.source === "string" ? response.source : "";
      current.lastUsed = Date.now();
      tabSummaryState.set(url, current);
      pruneSummaryState();
      updateSummaryUIForUrl(url);
    });
  } catch (err) {
    const current = tabSummaryState.get(url);
    if (!current || current.requestId !== requestId) {
      return;
    }
    current.status = "error";
    current.error = err?.message || "Summary unavailable";
    current.cached = false;
    current.lastUsed = Date.now();
    tabSummaryState.set(url, current);
    pruneSummaryState();
    updateSummaryUIForUrl(url);
  }
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

  if (userSelectedWebSearchEngineId && (!inputEl || !inputEl.value.trim())) {
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
    const resultUrl = typeof result.url === "string" ? result.url : "";
    if (resultUrl) {
      li.dataset.url = resultUrl;
    } else {
      delete li.dataset.url;
    }

    const iconEl = createIconElement(result);
    if (iconEl) {
      li.appendChild(iconEl);
    }

    const body = document.createElement("div");
    body.className = "spotlight-result-content";

    const isWebSearch = result.type === "webSearch";
    if (isWebSearch) {
      li.classList.add("spotlight-result-web-search");
    }
    const canSummarize = shouldSummarizeResult(result);

    const title = document.createElement("div");
    title.className = "spotlight-result-title";
    let titleText = result.title || result.url || "";
    if (isWebSearch && typeof result.query === "string" && result.query) {
      titleText = result.query;
    }
    title.textContent = titleText;

    const meta = document.createElement("div");
    meta.className = "spotlight-result-meta";
    if (isWebSearch) {
      meta.classList.add("spotlight-result-meta-web-search");
    }

    const url = document.createElement("span");
    url.className = "spotlight-result-url";

    if (isWebSearch) {
      const engineLabel =
        (typeof result.engineLabel === "string" && result.engineLabel) ||
        (typeof result.engineName === "string" && result.engineName) ||
        (typeof result.description === "string" && result.description) ||
        (typeof result.engineDomain === "string" && result.engineDomain) ||
        "";
      if (engineLabel) {
        url.textContent = engineLabel;
        url.title = engineLabel;
        meta.appendChild(url);
      }
    } else {
      const descriptionText = result.description || result.url || "";
      if (descriptionText) {
        url.textContent = descriptionText;
        url.title = descriptionText;
      } else {
        url.textContent = "";
      }
      meta.appendChild(url);

      const timestampLabel = formatResultTimestamp(result);

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

      const type = document.createElement("span");
      type.className = `spotlight-result-type type-${result.type}`;
      type.textContent = formatTypeLabel(result.type, result);
      meta.appendChild(type);

      if (canSummarize && resultUrl) {
        const summaryButton = document.createElement("button");
        summaryButton.type = "button";
        summaryButton.className = TAB_SUMMARY_BUTTON_CLASS;
        summaryButton.textContent = "Summarize";
        summaryButton.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        summaryButton.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        summaryButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const entry = tabSummaryState.get(resultUrl);
          const forceRefresh = Boolean(entry && entry.status === "ready");
          requestSummaryForResult(result, { forceRefresh });
        });
        const entry = tabSummaryState.get(resultUrl);
        updateSummaryButtonElement(summaryButton, entry);
        meta.appendChild(summaryButton);
      }
    }

    body.appendChild(title);
    body.appendChild(meta);
    li.appendChild(body);

    if (canSummarize && resultUrl) {
      const entry = tabSummaryState.get(resultUrl);
      renderSummaryPanelForElement(li, resultUrl, entry);
    }

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

function formatWebSearchStatus(info) {
  const engine = activeWebSearchEngine;
  if (!engine) {
    return "";
  }
  const engineName = info && typeof info.engineName === "string" && info.engineName ? info.engineName : engine.name;
  if (!engineName) {
    return "";
  }
  if (info && info.fallback) {
    return `Web search · ${engineName}`;
  }
  if (userSelectedWebSearchEngineId) {
    return `Web search: ${engineName}`;
  }
  return "";
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
    case "webSearch":
      if (result && result.engineName) {
        return `Web · ${result.engineName}`;
      }
      return "Web Search";
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

function collectPageTextForSummary() {
  try {
    let text = "";
    if (document.body) {
      text = document.body.innerText || document.body.textContent || "";
    } else if (document.documentElement) {
      text = document.documentElement.innerText || document.documentElement.textContent || "";
    }
    let normalized = (text || "").replace(/\u00a0/g, " ");
    normalized = normalized.replace(/\r\n?/g, "\n");
    normalized = normalized.replace(/\s+\n/g, "\n");
    normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();
    if (normalized.length > 24000) {
      normalized = normalized.slice(0, 24000);
    }
    const href = typeof window.location === "object" && typeof window.location.href === "string"
      ? window.location.href
      : "";
    return {
      success: Boolean(normalized),
      text: normalized,
      title: document.title || "",
      lastModified: typeof document.lastModified === "string" ? document.lastModified : "",
      url: href,
    };
  } catch (err) {
    return { success: false, error: err?.message || "Unable to read page" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }
  if (message.type === "SPOTLIGHT_TOGGLE") {
    if (isOpen) {
      closeOverlay();
    } else {
      void openOverlay();
    }
    return undefined;
  }
  if (message.type === "SPOTLIGHT_SUMMARY_PROGRESS") {
    handleSummaryProgress(message);
    return undefined;
  }
  if (message.type === "SPOTLIGHT_PAGE_TEXT_REQUEST") {
    setTimeout(() => {
      const payload = collectPageTextForSummary();
      try {
        sendResponse(payload);
      } catch (err) {
        console.warn("Spotlight: failed to respond with page text", err);
      }
    }, 0);
    return true;
  }
  return undefined;
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
