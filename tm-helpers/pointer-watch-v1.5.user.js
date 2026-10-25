// ==UserScript==
// @name         isContentEditable under pointer
// @namespace    ai-chat-logger-debug
// @version      1.5
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const KEY = "pointer-watch-props-v1";
  const POS_KEY = "pointer-watch-pos-v1";
  const MIN_KEY = "pointer-watch-min-v1";
  const DEFAULT_WATCH = [
    ".value",
    "text",
    "chain",
    "somefunc1",
    "aria-label",
    "testid",
    "type",
    'closest("form")',
    'closest("button")',
    "isContentEditable"
  ].join("; ");

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }
  function isEditable(el) {
    return el instanceof HTMLTextAreaElement
      || el instanceof HTMLInputElement
      || !!el.isContentEditable;
  }
  function nextAncestor(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    if (root && root.host) return root.host;
    return null;
  }
  function chain(el) {
    const out = [];
    for (let n = el; n && n !== document.documentElement; n = nextAncestor(n)) {
      if (!(n instanceof Element)) continue;
      out.push(n.localName + (n.id ? "#" + n.id : ""));
    }
    return out.join(" > ");
  }
  function liveText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || "";
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim();
  }
  function somefunc1(el) {
    return chain(el);
  }
  const extraFns = { somefunc1: somefunc1, chain: chain };

  function evalTerm(el, raw) {
    const term = String(raw || "").trim();
    if (!term || !el) return "";
    const fnName = term.replace(/\(\)\s*$/, "");
    if (extraFns[fnName]) {
      try { return extraFns[fnName](el); }
      catch (err) { return "ERR " + err.message; }
    }
    if (typeof window[fnName] === "function") {
      try { return window[fnName](el); }
      catch (err) { return "ERR " + err.message; }
    }
    const btn = el.closest ? (el.closest("button") || el) : el;
    const closest = term.match(/^closest\((["'])(.+)\1\)$/i);
    if (closest) return !!el.closest(closest[2]);
    const includes = term.match(/^(\w+)\.includes\((["'])(.+)\2\)$/i);
    if (includes) {
      const v = String(evalTerm(el, includes[1]) || "");
      return v.toLowerCase().includes(includes[3].toLowerCase());
    }
    const key = term.toLowerCase();
    if (key === "text") return liveText(el) || (btn.textContent || "").trim();
    if (key === "type") return btn.type || el.getAttribute("type") || "";
    if (key === "testid" || key === "data-testid") return btn.getAttribute("data-testid") || "";
    if (key === "aria-label" || key === "aria") return btn.getAttribute("aria-label") || "";
    if (key === "iscontenteditable") return !!el.isContentEditable;
    if (key === "iseditable") return isEditable(el);
    if (key === "isvisible") return isVisible(el);
    if (key === "value" || key === ".value") return ("value" in el) ? el.value : "";
    if (key === "tag") return el.tagName.toLowerCase();
    if (key === "id") return el.id || "";
    if (key === "class") return el.className || "";
    if (el.hasAttribute && el.hasAttribute(term)) return el.getAttribute(term);
    if (term in el) return el[term];
    return "";
  }

  let minimized = false;
  try { minimized = !!GM_getValue(MIN_KEY, false); } catch (_) {}

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: "8px",
    top: "8px",
    width: "360px",
    background: "rgba(0,0,0,.8)",
    color: "#fff",
    font: "12px/1.4 Consolas, monospace",
    borderRadius: "6px",
    padding: "0"
  });
  try {
    const pos = JSON.parse(GM_getValue(POS_KEY, "") || "null");
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      panel.style.left = pos.left + "px";
      panel.style.top = pos.top + "px";
    }
  } catch (_) {}

  const bar = document.createElement("div");
  Object.assign(bar.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 6px",
    cursor: "move",
    userSelect: "none",
    background: "rgba(255,255,255,.12)"
  });
  const title = document.createElement("span");
  title.textContent = "pointer watch";
  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.textContent = minimized ? "+" : "–";
  Object.assign(minBtn.style, {
    color: "#fff",
    background: "transparent",
    border: "1px solid rgba(255,255,255,.4)",
    borderRadius: "3px",
    cursor: "pointer",
    width: "22px",
    height: "18px",
    lineHeight: "14px"
  });
  bar.append(title, minBtn);

  const body = document.createElement("div");
  body.style.padding = "6px";
  body.style.display = minimized ? "none" : "";

  const input = document.createElement("textarea");
  input.placeholder = "aria-label; testid; text; type; closest(\"form\")";
  input.spellcheck = false;
  try { input.value = GM_getValue(KEY, DEFAULT_WATCH) || DEFAULT_WATCH; }
  catch (_) { input.value = DEFAULT_WATCH; }
  Object.assign(input.style, {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    height: "120px",
    resize: "vertical",
    color: "#fff",
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.3)",
    borderRadius: "4px",
    font: "12px/1.4 Consolas, monospace"
  });
  input.addEventListener("input", () => {
    try { GM_setValue(KEY, input.value); } catch (_) {}
  });
  input.addEventListener("mousedown", (e) => e.stopPropagation());

  const out = document.createElement("div");
  out.style.whiteSpace = "pre";
  out.style.marginTop = "6px";
  out.style.pointerEvents = "none";
  body.append(input, out);

  function applyMin() {
    body.style.display = minimized ? "none" : "";
    minBtn.textContent = minimized ? "+" : "–";
    panel.style.width = minimized ? "auto" : "360px";
    try { GM_setValue(MIN_KEY, minimized); } catch (_) {}
  }
  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    minimized = !minimized;
    applyMin();
  });
  applyMin();

  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target === minBtn) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const left = Math.max(0, sl + e.clientX - sx);
    const top = Math.max(0, st + e.clientY - sy);
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    try {
      GM_setValue(POS_KEY, JSON.stringify({
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0
      }));
    } catch (_) {}
  }
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  panel.append(bar, body);
  document.documentElement.appendChild(panel);

  document.addEventListener("mousemove", (e) => {
    if (panel.contains(e.target)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || panel.contains(el)) { out.textContent = "(none)"; return; }
    const tag = el.tagName.toLowerCase();
    const id = el.id ? "#" + el.id : "";
    const lines = [
      tag + id,
      "isEditable=" + isEditable(el) + "  isVisible=" + isVisible(el)
    ];
    for (const term of input.value.split(";")) {
      const name = term.trim();
      if (!name) continue;
      let val;
      try { val = evalTerm(el, name); }
      catch (err) { val = "ERR " + err.message; }
      lines.push(name + " = " + val);
    }
      out.style.whiteSpace = "pre-wrap";      // wrap long lines
out.style.overflowWrap = "anywhere";    // break a long token
//out.style.maxHeight = "40vh";
out.style.overflow = "auto";
    out.textContent = lines.join("\n");
    panel.style.background = isEditable(el) && isVisible(el)
      ? "rgba(0,90,0,.88)" : "rgba(0,0,0,.8)";
  }, true);
})();