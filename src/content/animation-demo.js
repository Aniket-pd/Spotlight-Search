(function () {
  const api = window.SpotlightAnimations || {};

  const prepareList = api.prepareListAnimation?.bind(api);
  const prepareChips = api.prepareChipGroup?.bind(api);
  const prepareMenu = api.prepareMenuAnimation?.bind(api);
  const animateOverlay = api.animateOverlay?.bind(api);
  const animatePanel = api.animatePanel?.bind(api);

  function withPrepare(prepareFn, element, options) {
    if (typeof prepareFn !== "function" || !element) {
      return null;
    }
    return prepareFn(element, options);
  }

  function playAnimation(handle) {
    if (typeof handle === "function") {
      handle();
    }
  }

  function animatePanelVisibility(element, config) {
    if (typeof animatePanel !== "function" || !element) {
      if (element) {
        element.style.display = config?.visible ? config?.display || "block" : "none";
      }
      return Promise.resolve();
    }
    return animatePanel(element, config);
  }

  function toggleOverlayDemo(root) {
    if (!root) return;
    const toggle = root.querySelector("[data-overlay-toggle]");
    const backdrop = root.querySelector("[data-overlay-backdrop]");
    const shell = backdrop?.querySelector(".spotlight-shell");
    const list = root.querySelector("[data-overlay-results]");
    if (!toggle || !backdrop || !shell || !list) {
      return;
    }
    let isOpen = false;
    const sampleResults = [
      { id: "intro", title: "Welcome to Spotlight", subtitle: "Type to search across tabs" },
      { id: "tips", title: "Press / for filters", subtitle: "Try tab:, bookmark:, or history:" },
      { id: "ai", title: "Ask the history assistant", subtitle: "Summarise last week's research" },
    ];

    function renderOverlayResults() {
      const finalize = withPrepare(prepareList, list, {
        key: (element, index) => element?.dataset?.demoId || index,
        enter: () => ({ ty: 12, scale: 0.96, opacity: 0 }),
        exit: () => ({ ty: -10, scale: 0.9, opacity: 0 }),
      });
      list.innerHTML = "";
      sampleResults.forEach((result) => {
        const item = document.createElement("li");
        item.className = "spotlight-result demo-result";
        item.dataset.demoId = result.id;
        const body = document.createElement("div");
        body.className = "spotlight-result-content";
        const title = document.createElement("div");
        title.className = "spotlight-result-title title";
        title.textContent = result.title;
        const meta = document.createElement("div");
        meta.className = "spotlight-result-meta meta";
        meta.textContent = result.subtitle;
        body.appendChild(title);
        body.appendChild(meta);
        item.appendChild(body);
        list.appendChild(item);
      });
      playAnimation(finalize);
    }

    renderOverlayResults();

    toggle.addEventListener("click", () => {
      isOpen = !isOpen;
      if (isOpen) {
        backdrop.classList.add("show");
        backdrop.style.pointerEvents = "auto";
        if (typeof animateOverlay === "function") {
          animateOverlay(backdrop, shell, { open: true });
        } else {
          shell.style.display = "block";
        }
      } else {
        backdrop.style.pointerEvents = "none";
        if (typeof animateOverlay === "function") {
          animateOverlay(backdrop, shell, { open: false }).then(() => {
            backdrop.classList.remove("show");
          });
        } else {
          shell.style.display = "none";
          backdrop.classList.remove("show");
        }
      }
    });
  }

  function toggleChipsDemo(root) {
    const stack = root.querySelector("[data-chip-stack]");
    const shuffleButton = root.querySelector("[data-chip-shuffle]");
    if (!stack || !shuffleButton) {
      return;
    }

    const chipPool = [
      { id: "tabs", label: "Tabs" },
      { id: "bookmarks", label: "Bookmarks" },
      { id: "history", label: "History" },
      { id: "downloads", label: "Downloads" },
      { id: "top-sites", label: "Top sites" },
      { id: "back", label: "Back history" },
      { id: "forward", label: "Forward" },
    ];

    let activeSet = chipPool.slice(0, 4);

    function renderChips() {
      const finalize = withPrepare(prepareChips, stack, {
        key: (element, index) => element?.dataset?.chipId || index,
        enter: () => ({ ty: 8, scale: 0.95, opacity: 0 }),
        exit: () => ({ ty: -8, scale: 0.92, opacity: 0 }),
      });
      stack.innerHTML = "";
      activeSet.forEach((chip, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "spotlight-filter-chip";
        button.textContent = chip.label;
        button.dataset.chipId = chip.id;
        button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
        stack.appendChild(button);
      });
      playAnimation(finalize);
    }

    renderChips();

    shuffleButton.addEventListener("click", () => {
      const shuffled = chipPool.slice().sort(() => Math.random() - 0.5);
      const count = 3 + Math.floor(Math.random() * 3);
      activeSet = shuffled.slice(0, count);
      renderChips();
    });
  }

  function toggleResultsDemo(root) {
    const list = root.querySelector("[data-results-list]");
    const addBtn = root.querySelector("[data-results-add]");
    const removeBtn = root.querySelector("[data-results-remove]");
    const shuffleBtn = root.querySelector("[data-results-shuffle]");
    if (!list || !addBtn || !removeBtn || !shuffleBtn) {
      return;
    }

    let counter = 4;
    let results = [
      { id: "alpha", title: "Read design tokens RFC", meta: "Tab • Today" },
      { id: "beta", title: "Spotlight PRD", meta: "Doc • 2 days ago" },
      { id: "gamma", title: "Bookmarked inspiration", meta: "Bookmark • Last week" },
    ];

    function render() {
      const finalize = withPrepare(prepareList, list, {
        key: (element, index) => element?.dataset?.resultId || index,
        enter: () => ({ ty: 14, scale: 0.96, opacity: 0 }),
        exit: () => ({ ty: -12, scale: 0.9, opacity: 0 }),
      });
      list.innerHTML = "";
      results.forEach((result) => {
        const item = document.createElement("li");
        item.className = "demo-result";
        item.dataset.resultId = result.id;
        const text = document.createElement("div");
        text.className = "title";
        text.textContent = result.title;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = result.meta;
        item.appendChild(text);
        item.appendChild(meta);
        list.appendChild(item);
      });
      playAnimation(finalize);
    }

    render();

    addBtn.addEventListener("click", () => {
      counter += 1;
      const id = `new-${counter}`;
      results.unshift({ id, title: `New result ${counter}`, meta: `Generated • ${new Date().toLocaleTimeString()}` });
      render();
    });

    removeBtn.addEventListener("click", () => {
      results.pop();
      if (!results.length) {
        results = [
          { id: "seed", title: "Seed result", meta: "Fallback dataset" },
        ];
      }
      render();
    });

    shuffleBtn.addEventListener("click", () => {
      results = results.slice().sort(() => Math.random() - 0.5);
      render();
    });
  }

  function toggleMenuDemo(root) {
    const menuList = root.querySelector("[data-menu-list]");
    const toggle = root.querySelector("[data-menu-toggle]");
    if (!menuList || !toggle) {
      return;
    }

    const options = [
      { id: "recent", label: "Recent tabs" },
      { id: "downloads", label: "Downloads" },
      { id: "assist", label: "History assistant" },
      { id: "settings", label: "Open settings" },
    ];

    let open = false;

    function renderOptions() {
      const finalize = withPrepare(prepareMenu, menuList, {
        key: (element, index) => element?.dataset?.optionId || index,
        enter: () => ({ ty: 8, scale: 0.98, opacity: 0 }),
        exit: () => ({ ty: -6, scale: 0.95, opacity: 0 }),
      });
      menuList.innerHTML = "";
      if (!open) {
        playAnimation(finalize);
        return;
      }
      options.forEach((option) => {
        const item = document.createElement("div");
        item.className = "demo-menu-item";
        item.dataset.optionId = option.id;
        item.textContent = option.label;
        menuList.appendChild(item);
      });
      playAnimation(finalize);
    }

    toggle.addEventListener("click", () => {
      open = !open;
      if (open) {
        menuList.classList.add("show");
        renderOptions();
        animatePanelVisibility(menuList, { visible: true, offset: 8, display: "block" });
      } else {
        animatePanelVisibility(menuList, { visible: false, offset: 8, display: "block" }).then(() => {
          menuList.classList.remove("show");
          renderOptions();
        });
      }
    });
  }

  function togglePanelDemo(root) {
    const panel = root.querySelector("[data-panel-content]");
    const toggle = root.querySelector("[data-panel-toggle]");
    if (!panel || !toggle) {
      return;
    }

    let visible = false;

    toggle.addEventListener("click", () => {
      visible = !visible;
      if (visible) {
        panel.classList.add("show");
      }
      animatePanelVisibility(panel, { visible, offset: 12, display: "block" }).then(() => {
        if (!visible) {
          panel.classList.remove("show");
        }
      });
    });
  }

  const overlayDemo = document.querySelector('[data-demo="overlay"]');
  const chipsDemo = document.querySelector('[data-demo="chips"]');
  const resultsDemo = document.querySelector('[data-demo="results"]');
  const menuDemo = document.querySelector('[data-demo="menu"]');
  const panelDemo = document.querySelector('[data-demo="panel"]');

  toggleOverlayDemo(overlayDemo);
  toggleChipsDemo(chipsDemo);
  toggleResultsDemo(resultsDemo);
  toggleMenuDemo(menuDemo);
  togglePanelDemo(panelDemo);
})();
