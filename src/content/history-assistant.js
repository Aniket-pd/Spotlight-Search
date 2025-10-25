(() => {
  const MAX_RENDERED_GROUPS = 8;
  const MAX_RENDERED_ENTRIES_PER_GROUP = 8;
  const QUICK_OPEN_LIMIT = 6;
  const MODEL_OPTIONS = { temperature: 0.1, topK: 32 };
  const DEFAULT_PLACEHOLDER = "Try \"Find the design articles I read yesterday morning\"";
  const MODEL_SYSTEM_PROMPT = [
    {
      role: "system",
      content:
        "You are a Chrome history intent parser. Extract structured actions for search, reopening, or deleting browsing history. Always respond with JSON that matches the provided schema. Do not invent history data. Use neutral, privacy-safe language.",
    },
    {
      role: "user",
      content: "Show me the study resources I opened three months ago.",
    },
    {
      role: "assistant",
      content:
        '{"action":"search","confidence":0.84,"needs_follow_up":false,"follow_up_question":null,"topics":["study resources"],"time_range":{"description":"three months ago","preset":"three_months_ago","start":null,"end":null},"targets":[]}',
    },
    {
      role: "user",
      content: "Reopen the SwiftUI tutorial tabs from last weekend",
    },
    {
      role: "assistant",
      content:
        '{"action":"open","confidence":0.9,"needs_follow_up":false,"follow_up_question":null,"topics":["SwiftUI tutorial"],"time_range":{"description":"last weekend","preset":"last_weekend","start":null,"end":null},"targets":[]}',
    },
    {
      role: "user",
      content: "Delete my shopping history from Saturday afternoon",
    },
    {
      role: "assistant",
      content:
        '{"action":"delete","confidence":0.88,"needs_follow_up":false,"follow_up_question":null,"topics":["shopping"],"time_range":{"description":"Saturday afternoon","preset":null,"start":null,"end":null},"targets":[]}',
    },
  ];

  const RESPONSE_SCHEMA = {
    type: "object",
    required: ["action", "confidence", "topics", "time_range", "needs_follow_up"],
    properties: {
      action: {
        type: "string",
        enum: ["search", "open", "delete", "clarify"],
      },
      confidence: { type: "number" },
      needs_follow_up: { type: "boolean" },
      follow_up_question: { type: ["string", "null"] },
      topics: {
        type: "array",
        items: { type: "string" },
      },
      time_range: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string" },
          preset: { type: ["string", "null"] },
          start: { type: ["string", "null"] },
          end: { type: ["string", "null"] },
        },
        additionalProperties: true,
      },
      targets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    additionalProperties: true,
  };

  const state = {
    container: null,
    panel: null,
    form: null,
    input: null,
    submit: null,
    feedback: null,
    results: null,
    loader: null,
    active: false,
    busy: false,
    sessionPromise: null,
    availability: null,
    requestCounter: 0,
    pendingRequestId: 0,
    followUp: null,
    lastIntent: null,
    lastResponse: null,
    pendingDeletion: null,
    locale: null,
    listenersAttached: false,
  };

  function getLocale() {
    if (state.locale) {
      return state.locale;
    }
    const navigatorLocale = typeof navigator !== "undefined" ? navigator.language : "";
    const uiLocale = chrome?.i18n?.getUILanguage?.() || "";
    state.locale = navigatorLocale || uiLocale || "en-US";
    return state.locale;
  }

  function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (typeof text === "string") {
      el.textContent = text;
    }
    return el;
  }

  function ensurePanel() {
    if (state.panel || !state.container) {
      return state.panel;
    }

    const panel = createElement("section", "spotlight-history-assistant");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "History assistant");
    panel.hidden = true;

    const header = createElement("div", "history-assistant-header");
    const title = createElement("h2", "history-assistant-title", "History Assistant");
    title.setAttribute("aria-live", "polite");
    const subtitle = createElement(
      "p",
      "history-assistant-subtitle",
      "Ask in plain language to find, reopen, or clean up your browsing history."
    );
    header.appendChild(title);
    header.appendChild(subtitle);

    const form = createElement("form", "history-assistant-form");
    form.setAttribute("novalidate", "true");

    const inputWrapper = createElement("div", "history-assistant-input-wrapper");
    const input = createElement("input", "history-assistant-input");
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("placeholder", DEFAULT_PLACEHOLDER);
    input.setAttribute("aria-label", "History assistant query");

    const submit = createElement("button", "history-assistant-submit", "Go");
    submit.type = "submit";

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(submit);
    form.appendChild(inputWrapper);

    const feedback = createElement("div", "history-assistant-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    const results = createElement("div", "history-assistant-results");

    const loader = createElement("div", "history-assistant-progress");
    loader.setAttribute("aria-hidden", "true");
    loader.textContent = "Thinking…";
    loader.hidden = true;

    form.addEventListener("submit", handleSubmit);

    panel.appendChild(header);
    panel.appendChild(form);
    panel.appendChild(loader);
    panel.appendChild(feedback);
    panel.appendChild(results);

    state.panel = panel;
    state.form = form;
    state.input = input;
    state.submit = submit;
    state.feedback = feedback;
    state.results = results;
    state.loader = loader;

    state.container.insertBefore(panel, state.container.querySelector(".spotlight-results"));

    return panel;
  }

  function setBusy(busy) {
    state.busy = busy;
    if (state.submit) {
      state.submit.disabled = busy;
      state.submit.textContent = busy ? "Working…" : "Go";
    }
    if (state.loader) {
      state.loader.hidden = !busy;
    }
    if (state.input) {
      state.input.disabled = busy;
    }
  }

  function resetFeedback() {
    if (state.feedback) {
      state.feedback.textContent = "";
      state.feedback.classList.remove("error", "info", "success", "warning");
    }
  }

  function renderFeedback(message, tone = "info") {
    if (!state.feedback) {
      return;
    }
    state.feedback.textContent = message || "";
    state.feedback.classList.remove("error", "info", "success", "warning");
    state.feedback.classList.add(tone);
  }

  function clearResults() {
    if (state.results) {
      state.results.innerHTML = "";
    }
  }

  function resetPendingState() {
    state.pendingDeletion = null;
    state.lastResponse = null;
    state.followUp = null;
  }

  function resetPanelState() {
    resetFeedback();
    clearResults();
    if (state.input) {
      state.input.value = "";
      state.input.setAttribute("placeholder", DEFAULT_PLACEHOLDER);
    }
    resetPendingState();
  }

  function setActive(active) {
    if (!state.container) {
      return;
    }
    ensurePanel();
    state.active = Boolean(active);
    state.container.classList.toggle("history-assistant-active", state.active);
    if (state.panel) {
      state.panel.hidden = !state.active;
    }
    if (state.active) {
      resetFeedback();
      if (state.input) {
        setTimeout(() => {
          state.input.focus({ preventScroll: true });
          state.input.select();
        }, 30);
      }
    } else {
      resetPanelState();
    }
  }

  function reset() {
    resetPanelState();
    setBusy(false);
  }

  function shouldSuppressResults() {
    return Boolean(state.active);
  }

  function isActive() {
    return Boolean(state.active);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!state.input) {
      return;
    }
    const text = state.input.value.trim();
    if (!text) {
      renderFeedback("Tell me what to look for and I’ll jump right in.", "warning");
      return;
    }

    if (state.followUp) {
      const combined = `${state.followUp.baseQuery}\nFollow-up answer: ${text}`;
      state.followUp = null;
      processQuery(combined, { displayQuery: text });
      return;
    }

    processQuery(text);
  }

  function getPromptApi() {
    if (typeof globalThis !== "object") {
      return null;
    }
    if (globalThis.LanguageModel && typeof globalThis.LanguageModel.create === "function") {
      return globalThis.LanguageModel;
    }
    const ai = globalThis.ai;
    if (ai && ai.languageModel && typeof ai.languageModel.create === "function") {
      return ai.languageModel;
    }
    return null;
  }

  async function ensureSession() {
    const api = getPromptApi();
    if (!api) {
      throw new Error("The on-device model isn’t available in this browser yet.");
    }
    if (!state.sessionPromise) {
      state.sessionPromise = (async () => {
        try {
          if (typeof api.availability === "function") {
            state.availability = await api.availability(MODEL_OPTIONS);
            if (state.availability === "unavailable") {
              throw new Error("On-device model unavailable");
            }
          }
          const session = await api.create({
            ...MODEL_OPTIONS,
            initialPrompts: MODEL_SYSTEM_PROMPT,
            expectedInputs: [{ type: "text", languages: ["en"] }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
          });
          return session;
        } catch (err) {
          state.sessionPromise = null;
          throw err;
        }
      })();
    }
    return state.sessionPromise;
  }

  async function requestIntent(query) {
    const session = await ensureSession();
    const trimmed = (query || "").trim();
    if (!trimmed) {
      throw new Error("Query is empty");
    }
    const messages = [
      { role: "user", content: trimmed },
      {
        role: "assistant",
        content: "",
        prefix: true,
      },
    ];
    const response = await session.prompt(messages, {
      responseConstraint: RESPONSE_SCHEMA,
      omitResponseConstraintInput: true,
    });
    if (typeof response !== "string" || !response.trim()) {
      throw new Error("No response from model");
    }
    try {
      return JSON.parse(response);
    } catch (err) {
      throw new Error("Model returned an unexpected format");
    }
  }

  function summarizeIntent(intent) {
    if (!intent) {
      return "";
    }
    const action = intent.action || "search";
    const topics = Array.isArray(intent.topics) ? intent.topics.filter(Boolean) : [];
    const topicLabel = topics.length ? topics.join(", ") : "everything";
    const rangeDescription = intent?.time_range?.description || "recently";
    switch (action) {
      case "open":
        return `Okay! I’ll reopen ${topicLabel} from ${rangeDescription}.`;
      case "delete":
        return `Got it—prepping to clean up ${topicLabel} from ${rangeDescription}.`;
      case "clarify":
        return `Let’s clarify what you need from ${rangeDescription}.`;
      default:
        return `Looking for ${topicLabel} from ${rangeDescription}.`;
    }
  }

  function buildFriendlyConfidence(confidence) {
    if (typeof confidence !== "number" || Number.isNaN(confidence)) {
      return "";
    }
    if (confidence >= 0.8) {
      return "I’m pretty confident about that.";
    }
    if (confidence >= 0.55) {
      return "I’m fairly sure, but let me know if something looks off.";
    }
    return "This might be a little fuzzy—double-check me.";
  }

  function serializeEntries(entries) {
    return entries
      .map((entry) => ({
        id: entry.id,
        url: entry.url,
        lastVisitTime: entry.lastVisitTime,
      }))
      .filter((entry) => entry.url);
  }

  function handleFollowUp(intent, originalQuery) {
    const question = intent?.follow_up_question;
    if (!question) {
      renderFeedback("Can you share a little more detail?", "warning");
      return;
    }
    renderFeedback(question, "info");
    if (state.input) {
      state.input.setAttribute("placeholder", "Your clarification");
      state.input.focus({ preventScroll: true });
      state.input.select();
    }
    state.followUp = { baseQuery: originalQuery, question };
  }

  function createGroupHeader(group) {
    const header = createElement("div", "history-assistant-group-header");
    const titleWrap = createElement("div", "history-assistant-group-title-wrap");
    const title = createElement("h3", "history-assistant-group-title", group.label || "Session");
    const metaParts = [];
    if (group.dateLabel) metaParts.push(group.dateLabel);
    if (group.timeLabel) metaParts.push(group.timeLabel);
    if (Number.isFinite(group.entryCount)) {
      metaParts.push(`${group.entryCount} ${group.entryCount === 1 ? "item" : "items"}`);
    }
    const meta = createElement("p", "history-assistant-group-meta", metaParts.join(" · "));
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const actions = createElement("div", "history-assistant-group-actions");
    const openBtn = createElement("button", "history-assistant-chip", "Open all");
    openBtn.type = "button";
    openBtn.dataset.action = "open-group";
    openBtn.dataset.groupId = group.id;

    const deleteBtn = createElement("button", "history-assistant-chip danger", "Delete…");
    deleteBtn.type = "button";
    deleteBtn.dataset.action = "delete-group";
    deleteBtn.dataset.groupId = group.id;

    actions.appendChild(openBtn);
    actions.appendChild(deleteBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    return header;
  }

  function createEntryElement(entry) {
    const item = createElement("div", "history-assistant-entry");
    item.dataset.entryId = entry.id;

    const text = createElement("div", "history-assistant-entry-text");
    const title = createElement("div", "history-assistant-entry-title", entry.title || entry.url);
    const metaParts = [];
    if (entry.hostname) metaParts.push(entry.hostname);
    if (entry.timeLabel) metaParts.push(entry.timeLabel);
    const meta = createElement("div", "history-assistant-entry-meta", metaParts.join(" · "));
    text.appendChild(title);
    text.appendChild(meta);

    const actions = createElement("div", "history-assistant-entry-actions");
    const openBtn = createElement("button", "history-assistant-chip", "Open");
    openBtn.type = "button";
    openBtn.dataset.action = "open-entry";
    openBtn.dataset.entryId = entry.id;

    const deleteBtn = createElement("button", "history-assistant-chip danger", "Delete");
    deleteBtn.type = "button";
    deleteBtn.dataset.action = "delete-entry";
    deleteBtn.dataset.entryId = entry.id;

    actions.appendChild(openBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(text);
    item.appendChild(actions);
    return item;
  }

  function renderSearchGroups(response) {
    if (!state.results) {
      return;
    }
    clearResults();
    state.results.dataset.mode = "search";

    if (!response || !Array.isArray(response.groups) || !response.groups.length) {
      const empty = createElement(
        "div",
        "history-assistant-empty",
        "No matching history just yet. Try adjusting the time frame or topic."
      );
      state.results.appendChild(empty);
      return;
    }

    const locale = getLocale();
    const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

    response.groups.forEach((group, groupIndex) => {
      if (groupIndex >= MAX_RENDERED_GROUPS) {
        return;
      }
      const groupEl = createElement("div", "history-assistant-group");
      groupEl.dataset.groupId = group.id;
      const header = createGroupHeader(group);
      groupEl.appendChild(header);

      const list = createElement("div", "history-assistant-entry-list");
      const entries = Array.isArray(group.entries) ? group.entries : [];
      entries.slice(0, MAX_RENDERED_ENTRIES_PER_GROUP).forEach((entry) => {
        const entryCopy = { ...entry };
        if (!entryCopy.timeLabel && Number.isFinite(entryCopy.lastVisitTime)) {
          entryCopy.timeLabel = timeFormatter.format(new Date(entryCopy.lastVisitTime));
        }
        const entryEl = createEntryElement(entryCopy);
        list.appendChild(entryEl);
      });
      groupEl.appendChild(list);
      state.results.appendChild(groupEl);
    });
  }

  function renderDeleteConfirmation(payload) {
    if (!state.results) {
      return;
    }
    clearResults();
    state.results.dataset.mode = "confirm";

    const headline = createElement(
      "h3",
      "history-assistant-confirm-title",
      payload?.summary || "Review items to delete"
    );
    state.results.appendChild(headline);

    const description = createElement(
      "p",
      "history-assistant-confirm-description",
      "Uncheck anything you want to keep, then confirm."
    );
    state.results.appendChild(description);

    const form = createElement("form", "history-assistant-confirm-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      confirmDeletionSelection();
    });

    const groupsContainer = createElement("div", "history-assistant-confirm-groups");
    const locale = getLocale();
    const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

    const entryCheckboxes = [];
    const groups = Array.isArray(payload?.groups) ? payload.groups : [];
    groups.forEach((group) => {
      const groupBlock = createElement("div", "history-assistant-confirm-group");
      const title = createElement("h4", "history-assistant-confirm-group-title", group.label || "Session");
      const metaParts = [];
      if (group.dateLabel) metaParts.push(group.dateLabel);
      if (group.timeLabel) metaParts.push(group.timeLabel);
      const meta = createElement("p", "history-assistant-confirm-group-meta", metaParts.join(" · "));
      groupBlock.appendChild(title);
      groupBlock.appendChild(meta);

      const entryList = createElement("div", "history-assistant-confirm-list");
      const entries = Array.isArray(group.entries) ? group.entries : [];
      entries.forEach((entry) => {
        const checkboxId = `history-delete-${entry.id}`;
        const row = createElement("label", "history-assistant-confirm-entry");
        row.setAttribute("for", checkboxId);
        const checkbox = createElement("input", "history-assistant-checkbox");
        checkbox.type = "checkbox";
        checkbox.id = checkboxId;
        checkbox.value = entry.id;
        checkbox.checked = true;
        checkbox.dataset.entryId = entry.id;
        checkbox.dataset.url = entry.url || "";
        checkbox.dataset.lastVisitTime = entry.lastVisitTime ? String(entry.lastVisitTime) : "";
        entryCheckboxes.push(checkbox);

        const label = createElement("span", "history-assistant-confirm-entry-text");
        const titleText = entry.title || entry.url || "Untitled page";
        const hostname = entry.hostname ? ` · ${entry.hostname}` : "";
        const timeLabel = Number.isFinite(entry.lastVisitTime)
          ? ` · ${timeFormatter.format(new Date(entry.lastVisitTime))}`
          : "";
        label.textContent = `${titleText}${hostname}${timeLabel}`;

        row.appendChild(checkbox);
        row.appendChild(label);
        entryList.appendChild(row);
      });
      groupBlock.appendChild(entryList);
      groupsContainer.appendChild(groupBlock);
    });

    form.appendChild(groupsContainer);

    const controls = createElement("div", "history-assistant-confirm-controls");
    const cancel = createElement("button", "history-assistant-chip", "Back");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      if (state.lastResponse && state.lastResponse.action === "search") {
        renderSearchGroups(state.lastResponse);
      } else {
        clearResults();
      }
      state.pendingDeletion = null;
    });

    const confirm = createElement("button", "history-assistant-chip danger", "Delete selected");
    confirm.type = "submit";

    controls.appendChild(cancel);
    controls.appendChild(confirm);
    form.appendChild(controls);
    state.results.appendChild(form);

    state.pendingDeletion = {
      entries: entryCheckboxes,
      summary: payload?.summary || "Delete selected history items",
    };
  }

  function gatherSelectedDeletionEntries() {
    if (!state.pendingDeletion || !Array.isArray(state.pendingDeletion.entries)) {
      return [];
    }
    return state.pendingDeletion.entries
      .filter((input) => input && input.checked)
      .map((input) => ({
        id: input.dataset.entryId,
        url: input.dataset.url,
        lastVisitTime: input.dataset.lastVisitTime ? Number(input.dataset.lastVisitTime) : null,
      }))
      .filter((entry) => entry.url);
  }

  async function confirmDeletionSelection() {
    const selected = gatherSelectedDeletionEntries();
    if (!selected.length) {
      renderFeedback("Select at least one entry to delete.", "warning");
      return;
    }
    try {
      setBusy(true);
      const response = await sendRuntimeMessage({
        type: "SPOTLIGHT_HISTORY_ASSISTANT_DELETE_SELECTION",
        entries: serializeEntries(selected),
      });
      if (!response || !response.success) {
        throw new Error(response?.error || "Deletion failed");
      }
      renderFeedback(response.summary || "Deletion complete.", "success");
      clearResults();
      state.pendingDeletion = null;
    } catch (err) {
      console.warn("History assistant delete error", err);
      renderFeedback(err?.message || "Unable to delete history entries.", "error");
    } finally {
      setBusy(false);
    }
  }

  function attachResultListeners() {
    if (!state.results) {
      return;
    }
    if (state.listenersAttached) {
      return;
    }
    state.results.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) {
        return;
      }
      const button = target.closest("button.history-assistant-chip");
      if (!button) {
        return;
      }
      const action = button.dataset.action;
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "open-group") {
        const groupId = button.dataset.groupId;
        handleGroupOpen(groupId);
      } else if (action === "delete-group") {
        const groupId = button.dataset.groupId;
        handleGroupDelete(groupId);
      } else if (action === "open-entry") {
        const entryId = button.dataset.entryId;
        handleEntryOpen(entryId);
      } else if (action === "delete-entry") {
        const entryId = button.dataset.entryId;
        handleEntryDelete(entryId);
      }
    });
    state.listenersAttached = true;
  }

  function findGroupById(groupId) {
    if (!state.lastResponse || !Array.isArray(state.lastResponse.groups)) {
      return null;
    }
    return state.lastResponse.groups.find((group) => group && group.id === groupId) || null;
  }

  function findEntryById(entryId) {
    if (!state.lastResponse || !Array.isArray(state.lastResponse.groups)) {
      return null;
    }
    for (const group of state.lastResponse.groups) {
      if (!group || !Array.isArray(group.entries)) continue;
      const match = group.entries.find((entry) => entry && entry.id === entryId);
      if (match) {
        return match;
      }
    }
    return null;
  }

  async function handleGroupOpen(groupId) {
    const group = findGroupById(groupId);
    if (!group || !Array.isArray(group.entries)) {
      renderFeedback("That session is no longer available.", "warning");
      return;
    }
    const entries = group.entries.slice(0, QUICK_OPEN_LIMIT);
    await performQuickOpen(entries, group.label);
  }

  async function handleEntryOpen(entryId) {
    const entry = findEntryById(entryId);
    if (!entry) {
      renderFeedback("That entry disappeared before I could open it.", "warning");
      return;
    }
    await performQuickOpen([entry], entry.title || entry.url);
  }

  async function performQuickOpen(entries, label) {
    if (!entries || !entries.length) {
      return;
    }
    try {
      setBusy(true);
      const response = await sendRuntimeMessage({
        type: "SPOTLIGHT_HISTORY_ASSISTANT_OPEN_SELECTION",
        entries: serializeEntries(entries),
      });
      if (!response || !response.success) {
        throw new Error(response?.error || "Unable to open history entries.");
      }
      const summary = response.summary || `Opened ${entries.length} item${entries.length === 1 ? "" : "s"}.`;
      renderFeedback(summary, "success");
    } catch (err) {
      console.warn("History assistant open error", err);
      renderFeedback(err?.message || "Unable to open those pages.", "error");
    } finally {
      setBusy(false);
    }
  }

  function handleGroupDelete(groupId) {
    const group = findGroupById(groupId);
    if (!group) {
      renderFeedback("Nothing to delete there.", "warning");
      return;
    }
    renderDeleteConfirmation({
      summary: `Delete ${group.entryCount || group.entries?.length || 0} item${
        (group.entryCount || group.entries?.length || 0) === 1 ? "" : "s"
      } from ${group.label}?`,
      groups: [group],
    });
  }

  function handleEntryDelete(entryId) {
    const entry = findEntryById(entryId);
    if (!entry) {
      renderFeedback("That entry is already gone.", "warning");
      return;
    }
    const group = findGroupById(entry.groupId);
    renderDeleteConfirmation({
      summary: `Delete ${entry.title || entry.url}?`,
      groups: [
        {
          id: group ? group.id : `entry-${entry.id}`,
          label: group ? group.label : "Selected entry",
          dateLabel: group ? group.dateLabel : "",
          timeLabel: group ? group.timeLabel : "",
          entries: [entry],
        },
      ],
    });
  }

  async function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Runtime message failed"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function runIntent(intent, originalQuery) {
    const requestId = ++state.requestCounter;
    state.pendingRequestId = requestId;
    try {
      setBusy(true);
      const response = await sendRuntimeMessage({
        type: "SPOTLIGHT_HISTORY_ASSISTANT_REQUEST",
        requestId,
        intent,
      });
      if (!response || response.requestId !== requestId) {
        return;
      }
      if (!response.success) {
        throw new Error(response.error || "Assistant request failed");
      }
      state.lastResponse = response;
      if (response.action === "delete" && response.confirmationRequired) {
        renderDeleteConfirmation(response);
        renderFeedback(response.summary || "Review the entries before deleting.", "info");
        return;
      }
      if (response.action === "open") {
        renderFeedback(response.summary || "Tabs reopened.", "success");
        renderSearchGroups(response);
        return;
      }
      renderSearchGroups(response);
      renderFeedback(response.summary || summarizeIntent(intent), "info");
    } catch (err) {
      console.warn("History assistant runtime error", err);
      renderFeedback(err?.message || "That request didn’t work—try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function processQuery(query, options = {}) {
    const originalQuery = options.displayQuery || query;
    resetFeedback();
    clearResults();
    renderFeedback("On it…", "info");
    try {
      setBusy(true);
      const intent = await requestIntent(query);
      state.lastIntent = intent;
      if (state.input) {
        state.input.setAttribute("placeholder", DEFAULT_PLACEHOLDER);
      }
      const confidenceMessage = buildFriendlyConfidence(intent?.confidence);
      if (intent?.needs_follow_up) {
        handleFollowUp(intent, query);
        if (confidenceMessage) {
          renderFeedback(`${confidenceMessage} ${intent.follow_up_question || "Mind clarifying?"}`, "info");
        }
        return;
      }
      const summary = summarizeIntent(intent);
      const message = confidenceMessage ? `${summary} ${confidenceMessage}` : summary;
      renderFeedback(message, "info");
      await runIntent(intent, originalQuery);
    } catch (err) {
      console.warn("History assistant prompt error", err);
      renderFeedback(err?.message || "I couldn’t understand that—try rephrasing.", "error");
    } finally {
      setBusy(false);
    }
  }

  function initialize(options = {}) {
    state.container = options.container || null;
    ensurePanel();
    attachResultListeners();
    return api;
  }

  const api = {
    initialize,
    setActive,
    reset,
    shouldSuppressResults,
    isActive,
  };

  globalThis.SpotlightHistoryAssistant = api;
})();
