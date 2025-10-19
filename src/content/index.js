const OVERLAY_ID = "spotlight-overlay";
const RESULTS_LIST_ID = "spotlight-results-list";
const RESULT_OPTION_ID_PREFIX = "spotlight-option-";
const RESULTS_LIMIT = 12;
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
let subfilterState = { type: null, options: [], activeId: null };
let selectedSubfilter = null;
let slashMenuEl = null;
let slashMenuOptions = [];
let slashMenuVisible = false;
let slashMenuActiveIndex = -1;

const iconCache = new Map();
const pendingIconOrigins = new Set();
let faviconQueue = [];
let faviconProcessing = false;
const DEFAULT_ICON_URL = chrome.runtime.getURL("icons/default.svg");
const DOWNLOAD_ICON_URL = chrome.runtime.getURL("icons/download.svg");
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
    hint: "Search recent downloads",
    value: "download:",
    keywords: ["download", "downloads", "d", "dl"],
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

const DOWNLOAD_REFRESH_INTERVAL = 180;
const downloadLiveData = new Map();
const downloadRowRefs = new Map();
const downloadUpdateTimers = new Map();
let downloadsPort = null;

function createOverlay() {
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
  inputEl.setAttribute(
    "placeholder",
    "Search tabs, bookmarks, history, downloads… (try \"tab:\" or \"download:\")"
  );
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

  containerEl.appendChild(inputWrapper);
  containerEl.appendChild(resultsEl);
  overlayEl.appendChild(containerEl);

  renderSubfilters();

  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) {
      closeOverlay();
    }
  });

  inputEl.addEventListener("input", handleInputChange);
  inputEl.addEventListener("keydown", handleInputKeydown);
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

function openOverlay() {
  if (isOpen) {
    inputEl.focus();
    inputEl.select();
    return;
  }

  if (!overlayEl) {
    createOverlay();
  }

  isOpen = true;
  activeIndex = -1;
  resultsState = [];
  statusEl.textContent = "";
  statusSticky = false;
  activeFilter = null;
  resetSubfilterState();
  resultsEl.innerHTML = "";
  inputEl.value = "";
  setGhostText("");
  resetSlashMenuState();

  bodyOverflowBackup = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  document.body.appendChild(overlayEl);
  connectDownloadsStream();
  requestResults("");
  setTimeout(() => {
    inputEl.focus({ preventScroll: true });
    inputEl.select();
  }, 10);
}

function closeOverlay() {
  if (!isOpen) return;

  isOpen = false;
  disconnectDownloadsStream();
  if (overlayEl && overlayEl.parentElement) {
    overlayEl.parentElement.removeChild(overlayEl);
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
  if (inputEl) {
    inputEl.removeAttribute("aria-activedescendant");
  }
  downloadRowRefs.clear();
  downloadUpdateTimers.forEach((timer) => clearTimeout(timer));
  downloadUpdateTimers.clear();
}

function handleGlobalKeydown(event) {
  if (!isOpen) return;
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
  const query = inputEl.value;
  updateSlashMenu();
  const trimmed = query.trim();
  if (trimmed === "> reindex") {
    lastRequestId = ++requestCounter;
    setStatus("Press Enter to rebuild index", { sticky: true, force: true });
    setGhostText("");
    resultsState = [];
    renderResults();
    return;
  }
  setStatus("", { force: true });
  setGhostText("");
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
      resultsState = Array.isArray(response.results) ? response.results.slice(0, RESULTS_LIMIT) : [];
      applyCachedFavicons(resultsState);
      activeIndex = resultsState.length > 0 ? 0 : -1;
      activeFilter = typeof response.filter === "string" && response.filter ? response.filter : null;
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
  updateActiveResult();
}

function updateActiveResult() {
  if (!resultsEl || !inputEl) {
    return;
  }
  const items = resultsEl.querySelectorAll("li");
  let activeItem = null;
  items.forEach((item, index) => {
    const isActive = index === activeIndex;
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
  resultsEl.innerHTML = "";
  downloadRowRefs.clear();
  downloadUpdateTimers.forEach((timer) => clearTimeout(timer));
  downloadUpdateTimers.clear();

  resultsState = resultsState.map((result) => applyLiveDownloadState(result));

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

  resultsState.forEach((result, index) => {
    const li = document.createElement("li");
    li.className = "spotlight-result";
    li.setAttribute("role", "option");
    li.id = `${RESULT_OPTION_ID_PREFIX}${index}`;
    li.dataset.resultId = String(result.id);
    const origin = result.type === "download" ? "" : getResultOrigin(result);
    if (origin) {
      li.dataset.origin = origin;
    } else {
      delete li.dataset.origin;
    }

    if (result.type === "download") {
      li.classList.add("spotlight-result-download");
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

    const type = document.createElement("span");
    type.className = `spotlight-result-type type-${result.type}`;
    type.textContent = formatTypeLabel(result.type, result);

    meta.appendChild(url);
    meta.appendChild(type);

    body.appendChild(title);
    body.appendChild(meta);

    if (result.type === "download") {
      const downloadInfo = createDownloadInfo(result);
      if (downloadInfo) {
        body.appendChild(downloadInfo);
      }
    }
    li.appendChild(body);

    li.addEventListener("pointerover", () => {
      if (activeIndex !== index) {
        activeIndex = index;
        updateActiveResult();
      }
    });

    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    li.addEventListener("click", () => {
      openResult(result);
    });

    if (result.type === "command") {
      li.classList.add("spotlight-result-command");
    }

    resultsEl.appendChild(li);
  });

  activeIndex = Math.min(activeIndex, resultsState.length - 1);
  if (activeIndex < 0 && resultsState.length > 0) {
    activeIndex = 0;
  }
  enqueueFavicons(resultsState.slice(0, RESULTS_LIMIT));
  updateActiveResult();
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
    default:
      return "";
  }
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
    case "download":
      return "Download";
    case "command":
      return (result && result.label) || "Command";
    case "navigation":
      if (result && result.direction === "forward") {
        return "Forward";
      }
      return "Back";
    default:
      return type || "";
  }
}

function scheduleIdleWork(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 500 });
  } else {
    setTimeout(callback, 32);
  }
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
  if (result?.type === "download") {
    wrapper.classList.add("spotlight-result-icon-download");
    wrapper.appendChild(createIconImage(DOWNLOAD_ICON_URL));
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
    const origin = getResultOrigin(result);
    if (!origin) return;
    if (iconCache.has(origin)) {
      const cached = iconCache.get(origin);
      result.faviconUrl = typeof cached === "string" && cached ? cached : null;
    }
  });
}

function shouldRequestFavicon(result) {
  if (!result || result.type === "command" || result.type === "download") {
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
    if (faviconUrl) {
      iconContainer.appendChild(createIconImage(faviconUrl));
      return;
    }
    const resultId = itemEl.dataset.resultId;
    const result = resultsState.find((entry) => String(entry?.id) === String(resultId));
    iconContainer.appendChild(createPlaceholderElement(result || null));
  });
}

function applyLiveDownloadState(result) {
  if (!result || result.type !== "download") {
    return result;
  }
  const live = downloadLiveData.get(result.downloadId);
  if (live) {
    Object.assign(result, live);
  }
  if (typeof result.progress !== "number") {
    const progress = computeDownloadProgress(result);
    if (progress !== null) {
      result.progress = progress;
    }
  }
  return result;
}

function connectDownloadsStream() {
  if (downloadsPort) {
    return;
  }
  try {
    downloadsPort = chrome.runtime.connect({ name: "downloads-stream" });
    downloadsPort.onMessage.addListener(handleDownloadsPortMessage);
    downloadsPort.onDisconnect.addListener(() => {
      downloadsPort = null;
    });
  } catch (err) {
    console.warn("Spotlight: unable to connect to downloads stream", err);
    downloadsPort = null;
  }
}

function disconnectDownloadsStream() {
  if (!downloadsPort) {
    return;
  }
  try {
    downloadsPort.disconnect();
  } catch (err) {
    // Ignore disconnect errors.
  }
  downloadsPort = null;
}

function handleDownloadsPortMessage(message) {
  if (!message) {
    return;
  }
  if (message.type === "downloads-snapshot" && Array.isArray(message.downloads)) {
    message.downloads.forEach((entry) => applyDownloadLiveData(entry));
    refreshVisibleDownloads();
    return;
  }
  if (message.type === "download-update" && message.download) {
    applyDownloadLiveData(message.download);
  }
}

function applyDownloadLiveData(data) {
  if (!data || typeof data.downloadId !== "number") {
    return;
  }
  const existing = downloadLiveData.get(data.downloadId) || {};
  const merged = { ...existing };
  merged.downloadId = data.downloadId;
  if (typeof data.state === "string") merged.state = data.state;
  if (typeof data.paused === "boolean") merged.paused = data.paused;
  if (typeof data.canResume === "boolean") merged.canResume = data.canResume;
  if (typeof data.bytesReceived === "number") merged.bytesReceived = data.bytesReceived;
  if (typeof data.totalBytes === "number") merged.totalBytes = data.totalBytes;
  if (typeof data.speed === "number") merged.speed = data.speed;
  if (typeof data.etaSeconds === "number") merged.etaSeconds = data.etaSeconds;
  if (typeof data.progress === "number") merged.progress = data.progress;
  if (typeof data.startTime === "number") merged.startTime = data.startTime;
  if (typeof data.endTime === "number") merged.endTime = data.endTime;
  if (typeof data.filename === "string") merged.filename = data.filename;
  if (typeof data.filePath === "string") merged.filePath = data.filePath;
  if (typeof data.url === "string") merged.url = data.url;
  if (typeof data.danger === "string") merged.danger = data.danger;
  downloadLiveData.set(data.downloadId, merged);
  updateResultsWithDownloadData(data.downloadId, merged);
}

function updateResultsWithDownloadData(downloadId, data) {
  let updated = false;
  resultsState.forEach((result) => {
    if (result && result.type === "download" && result.downloadId === downloadId) {
      Object.assign(result, data);
      if (typeof result.progress !== "number" || typeof data.progress !== "number") {
        const progress = computeDownloadProgress(result);
        if (progress !== null) {
          result.progress = progress;
        }
      }
      updated = true;
    }
  });
  if (updated) {
    scheduleDownloadRowRefresh(downloadId);
  }
}

function scheduleDownloadRowRefresh(downloadId) {
  const ref = downloadRowRefs.get(downloadId);
  if (!ref) {
    return;
  }
  if (downloadUpdateTimers.has(downloadId)) {
    return;
  }
  const timer = setTimeout(() => {
    downloadUpdateTimers.delete(downloadId);
    const result = resultsState.find(
      (entry) => entry && entry.type === "download" && entry.downloadId === downloadId
    );
    if (result && ref) {
      renderDownloadRow(ref, result);
    }
  }, DOWNLOAD_REFRESH_INTERVAL);
  downloadUpdateTimers.set(downloadId, timer);
}

function refreshVisibleDownloads() {
  downloadRowRefs.forEach((ref, downloadId) => {
    const result = resultsState.find(
      (entry) => entry && entry.type === "download" && entry.downloadId === downloadId
    );
    if (result) {
      applyLiveDownloadState(result);
      renderDownloadRow(ref, result);
    }
  });
}

function createDownloadInfo(result) {
  if (!result || result.type !== "download") {
    return null;
  }
  const info = document.createElement("div");
  info.className = "spotlight-download-info";

  const progressWrap = document.createElement("div");
  progressWrap.className = "spotlight-download-progress";
  const progressBar = document.createElement("div");
  progressBar.className = "spotlight-download-progress-bar";
  progressWrap.appendChild(progressBar);
  info.appendChild(progressWrap);

  const row = document.createElement("div");
  row.className = "spotlight-download-row";

  const stats = document.createElement("div");
  stats.className = "spotlight-download-stats";

  const statusEl = document.createElement("span");
  statusEl.className = "spotlight-download-status";
  stats.appendChild(statusEl);

  const amountEl = document.createElement("span");
  amountEl.className = "spotlight-download-amount";
  stats.appendChild(amountEl);

  const speedEl = document.createElement("span");
  speedEl.className = "spotlight-download-speed";
  stats.appendChild(speedEl);

  const etaEl = document.createElement("span");
  etaEl.className = "spotlight-download-eta";
  stats.appendChild(etaEl);

  row.appendChild(stats);

  const actions = document.createElement("div");
  actions.className = "spotlight-download-actions";
  row.appendChild(actions);

  info.appendChild(row);

  const ref = {
    infoEl: info,
    progressBar,
    statusEl,
    amountEl,
    speedEl,
    etaEl,
    actionsEl: actions,
    statsEl: stats,
  };

  renderDownloadRow(ref, result);
  if (typeof result.downloadId === "number") {
    downloadRowRefs.set(result.downloadId, ref);
  }

  return info;
}

function renderDownloadRow(ref, result) {
  if (!ref || !result) {
    return;
  }
  const progress = computeDownloadProgress(result);
  if (progress === null) {
    ref.progressBar.style.width = "18%";
    ref.progressBar.classList.add("indeterminate");
  } else {
    const percent = Math.max(0, Math.min(100, progress * 100));
    ref.progressBar.style.width = `${percent}%`;
    ref.progressBar.classList.remove("indeterminate");
  }

  const statusText = formatDownloadStatus(result);
  ref.statusEl.textContent = statusText;
  ref.statusEl.classList.remove("hidden");

  const amountText = formatDownloadAmount(result);
  if (amountText) {
    ref.amountEl.textContent = amountText;
    ref.amountEl.classList.remove("hidden");
  } else {
    ref.amountEl.textContent = "";
    ref.amountEl.classList.add("hidden");
  }

  const speedText = formatDownloadSpeed(result);
  if (speedText) {
    ref.speedEl.textContent = speedText;
    ref.speedEl.classList.remove("hidden", "muted");
  } else if (result.state === "in_progress" && !result.paused) {
    ref.speedEl.textContent = "—";
    ref.speedEl.classList.remove("hidden");
    ref.speedEl.classList.add("muted");
  } else {
    ref.speedEl.textContent = "";
    ref.speedEl.classList.add("hidden");
    ref.speedEl.classList.remove("muted");
  }

  const etaText = formatDownloadEta(result);
  if (etaText) {
    ref.etaEl.textContent = etaText;
    ref.etaEl.classList.remove("hidden", "muted");
  } else if (result.state === "in_progress" && !result.paused) {
    ref.etaEl.textContent = "—";
    ref.etaEl.classList.remove("hidden");
    ref.etaEl.classList.add("muted");
  } else {
    ref.etaEl.textContent = "";
    ref.etaEl.classList.add("hidden");
    ref.etaEl.classList.remove("muted");
  }

  updateDownloadActions(ref.actionsEl, result);
}

function updateDownloadActions(container, result) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (!result || typeof result.downloadId !== "number") {
    return;
  }

  const addAction = (label, handler) => {
    container.appendChild(createDownloadActionButton(label, handler));
  };

  if (result.state === "complete") {
    addAction("Open", () => {
      openResult(result);
    });
    addAction("Show in Folder", () => {
      requestDownloadAction(result.downloadId, "show", { close: true });
    });
    return;
  }

  if (result.state === "in_progress") {
    if (result.paused) {
      addAction("Resume", () => {
        requestDownloadAction(result.downloadId, "resume");
      });
    } else if (result.canResume) {
      addAction("Pause", () => {
        requestDownloadAction(result.downloadId, "pause");
      });
    }
    addAction("Cancel", () => {
      requestDownloadAction(result.downloadId, "cancel");
    });
    addAction("Show in Folder", () => {
      requestDownloadAction(result.downloadId, "show", { close: true });
    });
    return;
  }

  addAction("Show in Folder", () => {
    requestDownloadAction(result.downloadId, "show", { close: true });
  });
}

function createDownloadActionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "spotlight-download-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
  return button;
}

function requestDownloadAction(downloadId, action, options = {}) {
  chrome.runtime.sendMessage(
    { type: "SPOTLIGHT_DOWNLOAD_ACTION", downloadId, action },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("Spotlight download action error", chrome.runtime.lastError);
      }
      if (options && options.close) {
        closeOverlay();
      }
    }
  );
}

function computeDownloadProgress(result) {
  if (!result || result.type !== "download") {
    return null;
  }
  if (typeof result.progress === "number") {
    return Math.max(0, Math.min(1, result.progress));
  }
  const total = typeof result.totalBytes === "number" ? result.totalBytes : 0;
  if (total > 0) {
    const received = typeof result.bytesReceived === "number" ? result.bytesReceived : 0;
    return Math.max(0, Math.min(1, received / total));
  }
  return null;
}

function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[exponent]}`;
}

function formatDownloadAmount(result) {
  const received = typeof result.bytesReceived === "number" ? result.bytesReceived : 0;
  const total = typeof result.totalBytes === "number" ? result.totalBytes : 0;
  if (total > 0) {
    return `${formatBytes(received)} of ${formatBytes(total)}`;
  }
  if (received > 0) {
    return formatBytes(received);
  }
  return "";
}

function formatDownloadSpeed(result) {
  const speed = typeof result.speed === "number" ? result.speed : 0;
  if (speed > 0) {
    return `${formatBytes(speed)}/s`;
  }
  return "";
}

function formatDownloadEta(result) {
  if (!result || result.state !== "in_progress") {
    return "";
  }
  if (result.paused) {
    return "";
  }
  const eta = typeof result.etaSeconds === "number" ? result.etaSeconds : null;
  if (eta === 0) {
    return "Done";
  }
  if (eta && eta > 0 && Number.isFinite(eta)) {
    return `${formatDuration(eta)} left`;
  }
  return "";
}

function formatDuration(seconds) {
  const total = Math.ceil(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }
  if (minutes > 0) {
    if (secs > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${minutes}m`;
  }
  return `${secs}s`;
}

function formatDownloadStatus(result) {
  if (!result || result.type !== "download") {
    return "Download";
  }
  if (result.state === "complete") {
    return "Completed";
  }
  if (result.state === "interrupted") {
    return "Interrupted";
  }
  if (result.state === "in_progress") {
    return result.paused ? "Paused" : "In Progress";
  }
  return "Download";
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SPOTLIGHT_TOGGLE") {
    return;
  }
  if (isOpen) {
    closeOverlay();
  } else {
    openOverlay();
  }
});
