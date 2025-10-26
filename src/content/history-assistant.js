import { isHistoryAssistantEnabled, observeHistoryAssistantFlag } from "../shared/feature-flags.js";

const COMMAND_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "meta"],
    },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        domains: {
          type: "array",
          items: { type: "string" },
        },
        urlContains: { type: "string" },
        urls: {
          type: "array",
          items: { type: "string" },
        },
        timeRange: {
          type: "string",
          enum: [
            "auto",
            "today",
            "yesterday",
            "last_3_days",
            "last_7_days",
            "last_30_days",
            "last_90_days",
            "all",
            "custom",
          ],
        },
        startTime: { type: "number" },
        endTime: { type: "number" },
        limit: { type: "number" },
        sort: {
          type: "string",
          enum: ["recent", "frequent", "earliest"],
        },
      },
    },
    assistantResponse: { type: "string" },
    summarization: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["key-points", "tldr", "teaser", "headline"],
        },
        length: {
          type: "string",
          enum: ["short", "medium", "long"],
        },
        focus: { type: "string" },
      },
    },
    open: {
      type: "object",
      additionalProperties: false,
      properties: {
        disposition: {
          type: "string",
          enum: ["current_tab", "new_tab", "background"],
        },
        source: {
          type: "string",
          enum: ["history", "sessions"],
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are the Spotlight Smart History Assistant. You transform natural language requests into structured commands for a Chrome extension that works entirely on-device.\n\nGuidelines:\n- Always reply with JSON that matches the provided schema. No prose outside JSON.\n- Actions: show (list matching history), open (open or restore items), delete (remove history), summarize (summarize activity), meta (respond conversationally).\n- Prefer domains for well-known sites (e.g. youtube.com) and set timeRange thoughtfully (today, yesterday, last_3_days, last_7_days, last_30_days, last_90_days, all).\n- When dates are explicit, set startTime and endTime as Unix epoch milliseconds and use timeRange="custom".\n- Limit defaults to 20 when omitted.\n- Use open.source="sessions" for recently closed or session based restores, otherwise use "history".\n- assistantResponse should contain a short natural language reply summarizing the plan or answering meta questions.\n- summarization focus should highlight what to include in a summary when action is summarize.\n- Never invent data. If unsure, choose action "meta" with assistantResponse explaining limitations.`;

const MAX_RENDERED_RESULTS = 20;
const MAX_SUMMARY_ITEMS = 40;

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function formatVisitTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (error) {
    console.warn("Spotlight: failed to format timestamp", error);
  }
  return "";
}

function createElement(tag, className, options = {}) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (options.text) {
    el.textContent = options.text;
  }
  if (options.role) {
    el.setAttribute("role", options.role);
  }
  return el;
}

function createRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Runtime message failed"));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function ensureLanguageModelSession(state) {
  if (state.languageModelSession) {
    return state.languageModelSession;
  }
  if (typeof LanguageModel === "undefined" || !LanguageModel?.availability) {
    return null;
  }
  if (state.languageModelPromise) {
    return state.languageModelPromise;
  }
  state.languageModelPromise = (async () => {
    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      return null;
    }
    const session = await LanguageModel.create({
      initialPrompts: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
      ],
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const ratio = typeof event.loaded === "number" ? event.loaded : 0;
          const percentage = Math.max(0, Math.min(100, Math.round(ratio * 100)));
          state.updateStatus?.(`Downloading assistant… ${percentage}%`, "info");
        });
      },
    });
    state.languageModelSession = session;
    return session;
  })();
  try {
    const session = await state.languageModelPromise;
    return session;
  } catch (error) {
    console.warn("Spotlight: failed to create language model session", error);
    return null;
  } finally {
    state.languageModelPromise = null;
  }
}

async function ensureSummarizerInstance(state, options = {}) {
  if (typeof Summarizer === "undefined" || !Summarizer?.availability) {
    return null;
  }
  const type = options.type || "key-points";
  const length = options.length || "medium";
  const key = `${type}:${length}`;
  if (!state.summarizers) {
    state.summarizers = new Map();
  }
  if (state.summarizers.has(key)) {
    return state.summarizers.get(key);
  }
  const availability = await Summarizer.availability();
  if (availability === "unavailable") {
    return null;
  }
  const summarizer = await Summarizer.create({
    type,
    length,
    format: "markdown",
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const ratio = typeof event.loaded === "number" ? event.loaded : 0;
        const percentage = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        state.updateStatus?.(`Downloading summarizer… ${percentage}%`, "info");
      });
    },
  });
  state.summarizers.set(key, summarizer);
  return summarizer;
}

function buildSummarySource(items) {
  if (!Array.isArray(items)) {
    return "";
  }
  return items
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((item, index) => {
      const title = sanitizeText(item?.title) || "(untitled)";
      const url = sanitizeText(item?.url);
      const timestamp = formatVisitTimestamp(item?.lastVisitTime);
      const visitCount = typeof item?.visitCount === "number" ? item.visitCount : null;
      const visitLabel = visitCount && visitCount > 1 ? `${visitCount} visits` : "";
      const header = [String(index + 1).padStart(2, "0"), title].join(" · ");
      const meta = [timestamp, visitLabel, url].filter(Boolean).join(" · ");
      return `${header}\n${meta}`;
    })
    .join("\n\n");
}

function renderResultList(listEl, items, controller) {
  listEl.innerHTML = "";
  if (!Array.isArray(items) || !items.length) {
    const emptyEl = createElement("div", "spotlight-history-assistant-empty", {
      text: "No matching history was found.",
    });
    listEl.appendChild(emptyEl);
    return;
  }

  const limitedItems = items.slice(0, MAX_RENDERED_RESULTS);
  const list = createElement("ul", "spotlight-history-assistant-results", { role: "list" });
  limitedItems.forEach((item) => {
    const entry = createElement("li", "spotlight-history-assistant-result");
    const title = sanitizeText(item?.title) || sanitizeText(item?.url) || "(untitled)";
    const titleEl = createElement("div", "spotlight-history-assistant-result-title", {
      text: title,
    });
    entry.appendChild(titleEl);

    if (item?.url) {
      const urlEl = createElement("div", "spotlight-history-assistant-result-url", {
        text: sanitizeText(item.url),
      });
      entry.appendChild(urlEl);
    }

    const metaParts = [];
    const timeLabel = formatVisitTimestamp(item?.lastVisitTime);
    if (timeLabel) {
      metaParts.push(timeLabel);
    }
    if (typeof item?.visitCount === "number" && item.visitCount > 0) {
      metaParts.push(`${item.visitCount} visit${item.visitCount === 1 ? "" : "s"}`);
    }
    if (metaParts.length) {
      entry.appendChild(
        createElement("div", "spotlight-history-assistant-result-meta", {
          text: metaParts.join(" · "),
        })
      );
    }

    const actionsEl = createElement("div", "spotlight-history-assistant-actions");
    const openButton = createElement("button", "spotlight-history-assistant-action");
    openButton.type = "button";
    openButton.textContent = "Open";
    openButton.addEventListener("click", (event) => {
      event.stopPropagation();
      controller.runDirectCommand(
        {
          action: "open",
          filters: { urls: [item.url], limit: 1 },
          open: { disposition: "new_tab", source: "history" },
        },
        { items: [item] }
      );
    });
    actionsEl.appendChild(openButton);

    const deleteButton = createElement("button", "spotlight-history-assistant-action secondary");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      controller.runDirectCommand(
        {
          action: "delete",
          filters: { urls: [item.url], limit: 1 },
        },
        { items: [item] }
      );
    });
    actionsEl.appendChild(deleteButton);

    entry.appendChild(actionsEl);
    list.appendChild(entry);
  });

  listEl.appendChild(list);
}

function renderSummary(responseEl, summaryText) {
  responseEl.innerHTML = "";
  const summary = sanitizeText(summaryText);
  if (!summary) {
    const emptyEl = createElement("div", "spotlight-history-assistant-empty", {
      text: "No summary was generated.",
    });
    responseEl.appendChild(emptyEl);
    return;
  }
  const textEl = createElement("pre", "spotlight-history-assistant-summary");
  textEl.textContent = summary;
  responseEl.appendChild(textEl);
}

export function createHistoryAssistant(options = {}) {
  const {
    mountPoint = null,
    refreshResults = () => {},
    announceStatus = () => {},
  } = options;

  const state = {
    enabled: false,
    active: false,
    busy: false,
    languageModelSession: null,
    languageModelPromise: null,
    summarizers: null,
    updateStatus: null,
  };

  const container = createElement("section", "spotlight-history-assistant");
  container.setAttribute("aria-hidden", "true");
  container.hidden = true;

  const header = createElement("div", "spotlight-history-assistant-header");
  header.appendChild(createElement("div", "spotlight-history-assistant-title", { text: "Smart History Assistant" }));
  const badge = createElement("span", "spotlight-history-assistant-badge", { text: "Labs" });
  header.appendChild(badge);
  container.appendChild(header);

  const form = createElement("form", "spotlight-history-assistant-form");
  const queryLabel = createElement("label", "spotlight-history-assistant-label", { text: "Ask anything about your history" });
  const queryInput = document.createElement("input");
  queryInput.type = "text";
  queryInput.placeholder = "e.g. Open my YouTube tabs from last week";
  queryInput.className = "spotlight-history-assistant-input";
  queryInput.setAttribute("aria-label", "History assistant request");
  form.appendChild(queryLabel);
  form.appendChild(queryInput);

  const promptLabel = createElement("label", "spotlight-history-assistant-label", { text: "Optional follow-up or summary instructions" });
  const promptInput = document.createElement("textarea");
  promptInput.placeholder = "Add clarifications or summary focus (optional)";
  promptInput.rows = 2;
  promptInput.className = "spotlight-history-assistant-textarea";
  promptInput.setAttribute("aria-label", "Additional assistant instructions");
  form.appendChild(promptLabel);
  form.appendChild(promptInput);

  const formActions = createElement("div", "spotlight-history-assistant-form-actions");
  const runButton = createElement("button", "spotlight-history-assistant-run");
  runButton.type = "submit";
  runButton.textContent = "Run";
  formActions.appendChild(runButton);

  const clearButton = createElement("button", "spotlight-history-assistant-clear");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  formActions.appendChild(clearButton);
  form.appendChild(formActions);

  container.appendChild(form);

  const statusEl = createElement("div", "spotlight-history-assistant-status", { role: "status" });
  container.appendChild(statusEl);

  const responseEl = createElement("div", "spotlight-history-assistant-response");
  container.appendChild(responseEl);

  const listEl = createElement("div", "spotlight-history-assistant-list");
  container.appendChild(listEl);

  state.updateStatus = (message, tone = "info") => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.dataset.tone = tone;
    if (typeof announceStatus === "function" && message) {
      announceStatus(message);
    }
  };

  const setBusy = (busy) => {
    state.busy = Boolean(busy);
    container.classList.toggle("busy", state.busy);
    runButton.disabled = state.busy;
    queryInput.disabled = state.busy;
    promptInput.disabled = state.busy;
    clearButton.disabled = state.busy;
  };

  const updateVisibility = () => {
    const visible = state.enabled && state.active;
    container.hidden = !visible;
    container.setAttribute("aria-hidden", visible ? "false" : "true");
    container.classList.toggle("enabled", state.enabled);
  };

  const evaluateFlag = async () => {
    const value = await isHistoryAssistantEnabled();
    state.enabled = Boolean(value);
    updateVisibility();
  };

  evaluateFlag();
  const teardownFlagObserver = observeHistoryAssistantFlag((value) => {
    state.enabled = Boolean(value);
    updateVisibility();
  });

  const resetOutputs = () => {
    statusEl.textContent = "";
    responseEl.innerHTML = "";
    listEl.innerHTML = "";
    container.classList.remove("has-results");
  };

  clearButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    queryInput.value = "";
    promptInput.value = "";
    resetOutputs();
    state.updateStatus("Cleared.", "info");
  });

  const handleMetaResponse = (command) => {
    const assistantResponse = sanitizeText(command?.assistantResponse);
    responseEl.innerHTML = "";
    if (assistantResponse) {
      const paragraph = createElement("p", "spotlight-history-assistant-message", {
        text: assistantResponse,
      });
      responseEl.appendChild(paragraph);
    }
    listEl.innerHTML = "";
    container.classList.toggle("has-results", Boolean(assistantResponse));
    state.updateStatus("", "info");
  };

const handleCommandResult = async (command, rawResponse, context) => {
    const action = sanitizeText(command?.action).toLowerCase();
    const assistantResponse = sanitizeText(command?.assistantResponse);
    if (assistantResponse) {
      const paragraph = createElement("p", "spotlight-history-assistant-message", {
        text: assistantResponse,
      });
      responseEl.innerHTML = "";
      responseEl.appendChild(paragraph);
    } else {
      responseEl.innerHTML = "";
    }

    if (action === "meta") {
      handleMetaResponse(command);
      return;
    }

    if (!rawResponse || rawResponse.success === false) {
      const errorMessage = sanitizeText(rawResponse?.error) || "Request failed.";
      state.updateStatus(errorMessage, "error");
      return;
    }

    container.classList.toggle("has-results", true);

    const displayItems = Array.isArray(rawResponse?.items) && rawResponse.items.length
      ? rawResponse.items
      : Array.isArray(context?.items)
      ? context.items
      : [];

    if (action === "show") {
      renderResultList(listEl, displayItems, controller);
      state.updateStatus(rawResponse.message || "Listing matching history.", "success");
      return;
    }

    if (action === "open") {
      renderResultList(listEl, displayItems, controller);
      const opened = typeof rawResponse.opened === "number" ? rawResponse.opened : 0;
      const label = opened === 1 ? "Opened 1 entry." : `Opened ${opened} entries.`;
      state.updateStatus(rawResponse.message || label, "success");
      return;
    }

    if (action === "delete") {
      renderResultList(listEl, displayItems, controller);
      const count = typeof rawResponse.deleted === "number" ? rawResponse.deleted : 0;
      const label = count === 1 ? "Deleted 1 entry." : `Deleted ${count} entries.`;
      state.updateStatus(rawResponse.message || label, "success");
      if (typeof refreshResults === "function") {
        refreshResults();
      }
      return;
    }

    if (action === "summarize") {
      const summaryOptions = {
        type: command?.summarization?.type,
        length: command?.summarization?.length,
      };
      const summarizer = await ensureSummarizerInstance(state, summaryOptions);
      if (!summarizer) {
        state.updateStatus("Summarizer unavailable on this device.", "error");
        return;
      }
      const sourceText = buildSummarySource(displayItems);
      if (!sourceText) {
        state.updateStatus("Nothing to summarize.", "info");
        return;
      }
      state.updateStatus("Summarizing your activity…", "info");
      try {
        const summaryContext = sanitizeText(command?.summarization?.focus) || sanitizeText(context?.prompt) || "";
        const summaryResult = await summarizer.summarize(sourceText, {
          context: summaryContext || undefined,
        });
        listEl.innerHTML = "";
        renderSummary(responseEl, summaryResult);
        state.updateStatus("Summary ready.", "success");
      } catch (error) {
        console.warn("Spotlight: summarization failed", error);
        state.updateStatus("Unable to summarize right now.", "error");
      }
      return;
    }

    state.updateStatus("Request completed.", "success");
  };

  const controller = {
    mount() {
      if (mountPoint && !mountPoint.contains(container)) {
        mountPoint.appendChild(container);
      }
      updateVisibility();
    },
    setActive(active) {
      state.active = Boolean(active);
      updateVisibility();
      if (!state.active) {
        container.classList.remove("has-results");
      }
    },
    async runCommandFromPrompt(rawInput, promptSupplement) {
      if (!state.enabled) {
        state.updateStatus("History assistant is disabled.", "error");
        return;
      }
      const trimmed = sanitizeText(rawInput);
      if (!trimmed) {
        state.updateStatus("Enter a request to continue.", "error");
        return;
      }
      setBusy(true);
      state.updateStatus("Thinking…", "info");
      const session = await ensureLanguageModelSession(state);
      if (!session) {
        state.updateStatus("Assistant model unavailable on this device.", "error");
        setBusy(false);
        return;
      }
      let rawResponse;
      try {
        const userMessage = [trimmed];
        const promptExtra = sanitizeText(promptSupplement);
        if (promptExtra) {
          userMessage.push(`Additional guidance: ${promptExtra}`);
        }
        rawResponse = await session.prompt(userMessage.join("\n\n"), {
          responseConstraint: COMMAND_RESPONSE_SCHEMA,
          omitResponseConstraintInput: true,
        });
      } catch (error) {
        console.warn("Spotlight: prompt request failed", error);
        state.updateStatus("Assistant request failed.", "error");
        setBusy(false);
        return;
      }

      let command = null;
      try {
        command = JSON.parse(rawResponse);
      } catch (error) {
        console.warn("Spotlight: assistant produced invalid response", rawResponse, error);
        state.updateStatus("Assistant response was malformed.", "error");
        setBusy(false);
        return;
      }

      if (!command || typeof command.action !== "string") {
        state.updateStatus("Assistant could not understand the request.", "error");
        setBusy(false);
        return;
      }

      if (command.action === "meta") {
        handleMetaResponse(command);
        setBusy(false);
        return;
      }

      try {
        const response = await createRuntimeMessage({
          type: "SPOTLIGHT_HISTORY_ASSISTANT_COMMAND",
          command,
          context: { input: trimmed, prompt: sanitizeText(promptSupplement) },
        });
        await handleCommandResult(command, response, { input: trimmed, prompt: sanitizeText(promptSupplement) });
      } catch (error) {
        console.warn("Spotlight: history assistant command failed", error);
        state.updateStatus("Unable to run history command.", "error");
      } finally {
        setBusy(false);
      }
    },
    async runDirectCommand(command, localContext = {}) {
      if (!state.enabled || !command) {
        return;
      }
      setBusy(true);
      try {
        const response = await createRuntimeMessage({
          type: "SPOTLIGHT_HISTORY_ASSISTANT_COMMAND",
          command,
          context: { input: "direct-action", ...localContext },
        });
        await handleCommandResult(command, response, { input: "direct-action", ...localContext });
      } catch (error) {
        console.warn("Spotlight: direct history action failed", error);
        state.updateStatus("Unable to complete the action.", "error");
      } finally {
        setBusy(false);
      }
    },
    handleOverlayClosed() {
      resetOutputs();
      state.active = false;
      updateVisibility();
    },
    destroy() {
      teardownFlagObserver();
      if (container.parentElement) {
        container.parentElement.removeChild(container);
      }
      if (state.languageModelSession && typeof state.languageModelSession.destroy === "function") {
        try {
          state.languageModelSession.destroy();
        } catch (error) {
          console.warn("Spotlight: failed to destroy language model session", error);
        }
      }
      if (state.summarizers) {
        for (const summarizer of state.summarizers.values()) {
          try {
            summarizer?.destroy?.();
          } catch (error) {
            console.warn("Spotlight: failed to destroy summarizer", error);
          }
        }
        state.summarizers.clear();
      }
    },
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    controller.runCommandFromPrompt(queryInput.value, promptInput.value);
  });

  [queryInput, promptInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("keyup", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  controller.mount();
  return controller;
}
