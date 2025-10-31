(function () {
  const SPRING_PRESETS = {
    gentle: { stiffness: 210, damping: 28, mass: 1 },
    snappy: { stiffness: 520, damping: 36, mass: 0.85 },
    delicate: { stiffness: 160, damping: 24, mass: 0.92 },
  };

  const activeAnimations = new WeakMap();
  const rafCallbacks = new Set();
  let reduceMotion = false;
  let reduceMotionQuery = null;

  function initReduceMotion() {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotion = Boolean(reduceMotionQuery.matches);
    if (typeof reduceMotionQuery.addEventListener === "function") {
      reduceMotionQuery.addEventListener("change", (event) => {
        reduceMotion = Boolean(event.matches);
      });
    } else if (typeof reduceMotionQuery.addListener === "function") {
      reduceMotionQuery.addListener((event) => {
        reduceMotion = Boolean(event.matches);
      });
    }
  }

  initReduceMotion();

  function prefersReducedMotion() {
    return reduceMotion;
  }

  function spring(config) {
    if (!config) {
      return { ...SPRING_PRESETS.gentle };
    }
    if (typeof config === "string") {
      const preset = SPRING_PRESETS[config];
      return preset ? { ...preset } : { ...SPRING_PRESETS.gentle };
    }
    const preset = config.preset ? SPRING_PRESETS[config.preset] : null;
    return {
      ...(preset || SPRING_PRESETS.gentle),
      ...(typeof config === "object" ? config : {}),
    };
  }

  function cancelAnimation(element) {
    if (!element) return;
    const existing = activeAnimations.get(element);
    if (existing && typeof existing.cancel === "function") {
      existing.cancel();
    }
    activeAnimations.delete(element);
  }

  function runSpring({
    element,
    from,
    to,
    config,
    delay = 0,
    durationRange = { min: 140, max: 320 },
    onUpdate,
    onComplete,
  }) {
    if (!element) {
      return () => {};
    }

    cancelAnimation(element);

    const springConfig = spring(config);
    const state = { ...from };
    const target = { ...to };
    const velocities = {};
    Object.keys(target).forEach((key) => {
      velocities[key] = 0;
      if (typeof state[key] !== "number") {
        state[key] = target[key];
      }
    });

    let cancelled = false;
    let startTime = null;
    let lastTime = null;

    function apply(values) {
      if (typeof onUpdate === "function") {
        onUpdate(values);
      }
    }

    function finish() {
      if (cancelled) return;
      cancelled = true;
      apply(target);
      if (typeof onComplete === "function") {
        onComplete();
      }
    }

    function step(timestamp) {
      if (cancelled) {
        return;
      }
      if (startTime === null) {
        startTime = timestamp;
      }
      if (delay && timestamp - startTime < delay) {
        requestAnimationFrame(step);
        return;
      }
      if (lastTime === null) {
        lastTime = timestamp;
      }
      const elapsed = timestamp - startTime - delay;
      const dt = Math.min((timestamp - lastTime) / 1000, 1 / 24);
      lastTime = timestamp;

      let done = true;
      Object.keys(target).forEach((key) => {
        const toValue = target[key];
        const current = state[key];
        const velocity = velocities[key];
        const delta = current - toValue;
        const accel = (-springConfig.stiffness * delta - springConfig.damping * velocity) / springConfig.mass;
        const nextVelocity = velocity + accel * dt;
        let nextValue = current + nextVelocity * dt;
        if (Math.abs(nextVelocity) > 0.01 || Math.abs(nextValue - toValue) > 0.01) {
          done = false;
        } else {
          nextValue = toValue;
        }
        velocities[key] = nextVelocity;
        state[key] = nextValue;
      });

      apply(state);

      if (elapsed >= durationRange.max) {
        finish();
        return;
      }

      if (!done) {
        requestAnimationFrame(step);
        return;
      }

      finish();
    }

    requestAnimationFrame(step);

    const controller = {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        if (typeof onComplete === "function") {
          onComplete();
        }
      },
    };

    activeAnimations.set(element, controller);
    return () => controller.cancel();
  }

  function buildTransform({ tx = 0, ty = 0, sx = 1, sy = 1, scale = 1 }) {
    const scaleX = sx !== 1 ? sx : scale;
    const scaleY = sy !== 1 ? sy : scale;
    return `translate3d(${tx}px, ${ty}px, 0) scale(${scaleX}, ${scaleY})`;
  }

  function defaultKeyForElement(element, index) {
    if (!element) return index;
    return element.dataset.key || element.dataset.id || element.id || index;
  }

  function measureContainer(container, keyFn) {
    if (!container) {
      return { items: [], rect: null, scrollTop: 0 };
    }
    const rect = container.getBoundingClientRect();
    const children = Array.from(container.children || []);
    const items = children.map((element, index) => ({
      element,
      key: keyFn ? keyFn(element, index) : defaultKeyForElement(element, index),
      rect: element.getBoundingClientRect(),
      opacity: Number.parseFloat(getComputedStyle(element).opacity || "1"),
    }));
    return { items, rect, scrollTop: container.scrollTop || 0 };
  }

  function scheduleRaf(fn) {
    rafCallbacks.add(fn);
    if (rafCallbacks.size === 1) {
      requestAnimationFrame(flushRaf);
    }
  }

  function flushRaf() {
    const callbacks = Array.from(rafCallbacks);
    rafCallbacks.clear();
    callbacks.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Spotlight animation callback failed", error);
      }
    });
  }

  function prepareLayoutAnimation(container, options = {}) {
    const { key, stagger = 0, spring: springConfig, enter, exit, update } = options;
    if (!container || prefersReducedMotion()) {
      return () => {};
    }
    const snapshot = measureContainer(container, key);
    const playQueue = [];

    return function play() {
      scheduleRaf(() => {
        const current = measureContainer(container, key);
        const previousMap = new Map();
        snapshot.items.forEach((item) => {
          previousMap.set(item.key, item);
        });

        const distanceCache = new WeakMap();

        current.items.forEach((item, index) => {
          const prev = previousMap.get(item.key);
          const delay = stagger ? index * stagger : 0;
          if (!item.element) {
            return;
          }
          item.element.style.willChange = "transform, opacity";
          item.element.style.transformOrigin = "50% 50%";
          if (prev) {
            const scrollDelta = (snapshot.scrollTop || 0) - (container.scrollTop || 0);
            const tx = prev.rect.left - item.rect.left;
            const ty = prev.rect.top - item.rect.top + scrollDelta;
            const sx = prev.rect.width / (item.rect.width || 1);
            const sy = prev.rect.height / (item.rect.height || 1);
            const fromState = { tx, ty, sx, sy, opacity: prev.opacity };
            const toState = {
              tx: 0,
              ty: 0,
              sx: 1,
              sy: 1,
              opacity: typeof item.opacity === "number" ? item.opacity : 1,
            };
            const distance = Math.hypot(tx, ty);
            distanceCache.set(item.element, distance);
            item.element.style.transform = buildTransform(fromState);
            item.element.style.opacity = String(fromState.opacity);
            runSpring({
              element: item.element,
              from: fromState,
              to: toState,
              config: springConfig,
              delay,
              durationRange: {
                min: 140,
                max: Math.min(320, 140 + Math.min(distance, 380)),
              },
              onUpdate: (state) => {
                item.element.style.transform = buildTransform(state);
                item.element.style.opacity = String(state.opacity);
              },
              onComplete: () => {
                item.element.style.transform = "";
                item.element.style.opacity = "";
                item.element.style.willChange = "";
                if (typeof update === "function") {
                  update(item.element);
                }
              },
            });
            previousMap.delete(item.key);
          } else {
            const initial = typeof enter === "function"
              ? enter(item.element)
              : { tx: 0, ty: 12, scale: 0.98, opacity: 0 };
            const fromState = {
              tx: initial.tx || 0,
              ty: initial.ty || 0,
              sx: initial.sx || initial.scale || 1,
              sy: initial.sy || initial.scale || 1,
              opacity: initial.opacity == null ? 0 : initial.opacity,
            };
            const toState = { tx: 0, ty: 0, sx: 1, sy: 1, opacity: 1 };
            const distance = Math.hypot(fromState.tx, fromState.ty);
            distanceCache.set(item.element, distance);
            item.element.style.transform = buildTransform(fromState);
            item.element.style.opacity = String(fromState.opacity);
            runSpring({
              element: item.element,
              from: fromState,
              to: toState,
              config: springConfig,
              delay,
              durationRange: {
                min: 140,
                max: Math.min(320, 140 + Math.min(distance, 380)),
              },
              onUpdate: (state) => {
                item.element.style.transform = buildTransform(state);
                item.element.style.opacity = String(state.opacity);
              },
              onComplete: () => {
                item.element.style.transform = "";
                item.element.style.opacity = "";
                item.element.style.willChange = "";
              },
            });
          }
        });

        previousMap.forEach((item) => {
          if (!item.element) {
            return;
          }
          const containerRect = container.getBoundingClientRect();
          const ghost = item.element.cloneNode(true);
          const offsetTop = item.rect.top - containerRect.top;
          const offsetLeft = item.rect.left - containerRect.left;
          if (ghost.classList) {
            ghost.classList.add("spotlight-flip-ghost");
          }
          ghost.style.position = "absolute";
          ghost.style.top = `${offsetTop}px`;
          ghost.style.left = `${offsetLeft}px`;
          ghost.style.width = `${item.rect.width}px`;
          ghost.style.height = `${item.rect.height}px`;
          ghost.style.pointerEvents = "none";
          ghost.style.margin = "0";
          ghost.style.zIndex = "1";
          ghost.style.transformOrigin = "50% 50%";
          ghost.style.willChange = "transform, opacity";
          container.appendChild(ghost);
          const exitState = typeof exit === "function" ? exit(ghost) : { ty: -12, scale: 0.92, opacity: 0 };
          const fromState = { tx: 0, ty: 0, sx: 1, sy: 1, opacity: item.opacity };
          const toState = {
            tx: exitState.tx || 0,
            ty: exitState.ty || 0,
            sx: exitState.sx || exitState.scale || 0.92,
            sy: exitState.sy || exitState.scale || 0.92,
            opacity: exitState.opacity == null ? 0 : exitState.opacity,
          };
          runSpring({
            element: ghost,
            from: fromState,
            to: toState,
            config: springConfig,
            delay: 0,
            durationRange: {
              min: 140,
              max: Math.min(260, 140 + Math.min(Math.hypot(toState.tx, toState.ty), 300)),
            },
            onUpdate: (state) => {
              ghost.style.transform = buildTransform(state);
              ghost.style.opacity = String(state.opacity);
            },
            onComplete: () => {
              ghost.remove();
            },
          });
        });
      });
    };
  }

  function prepareListAnimation(container, options = {}) {
    return prepareLayoutAnimation(container, {
      spring: { preset: "gentle" },
      stagger: 16,
      ...options,
    });
  }

  function prepareChipGroup(container, options = {}) {
    return prepareLayoutAnimation(container, {
      spring: { preset: "delicate" },
      stagger: 12,
      enter: () => ({ ty: 8, scale: 0.95, opacity: 0 }),
      exit: () => ({ ty: -6, scale: 0.94, opacity: 0 }),
      ...options,
    });
  }

  function prepareMenuAnimation(container, options = {}) {
    return prepareLayoutAnimation(container, {
      spring: { preset: "delicate" },
      stagger: 14,
      enter: () => ({ ty: 6, scale: 0.98, opacity: 0 }),
      exit: () => ({ ty: -6, scale: 0.96, opacity: 0 }),
      ...options,
    });
  }

  function animateOverlay(overlay, shell, { open, spring: springConfig } = {}) {
    if (!overlay || !shell) {
      return Promise.resolve();
    }
    if (prefersReducedMotion()) {
      overlay.style.opacity = open ? "1" : "0";
      shell.style.transform = "";
      if (!open) {
        overlay.style.opacity = "0";
      }
      return Promise.resolve();
    }

    overlay.style.willChange = "opacity";
    shell.style.willChange = "transform, opacity";

    if (open) {
      overlay.style.opacity = "0";
      shell.style.transform = "scale(0.96) translate3d(0, 16px, 0)";
      shell.style.opacity = "0";
    }

    return new Promise((resolve) => {
      runSpring({
        element: shell,
        from: open ? { scale: 0.96, ty: 16, opacity: 0 } : { scale: 1, ty: 0, opacity: 1 },
        to: open ? { scale: 1, ty: 0, opacity: 1 } : { scale: 0.96, ty: 16, opacity: 0 },
        config: springConfig || { preset: open ? "gentle" : "delicate" },
        durationRange: { min: 140, max: open ? 280 : 220 },
        onUpdate: (state) => {
          shell.style.transform = buildTransform(state);
          shell.style.opacity = String(state.opacity);
          overlay.style.opacity = open ? String(Math.min(1, state.opacity * 1.1)) : String(state.opacity);
        },
        onComplete: () => {
          shell.style.transform = open ? "" : "scale(0.96) translate3d(0, 16px, 0)";
          shell.style.opacity = open ? "" : "0";
          overlay.style.opacity = open ? "" : "0";
          overlay.style.willChange = "";
          shell.style.willChange = "";
          resolve();
        },
      });
    });
  }

  function animatePanel(panel, { visible, offset = 10, spring: springConfig, display = "block" } = {}) {
    if (!panel) {
      return Promise.resolve();
    }
    if (prefersReducedMotion()) {
      panel.style.opacity = visible ? "1" : "0";
      panel.style.transform = visible ? "" : `translate3d(0, ${offset}px, 0)`;
      panel.style.display = visible ? display : "none";
      return Promise.resolve();
    }

    panel.style.display = display;
    panel.style.willChange = "transform, opacity";
    const fromState = visible ? { ty: offset, opacity: 0 } : { ty: 0, opacity: 1 };
    const toState = visible ? { ty: 0, opacity: 1 } : { ty: offset, opacity: 0 };

    return new Promise((resolve) => {
      runSpring({
        element: panel,
        from: fromState,
        to: toState,
        config: springConfig || { preset: visible ? "gentle" : "delicate" },
        durationRange: { min: 140, max: 260 },
        onUpdate: (state) => {
          panel.style.transform = buildTransform(state);
          panel.style.opacity = String(state.opacity);
        },
        onComplete: () => {
          if (!visible) {
            panel.style.display = "none";
          }
          panel.style.transform = visible ? "" : `translate3d(0, ${offset}px, 0)`;
          panel.style.opacity = visible ? "" : "0";
          panel.style.willChange = "";
          resolve();
        },
      });
    });
  }

  function stagger(elements, amount = 16) {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.map((_, index) => index * amount);
  }

  const api = {
    spring,
    prefersReducedMotion,
    prepareLayoutAnimation,
    prepareListAnimation,
    prepareChipGroup,
    prepareMenuAnimation,
    animateOverlay,
    animatePanel,
    stagger,
  };

  globalThis.SpotlightAnimations = api;
})();
