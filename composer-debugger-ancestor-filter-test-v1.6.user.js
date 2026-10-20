// ==UserScript==
// @name         ChatGPT / Grok Composer Debugger jcx
// @namespace    ai-chat-logger-debug
// @version      1.6
// @description  Composer debugger with editable ancestor-filter test bar
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://grok.com/*
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "[Composer Debugger]";
  const MAX_LINES_PER_ENTRY = 2;
  const MAX_LOG_ENTRIES = 80;

  // --------------------------------------------------
  // State (no polling)
  // --------------------------------------------------
  let lastActiveComposer = null;   // last focused / active editable
  let lastComposerText = "";       // updated on input + paste re-read
  let mousedownText = "";          // temp var filled on mousedown

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }

  function isEditable(el) {
    return (
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLInputElement ||
      el.isContentEditable
    );
  }

  function getSendButton() {
    const selectors = [
      'button[data-testid*="send"]',
      'button[aria-label*="Send" i]',
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]',
      'button[data-testid="chat-submit"]',
      'button[data-testid="grokSendButton"]',
      'button[data-testid*="submit"]',
      'button[type="submit"]'
    ];
    for (const sel of selectors) {
      const candidates = [...document.querySelectorAll(sel)];
      const found = candidates.find((el) => {
        const btn = el.closest("button") || el;
        return btn instanceof HTMLElement && isVisible(btn) && !btn.disabled;
      });
      if (found) return found.closest("button") || found;
    }
    return null;
  }

  function getSendButtonInfo() {
    const btn = getSendButton();
    if (!btn) return "Send button: NOT FOUND";
    const r = btn.getBoundingClientRect();
    const testid = btn.getAttribute("data-testid") || "";
    const aria = btn.getAttribute("aria-label") || "";
    return [
      "Send button: FOUND",
      `testid: ${testid || "(none)"}`,
      `aria: ${aria || "(none)"}`,
      `pos: ${r.x.toFixed(0)},${r.y.toFixed(0)}  size: ${r.width.toFixed(0)}×${r.height.toFixed(0)}`
    ].join("\n");
  }

  function findComposer() {
    // Prefer last active if still visible
    if (lastActiveComposer && isVisible(lastActiveComposer) && isEditable(lastActiveComposer)) {
      return lastActiveComposer;
    }

    const sendButton = getSendButton();
    if (sendButton) {
      let node = sendButton.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const candidates = [
          ...node.querySelectorAll('[contenteditable="true"], textarea, input, .tiptap.ProseMirror')
        ].filter((el) => isEditable(el) && isVisible(el) && !el.closest("#peek-box"));

        if (candidates.length) {
          const b = sendButton.getBoundingClientRect();
          const bx = b.left + b.width / 2;
          const by = b.top + b.height / 2;
          candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const da = (bx - Math.max(ra.left, Math.min(bx, ra.right))) ** 2 +
                       (by - Math.max(ra.top, Math.min(by, ra.bottom))) ** 2;
            const db = (bx - Math.max(rb.left, Math.min(bx, rb.right))) ** 2 +
                       (by - Math.max(rb.top, Math.min(by, rb.bottom))) ** 2;
            return da - db;
          });
          return candidates[0];
        }
        node = node.parentElement;
      }
    }

    const selectors = [
      "#prompt-textarea",
      '[data-testid="composer-text-input"]',
      '[data-testid="grokInput"]',
      "textarea[placeholder*='Ask']",
      ".tiptap.ProseMirror[contenteditable='true']",
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      "textarea"
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (isVisible(el) && isEditable(el)) return el;
      }
    }
    return null;
  }

  function getText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value || "";
    }
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }

  // --------------------------------------------------
  // Track last active composer + input / paste
  // --------------------------------------------------
  function attachListeners(el) {
    if (!el || el._dbgAttached) return;
    el._dbgAttached = true;

    el.addEventListener("focus", () => {
      lastActiveComposer = el;
    });

    el.addEventListener("input", () => {
      lastActiveComposer = el;
      lastComposerText = getText(el);
    });

    // Re-read after paste (text is inserted after the paste event)
    el.addEventListener("paste", () => {
      lastActiveComposer = el;
      setTimeout(() => {
        lastComposerText = getText(el);
      }, 50);
    });
  }

  // Attach to whatever is currently the composer (once)
  function ensureAttached() {
    const el = findComposer();
    if (el) attachListeners(el);
  }







  // Light re-attach in case the DOM is replaced
  //setInterval(ensureAttached, 1000);



document.addEventListener("focus", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
   // lastComposerText = getText(el);   // also update text
  }
});

document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
  }
});

document.addEventListener("paste", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
    requestAnimationFrame(() => {
     // lastComposerText = getText(el);
    });
  }
});
  // ---why u do not do it like this   ?









  // --------------------------------------------------
  // Ancestor filters (live-editable test bar)
  // --------------------------------------------------
  function parseAncestorFilters(raw) {
    const result = { whitelist: [], blacklist: [] };
    for (const line of String(raw || "").split(/\r?\n/)) {
      const m = line.trim().match(/^(wldiv|bldiv)\s*:\s*(.*)$/i);
      if (!m) continue;
      const terms = m[2].split(",").map((x) => x.trim()).filter(Boolean);
      result[m[1].toLowerCase() === "wldiv" ? "whitelist" : "blacklist"].push(...terms);
    }
    return result;
  }

  function ancestorTermMatches(ancestor, rawTerm) {
    const term = String(rawTerm || "").trim().toLowerCase();
    if (!term || !(ancestor instanceof Element)) return false;

    // tag.class: e.g. div.names
    const classMatch = term.match(/^([a-z0-9*-]+)\.([\w-]+)$/i);
    if (classMatch) {
      const tag = classMatch[1];
      return (tag === "*" || ancestor.tagName.toLowerCase().includes(tag)) &&
        String(ancestor.className && typeof ancestor.className === "string" ? ancestor.className : "")
          .toLowerCase().includes(classMatch[2].toLowerCase());
    }

    // tag#id or tag.id:foo: match ID by substring
    const idMatch = term.match(/^([a-z0-9*-]+)(?:#id:|#|\.id:)([\w-]+)$/i);
    if (idMatch) {
      const tag = idMatch[1];
      return (tag === "*" || ancestor.tagName.toLowerCase().includes(tag)) &&
        String(ancestor.id || "").toLowerCase().includes(idMatch[2].toLowerCase());
    }

    // Bare term: substring of the ancestor's tag/custom-element name.
    return ancestor.tagName.toLowerCase().includes(term);
  }

  function passesAncestorFilters(el) {
    const { whitelist, blacklist } = parseAncestorFilters(filterInput.value);
    // Empty filters preserve the old debugger behavior.
    if (!whitelist.length && !blacklist.length) return { pass: true, reason: "no filters" };
    if (!(el instanceof Element)) return false;

    const ancestors = [];
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      ancestors.push(node);
    }

    // Blacklist always wins.
    for (const term of blacklist) {
      if (ancestors.some((node) => ancestorTermMatches(node, term))) {
        return { pass: false, reason: `blocked by bldiv:${term}` };
      }
    }

    // A non-empty whitelist requires at least one matching ancestor.
    if (whitelist.length && !whitelist.some((term) =>
      ancestors.some((node) => ancestorTermMatches(node, term)))) {
      return { pass: false, reason: `no ancestor matched wldiv:${whitelist.join(",")}` };
    }
    return { pass: true, reason: "passed" };
  }

  // --------------------------------------------------
  // Text helpers
  // --------------------------------------------------
  function cleanText(raw) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_LINES_PER_ENTRY)
      .join("\n");
  }

  function formatTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    top: "100px",
    right: "20px",
    width: "400px",
    maxWidth: "calc(100vw - 30px)",
    zIndex: "2147483647",
    background: "rgba(20, 20, 20, 0.82)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.45)",
    borderRadius: "10px",
    boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
    font: "13px/1.5 monospace",
    backdropFilter: "blur(6px)"
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "9px 10px",
    cursor: "move",
    userSelect: "none",
    background: "rgba(255,255,255,0.12)",
    borderBottom: "1px solid rgba(255,255,255,0.2)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  });

  const heading = document.createElement("span");
  heading.textContent = "Composer Debugger v1.5";

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.title = "Fold / unfold";
  Object.assign(closeButton.style, {
    color: "white",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "20px",
    lineHeight: "20px"
  });

  header.append(heading, closeButton);

  const status = document.createElement("div");
  status.textContent = "Waiting for mousedown / Enter / Send...";
  Object.assign(status.style, {
    padding: "8px 10px",
    color: "#9fe7ff",
    borderBottom: "1px solid rgba(255,255,255,0.2)",
    fontSize: "12px"
  });

  const filterWrap = document.createElement("div");
  Object.assign(filterWrap.style, {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.2)"
  });

  const filterLabel = document.createElement("div");
  filterLabel.textContent = "Ancestor filters (wldiv / bldiv; blank = no filtering)";
  Object.assign(filterLabel.style, {
    marginBottom: "5px",
    color: "#ffd98a",
    fontSize: "12px"
  });

  const filterInput = document.createElement("textarea");
  filterInput.placeholder = "wldiv:ytd-comment-simplebox-renderer\\nbldiv:div#ignored";
  filterInput.spellcheck = false;
  filterInput.setAttribute("aria-label", "Ancestor filters");
  Object.assign(filterInput.style, {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    resize: "vertical",
    color: "#fff",
    background: "rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "5px",
    padding: "6px",
    font: "12px/1.4 monospace"
  });

  const filterHint = document.createElement("div");
  filterHint.textContent = "Comma-separated terms; repeated lines allowed. Applied to Enter and Send captures.";
  Object.assign(filterHint.style, {
    marginTop: "4px",
    color: "#c9c9c9",
    fontSize: "11px"
  });

  filterWrap.append(filterLabel, filterInput, filterHint);

  const output = document.createElement("pre");
  output.textContent = "(No captures yet)\n\n--- Send Button ---\n" + getSendButtonInfo();
  Object.assign(output.style, {
    margin: "0",
    padding: "10px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: "50vh",
    overflowY: "auto",
    userSelect: "text",
    fontSize: "12px"
  });

  panel.append(header, status, filterWrap, output);
  document.documentElement.appendChild(panel);

  // Start folded
  status.style.display = "none";
  output.style.display = "none";
  heading.style.display = "none";
  panel.dataset.folded = "true";
  closeButton.textContent = "+";
  header.style.padding = "2px";
  header.style.borderBottom = "none";
  header.style.justifyContent = "center";
  panel.style.width = "auto";
  panel.style.minWidth = "0";

  // --------------------------------------------------
  // Fold / unfold
  // --------------------------------------------------
  let anchorRight = null;
  let anchorTop = null;

  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const folded = panel.dataset.folded !== "true";

    if (anchorRight === null) {
      const r = closeButton.getBoundingClientRect();
      anchorRight = r.right;
      anchorTop = r.top;
    }

    status.style.display = folded ? "none" : "";
    filterWrap.style.display = folded ? "none" : "";
    output.style.display = folded ? "none" : "";
    heading.style.display = folded ? "none" : "";
    panel.dataset.folded = folded ? "true" : "false";
    closeButton.textContent = folded ? "+" : "×";

    if (folded) {
      header.style.padding = "2px";
      header.style.borderBottom = "none";
      header.style.justifyContent = "center";
      panel.style.width = "auto";
      panel.style.minWidth = "0";
    } else {
      header.style.padding = "9px 10px";
      header.style.borderBottom = "1px solid rgba(255,255,255,0.2)";
      header.style.justifyContent = "space-between";
      panel.style.width = "400px";
      panel.style.minWidth = "";
    }

    requestAnimationFrame(() => {
      const r = closeButton.getBoundingClientRect();
      panel.style.left =
        panel.getBoundingClientRect().left + anchorRight - r.right + "px";
      panel.style.top =
        panel.getBoundingClientRect().top + anchorTop - r.top + "px";
      panel.style.right = "auto";
    });
  });

  // --------------------------------------------------
  // Drag
  // --------------------------------------------------
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  header.addEventListener("pointerdown", (e) => {
    if (e.target === closeButton) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panel.style.left = rect.left + "px";
    panel.style.top = rect.top + "px";
    panel.style.right = "auto";
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + e.clientX - startX));
    const top = Math.max(0, Math.min(window.innerHeight - header.offsetHeight, startTop + e.clientY - startY));
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  });

  header.addEventListener("pointerup", () => { dragging = false; });
  header.addEventListener("pointercancel", () => { dragging = false; });

  // --------------------------------------------------
  // Logging
  // --------------------------------------------------
  let captureCount = 0;
  const logLines = [];

  function appendLog(source, rawText) {
    captureCount++;
    const cleaned = cleanText(rawText);
    const ts = formatTimestamp();
    const label = source.toUpperCase();

    let entry = `[${ts}] [${label}]`;
    entry += cleaned ? "\n" + cleaned : " (empty)";

    const limited = entry.split("\n").slice(0, 1 + MAX_LINES_PER_ENTRY).join("\n");

    logLines.push(limited);
    if (logLines.length > MAX_LOG_ENTRIES) {
      logLines.splice(0, logLines.length - MAX_LOG_ENTRIES);
    }

    output.textContent =
      logLines.join("\n\n") +
      "\n\n--- Send Button ---\n" +
      getSendButtonInfo();

    output.scrollTop = output.scrollHeight;

    status.textContent = `#${captureCount} | ${label} | len=${rawText.length} | ${cleaned ? "captured" : "empty"}`;
    status.style.color = "#9fe7ff";

    console.log(`${PREFIX} ${label} #${captureCount}`, { source, textLength: rawText.length, cleaned, timestamp: ts });
  }

  // --------------------------------------------------
  // mousedown: fetch last active composer text into temp var + log
  // --------------------------------------------------
  document.addEventListener("mousedown", (e) => {
    if (panel.contains(e.target)) return;

    // Prefer last active, fall back to current find
    const el = (lastActiveComposer && isVisible(lastActiveComposer))
      ? lastActiveComposer
      : findComposer();

    mousedownText = el ? getText(el) : "";
    appendLog("mousedown", mousedownText);
  }, true);

  // --------------------------------------------------
  // Send / Submit click (uses mousedownText if available, else live read)
  // --------------------------------------------------
  document.addEventListener("click", (e) => {
    if (panel.contains(e.target)) return;

    const path = e.composedPath ? e.composedPath() : [e.target];
    const isSend = path.some((el) => {
      if (!(el instanceof Element)) return false;
      const btn = el.closest("button") || el;
      if (!(btn instanceof HTMLElement)) return false;
      const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const text = (btn.textContent || "").trim().toLowerCase();
      return (
        testid.includes("send") ||
        aria.includes("send") ||
        aria.includes("submit") ||
        testid.includes("submit") ||
        testid.includes("chat-submit") ||
        testid.includes("groksend") ||
        text === "submit" ||
        text === "send" ||
        (btn.type === "submit" && btn.closest("form"))
      );
    });

    if (!isSend) return;

    const el = (lastActiveComposer && isVisible(lastActiveComposer) && isEditable(lastActiveComposer))
      ? lastActiveComposer
      : findComposer();
    const filterResult = passesAncestorFilters(el);
    if (!filterResult.pass) {
      appendLog("send FILTER BLOCKED: " + filterResult.reason, "");
      return;
    }
    const text = mousedownText || lastComposerText || getText(el);
    appendLog("send", text);
  }, true);

  // --------------------------------------------------
  // Enter key
  // --------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (panel.contains(e.target)) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    const el = lastActiveComposer || findComposer();
    if (!el) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (target !== el && !el.contains(target)) return;

    const filterResult = passesAncestorFilters(el);
    if (!filterResult.pass) {
      appendLog("enter FILTER BLOCKED: " + filterResult.reason, "");
      return;
    }
    const text = lastComposerText || getText(el);
    appendLog("enter", text);
  }, true);

  console.log(`${PREFIX} v1.6 loaded (ancestor-filter test bar, no polling).`);
})();
