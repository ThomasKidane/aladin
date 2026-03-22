window._docs_annotate_canvas_by_ext = "clfoagbcljppiogigjclfjnjpcijnijl";

!(function forceHtmlRenderingMode() {
  if (window._docs_flag_initialData) {
    window._docs_flag_initialData["kix-awcp"] = true;
  } else {
    setTimeout(forceHtmlRenderingMode, 0);
  }
})();

(function () {
  window["_docs_force_html_by_ext"] = "pebbhcjfokadbgbnlmogdkkaahmamnap";
})();

(() => {
  const REQUEST_TAG = "__aladin:gdocs:request";
  const RESPONSE_TAG = "__aladin:gdocs:response";

  // Inline logger matching loggingUtils pattern
  // Checks for development mode via global variable (since we can't use import.meta in static JS)
  const isDeveloping = () => {
    if (typeof window === "undefined") return false;
    return window.__GEODO_DEVELOPING === "true" || window.__GEODO_DEVELOPING === true;
  };
  const createLogger = (prefix) => ({
    info: (...args) => {
      if (isDeveloping()) {
        console.log(`[${prefix}] ℹ️`, ...args);
      }
    },
    success: (...args) => {
      if (isDeveloping()) {
        console.log(`[${prefix}] ✅`, ...args);
      }
    },
    error: (...args) => {
      if (isDeveloping()) {
        console.error(`[${prefix}] ❌`, ...args);
      }
    },
    warn: (...args) => {
      if (isDeveloping()) {
        console.warn(`[${prefix}] ⚠️`, ...args);
      }
    },
  });

  const log = createLogger("GDocs");

  let _syncLocator = null;

  function getRawText() {
    const win = window;
    if (_syncLocator) {
      try {
        let base =
          _syncLocator.on === "window"
            ? win[_syncLocator.rootKey]
            : win.document[_syncLocator.rootKey];

        let parentObject = base;
        for (let i = 0; i < _syncLocator.path.length - 1; i++) {
          parentObject = parentObject[_syncLocator.path[i]];
        }

        let v = parentObject[_syncLocator.path[_syncLocator.path.length - 1]];

        if (typeof v === "string") {
          log.info("Found text via locator:", _syncLocator);
          log.info("Parent object:", parentObject);
          log.info("Raw value:", v);
          return v;
        }
      } catch {
        _syncLocator = null;
      }
    }

    const SENTINEL = "\u0003";
    const visited = new WeakSet();

    const dfs = (obj, path) => {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return null;
      visited.add(obj);
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          try {
            const v = obj[k];
            if (typeof v === "string" && v.includes(SENTINEL) && v !== SENTINEL) {
              return { val: v, path: path.concat(k), parent: obj };
            }
            if (typeof v === "object") {
              const res = dfs(v, path.concat(k));
              if (res) return res;
            }
          } catch { }
        }
      }
      return null;
    };

    const windowRootNames = ["_kixApp", "KX_kixApp", "kixApp"];
    const windowRootKeys = Object.getOwnPropertyNames(win).filter((n) =>
      windowRootNames.some((r) => n.includes(r))
    );
    for (const rk of windowRootKeys) {
      const res = dfs(win[rk], []);
      if (res) {
        _syncLocator = { on: "window", rootKey: rk, path: res.path };
        log.info("Found text in window at path:", rk, res.path.join("."));
        log.info("Parent object:", res.parent);
        log.info("Raw value:", res.val);
        return res.val;
      }
    }

    const doc = win.document;
    if (doc) {
      const docRootKeys = Object.getOwnPropertyNames(doc).filter((name) =>
        name.includes("closure_lm_")
      );
      for (const rk of docRootKeys) {
        const res = dfs(doc[rk], []);
        if (res) {
          _syncLocator = { on: "document", rootKey: rk, path: res.path };
          log.info(
            "Found text in document at path:",
            `document.${rk}`,
            res.path.join(".")
          );
          log.info("Parent object:", res.parent);
          log.info("Raw value:", res.val);
          return res.val;
        }
      }
    }

    log.info("Could not find text.");
    return "";
  }

  window.getGDocsText = getRawText;

  const state = {
    originalBackgroundColor: '',
    originalCanvasMethods: new Map(),
    globalFillTextMap: new Map(),
    highlightRangeCache: new Map(),
    claimedHighlightRanges: [],
    canvasObserver: null,
    targetNode: null,
    canvasHostSelector: null,
    canvasRegistry: new Map(),
    lastSpellcheckStrokeTime: 0,
    lastMeaningfulKeyTimestamp: -1,
    ghostTextDebounceTimer: null,
    paragraphMutationCounter: 0,
    initialized: false,
    initializationPromise: null,
    cleanRawText: "",
    lastRawRefresh: 0,
    highlightContainer: null,
    canvasTextSnapshot: "",
    canvasSnapshotVersion: 0,
    hoverRegions: new Map(),
    hoverActiveId: null,
    hoverTrackerAttached: false,
    overlayTimer: null,
    measurementCanvas: null,
    measurementCtx: null,
  };

  const FEEDBACK_OVERLAY_ID = "__aladin-replace-text-feedback";

  function overrideCanvasGetContext() {
    const canvasProto = HTMLCanvasElement.prototype;
    const originalGetContext = canvasProto.getContext;
    if (!originalGetContext) return;

    canvasProto.getContext = function (contextType, ...rest) {
      const ctx = originalGetContext.call(this, contextType, ...rest);
      if (contextType === "2d" && ctx) {
        patchCanvasContext(ctx, this);
      }
      return ctx;
    };
  }

  const constants = {
    SPELLCHECK_SETTLE_MS: 40,
    RAW_REFRESH_INTERVAL_MS: 750,
    ALIGNMENT_LOOKAHEAD: 4000,
    KEY_EVENT_WINDOW_MS: 500,
  };

  const LIGHT_BLUE_UNDERLINE = "rgb(99, 163, 186)";
  const LIGHT_BLUE_SHADE = "rgba(99, 163, 186, 0.16)";

  function ensureMeasurementContext() {
    if (state.measurementCtx) return state.measurementCtx;
    const canvas = document.createElement("canvas");
    canvas.width = 0;
    canvas.height = 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    state.measurementCanvas = canvas;
    state.measurementCtx = ctx;
    return ctx;
  }

  function measureCharOffsetsForText(text, font) {
    if (!text || !font) return null;
    const ctx = ensureMeasurementContext();
    if (!ctx) return null;
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const len = text.length;
    if (!len) return [0];
    const offsets = new Array(len + 1);
    offsets[0] = 0;
    let prefix = "";
    for (let i = 0; i < len; i++) {
      prefix += text[i];
      offsets[i + 1] = ctx.measureText(prefix).width;
    }
    return offsets;
  }

  function ensureEntryCharOffsets(entry) {
    if (!entry || !entry.text || !entry.font) return null;
    if (
      Array.isArray(entry.charOffsets) &&
      entry.charOffsets.length === entry.text.length + 1
    ) {
      return entry.charOffsets;
    }
    const offsets = measureCharOffsetsForText(entry.text, entry.font);
    if (offsets) {
      entry.charOffsets = offsets;
      return offsets;
    }
    return null;
  }

  const CANVAS_HOST_SELECTORS = [
    ".kix-rotatingtilemanager-content",
    ".kix-rotatingtilemanager",
    ".kix-appview-editor",
    "#docs-editor-container",
    "body",
  ];

  function findCanvasHost() {
    for (const selector of CANVAS_HOST_SELECTORS) {
      if (selector === "body") {
        if (document.body) {
          return { node: document.body, selector };
        }
        continue;
      }
      const node = document.querySelector(selector);
      if (node) {
        return { node, selector };
      }
    }
    return null;
  }

  function waitForCanvasHost(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        const found = findCanvasHost();
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for Docs canvas host (${CANVAS_HOST_SELECTORS.join(
                ", "
              )})`
            )
          );
          return;
        }
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  function getCanvasUid(canvas) {
    if (!canvas.dataset.uid) {
      canvas.dataset.uid = Math.random().toString(36).substring(2);
    }
    state.canvasRegistry.set(canvas.dataset.uid, canvas);
    return canvas.dataset.uid;
  }

  function getCanvasByUid(uid) {
    if (!uid || !state.canvasRegistry) return null;
    const cached = state.canvasRegistry.get(uid);
    if (cached && document.contains(cached)) {
      return cached;
    }
    const fallback = document.querySelector(`canvas[data-uid="${uid}"]`);
    if (fallback) {
      state.canvasRegistry.set(uid, fallback);
      return fallback;
    }
    state.canvasRegistry.delete(uid);
    return null;
  }

  function toDeviceY(y, mtx) {
    return mtx.f + mtx.d * y;
  }

  function getScrollX() {
    if (typeof window !== "undefined" && typeof window.scrollX === "number") {
      return window.scrollX;
    }
    const doc = typeof document !== "undefined" ? document.documentElement : null;
    if (doc && typeof doc.scrollLeft === "number") {
      return doc.scrollLeft;
    }
    return 0;
  }

  function getScrollY() {
    if (typeof window !== "undefined" && typeof window.scrollY === "number") {
      return window.scrollY;
    }
    const doc = typeof document !== "undefined" ? document.documentElement : null;
    if (doc && typeof doc.scrollTop === "number") {
      return doc.scrollTop;
    }
    return 0;
  }

  function computeCanvasPageRect(canvas) {
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") {
      return null;
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      left: bounds.left + getScrollX(),
      top: bounds.top + getScrollY(),
      width: bounds.width,
      height: bounds.height,
    };
  }

  function buildVerboseLog(...args) {
    return args;
  }
  function rememberLineForCaret() { }
  function updateParagraphStructure() { }
  function isCaretAtLineEnd() {
    return false;
  }
  function isCaretAtParagraphEnd() {
    return false;
  }
  function showGhostTextAfterDebounce() { }

  const INVISIBLE_CONTROL_REGEX =
    /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u2060-\u2064\u061C\u00AD\u034F\uFEFF]/g;

  let trustedHtmlPolicy = null;
  function setTrustedInnerHTML(target, html) {
    if (!target) return;
    const markup = typeof html === "string" ? html : "";
    const tt = window.trustedTypes;
    if (tt) {
      if (!trustedHtmlPolicy) {
        try {
          trustedHtmlPolicy =
            tt.getPolicy && tt.getPolicy("aladin#gdocs#innerHTML")
              ? tt.getPolicy("aladin#gdocs#innerHTML")
              : tt.createPolicy("aladin#gdocs#innerHTML", {
                createHTML(value) {
                  return value;
                },
              });
        } catch (err) {
          log.warn("Failed to establish TrustedHTML policy", err);
          trustedHtmlPolicy = null;
        }
      }
      if (trustedHtmlPolicy) {
        target.innerHTML = trustedHtmlPolicy.createHTML(markup);
        return;
      }
    }
    target.innerHTML = markup;
  }

  function stripInvisibleControls(text) {
    if (!text) return "";
    return text.replace(INVISIBLE_CONTROL_REGEX, "");
  }

  const APOSTROPHE_VARIANTS_REGEX = /[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\uFF07]/g;
  function normalizeApostrophes(text) {
    if (!text) return "";
    return text.replace(APOSTROPHE_VARIANTS_REGEX, "'");
  }

  function normalizeMatchSignature(text) {
    if (!text) return "";
    return stripInvisibleControls(text)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function resetClaimedHighlightRanges() {
    state.claimedHighlightRanges = [];
  }

  function reserveHighlightRange(start, end) {
    if (typeof start === "number" && typeof end === "number" && end > start) {
      state.claimedHighlightRanges.push({ start, end });
    }
  }

  function rangeOverlapsExisting(start, end) {
    if (typeof start !== "number" || typeof end !== "number" || end <= start) {
      return false;
    }
    return state.claimedHighlightRanges.some(
      (range) => !(end <= range.start || start >= range.end)
    );
  }

  function normalizeRawText(raw) {
    if (!raw) return "";
    let text = raw;
    try {
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))
      ) {
        text = JSON.parse(text);
      }
    } catch {
      // ignore
    }
    // Normalize line endings but preserve all other characters to prevent alignment issues.
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalizeApostrophes(stripInvisibleControls(normalized));
  }

  function normalizeCanvasText(text) {
    if (!text) return "";
    // Normalize line endings but preserve all other characters to prevent alignment issues.
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalizeApostrophes(stripInvisibleControls(normalized));
  }

  function snippetForLog(text, maxLen = 140) {
    if (!text) return "";
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > maxLen ? collapsed.slice(0, maxLen) + "…" : collapsed;
  }

  function refreshCleanRawText(force = false) {
    const now = Date.now();
    const needsRefresh =
      force ||
      !state.cleanRawText ||
      now - state.lastRawRefresh >= constants.RAW_REFRESH_INTERVAL_MS;
    if (!needsRefresh) {
      return state.cleanRawText;
    }
    state.lastRawRefresh = now;
    if (typeof window.getGDocsText !== "function") {
      return state.cleanRawText;
    }
    let raw = "";
    try {
      raw = window.getGDocsText() || "";
    } catch (err) {
      log.warn("Failed to fetch raw text for alignment", err);
      return state.cleanRawText;
    }
    const clean = normalizeRawText(raw);
    if (clean !== state.cleanRawText) {
      state.cleanRawText = clean;
    }
    return state.cleanRawText;
  }

  const SKIPPABLE_CODEPOINTS = (() => {
    const codes = new Set([
      3,
      9,
      10,
      11,
      12,
      13,
      32,
      160,
      173,
      5760,
      6158,
      8232,
      8233,
      8239,
      8287,
      12288,
      65279,
      0x2022,
      0x2043,
      0x25e6,
      0x25cb,
      0x25cf,
    ]);
    const addRange = (start, end) => {
      for (let cp = start; cp <= end; cp++) {
        codes.add(cp);
      }
    };
    addRange(8192, 8202); // U+2000 - U+200A spaces etc.
    addRange(0x200b, 0x200f); // zero-width, LRM/RLM
    addRange(0x202a, 0x202e); // directional embeddings
    addRange(0x2066, 0x2069); // isolates
    addRange(0x2060, 0x2064); // word joiner etc.
    codes.add(0x061c); // Arabic letter mark
    codes.add(0x034f); // Combining grapheme joiner
    return codes;
  })();

  function isSkippableWhitespace(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return SKIPPABLE_CODEPOINTS.has(code);
  }

  function tryMatchAt(raw, needle, start) {
    if (!needle) return null;
    const rawLen = raw.length;
    const needleLen = needle.length;
    let i = start;
    let j = 0;
    let firstMatch = -1;
    while (i < rawLen && j < needleLen) {
      const rc = raw[i];
      const ec = needle[j];
      if (rc === ec) {
        if (firstMatch === -1) firstMatch = i;
        i++;
        j++;
        continue;
      }
      if (isSkippableWhitespace(rc)) {
        i++;
        continue;
      }
      if (isSkippableWhitespace(ec)) {
        j++;
        continue;
      }
      return null;
    }
    if (j === needleLen) {
      if (firstMatch === -1) firstMatch = start;
      return { start: firstMatch, end: i };
    }
    return null;
  }

  function locateInRaw(raw, needle, start) {
    if (!needle || !raw) return null;
    const rawLen = raw.length;
    if (!rawLen) return null;
    const maxStart = Math.min(
      rawLen - 1,
      Math.max(0, start) + constants.ALIGNMENT_LOOKAHEAD
    );
    for (let pos = Math.max(0, start); pos <= maxStart; pos++) {
      const match = tryMatchAt(raw, needle, pos);
      if (match) return match;
    }
    return null;
  }

  function orderFillEntries() {
    return Array.from(state.globalFillTextMap.entries()).sort((a, b) => {
      const bboxA = a[1].bbox;
      const bboxB = b[1].bbox;
      if (bboxA.y !== bboxB.y) return bboxA.y - bboxB.y;
      if (bboxA.x !== bboxB.x) return bboxA.x - bboxB.x;
      return 0;
    });
  }

  function registerHoverRegion(id, data) {
    let entry = state.hoverRegions.get(id);
    if (!entry) {
      entry = {
        rects: [],
        shades: [],
        underlines: [],
        underlineRects: [],
        color: data.color,
        payload: data.payload || null,
        tooltipRect: null,
      };
      state.hoverRegions.set(id, entry);
    }
    if (data.payload && !entry.payload) {
      entry.payload = data.payload;
    }
    entry.rects.push(data.rect);
    entry.shades.push(data.shade);
    entry.underlines.push(data.underline);
    entry.underlineRects.push([
      data.absUnderlineTop,
      data.absUnderlineBottom,
    ]);
  }

  function applyHoverVisual(entry, active) {
    if (!entry) return;
    entry.shades.forEach((shade) => {
      shade.style.opacity = active ? "1" : "0";
    });
    entry.underlines.forEach((line) => {
      line.style.opacity = active ? "1" : "0.85";
    });
  }

  function updateHoverState(id) {
    if (state.hoverActiveId === id) return;
    if (state.hoverActiveId) {
      applyHoverVisual(state.hoverRegions.get(state.hoverActiveId), false);
    }
    state.hoverActiveId = id;
    if (id) {
      applyHoverVisual(state.hoverRegions.get(id), true);
    }
    notifyHoverChange(id);
  }

  function updateHoverEntryBounds(entry) {
    if (!entry || !entry.underlines || entry.underlines.length === 0) return null;
    const target = entry.underlines[0];
    if (!target || typeof target.getBoundingClientRect !== "function") return null;
    const rect = target.getBoundingClientRect();
    const absLeft = rect.left + window.scrollX;
    const absRight = rect.right + window.scrollX;
    const absTop = rect.top + window.scrollY;
    const absBottom = rect.bottom + window.scrollY;
    entry.rects[0] = [absLeft, absRight, absTop, absBottom];
    entry.underlineRects[0] = [absTop, absBottom];
    return entry.rects[0];
  }

  function refreshHoverGeometry() {
    if (!state.hoverRegions) return;
    for (const entry of state.hoverRegions.values()) {
      updateHoverEntryBounds(entry);
    }
  }

  function ensureHoverTracker() {
    if (state.hoverTrackerAttached) return;
    const handleMove = (event) => {
      const target = event.target;
      const x =
        event.clientX +
        ("scrollX" in window ? window.scrollX : document.documentElement.scrollLeft);
      const y =
        event.clientY +
        ("scrollY" in window ? window.scrollY : document.documentElement.scrollTop);
      let matched = null;
      for (const [id, entry] of state.hoverRegions.entries()) {
        const hitBase = entry.rects.some(([left, right, top, bottom]) => {
          return x >= left && x <= right && y >= top && y <= bottom;
        });
        const hitTooltip =
          !hitBase &&
          entry.tooltipRect &&
          x >= entry.tooltipRect[0] &&
          x <= entry.tooltipRect[1] &&
          y >= entry.tooltipRect[2] &&
          y <= entry.tooltipRect[3];
        const hit = hitBase || hitTooltip;
        if (hit) {
          matched = id;
          break;
        }
      }
      updateHoverState(matched);
    };
    const handleLeave = () => updateHoverState(null);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerdown", handleMove, true);
    document.addEventListener("pointerleave", handleLeave, true);
    state.hoverTrackerAttached = true;
  }

  function notifyHoverChange(activeId) {
    let payload = null;
    if (activeId) {
      const entry = state.hoverRegions.get(activeId);
      if (entry) {
        const rectCoords = updateHoverEntryBounds(entry) || entry.rects[0];
        if (rectCoords) {
          const [left, right, top, bottom] = rectCoords;
          const underlineBounds = entry.underlineRects?.[0];
          const underlineViewportTop =
            underlineBounds && typeof underlineBounds[0] === "number"
              ? underlineBounds[0] - window.scrollY
              : top;
          const underlineViewportBottom =
            underlineBounds && typeof underlineBounds[1] === "number"
              ? underlineBounds[1] - window.scrollY
              : underlineViewportTop;
          payload = {
            id: activeId,
            chipId: entry.payload?.chipId || null,
            newText: entry.payload?.newText || "",
            rect: {
              left,
              top,
              width: right - left,
              height: bottom - top,
              right,
              bottom,
              viewportLeft: left - window.scrollX,
              viewportTop: top - window.scrollY,
              underlineViewportTop,
              underlineViewportBottom,
            },
          };
        }
      }
    }
    window.postMessage(
      {
        __aladinGDocsHover: true,
        payload,
      },
      "*"
    );
  }

  function getHighlightHost() {
    const selectors = [
      ".kix-appview-editor",
      ".kix-rotatingtilemanager-content",
      ".kix-rotatingtilemanager",
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function ensureHighlightLayer() {
    if (state.highlightContainer && document.contains(state.highlightContainer)) {
      return state.highlightContainer;
    }
    const host = getHighlightHost();
    if (!host) {
      log.warn("Unable to locate highlight host.");
      return null;
    }
    const computed = window.getComputedStyle(host);
    if (computed.position === "static") {
      host.style.position = "relative";
    }
    const container = document.createElement("div");
    container.id = "aladin-docs-highlight-layer";
    container.style.position = "absolute";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.pointerEvents = "none";
    container.style.zIndex = "1000";
    host.appendChild(container);
    state.highlightContainer = container;
    return container;
  }

  function clearHighlightLayer() {
    if (!state.highlightContainer) return;
    try {
      state.highlightContainer.remove();
    } catch { }
    state.highlightContainer = null;
    if (state.hoverRegions) {
      state.hoverRegions.clear();
    }
    updateHoverState(null);
  }

  function showFeedbackOverlay(durationMs = 5000) {
    if (typeof document === "undefined") return;
    let overlay = document.getElementById(FEEDBACK_OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = FEEDBACK_OVERLAY_ID;
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100vw";
      overlay.style.height = "100vh";
      overlay.style.background = "rgba(0, 0, 0, 0.28)";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147482000";
      overlay.style.opacity = "0";
      overlay.style.transition = "opacity 160ms ease";
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        overlay && (overlay.style.opacity = "1");
      });
    } else {
      overlay.style.opacity = "1";
    }
    if (state.overlayTimer) {
      clearTimeout(state.overlayTimer);
    }
    state.overlayTimer = window.setTimeout(() => {
      const node = document.getElementById(FEEDBACK_OVERLAY_ID);
      if (node) {
        node.style.opacity = "0";
        setTimeout(() => {
          try {
            node.remove();
          } catch { }
        }, 200);
      }
      state.overlayTimer = null;
    }, Math.max(0, durationMs));
  }

  function focusDocsEditor() {
    const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
    if (!iframe) return null;
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) return null;
    const editable = doc.querySelector("[contenteditable=true]");
    if (!editable) return null;
    win.focus();
    editable.focus();
    return { iframe, doc, win, editable };
  }

  function dispatchDocsKey(target, type, key) {
    if (!target) return;
    const event = new KeyboardEvent(type, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
  }

  function dispatchDocsMouse(target, type, x, y, opts = {}) {
    if (!target) return;
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: Math.round(x),
      clientY: Math.round(y),
      buttons: type === "mouseup" ? 0 : 1,
      ...opts,
    });
    target.dispatchEvent(event);
  }

  function runAnimationSteps(steps) {
    if (!steps.length) return;
    let idx = 0;
    const drive = () => {
      const fn = steps[idx];
      if (typeof fn === "function") {
        try {
          fn();
        } catch (err) {
          log.warn("replace-text step error", err);
        }
      }
      idx++;
      if (idx < steps.length) {
        requestAnimationFrame(drive);
      }
    };
    requestAnimationFrame(drive);
  }

  function replacementBoundsForChip(chipId) {
    if (!state.hoverRegions || !chipId) return null;
    const matches = [];
    for (const entry of state.hoverRegions.values()) {
      if (entry?.payload?.chipId === chipId) {
        matches.push(entry);
      }
    }
    if (!matches.length) return null;
    const normalizedSegments = [];
    matches.forEach((entry) => {
      entry.rects.forEach((rect, idx) => {
        const liveUnderline = entry.underlines?.[idx];
        const liveBounds =
          liveUnderline && typeof liveUnderline.getBoundingClientRect === "function"
            ? liveUnderline.getBoundingClientRect()
            : null;
        const absLeft =
          liveBounds?.left != null ? liveBounds.left + window.scrollX : rect?.[0];
        const absRight =
          liveBounds?.right != null ? liveBounds.right + window.scrollX : rect?.[1];
        const absTop =
          liveBounds?.top != null ? liveBounds.top + window.scrollY : rect?.[2];
        const absBottom =
          liveBounds?.bottom != null ? liveBounds.bottom + window.scrollY : rect?.[3];
        if (
          typeof absLeft !== "number" ||
          typeof absRight !== "number" ||
          typeof absTop !== "number" ||
          typeof absBottom !== "number"
        ) {
          return;
        }
        const underlinePair = entry.underlineRects?.[idx] || null;
        const underlineTop =
          liveBounds?.top != null
            ? liveBounds.top + window.scrollY
            : underlinePair && typeof underlinePair[0] === "number"
              ? underlinePair[0]
              : absTop;
        const underlineBottom =
          liveBounds?.bottom != null
            ? liveBounds.bottom + window.scrollY
            : underlinePair && typeof underlinePair[1] === "number"
              ? underlinePair[1]
              : absBottom;
        normalizedSegments.push({
          rect: [absLeft, absRight, absTop, absBottom],
          underlineTop,
          underlineBottom,
          underlineMid: (underlineTop + underlineBottom) / 2,
        });
      });
    });
    if (!normalizedSegments.length) return null;
    const firstSegment = normalizedSegments.reduce((best, seg) => {
      if (!best) return seg;
      if (seg.underlineTop < best.underlineTop) return seg;
      if (seg.underlineTop === best.underlineTop) {
        if (seg.rect[2] < best.rect[2]) return seg;
        if (seg.rect[2] === best.rect[2] && seg.rect[0] < best.rect[0]) {
          return seg;
        }
      }
      return best;
    }, null);
    const lastSegment = normalizedSegments.reduce((best, seg) => {
      if (!best) return seg;
      if (seg.underlineBottom > best.underlineBottom) return seg;
      if (seg.underlineBottom === best.underlineBottom) {
        if (seg.rect[3] > best.rect[3]) return seg;
        if (seg.rect[3] === best.rect[3] && seg.rect[1] > best.rect[1]) {
          return seg;
        }
      }
      return best;
    }, null);
    if (!firstSegment || !lastSegment) {
      return null;
    }
    const startYAbs = lastSegment.underlineMid;
    const endYAbs = firstSegment.underlineMid;
    return {
      startClientX: lastSegment.rect[1] - window.scrollX - 1,
      startClientY: startYAbs - window.scrollY,
      endClientX: firstSegment.rect[0] - window.scrollX + 1,
      endClientY: endYAbs - window.scrollY,
    };
  }

  function pasteReplacementText(editable, doc, text) {
    if (!editable) return;
    const dt = new DataTransfer();
    dt.setData("text/plain", text || "");
    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(pasteEvent);
    if (doc && typeof doc.execCommand === "function") {
      if (text && text.length) {
        doc.execCommand("insertText", false, text);
      } else {
        doc.execCommand("delete");
      }
    }
  }

  function applyReplaceTextForChip(chipId, newText) {
    const gesturesTarget = document.querySelector(
      ".kix-rotatingtilemanager-content"
    );
    if (!gesturesTarget) {
      log.warn("Cannot locate tile manager for replace-text.");
      return false;
    }
    const bounds = replacementBoundsForChip(chipId);
    if (!bounds) {
      log.warn("Unable to resolve highlight bounds for chip", chipId);
      return false;
    }
    const focusCtx = focusDocsEditor();
    if (!focusCtx) {
      log.warn("Unable to focus Docs editor for replace-text.");
      return false;
    }
    const textValue =
      typeof newText === "string" && newText.length ? newText : "";
    const steps = [
      () =>
        dispatchDocsMouse(
          gesturesTarget,
          "mousedown",
          bounds.startClientX,
          bounds.startClientY
        ),
      () =>
        dispatchDocsMouse(
          gesturesTarget,
          "mouseup",
          bounds.startClientX,
          bounds.startClientY
        ),
      () => dispatchDocsKey(focusCtx.doc, "keydown", "Shift"),
      () =>
        dispatchDocsMouse(
          gesturesTarget,
          "mousedown",
          bounds.endClientX,
          bounds.endClientY,
          { shiftKey: true }
        ),
      () =>
        dispatchDocsMouse(
          gesturesTarget,
          "mouseup",
          bounds.endClientX,
          bounds.endClientY,
          { shiftKey: true }
        ),
      () => dispatchDocsKey(focusCtx.doc, "keyup", "Shift"),
      () => pasteReplacementText(focusCtx.editable, focusCtx.doc, textValue),
    ];
    runAnimationSteps(steps);
    return true;
  }

  function rebuildCanvasSnapshot(reason) {
    const orderedEntries = orderFillEntries();
    let combined = "";
    orderedEntries.forEach(([key, entry]) => {
      const normalized = entry.text || "";
      entry.rawStart = combined.length;
      combined += normalized;
      entry.rawEnd = combined.length;
    });
    state.canvasTextSnapshot = combined;
    state.canvasSnapshotVersion = (state.canvasSnapshotVersion || 0) + 1;
    state.highlightRangeCache.clear();
    log.info("Canvas snapshot rebuilt", {
      reason,
      version: state.canvasSnapshotVersion,
      length: combined.length,
      entryCount: orderedEntries.length,
    });
    return combined;
  }

  function ensureCanvasSnapshot(reason) {
    if (!state.canvasTextSnapshot) {
      return rebuildCanvasSnapshot(reason);
    }
    return state.canvasTextSnapshot;
  }

  function sanitizeNeedle(text) {
    if (!text) return "";
    const normalized = text.replace(/\r\n/g, "\n");
    return normalizeApostrophes(stripInvisibleControls(normalized));
  }

  function matchHighlightByText(text, cursorHint = 0) {
    const normalizedNeedle = sanitizeNeedle(text || "");
    const trimmedNeedle = normalizedNeedle.trim();
    if (!trimmedNeedle) return null;

    const haystack = ensureCanvasSnapshot("match-highlight");

    // Strategy 1: Exact match with trimmed text
    let idx = haystack.indexOf(trimmedNeedle, cursorHint);
    if (idx !== -1) {
      log.info("Matched with exact search", {
        needle: trimmedNeedle,
        cursor: cursorHint,
        index: idx,
      });
      return { start: idx, end: idx + trimmedNeedle.length, strategy: "exact" };
    }

    // Strategy 2: Collapse internal whitespace differences and retry
    const collapsed = trimmedNeedle.replace(/\s+/g, " ");
    if (collapsed !== trimmedNeedle) {
      idx = haystack.indexOf(collapsed, cursorHint);
      if (idx !== -1) {
        log.info("Matched with collapsed-whitespace search", {
          needle: trimmedNeedle,
          cursor: cursorHint,
          range: [idx, idx + collapsed.length],
        });
        return {
          start: idx,
          end: idx + collapsed.length,
          strategy: "collapsed-whitespace",
        };
      }
    }

    // Strategy 3: whitespace-/control-insensitive fuzzy match that can span multiple lines
    const fuzzy = fuzzyMatchHighlightByWhitespace(haystack, trimmedNeedle, cursorHint);
    if (fuzzy) {
      return fuzzy;
    }

    log.warn("Failed to match text with all strategies", {
      needle: trimmedNeedle,
      cursor: cursorHint,
    });
    return null;
  }

  function fuzzyMatchHighlightByWhitespace(haystack, needle, cursorHint) {
    const compressedNeedle = stripInvisibleControls(needle)
      .replace(/\s+/g, "")
      .trim();
    if (!compressedNeedle.length) return null;
    const hayLen = haystack.length;
    const startCursor = Math.max(0, cursorHint);

    for (let i = startCursor; i < hayLen; i++) {
      const ch = haystack[i];
      if (isSkippableWhitespace(ch)) continue;
      if (ch !== compressedNeedle[0]) continue;

      let hayIdx = i;
      let needleIdx = 0;
      let matchStart = -1;
      while (hayIdx < hayLen && needleIdx < compressedNeedle.length) {
        const hayChar = haystack[hayIdx];
        if (isSkippableWhitespace(hayChar)) {
          hayIdx++;
          continue;
        }
        if (hayChar === compressedNeedle[needleIdx]) {
          if (matchStart === -1) matchStart = hayIdx;
          needleIdx++;
          hayIdx++;
        } else {
          matchStart = -1;
          break;
        }
      }
      if (needleIdx === compressedNeedle.length && matchStart !== -1) {
        while (hayIdx < hayLen && isSkippableWhitespace(haystack[hayIdx])) {
          hayIdx++;
        }
        log.info("Matched with fuzzy whitespace-insensitive search", {
          needle,
          cursor: cursorHint,
          range: [matchStart, hayIdx],
        });
        return {
          start: matchStart,
          end: hayIdx,
          strategy: "fuzzy-whitespace",
        };
      }
    }
    return null;
  }

  function resolveEntryScale(entry) {
    const transform = entry.transformMatrix || {};
    const deviceScaleX = transform.a || 1;
    const deviceScaleY =
      transform.d || (transform.a && Math.abs(transform.a) > 0 ? transform.a : 1);
    const canvasWidth =
      entry.canvasWidth ||
      (entry.pageRect?.width || 0) * Math.max(deviceScaleX, 1) ||
      1;
    const canvasHeight =
      entry.canvasHeight ||
      (entry.pageRect?.height || 0) * Math.max(deviceScaleY, 1) ||
      1;
    const styleWidth =
      canvasWidth / (deviceScaleX || 1) || entry.pageRect?.width || 1;
    const styleHeight =
      canvasHeight / (deviceScaleY || 1) || entry.pageRect?.height || 1;
    const pageScaleX =
      styleWidth && entry.pageRect?.width
        ? entry.pageRect.width / styleWidth
        : 1;
    const pageScaleY =
      styleHeight && entry.pageRect?.height
        ? entry.pageRect.height / styleHeight
        : pageScaleX;
    return {
      transform,
      deviceScaleX: deviceScaleX || 1,
      deviceScaleY: deviceScaleY || 1,
      pageScaleX: pageScaleX || 1,
      pageScaleY: pageScaleY || 1,
    };
  }

  function resolveEntryPageRect(entry, cache) {
    if (!entry) return null;
    const cacheKey = entry.canvasUid || entry.key || null;
    if (cacheKey && cache && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    let rect = entry.pageRect || null;
    if (entry.canvasUid) {
      const canvas = getCanvasByUid(entry.canvasUid);
      if (canvas) {
        const refreshedRect = computeCanvasPageRect(canvas);
        if (refreshedRect) {
          rect = refreshedRect;
        }
      }
    }
    if (cacheKey && cache && rect) {
      cache.set(cacheKey, rect);
    }
    return rect;
  }

  function computeHighlightRects(entries, rangeStart, rangeEnd, hostElement) {
    const rects = [];
    const debugDetails = [];

    log.info("--- Computing Highlight Rects ---", {
      rangeStart,
      rangeEnd,
      entryCount: entries.length,
      canvasSnapshotLength: state.canvasTextSnapshot.length,
    });
    if (entries.length > 0) {
      log.info(
        "Sample of first 5 canvas text entries:",
        entries
          .slice(0, 5)
          .map((e) => ({ text: snippetForLog(e.text), range: [e.rawStart, e.rawEnd] }))
      );
    }

    if (!hostElement) {
      debugDetails.push({ reason: "missing-host", rangeStart, rangeEnd });
      return { rects, debugDetails, rangeStart, rangeEnd };
    }
    if (!entries || !entries.length) {
      debugDetails.push({ reason: "no-entries", rangeStart, rangeEnd });
      return { rects, debugDetails, rangeStart, rangeEnd };
    }

    const hostBounds = hostElement.getBoundingClientRect();
    const hostOffsetLeft = hostBounds.left + window.scrollX;
    const hostOffsetTop = hostBounds.top + window.scrollY;
    const hostScrollLeft =
      typeof hostElement.scrollLeft === "number" ? hostElement.scrollLeft : 0;
    const hostScrollTop =
      typeof hostElement.scrollTop === "number" ? hostElement.scrollTop : 0;
    const clampedStart = Math.max(0, rangeStart);
    const clampedEnd = Math.max(clampedStart, rangeEnd);
    const pageRectCache = new Map();

    for (const entry of entries) {
      const detail = {
        key: entry.key,
        text: snippetForLog(entry.text),
        rawStart: entry.rawStart,
        rawEnd: entry.rawEnd,
        bbox: entry.bbox,
      };

      if (
        entry.rawStart == null ||
        entry.rawEnd == null ||
        entry.rawEnd <= clampedStart ||
        entry.rawStart >= clampedEnd
      ) {
        detail.skipReason = "out-of-range";
        if (debugDetails.filter((d) => d.skipReason === "out-of-range").length < 5) {
          log.info("Entry skipped (out of range)", {
            entryRange: [entry.rawStart, entry.rawEnd],
            highlightRange: [clampedStart, clampedEnd],
            text: snippetForLog(entry.text),
          });
        }
        debugDetails.push(detail);
        continue;
      }

      const span = entry.rawEnd - entry.rawStart;
      if (span <= 0 || entry.bbox.width <= 0 || entry.bbox.height <= 0) {
        detail.skipReason = "degenerate-span";
        debugDetails.push(detail);
        continue;
      }

      const overlapStart = Math.max(entry.rawStart, clampedStart);
      const overlapEnd = Math.min(entry.rawEnd, clampedEnd);
      if (overlapEnd <= overlapStart) {
        detail.skipReason = "no-overlap";
        debugDetails.push(detail);
        continue;
      }

      const localStartIndex = Math.max(
        0,
        Math.min(span, overlapStart - entry.rawStart)
      );
      const localEndIndex = Math.max(
        localStartIndex,
        Math.min(span, overlapEnd - entry.rawStart)
      );

      let logicalStart = null;
      let logicalEnd = null;
      let relativeWidth = null;
      let usedCharOffsets = false;

      if (
        Array.isArray(entry.charOffsets) &&
        entry.charOffsets.length === span + 1
      ) {
        const localStartOffset = entry.charOffsets[localStartIndex];
        const localEndOffset = entry.charOffsets[localEndIndex];
        if (
          typeof localStartOffset === "number" &&
          typeof localEndOffset === "number" &&
          localEndOffset > localStartOffset
        ) {
          relativeWidth = localEndOffset - localStartOffset;
          if (relativeWidth > 0.5) {
            logicalStart = entry.bbox.x + localStartOffset;
            logicalEnd = entry.bbox.x + localEndOffset;
            usedCharOffsets = true;
          }
        }
      }

      if (logicalStart == null || logicalEnd == null) {
        const fractionStart = (overlapStart - entry.rawStart) / span;
        const fractionEnd = (overlapEnd - entry.rawStart) / span;
        if (fractionEnd <= fractionStart) {
          detail.skipReason = "no-overlap";
          debugDetails.push(detail);
          continue;
        }
        relativeWidth = entry.bbox.width * (fractionEnd - fractionStart);
        if (relativeWidth <= 0.5) {
          detail.skipReason = "too-narrow";
          detail.relativeWidth = relativeWidth;
          debugDetails.push(detail);
          continue;
        }
        logicalStart = entry.bbox.x + entry.bbox.width * fractionStart;
        logicalEnd = entry.bbox.x + entry.bbox.width * fractionEnd;
      }

      const scales = resolveEntryScale(entry);
      const transform = scales.transform;
      const cssStart =
        (logicalStart * scales.deviceScaleX + (transform.e || 0)) /
        (scales.deviceScaleX * scales.pageScaleX);
      const cssEnd =
        (logicalEnd * scales.deviceScaleX + (transform.e || 0)) /
        (scales.deviceScaleX * scales.pageScaleX);
      const cssWidth = Math.max(cssEnd - cssStart, 0.5);

      const cssTextTop =
        (entry.bbox.y * scales.deviceScaleY + (transform.f || 0)) /
        (scales.deviceScaleY * scales.pageScaleY);
      const cssTextHeight = entry.bbox.height / scales.pageScaleY;
      const logicalBottom = entry.bbox.y + entry.bbox.height;
      const cssBottom =
        (logicalBottom * scales.deviceScaleY + (transform.f || 0)) /
        (scales.deviceScaleY * scales.pageScaleY);
      const underlineThickness = Math.min(Math.max(cssTextHeight * 0.15, 1), 3);

      const pageRect = resolveEntryPageRect(entry, pageRectCache);
      const pageOffsetLeft = pageRect?.left ?? 0;
      const pageOffsetTop = pageRect?.top ?? 0;

      const absLeft = pageOffsetLeft + cssStart;
      const absUnderlineTop = pageOffsetTop + cssBottom - underlineThickness;
      const absUnderlineBottom = absUnderlineTop + underlineThickness;
      const absTextTop = pageOffsetTop + cssTextTop;
      const rect = {
        left: absLeft - hostOffsetLeft + hostScrollLeft,
        top: absUnderlineTop - hostOffsetTop + hostScrollTop,
        width: cssWidth,
        height: underlineThickness,
        textTop: absTextTop - hostOffsetTop + hostScrollTop,
        textHeight: cssTextHeight,
        absLeft,
        absRight: absLeft + cssWidth,
        absTextTop,
        absTextBottom: absTextTop + cssTextHeight,
        absUnderlineTop,
        absUnderlineBottom,
      };
      rects.push(rect);
      detail.skipReason = null;
      detail.rect = rect;
      detail.usedCharOffsets = usedCharOffsets;
      detail.relativeWidth = relativeWidth;
      debugDetails.push(detail);
    }

    log.info("--- Finished Computing Rects ---", {
      foundRectCount: rects.length,
      totalEntries: entries.length,
    });
    return { rects, debugDetails, rangeStart: clampedStart, rangeEnd: clampedEnd };
  }

  function normalizeHighlightPayload(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        id: typeof item?.id === "string" ? item.id : String(item?.id ?? ""),
        start: typeof item?.start === "number" ? item.start : null,
        end: typeof item?.end === "number" ? item.end : null,
        text: typeof item?.text === "string" ? item.text : null,
        color: typeof item?.color === "string" ? item.color : null,
        chipId: typeof item?.chipId === "string" ? item.chipId : null,
        replacementText:
          typeof item?.replacementText === "string"
            ? item.replacementText
            : null,
      }))
      .filter(
        (item) =>
          item.id &&
          (item.text ||
            (item.start !== null && item.end !== null))
      );
  }

  function renderHighlightOverlays(highlights) {
    if (!highlights.length) {
      clearHighlightLayer();
      log.info("Cleared all suggestion highlights.");
      return;
    }

    const highlightHost = getHighlightHost();
    if (!highlightHost) {
      log.warn("Cannot render highlights (missing host).");
      return;
    }
    const container = ensureHighlightLayer();
    if (!container) return;
    setTrustedInnerHTML(container, "");

    const entries = exportFillEntries();
    if (!entries.length) {
      log.warn("Fill map empty while rendering highlights.");
      return;
    }

    const summary = [];
    state.hoverRegions = new Map();
    updateHoverState(null);
    ensureHoverTracker();
    highlights.forEach((highlight) => {
      const { rects, debugDetails, rangeStart, rangeEnd } = computeHighlightRects(
        entries,
        highlight.start,
        highlight.end,
        highlightHost
      );
      if (!rects.length) {
        log.warn("Failed to compute rects for underline", {
          id: highlight.id,
          rangeStart,
          rangeEnd,
          debugDetails: debugDetails.slice(0, 20),
        });
        summary.push({ id: highlight.id, rectCount: 0 });
        return;
      }

      rects.forEach((rect) => {
        const shade = document.createElement("div");
        shade.className = "aladin-suggestion-highlight-shade";
        shade.dataset.aladinSuggestionId = highlight.id;
        shade.style.position = "absolute";
        shade.style.left = rect.left + "px";
        shade.style.top = rect.textTop + "px";
        shade.style.width = rect.width + "px";
        shade.style.height = rect.textHeight + "px";
        shade.style.background = LIGHT_BLUE_SHADE;
        shade.style.borderRadius = "3px";
        shade.style.pointerEvents = "none";
        shade.style.opacity = "0";
        shade.style.transition = "opacity 140ms ease";
        container.appendChild(shade);

        const underline = document.createElement("div");
        underline.className = "aladin-suggestion-highlight";
        underline.dataset.aladinSuggestionId = highlight.id;
        if (highlight.text) {
          underline.dataset.aladinSuggestionText = highlight.text;
        }
        if (highlight.replacementText) {
          underline.dataset.aladinSuggestionNewText = highlight.replacementText;
        }
        if (highlight.chipId) {
          underline.dataset.aladinChipId = highlight.chipId;
        }
        underline.style.position = "absolute";
        underline.style.left = rect.left + "px";
        underline.style.top = rect.top + "px";
        underline.style.width = rect.width + "px";
        underline.style.height = rect.height + "px";
        underline.style.borderBottom = `2px solid ${LIGHT_BLUE_UNDERLINE}`;
        underline.style.pointerEvents = "none";
        underline.style.opacity = "0.85";
        underline.style.transition = "opacity 140ms ease";
        underline.style.background = "transparent";
        container.appendChild(underline);

        const hitTop = Math.min(rect.absTextTop, rect.absUnderlineTop) - 2;
        const hitBottom =
          Math.max(rect.absTextBottom, rect.absUnderlineBottom) + 4;
        const hitLeft = rect.absLeft - 1;
        const hitRight = rect.absRight + 1;
        registerHoverRegion(highlight.id, {
          rect: [hitLeft, hitRight, hitTop, hitBottom],
          shade,
          underline,
          color: LIGHT_BLUE_UNDERLINE,
          payload: {
            chipId: highlight.chipId || null,
            newText: highlight.replacementText || highlight.text || "",
          },
          absUnderlineTop: rect.absUnderlineTop,
          absUnderlineBottom: rect.absUnderlineBottom,
        });
      });

      summary.push({ id: highlight.id, rectCount: rects.length });
    });

    log.info("render-highlights", {
      requested: highlights.length,
      rendered: summary.filter((s) => s.rectCount > 0).length,
    });

    refreshHoverGeometry();
  }


  function patchCanvasContext(ctx, canvas) {
    if (state.originalCanvasMethods.has(ctx)) return;
    log.info("Patching context for canvas:", canvas);

    const originals = {
      fillText: ctx.fillText.bind(ctx),
      clearRect: ctx.clearRect.bind(ctx),
    };
    state.originalCanvasMethods.set(ctx, originals);

    ctx.fillText = (text, x, y, ...rest) => {
      const mtx = ctx.getTransform();

      const yDevice = toDeviceY(y, mtx);
      const gctx = ctx;
      const shift = gctx.__ghostShift;
      const yOffset = shift && yDevice > shift.anchorY ? shift.offset : 0;
      const yPaint = y + yOffset;

      originals.fillText(text, x, yPaint, ...rest);

      const tm = ctx.measureText(text);
      let startX = x;
      if (/right|end/.test(ctx.textAlign)) startX = x - tm.width;
      else if (ctx.textAlign === "center") startX = x - tm.width / 2;

      const bbox = {
        x: startX + tm.actualBoundingBoxLeft,
        y: yPaint - tm.actualBoundingBoxAscent,
        width: tm.width,
        height: tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent,
      };

      const normalizedText = normalizeCanvasText(text);
      const cUid = getCanvasUid(canvas);
      const gKey = `${cUid}:${Math.round(bbox.y)}:${Math.round(bbox.x)}`;

      if (!normalizedText) {
        if (state.globalFillTextMap.delete(gKey)) {
          state.canvasTextSnapshot = "";
          log.info("globalFillTextMap update after delete", {
            trigger: "fillText delete",
            count: state.globalFillTextMap.size,
            entries: Array.from(state.globalFillTextMap.entries()),
          });
        }
        return;
      }

      const layoutRect = canvas.getBoundingClientRect();
      const pageRect = {
        left: layoutRect.left + window.scrollX,
        top: layoutRect.top + window.scrollY,
        width: layoutRect.width,
        height: layoutRect.height,
      };

      const prev = state.globalFillTextMap.get(gKey);
      if (
        !prev ||
        prev.text !== normalizedText ||
        prev.width !== bbox.width ||
        prev.height !== bbox.height
      ) {
        state.globalFillTextMap.set(gKey, {
          canvas,
          ctx,
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
          text: normalizedText,
          originalText: text,
          font: ctx.font,
          bbox,
          baselineY: yPaint,
          ascent: tm.actualBoundingBoxAscent,
          descent: tm.actualBoundingBoxDescent,
          transformMatrix: mtx,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          canvasUid: cUid,
          pageRect,
          log: buildVerboseLog(text, x, y, yPaint, tm, bbox, mtx, ctx.font),
          rawStart: prev?.rawStart ?? null,
          rawEnd: prev?.rawEnd ?? null,
          charOffsets:
            prev && prev.text === normalizedText && Array.isArray(prev.charOffsets)
              ? prev.charOffsets
              : null,
        });
        state.canvasTextSnapshot = "";
        log.info("globalFillTextMap update after set", {
          trigger: "fillText set",
          count: state.globalFillTextMap.size,
          entries: Array.from(state.globalFillTextMap.entries()),
        });
      }

      log.info("fillText:", {
        text,
        x,
        y,
        font: ctx.font,
        fillStyle: ctx.fillStyle,
        bbox: bbox,
        textMetrics: tm,
        canvasUid: cUid,
        gKey: gKey,
      });

      const ghostW = 0;
      const lastGlyphBBox = {
        x: bbox.x + bbox.width,
        y: bbox.y,
        width: ghostW,
        height: bbox.height,
        canvasPageX: pageRect.left,
        canvasPageY: pageRect.top,
        textBaselineY: yPaint,
        canvasElement: canvas,
        ctx,
        transformMatrix: mtx,
        font: ctx.font,
        mutationCounter: state.paragraphMutationCounter,
      };

      rememberLineForCaret(text, lastGlyphBBox);
      updateParagraphStructure(ctx, lastGlyphBBox);

      const caretAtEnd = isCaretAtLineEnd(lastGlyphBBox, null);
      const caretAtParaEnd = caretAtEnd && isCaretAtParagraphEnd(lastGlyphBBox);

      const keyRecent =
        Date.now() - state.lastSpellcheckStrokeTime <= constants.SPELLCHECK_SETTLE_MS ||
        Date.now() - state.lastMeaningfulKeyTimestamp <= constants.KEY_EVENT_WINDOW_MS;

      if (caretAtParaEnd && keyRecent) {
        if (state.ghostTextDebounceTimer !== null) {
          clearTimeout(state.ghostTextDebounceTimer);
        }
        const anchor = lastGlyphBBox;
        state.ghostTextDebounceTimer = window.setTimeout(
          () => showGhostTextAfterDebounce(anchor),
          constants.GHOST_TEXT_DEBOUNCE_MS
        );
      }
    };

    ctx.clearRect = (x, y, w, h) => {
      originals.clearRect(x, y, w, h);

      const cUid = getCanvasUid(canvas);
      const left = x,
        right = x + w,
        top = y,
        bottom = y + h;

      log.info("clearRect:", { x, y, w, h, canvasUid: cUid });

      let removedAny = false;
      for (const [k, e] of state.globalFillTextMap) {
        if (!k.startsWith(cUid + ":")) continue;
        const b = e.bbox;
        const overlaps =
          b.x < right && b.x + b.width > left && b.y < bottom && b.y + b.height > top;
        if (overlaps) {
          state.globalFillTextMap.delete(k);
          log.info("globalFillTextMap update after clearRect delete", {
            trigger: "clearRect delete",
            canvasUid: cUid,
            count: state.globalFillTextMap.size,
            entries: Array.from(state.globalFillTextMap.entries()),
          });
          removedAny = true;
        }
      }
      if (removedAny) {
        state.canvasTextSnapshot = "";
      }
    };
  }

  function handleObservedCanvas(canvas) {
    if (!canvas.classList.contains("kix-canvas-tile-content")) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      patchCanvasContext(ctx, canvas);
    }
  }

  overrideCanvasGetContext();

  async function initializeRuntime() {
    const startedAt = Date.now();
    const host = await waitForCanvasHost().catch((err) => {
      log.error("Failed to locate canvas host", err);
      throw err;
    });

    state.targetNode = host.node;
    state.canvasHostSelector = host.selector;
    log.info("Canvas host ready", {
      selector: host.selector,
      elapsedMs: Date.now() - startedAt,
    });

    state.canvasObserver = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== Node.ELEMENT_NODE) return;
          const el = n;
          if (el.tagName === "CANVAS") {
            handleObservedCanvas(el);
          } else {
            el
              .querySelectorAll("canvas.kix-canvas-tile-content")
              .forEach((c) => handleObservedCanvas(c));
          }
        });
      });
    });

    state.canvasObserver.observe(state.targetNode, {
      childList: true,
      subtree: true,
    });

    const initialScope =
      state.targetNode instanceof Element ? state.targetNode : document;
    initialScope
      .querySelectorAll("canvas.kix-canvas-tile-content")
      .forEach((c) => handleObservedCanvas(c));

    refreshCleanRawText(true);
  }

  function ensureInitialized() {
    if (state.initialized && state.initializationPromise) {
      return state.initializationPromise;
    }
    if (!state.initializationPromise) {
      state.initializationPromise = initializeRuntime()
        .then(() => {
          state.initialized = true;
        })
        .catch((err) => {
          log.error("Failed to initialize runtime", err);
          state.initialized = false;
          state.initializationPromise = null;
          throw err;
        });
    }
    return state.initializationPromise;
  }

  function exportFillEntries() {
    return orderFillEntries().map(([key, entry]) => ({
      key,
      text: entry.text,
      originalText: entry.originalText,
      rawStart: entry.rawStart ?? null,
      rawEnd: entry.rawEnd ?? null,
      bbox: entry.bbox,
      pageRect: entry.pageRect,
      font: entry.font,
      canvasUid: entry.canvasUid,
      transformMatrix: entry.transformMatrix,
      canvasWidth: entry.canvasWidth,
      canvasHeight: entry.canvasHeight,
      baselineY: entry.baselineY,
      ascent: entry.ascent,
      descent: entry.descent,
      charOffsets: ensureEntryCharOffsets(entry),
    }));
  }

  function exportSnapshot() {
    const snapshotText =
      state.cleanRawText && state.cleanRawText.length
        ? state.cleanRawText
        : ensureCanvasSnapshot("snapshot-export");
    return {
      rawText: snapshotText,
      entries: exportFillEntries(),
      timestamp: Date.now(),
    };
  }

  const actionHandlers = {
    async init() {
      await ensureInitialized();
      return { initialized: true };
    },
    async "refresh-raw-text"() {
      await ensureInitialized();
      refreshCleanRawText(true);
      return { rawTextLength: state.cleanRawText.length };
    },
    async "get-fill-map"() {
      await ensureInitialized();
      rebuildCanvasSnapshot("bridge-fill-map");
      return { entries: exportFillEntries() };
    },
    async "get-document-snapshot"(payload) {
      await ensureInitialized();
      if (payload && payload.forceRefresh) {
        refreshCleanRawText(true);
      }
      rebuildCanvasSnapshot("bridge-snapshot");
      return exportSnapshot();
    },
    async "get-raw-text"() {
      await ensureInitialized();
      const rawText = refreshCleanRawText(true);
      return { rawText };
    },
    async align(payload) {
      await ensureInitialized();
      rebuildCanvasSnapshot(payload?.reason || "bridge-align");
      return { aligned: true };
    },
    async "render-highlights"(payload) {
      await ensureInitialized();
      const highlights = normalizeHighlightPayload(payload?.highlights);
      log.info("render-highlights request", {
        requested: payload?.highlights?.length || 0,
        normalized: highlights.length,
      });
      if (!highlights.length) {
        renderHighlightOverlays([]);
        return { highlightCount: 0, unmatched: [] };
      }
      rebuildCanvasSnapshot("render-highlights");
      log.info(
        "Canvas text snapshot for matching:",
        snippetForLog(state.canvasTextSnapshot, 1000)
      );
      resetClaimedHighlightRanges();
      const resolved = [];
      const unmatched = [];
      highlights.forEach((highlight) => {
        const signature = normalizeMatchSignature(highlight.text || "");
        const cached = state.highlightRangeCache.get(highlight.id);
        if (
          typeof highlight.start === "number" &&
          typeof highlight.end === "number"
        ) {
          if (!rangeOverlapsExisting(highlight.start, highlight.end)) {
            reserveHighlightRange(highlight.start, highlight.end);
          }
          state.highlightRangeCache.set(highlight.id, {
            start: highlight.start,
            end: highlight.end,
            signature,
            snapshotVersion: state.canvasSnapshotVersion,
          });
          resolved.push(highlight);
          return;
        }
        if (
          cached &&
          cached.signature === signature &&
          cached.snapshotVersion === state.canvasSnapshotVersion &&
          !rangeOverlapsExisting(cached.start, cached.end)
        ) {
          reserveHighlightRange(cached.start, cached.end);
          resolved.push({
            ...highlight,
            start: cached.start,
            end: cached.end,
          });
          return;
        }
        if (!highlight.text) {
          unmatched.push({ id: highlight.id, reason: "missing-text" });
          return;
        }
        let cursorHint = 0;
        let match = null;
        while (cursorHint < state.canvasTextSnapshot.length) {
          const attempt = matchHighlightByText(highlight.text, cursorHint);
          if (!attempt) break;
          if (!rangeOverlapsExisting(attempt.start, attempt.end)) {
            match = attempt;
            break;
          }
          cursorHint = Math.max(cursorHint + 1, attempt.end);
        }
        if (!match) {
          log.warn("Unable to match highlight text", {
            id: highlight.id,
            snippet: snippetForLog(highlight.text || ""),
          });
          unmatched.push({
            id: highlight.id,
            snippet: snippetForLog(highlight.text || ""),
          });
          return;
        }
        reserveHighlightRange(match.start, match.end);
        state.highlightRangeCache.set(highlight.id, {
          start: match.start,
          end: match.end,
          signature,
          snapshotVersion: state.canvasSnapshotVersion,
        });
        log.info("Matched text highlight", {
          id: highlight.id,
          strategy: match.strategy,
          range: [match.start, match.end],
        });
        resolved.push({
          ...highlight,
          start: match.start,
          end: match.end,
        });
      });
      renderHighlightOverlays(resolved);
      return { highlightCount: resolved.length, unmatched };
    },
    async "set-text-color"(payload) {
      const enabled = payload?.color !== null;
      return { visualTestEnabled: enabled };
    },
    async "feedback-overlay"(payload) {
      const duration =
        typeof payload?.durationMs === "number" ? payload.durationMs : 5000;
      showFeedbackOverlay(duration);
      return { overlay: true };
    },
    async "apply-replace-text"(payload) {
      await ensureInitialized();
      const applied = applyReplaceTextForChip(
        payload?.chipId,
        payload?.newText || ""
      );
      return { applied };
    },
  };

  function handleBridgeMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__aladinBridge !== REQUEST_TAG) return;
    const { action, requestId, payload } = data;
    const respond = (response) =>
      window.postMessage(
        {
          __aladinBridge: RESPONSE_TAG,
          requestId,
          action,
          ...response,
        },
        "*"
      );
    const handler = actionHandlers[action];
    if (!handler) {
      respond({ ok: false, error: `Unknown action ${action}` });
      return;
    }
    try {
      const result = handler(payload);
      if (result && typeof result.then === "function") {
        result
          .then((res) => respond({ ok: true, result: res }))
          .catch((err) =>
            respond({ ok: false, error: err?.message || String(err) })
          );
      } else {
        respond({ ok: true, result });
      }
    } catch (err) {
      respond({ ok: false, error: err?.message || String(err) });
    }
  }

  window.addEventListener("message", handleBridgeMessage);

  function handleHoverAugmentMessage(event) {
    const data = event.data;
    if (!data) return;
    if (data.__aladinGDocsTooltipArea) {
      const payload = data.payload;
      if (!payload || !payload.id) {
        return;
      }
      const entry = state.hoverRegions.get(payload.id);
      if (!entry) return;
      if (!payload.rect) {
        entry.tooltipRect = null;
      } else {
        entry.tooltipRect = [
          payload.rect.left,
          payload.rect.right,
          payload.rect.top,
          payload.rect.bottom,
        ];
      }
    }
  }
  window.addEventListener("message", handleHoverAugmentMessage);
})();
