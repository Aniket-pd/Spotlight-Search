const OVERLAY_ID = "spotlight-overlay";
const RESULTS_LIST_ID = "spotlight-results-list";
const RESULT_OPTION_ID_PREFIX = "spotlight-option-";
const LAZY_INITIAL_BATCH = 30;
const LAZY_BATCH_SIZE = 24;
const LAZY_LOAD_THRESHOLD = 160;
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

const DOWNLOAD_PORT_NAME = "downloads-stream";
const DOWNLOAD_UPDATE_INTERVAL = 180;
const DOWNLOAD_ICON_URL = chrome.runtime.getURL("icons/download.svg");

const downloadState = new Map();
const downloadDomRefs = new Map();
const downloadUpdateQueue = new Map();
let downloadFlushTimer = null;
let downloadsPort = null;

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
    id: "slash-download",
    label: "Downloads",
    hint: "Monitor recent downloads",
    value: "download:",
    keywords: ["download", "downloads", "files", "d"],
  },
  {
    id: "slash-history",
    label: "History",
    hint: "Browse recent history",
    value: "history:",
    keywords: ["history", "hist", "recent", "visited"],
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
  inputEl.setAttribute("placeholder", "Search tabs, bookmarks, history… (try \"tab:\")");
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

function mergeDownloadPayload(download = {}, metrics = {}) {
  const merged = { ...download };
  if (typeof metrics.progress === "number" && Number.isFinite(metrics.progress)) {
    merged.progress = metrics.progress;
  }
  if (typeof metrics.speed === "number" && Number.isFinite(metrics.speed)) {
    merged.speed = metrics.speed;
  }
  if (typeof metrics.eta === "number" && Number.isFinite(metrics.eta)) {
    merged.eta = metrics.eta;
  } else if (metrics.eta === null) {
    merged.eta = null;
  }
  return merged;
}

function queueDownloadUpdate(message) {
  if (!message || !message.download) {
    return;
  }
  const downloadId = message.download.downloadId;
  if (typeof downloadId !== "number") {
    return;
  }
  downloadUpdateQueue.set(downloadId, message);
  if (!downloadFlushTimer) {
    downloadFlushTimer = setTimeout(() => {
      downloadFlushTimer = null;
      const pending = Array.from(downloadUpdateQueue.values());
      downloadUpdateQueue.clear();
      pending.forEach((update) => {
        applyDownloadUpdate(update);
      });
    }, DOWNLOAD_UPDATE_INTERVAL);
  }
}

function handleDownloadRemoved(downloadId) {
  if (typeof downloadId !== "number") {
    return;
  }
  downloadState.delete(downloadId);
  resultsState.forEach((result) => {
    if (result && result.type === "download" && result.downloadId === downloadId) {
      result.exists = false;
      if (result.state !== "complete") {
        result.state = "interrupted";
      }
      result.progress = null;
      result.speed = 0;
      result.eta = null;
    }
  });
  updateDownloadRow(downloadId);
}

function handleDownloadPortMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "download-snapshot" && Array.isArray(message.downloads)) {
    message.downloads.forEach((entry) => {
      if (!entry || !entry.download || typeof entry.download.downloadId !== "number") {
        return;
      }
      const merged = mergeDownloadPayload(entry.download, entry.metrics || {});
      merged.timestamp = entry.timestamp || Date.now();
      downloadState.set(entry.download.downloadId, merged);
    });
    applyDownloadStateToResults();
    syncDownloadDom();
    return;
  }
  if (message.type === "download-update") {
    queueDownloadUpdate(message);
    return;
  }
  if (message.type === "download-removed") {
    handleDownloadRemoved(message.downloadId);
  }
}

function connectDownloadStream() {
  if (downloadsPort) {
    return;
  }
  try {
    downloadsPort = chrome.runtime.connect({ name: DOWNLOAD_PORT_NAME });
  } catch (err) {
    console.warn("Spotlight: unable to connect to downloads stream", err);
    return;
  }
  downloadsPort.onMessage.addListener(handleDownloadPortMessage);
  downloadsPort.onDisconnect.addListener(() => {
    downloadsPort = null;
  });
}

function disconnectDownloadStream() {
  if (downloadFlushTimer) {
    clearTimeout(downloadFlushTimer);
    downloadFlushTimer = null;
  }
  downloadUpdateQueue.clear();
  if (downloadsPort) {
    try {
      downloadsPort.disconnect();
    } catch (err) {
      // ignore
    }
    downloadsPort = null;
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

  connectDownloadStream();

  isOpen = true;
  activeIndex = -1;
  resultsState = [];
  lazyList.reset();
  statusEl.textContent = "";
  statusSticky = false;
  activeFilter = null;
  resetSubfilterState();
  resultsEl.innerHTML = "";
  downloadDomRefs.clear();
  inputEl.value = "";
  setGhostText("");
  resetSlashMenuState();

  bodyOverflowBackup = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  document.body.appendChild(overlayEl);
  requestResults("");
  setTimeout(() => {
    inputEl.focus({ preventScroll: true });
    inputEl.select();
  }, 10);
}

function closeOverlay() {
  if (!isOpen) return;

  isOpen = false;
  disconnectDownloadStream();
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
  resultsState = [];
  lazyList.reset();
  downloadDomRefs.clear();
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
    lazyList.reset();
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
      resultsState = Array.isArray(response.results) ? response.results.slice() : [];
      applyDownloadStateToResults();
      lazyList.setItems(resultsState);
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
  const expanded = lazyList.ensureVisible(activeIndex);
  if (!expanded) {
    updateActiveResult();
  }
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
    const urlLabel = formatResultUrlText(result);
    if (urlLabel) {
      url.textContent = urlLabel;
      url.title = urlLabel;
    } else {
      url.textContent = "";
      url.removeAttribute("title");
    }

    const timestampLabel = formatResultTimestamp(result);

    const type = document.createElement("span");
    type.className = `spotlight-result-type type-${result.type}`;
    type.textContent = formatTypeLabel(result.type, result);

    meta.appendChild(url);
    if (timestampLabel) {
      const timestampEl = document.createElement("span");
      timestampEl.className = "spotlight-result-timestamp";
      timestampEl.textContent = timestampLabel;
      timestampEl.title = timestampLabel;
      meta.appendChild(timestampEl);
    }
    meta.appendChild(type);

    body.appendChild(title);
    body.appendChild(meta);
    li.appendChild(body);

    if (result.type === "download" && typeof result.downloadId === "number") {
      li.classList.add("spotlight-result-download");
      const extras = createDownloadDetails(result);
      body.appendChild(extras.container);
      downloadDomRefs.set(result.downloadId, {
        index: displayIndex,
        li,
        progressBar: extras.progressBar,
        progressWrapper: extras.progressWrapper,
        statusLabel: extras.statusLabel,
        metricsLabel: extras.metricsLabel,
        actionsContainer: extras.actionsContainer,
        urlEl: url,
      });
      applyDownloadStateToDom(result.downloadId);
    }

    li.addEventListener("pointerover", () => {
      if (activeIndex !== displayIndex) {
        activeIndex = displayIndex;
        if (!lazyList.ensureVisible(activeIndex)) {
          updateActiveResult();
        }
      }
    });

    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    li.addEventListener("click", (event) => {
      if (event.target && event.target.closest && event.target.closest(".spotlight-download-action")) {
        return;
      }
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
    result.endTime,
    result.startTime,
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

function formatResultUrlText(result) {
  if (!result || typeof result !== "object") {
    return "";
  }
  if (result.type === "download") {
    if (result.filePath) {
      return result.filePath;
    }
    if (result.folderPath) {
      return result.folderPath;
    }
    if (result.sourceUrl) {
      return result.sourceUrl;
    }
  }
  if (typeof result.description === "string" && result.description) {
    return result.description;
  }
  if (typeof result.url === "string" && result.url) {
    return result.url;
  }
  if (typeof result.origin === "string" && result.origin) {
    return result.origin;
  }
  return "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = unitIndex === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  const display = unitIndex === 0 ? fixed : fixed.toFixed(value >= 10 ? 0 : 1);
  return `${display} ${units[unitIndex]}`;
}

function formatDownloadSpeed(speed) {
  if (!Number.isFinite(speed) || speed <= 0) {
    return "";
  }
  return `${formatBytes(speed)}/s`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const totalSeconds = Math.ceil(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
  }
  if (minutes > 0) {
    return secs ? `${minutes}m ${secs}s left` : `${minutes}m left`;
  }
  return `${secs}s left`;
}

function formatDownloadStatus(result) {
  if (!result) {
    return "Download";
  }
  if (result.exists === false) {
    return "Removed";
  }
  switch (result.state) {
    case "complete":
      return "Completed";
    case "in_progress":
      return result.paused ? "Paused" : "Downloading";
    case "interrupted":
      return "Canceled";
    default:
      return toTitleCase(result.state || "Download");
  }
}

function buildDownloadMetricsLabel(result) {
  if (!result) {
    return "";
  }
  const parts = [];
  const received = Number.isFinite(result.bytesReceived) ? formatBytes(result.bytesReceived) : "";
  const total = Number.isFinite(result.totalBytes) && result.totalBytes > 0 ? formatBytes(result.totalBytes) : "";
  if (result.state === "complete") {
    if (total) {
      parts.push(total);
    } else if (received) {
      parts.push(received);
    }
  } else if (received) {
    const sizeLabel = total ? `${received} of ${total}` : received;
    parts.push(sizeLabel);
  }
  const speedLabel = formatDownloadSpeed(result.speed);
  if (speedLabel) {
    parts.push(speedLabel);
  }
  const etaLabel = formatEta(result.eta);
  if (etaLabel) {
    parts.push(etaLabel);
  }
  return parts.join(" · ");
}

function createDownloadDetails(result) {
  const container = document.createElement("div");
  container.className = "spotlight-download-details";

  const statusRow = document.createElement("div");
  statusRow.className = "spotlight-download-status-row";

  const statusLabel = document.createElement("span");
  statusLabel.className = "spotlight-download-status";
  statusLabel.textContent = formatDownloadStatus(result);

  const metricsLabel = document.createElement("span");
  metricsLabel.className = "spotlight-download-metrics";
  metricsLabel.textContent = buildDownloadMetricsLabel(result);

  statusRow.appendChild(statusLabel);
  statusRow.appendChild(metricsLabel);

  const progressWrapper = document.createElement("div");
  progressWrapper.className = "spotlight-download-progress";
  const progressBar = document.createElement("div");
  progressBar.className = "spotlight-download-progress-bar";
  progressWrapper.appendChild(progressBar);

  const actionsContainer = document.createElement("div");
  actionsContainer.className = "spotlight-download-actions";

  container.appendChild(statusRow);
  container.appendChild(progressWrapper);
  container.appendChild(actionsContainer);

  return { container, statusLabel, metricsLabel, progressBar, progressWrapper, actionsContainer };
}

function triggerDownloadAction(downloadId, action) {
  if (typeof downloadId !== "number" || !action) {
    return;
  }
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_DOWNLOAD_ACTION", downloadId, action }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Spotlight download action error", chrome.runtime.lastError);
      return;
    }
    if (!response || !response.success) {
      const errorMessage = (response && response.error) || "Unable to update download";
      console.warn("Spotlight download action failed", errorMessage);
    }
  });
}

function updateDownloadActions(container, state) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (!state || typeof state.downloadId !== "number") {
    container.style.display = "none";
    return;
  }
  const actions = [];
  if (state.state === "in_progress") {
    if (state.paused) {
      actions.push({ label: "Resume", action: "resume" });
    } else {
      actions.push({ label: "Pause", action: "pause" });
    }
    actions.push({ label: "Cancel", action: "cancel" });
  } else if (state.state === "complete") {
    actions.push({ label: "Open", action: "open" });
    actions.push({ label: "Show in Folder", action: "show" });
  } else if (state.exists !== false) {
    actions.push({ label: "Show in Folder", action: "show" });
  }

  actions.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spotlight-download-action";
    button.textContent = entry.label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      triggerDownloadAction(state.downloadId, entry.action);
    });
    container.appendChild(button);
  });

  container.style.display = actions.length ? "" : "none";
}

function applyDownloadStateToResults() {
  if (!Array.isArray(resultsState)) {
    return;
  }
  resultsState.forEach((result) => {
    if (!result || result.type !== "download" || typeof result.downloadId !== "number") {
      return;
    }
    const state = downloadState.get(result.downloadId);
    if (state) {
      Object.assign(result, state);
    }
  });
}

function applyDownloadUpdate(message) {
  if (!message || !message.download || typeof message.download.downloadId !== "number") {
    return;
  }
  const downloadId = message.download.downloadId;
  const previous = downloadState.get(downloadId) || {};
  const mergedBase = { ...previous, ...message.download };
  const merged = mergeDownloadPayload(mergedBase, message.metrics || {});
  merged.timestamp = message.timestamp || Date.now();
  downloadState.set(downloadId, merged);
  resultsState.forEach((result) => {
    if (result && result.type === "download" && result.downloadId === downloadId) {
      Object.assign(result, merged);
    }
  });
  updateDownloadRow(downloadId);
}

function updateDownloadRow(downloadId) {
  const ref = downloadDomRefs.get(downloadId);
  if (!ref) {
    return;
  }
  const state = downloadState.get(downloadId) || resultsState[ref.index] || null;
  if (!state) {
    if (ref.actionsContainer) {
      ref.actionsContainer.style.display = "none";
    }
    if (ref.progressWrapper) {
      ref.progressWrapper.style.display = "none";
    }
    return;
  }
  if (ref.statusLabel) {
    ref.statusLabel.textContent = formatDownloadStatus(state);
  }
  if (ref.metricsLabel) {
    ref.metricsLabel.textContent = buildDownloadMetricsLabel(state);
  }
  if (ref.progressWrapper && ref.progressBar) {
    const progress = Number.isFinite(state.progress) ? Math.max(0, Math.min(1, state.progress)) : null;
    if (progress === null) {
      ref.progressWrapper.style.display = "none";
      ref.progressBar.style.width = "0%";
    } else {
      ref.progressWrapper.style.display = "";
      const percent = Math.max(0, Math.min(100, progress * 100));
      ref.progressBar.style.width = percent >= 100 ? "100%" : `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
    }
  }
  updateDownloadActions(ref.actionsContainer, state);
  if (ref.urlEl) {
    const label = formatResultUrlText(state);
    ref.urlEl.textContent = label;
    if (label) {
      ref.urlEl.title = label;
    } else {
      ref.urlEl.removeAttribute("title");
    }
  }
  if (ref.li) {
    ref.li.classList.toggle("download-state-complete", state.state === "complete");
    ref.li.classList.toggle("download-state-active", state.state === "in_progress" && !state.paused);
    ref.li.classList.toggle("download-state-paused", state.state === "in_progress" && Boolean(state.paused));
    ref.li.classList.toggle("download-state-error", state.exists === false || state.state === "interrupted");
  }
}

function syncDownloadDom() {
  downloadDomRefs.forEach((_, downloadId) => {
    updateDownloadRow(downloadId);
  });
}

function applyDownloadStateToDom(downloadId) {
  if (!downloadState.has(downloadId)) {
    const ref = downloadDomRefs.get(downloadId);
    if (ref) {
      const result = resultsState[ref.index];
      if (result && result.type === "download") {
        downloadState.set(downloadId, { ...result });
      }
    }
  }
  updateDownloadRow(downloadId);
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
  if (result && result.type === "download") {
    wrapper.classList.add("download-icon");
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
