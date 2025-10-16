const OVERLAY_ID = "spotlight-overlay";
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
let footerEl = null;

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
  inputEl = document.createElement("input");
  inputEl.className = "spotlight-input";
  inputEl.type = "text";
  inputEl.setAttribute("placeholder", "Search tabs, bookmarks, history...");
  inputEl.setAttribute("spellcheck", "false");
  inputWrapper.appendChild(inputEl);

  statusEl = document.createElement("div");
  statusEl.className = "spotlight-status";
  statusEl.textContent = "";
  inputWrapper.appendChild(statusEl);

  resultsEl = document.createElement("ul");
  resultsEl.className = "spotlight-results";
  resultsEl.setAttribute("role", "listbox");

  footerEl = document.createElement("div");
  footerEl.className = "spotlight-footer";
  footerEl.setAttribute("aria-hidden", "true");
  footerEl.innerHTML = [
    '<span class="shortcut">↑↓</span> navigate',
    '<span class="shortcut">Enter</span> open',
    '<span class="shortcut">⌘↵ / Ctrl+Enter</span> open in new tab',
    '<span class="shortcut">Esc</span> close'
  ].join("<span class=\"separator\">•</span>");

  containerEl.appendChild(inputWrapper);
  containerEl.appendChild(resultsEl);
  containerEl.appendChild(footerEl);
  overlayEl.appendChild(containerEl);

  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) {
      closeOverlay();
    }
  });

  inputEl.addEventListener("input", handleInputChange);
  inputEl.addEventListener("keydown", handleInputKeydown);
  document.addEventListener("keydown", handleGlobalKeydown, true);
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
  resultsEl.innerHTML = "";
  inputEl.value = "";

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
  if (overlayEl && overlayEl.parentElement) {
    overlayEl.parentElement.removeChild(overlayEl);
  }
  document.body.style.overflow = bodyOverflowBackup;
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
    pendingQueryTimeout = null;
  }
}

function handleGlobalKeydown(event) {
  if (!isOpen) return;
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
  if (event.key === "Enter") {
    const value = inputEl.value.trim();
    if (value === "> reindex") {
      triggerReindex();
      return;
    }
    if (resultsState.length > 0 && activeIndex >= 0) {
      event.preventDefault();
      openResult(resultsState[activeIndex], {
        newTab: event.metaKey || event.ctrlKey
      });
    } else if (resultsState.length === 1) {
      event.preventDefault();
      openResult(resultsState[0], {
        newTab: event.metaKey || event.ctrlKey
      });
    }
  }
}

function handleInputChange() {
  const query = inputEl.value;
  if (query.trim() === "> reindex") {
    setStatus("Press Enter to rebuild index");
    resultsState = [];
    renderResults();
    return;
  }
  setStatus("");
  if (pendingQueryTimeout) {
    clearTimeout(pendingQueryTimeout);
  }
  pendingQueryTimeout = setTimeout(() => {
    requestResults(query);
  }, 80);
}

function requestResults(query) {
  lastRequestId = ++requestCounter;
  chrome.runtime.sendMessage(
    { type: "SPOTLIGHT_QUERY", query, requestId: lastRequestId },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Spotlight query error", chrome.runtime.lastError);
        return;
      }
      if (!response || response.requestId !== lastRequestId) {
        return;
      }
      resultsState = Array.isArray(response.results) ? response.results.slice(0, RESULTS_LIMIT) : [];
      activeIndex = resultsState.length > 0 ? 0 : -1;
      renderResults();
    }
  );
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message || "";
  }
}

function navigateResults(delta) {
  if (!resultsState.length) return;
  activeIndex = (activeIndex + delta + resultsState.length) % resultsState.length;
  updateActiveResult();
}

function updateActiveResult() {
  const items = resultsEl.querySelectorAll("li");
  items.forEach((item, index) => {
    if (index === activeIndex) {
      item.classList.add("active");
      item.setAttribute("aria-selected", "true");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("active");
      item.removeAttribute("aria-selected");
    }
  });
}

function openResult(result, options = {}) {
  if (!result) return;
  const newTab = Boolean(options.newTab);
  chrome.runtime.sendMessage({
    type: "SPOTLIGHT_OPEN",
    itemId: result.id,
    newTab
  });
  closeOverlay();
}

function renderResults() {
  resultsEl.innerHTML = "";

  if (inputEl.value.trim() === "> reindex") {
    const li = document.createElement("li");
    li.className = "spotlight-result reindex";
    li.textContent = "Press Enter to rebuild the search index";
    resultsEl.appendChild(li);
    return;
  }

  if (!resultsState.length) {
    const li = document.createElement("li");
    li.className = "spotlight-result empty";
    li.textContent = "No matches";
    resultsEl.appendChild(li);
    return;
  }

  resultsState.forEach((result, index) => {
    const li = document.createElement("li");
    li.className = "spotlight-result";
    li.setAttribute("role", "option");

    const title = document.createElement("div");
    title.className = "spotlight-result-title";
    title.textContent = result.title || result.url;

    const meta = document.createElement("div");
    meta.className = "spotlight-result-meta";

    const url = document.createElement("span");
    url.className = "spotlight-result-url";
    url.textContent = result.url;

    const type = document.createElement("span");
    type.className = `spotlight-result-type type-${result.type}`;
    type.textContent = formatTypeLabel(result.type);

    meta.appendChild(url);
    meta.appendChild(type);

    li.appendChild(title);
    li.appendChild(meta);

    li.addEventListener("mouseenter", () => {
      activeIndex = index;
      updateActiveResult();
    });

    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    li.addEventListener("click", (event) => {
      openResult(result, { newTab: event.metaKey || event.ctrlKey });
    });

    li.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        openResult(result, { newTab: true });
      }
    });

    resultsEl.appendChild(li);
  });

  activeIndex = Math.min(activeIndex, resultsState.length - 1);
  if (activeIndex < 0 && resultsState.length > 0) {
    activeIndex = 0;
  }
  updateActiveResult();
}

function triggerReindex() {
  setStatus("Rebuilding index...");
  chrome.runtime.sendMessage({ type: "SPOTLIGHT_REINDEX" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Unable to rebuild index");
      return;
    }
    if (response && response.success) {
      setStatus("Index refreshed");
      requestResults(inputEl.value === "> reindex" ? "" : inputEl.value);
    } else {
      setStatus("Rebuild failed");
    }
  });
}

function formatTypeLabel(type) {
  switch (type) {
    case "tab":
      return "Tab";
    case "bookmark":
      return "Bookmark";
    case "history":
      return "History";
    default:
      return type || "";
  }
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
