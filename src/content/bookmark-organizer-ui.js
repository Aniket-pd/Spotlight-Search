(() => {
  const DEFAULT_LABEL = "Organize";
  const RUNNING_LABEL = "Organizing…";
  const SUCCESS_LABEL = "Organized";
  const ERROR_LABEL = "Try Again";
  const RESET_DELAY = 2600;
  const controls = new WeakMap();

  function createControl(options = {}) {
    const { container, onRequestOrganize } = options;
    if (!container || typeof container.appendChild !== "function") {
      return null;
    }

    const existing = controls.get(container);
    if (existing) {
      existing.api.setRequestHandler(onRequestOrganize);
      return existing.api;
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = "spotlight-subfilters-actions";
    actionsEl.setAttribute("hidden", "true");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "spotlight-subfilters-action-button";
    button.setAttribute("aria-label", "Organize bookmarks with AI");
    button.disabled = true;

    const labelSpan = document.createElement("span");
    labelSpan.className = "spotlight-subfilters-action-label";
    labelSpan.textContent = DEFAULT_LABEL;

    const spinner = document.createElement("span");
    spinner.className = "spotlight-spinner";
    spinner.setAttribute("aria-hidden", "true");

    const progressText = document.createElement("span");
    progressText.className = "spotlight-subfilters-action-progress";
    progressText.setAttribute("aria-live", "polite");
    progressText.setAttribute("aria-atomic", "false");
    progressText.setAttribute("hidden", "true");

    button.append(labelSpan, spinner);
    actionsEl.append(button, progressText);
    container.appendChild(actionsEl);

    const state = {
      visible: false,
      enabled: false,
      running: false,
      success: false,
      error: false,
      label: DEFAULT_LABEL,
      progress: "",
    };

    let handler = null;
    let resetTimer = null;

    function applyState() {
      if (state.visible) {
        actionsEl.removeAttribute("hidden");
      } else {
        actionsEl.setAttribute("hidden", "true");
      }

      button.disabled = !state.enabled || state.running;
      button.classList.toggle("running", state.running);
      button.classList.toggle("success", state.success);
      button.classList.toggle("error", state.error);
      labelSpan.textContent = state.label;
      if (state.progress) {
        progressText.textContent = state.progress;
        progressText.removeAttribute("hidden");
      } else {
        progressText.textContent = "";
        progressText.setAttribute("hidden", "true");
      }
    }

    function cancelResetTimer() {
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    }

    function scheduleReset(delay = RESET_DELAY) {
      cancelResetTimer();
      if (!delay) {
        return;
      }
      resetTimer = setTimeout(() => {
        state.success = false;
        state.error = false;
        state.label = DEFAULT_LABEL;
        applyState();
      }, delay);
    }

    button.addEventListener("click", () => {
      if (!handler || !state.enabled || state.running) {
        return;
      }
      handler(api);
    });

    const api = {
      setVisible(value) {
        state.visible = Boolean(value);
        applyState();
      },
      setEnabled(value) {
        state.enabled = Boolean(value);
        applyState();
      },
      setRunning(value, label) {
        cancelResetTimer();
        state.running = Boolean(value);
        state.success = false;
        state.error = false;
        state.label = label || (state.running ? RUNNING_LABEL : DEFAULT_LABEL);
        applyState();
      },
      showSuccess(label, options = {}) {
        cancelResetTimer();
        state.running = false;
        state.success = true;
        state.error = false;
        state.label = label || SUCCESS_LABEL;
        state.progress = "";
        applyState();
        const delay = typeof options.resetDelay === "number" ? options.resetDelay : RESET_DELAY;
        if (delay > 0) {
          scheduleReset(delay);
        }
      },
      showError(label) {
        cancelResetTimer();
        state.running = false;
        state.success = false;
        state.error = true;
        state.label = label || ERROR_LABEL;
        state.progress = "";
        applyState();
      },
      reset(label = DEFAULT_LABEL) {
        cancelResetTimer();
        state.running = false;
        state.success = false;
        state.error = false;
        state.label = label;
        state.progress = "";
        applyState();
      },
      isRunning() {
        return state.running;
      },
      setRequestHandler(callback) {
        handler = typeof callback === "function" ? callback : null;
        state.enabled = Boolean(handler);
        applyState();
      },
      setProgress(value) {
        state.progress = typeof value === "string" ? value : "";
        applyState();
      },
    };

    applyState();
    api.setRequestHandler(onRequestOrganize);

    controls.set(container, { api });
    return api;
  }

  globalThis.SpotlightBookmarkOrganizerUI = {
    createControl,
  };
})();
