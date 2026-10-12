# ai-chat-logger 20261011 --- click listener and findcomposer fixed by chatgpt

> Platform: chatgpt · Model: auto · Updated: 2026-10-11T10:15:22.411Z

## ?? User

ttyyyy

## ?? Assistant

Heyyy 😄 What's up?

## ?? User

ttyy

## ?? Assistant

Tyyy 😂👋 I'm here! What's next?

## ?? User

let this tranparent window be draggable  // ==UserScript==
// @name         Closest ancestor editable peek
// @namespace    ai-chat-logger
// @version      0.1.0
// @description  From a hovered button, use the nearest ancestor that contains a text bar
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const KEY = "peek-ratio";
  const SEL = "[contenteditable='true'], textarea, input:not([type]), input[type='text'], input[type='search']";

  function ratio() {
    const raw = (localStorage.getItem(KEY) || "0.05:0.10").trim();
    const m = raw.match(/([0-9.]+)\s*:\s*([0-9.]+)/);
    const x = m ? Number(m[1]) : 0.05;
    const y = m ? Number(m[2]) : 0.10;
    return { x: Number.isFinite(x) ? x : 0.05, y: Number.isFinite(y) ? y : 0.10 };
  }

  function barsIn(node) {
    return [...node.querySelectorAll(SEL)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2 && !el.closest("#peek-box");
    });
  }

  function ancestorBar(btn) {
    const b = btn.getBoundingClientRect();
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    let node = btn.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const bars = barsIn(node).filter((el) => !el.contains(btn));
      if (bars.length) {
        let best = bars[0];
        let bestD = Infinity;
        for (const el of bars) {
          const r = el.getBoundingClientRect();
          const x = Math.max(r.left, Math.min(bx, r.right));
          const y = Math.max(r.top, Math.min(by, r.bottom));
          const d = (bx - x) ** 2 + (by - y) ** 2;
          if (d < bestD) { bestD = d; best = el; }
        }
        return { el: best, bx, by };
      }
      node = node.parentElement;
    }
    return { el: null, bx, by };
  }

  function drawCross(bx, by, maxX, maxY) {
    let h = document.getElementById("peek-cross-h");
    let v = document.getElementById("peek-cross-v");
    if (!h) {
      h = document.createElement("div");
      h.id = "peek-cross-h";
      v = document.createElement("div");
      v.id = "peek-cross-v";
      h.style.cssText = "position:fixed;z-index:2147483646;background:rgba(255,40,40,.85);pointer-events:none";
      v.style.cssText = h.style.cssText;
      document.documentElement.appendChild(h);
      document.documentElement.appendChild(v);
    }
    h.style.left = (bx - maxX) + "px";
    h.style.top = by + "px";
    h.style.width = (maxX * 2) + "px";
    h.style.height = "2px";
    v.style.left = bx + "px";
    v.style.top = (by - maxY) + "px";
    v.style.width = "2px";
    v.style.height = (maxY * 2) + "px";
  }

  function showText(text) {
    let wrap = document.getElementById("peek-box");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "peek-box";
      wrap.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;background:rgba(0,0,0,.35);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px";
      const inp = document.createElement("input");
      inp.placeholder = "0.05:0.10";
      inp.style.cssText = "width:100%;margin-bottom:6px;background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4)";
      inp.value = localStorage.getItem(KEY) || "0.05:0.10";
      inp.addEventListener("change", () => localStorage.setItem(KEY, inp.value));
      inp.addEventListener("click", (e) => e.stopPropagation());
      const out = document.createElement("textarea");
      out.id = "peek-out";
      out.readOnly = true;
      out.style.cssText = "width:100%;height:70px;background:transparent;color:#fff;border:0";
      const aria = document.createElement("div");
      aria.id = "peek-aria";
      aria.style.cssText = "margin-top:6px;white-space:pre-wrap";
      wrap.appendChild(inp);
      wrap.appendChild(out);
      wrap.appendChild(aria);
      document.documentElement.appendChild(wrap);
    }
    document.getElementById("peek-out").value = text || "(none in ancestor)";
  }
  function showAria(btn) {
    const el = document.getElementById("peek-aria");
    if (!el) return;
    const name = btn && (btn.getAttribute("aria-label") || "");
    el.textContent = "from aria-label: " + (name || "(none)");
  }

  showText("");
  document.addEventListener("mousemove", (e) => {
    const btn = e.target.closest && e.target.closest("button, ytcp-button, [role='button']");
    if (!btn || (btn.closest && btn.closest("#peek-box"))) {
      const h = document.getElementById("peek-cross-h");
      const v = document.getElementById("peek-cross-v");
      if (h) h.remove();
      if (v) v.remove();
      return;
    }
    const lim = ratio();
    const hit = ancestorBar(btn);
    drawCross(hit.bx, hit.by, lim.x * window.innerWidth, lim.y * window.innerHeight);
    showText(hit.el && (hit.el.value || hit.el.innerText));
    showAria(btn);
  }, true);
})();

## ?? Assistant

Add a drag handle to the transparent window so you can drag it around without interfering with the input, textarea, or page-hover detection. I've updated your full userscript below.

The window will be draggable by its top padding area, and its position will stay fixed while you move it.

<WritingBlock id="58321" variant="document">```javascript
// ==UserScript==
// @name         Closest ancestor editable peek
// @namespace    ai-chat-logger
// @version      0.2.0
// @description  From a hovered button, use the nearest ancestor that contains a text bar
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const KEY = "peek-ratio";
  const SEL = "[contenteditable='true'], textarea, input:not([type]), input[type='text'], input[type='search']";

  function ratio() {
    const raw = (localStorage.getItem(KEY) || "0.05:0.10").trim();
    const m = raw.match(/([0-9.]+)\s*:\s*([0-9.]+)/);
    const x = m ? Number(m[1]) : 0.05;
    const y = m ? Number(m[2]) : 0.10;
    return {
      x: Number.isFinite(x) ? x : 0.05,
      y: Number.isFinite(y) ? y : 0.10
    };
  }

  function barsIn(node) {
    return [...node.querySelectorAll(SEL)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2 && !el.closest("#peek-box");
    });
  }

  function ancestorBar(btn) {
    const b = btn.getBoundingClientRect();
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    let node = btn.parentElement;

    while (node && node !== document.body && node !== document.documentElement) {
      const bars = barsIn(node).filter((el) => !el.contains(btn));

      if (bars.length) {
        let best = bars[0];
        let bestD = Infinity;

        for (const el of bars) {
          const r = el.getBoundingClientRect();
          const x = Math.max(r.left, Math.min(bx, r.right));
          const y = Math.max(r.top, Math.min(by, r.bottom));
          const d = (bx - x) ** 2 + (by - y) ** 2;

          if (d < bestD) {
            bestD = d;
            best = el;
          }
        }

        return { el: best, bx, by };
      }

      node = node.parentElement;
    }

    return { el: null, bx, by };
  }

  function drawCross(bx, by, maxX, maxY) {
    let h = document.getElementById("peek-cross-h");
    let v = document.getElementById("peek-cross-v");

    if (!h) {
      h = document.createElement("div");
      h.id = "peek-cross-h";
      v = document.createElement("div");
      v.id = "peek-cross-v";

      h.style.cssText =
        "position:fixed;z-index:2147483646;background:rgba(255,40,40,.85);pointer-events:none";
      v.style.cssText = h.style.cssText;

      document.documentElement.appendChild(h);
      document.documentElement.appendChild(v);
    }

    h.style.left = (bx - maxX) + "px";
    h.style.top = by + "px";
    h.style.width = (maxX * 2) + "px";
    h.style.height = "2px";

    v.style.left = bx + "px";
    v.style.top = (by - maxY) + "px";
    v.style.width = "2px";
    v.style.height = (maxY * 2) + "px";
  }

  function makeDraggable(wrap, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.style.cursor = "move";
    handle.title = "Drag to move this window";

    handle.addEventListener("mousedown", (e) => {
      // Only drag with the left mouse button.
      if (e.button !== 0) return;

      // Do not start dragging from interactive controls.
      if (e.target.closest("input, textarea, button, select")) return;

      dragging = true;

      const r = wrap.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = r.left;
      startTop = r.top;

      // Switch from right/bottom anchoring to left/top positioning.
      wrap.style.left = r.left + "px";
      wrap.style.top = r.top + "px";
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";

      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;

      const left = startLeft + e.clientX - startX;
      const top = startTop + e.clientY - startY;

      // Keep at least part of the window within the viewport.
      const maxLeft = Math.max(0, window.innerWidth - 40);
      const maxTop = Math.max(0, window.innerHeight - 30);

      wrap.style.left = Math.max(0, Math.min(left, maxLeft)) + "px";
      wrap.style.top = Math.max(0, Math.min(top, maxTop)) + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function showText(text) {
    let wrap = document.getElementById("peek-box");

    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "peek-box";
      wrap.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;" +
        "background:rgba(0,0,0,.35);color:#fff;" +
        "border:1px solid rgba(255,255,255,.4);padding:6px;box-sizing:border-box";

      // Dedicated drag handle.
      const handle = document.createElement("div");
      handle.id = "peek-drag-handle";
      handle.textContent = "⠿ Drag window";
      handle.style.cssText =
        "height:20px;margin-bottom:6px;font:12px sans-serif;" +
        "color:rgba(255,255,255,.75);user-select:none";

      const inp = document.createElement("input");
      inp.placeholder = "0.05:0.10";
      inp.style.cssText =
        "box-sizing:border-box;width:100%;margin-bottom:6px;" +
        "background:rgba(255,255,255,.2);color:#fff;" +
        "border:1px solid rgba(255,255,255,.4)";
      inp.value = localStorage.getItem(KEY) || "0.05:0.10";
      inp.addEventListener("change", () => localStorage.setItem(KEY, inp.value));
      inp.addEventListener("click", (e) => e.stopPropagation());

      const out = document.createElement("textarea");
      out.id = "peek-out";
      out.readOnly = true;
      out.style.cssText =
        "box-sizing:border-box;width:100%;height:70px;" +
        "background:transparent;color:#fff;border:0";

      const aria = document.createElement("div");
      aria.id = "peek-aria";
      aria.style.cssText = "margin-top:6px;white-space:pre-wrap";

      wrap.appendChild(handle);
      wrap.appendChild(inp);
      wrap.appendChild(out);
      wrap.appendChild(aria);
      document.documentElement.appendChild(wrap);

      makeDraggable(wrap, handle);
    }

    document.getElementById("peek-out").value =
      text || "(none in ancestor)";
  }

  function showAria(btn) {
    const el = document.getElementById("peek-aria");
    if (!el) return;

    const name = btn && (btn.getAttribute("aria-label") || "");
    el.textContent = "from aria-label: " + (name || "(none)");
  }

  showText("");

  document.addEventListener("mousemove", (e) => {
    const btn = e.target.closest &&
      e.target.closest("button, ytcp-button, [role='button']");

    if (!btn || (btn.closest && btn.closest("#peek-box"))) {
      const h = document.getElementById("peek-cross-h");
      const v = document.getElementById("peek-cross-v");
      if (h) h.remove();
      if (v) v.remove();
      return;
    }

    const lim = ratio();
    const hit = ancestorBar(btn);

    drawCross(
      hit.bx,
      hit.by,
      lim.x * window.innerWidth,
      lim.y * window.innerHeight
    );

    showText(hit.el && (hit.el.value || hit.el.innerText));
    showAria(btn);
  }, true);
})();
```</WritingBlock>

**How to use it:** Hover over the `⠿ Drag window` strip at the top, hold the left mouse button, and drag. The text fields remain usable without accidentally moving the window.

## ?? User

ddsd

## ?? Assistant

😂 I'm here! Want to tweak the draggable transparent window some more, or are you testing something?

## ?? User

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      const comp = findComposer();
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (comp && path.includes(comp)) maybeSaveFromComposer();
    }
  }, true);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest("button");
    if (!btn) return;
    const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-testid") || "").toLowerCase();
    if (/send|submit/.test(label)) maybeSaveFromComposer();
  },      ----hi ,this is part of some extension content.js  that i used to catch , say chapgpt ' s just this input text box 's content ,  and for enter key , it can ,but in case i click the 'Send' button , it fails , why  ?

## ?? Assistant

Hi! The key difference is that **pressing Enter and clicking ChatGPT’s Send button are two different event paths**, even though both submit the same message.

Your Enter-key handler works because it explicitly checks whether the event originated inside the composer:

```js
const comp = findComposer();
const path = e.composedPath ? e.composedPath() : [e.target];

if (comp && path.includes(comp)) maybeSaveFromComposer();
```

Your click handler, however, does not locate the composer at all. It only checks whether the clicked element is a `<button>` and whether that button's `aria-label` or `data-testid` contains `send` or `submit`.

That creates several possible failure points.

## 1. The most likely reasons

**A. Your selector misses ChatGPT's Send button.**

Your current code checks:

```js
const label = (
  btn.getAttribute("aria-label") ||
  btn.getAttribute("data-testid") ||
  "").toLowerCase();

if (/send|submit/.test(label)) maybeSaveFromComposer();
```

The `||` is important: it uses `data-testid` only when `aria-label` is empty. If the button has `aria-label="Submit"` but `data-testid="send-button"`, the code sees only `"submit"` — which still matches, but in the opposite case, a nonmatching nonempty label can hide a matching `data-testid`.

For ChatGPT, commonly documented selectors include `button[data-testid="send-button"]` and `button[aria-label="Send prompt"]`. <Cite refs={["turn106330search3","turn106330search7"]}/>

**B. The click target might not be the button itself.**

You use `e.target.closest("button")`, which handles clicks on nested SVGs or icons correctly in ordinary DOM structures. But if the actual target is inside a Shadow DOM, `e.target` can be retargeted to the shadow host, so `closest("button")` may not find the internal button.

**C. `maybeSaveFromComposer()` might run too late.**

Your listener runs during the capture phase, before the button's click handler submits the message. If `maybeSaveFromComposer()` reads the composer immediately, that should normally be fine. However, if your saving logic depends on the composer still containing text after submission, another event handler could clear it before your code reads it — especially if you defer the read asynchronously.

## 2. Recommended fix

Replace your existing click listener with this version. It checks both attributes independently, supports nested click targets through `composedPath()`, and locates the composer associated with the Send button.

<CodeBlock language="javascript" editable>
document.addEventListener("click", (e) => {
  const path = e.composedPath ? e.composedPath() : [e.target];

  const btn = path.find(
    (el) =>
      el instanceof Element &&
      (el.matches("button, [role='button']"))
  );

  if (!btn) return;

  const labels = [
    btn.getAttribute("aria-label"),
    btn.getAttribute("data-testid"),
    btn.getAttribute("title"),
    btn.textContent
  ].filter(Boolean).join(" ").toLowerCase();

  const isSendButton =
    /send|submit/.test(labels) ||
    btn.matches(
      'button[data-testid="send-button"], button[type="submit"]'
    );

  if (!isSendButton) return;

  // Debug: verify that the Send button was detected.
  console.log("[comment logger] Send button detected:", btn);

  maybeSaveFromComposer();
}, true);
</CodeBlock>

One important caveat: this fixes button detection, but it does not guarantee that `maybeSaveFromComposer()` reads the correct input. If your extension supports multiple composers or multiple AI sites, it should identify the composer associated with the clicked button rather than blindly calling `findComposer()`.

## 3. Quick diagnostic

Open DevTools on ChatGPT, click Send, and check whether this log appears:

```js
console.log(
  "clicked:",
  e.target,
  "path:",
  e.composedPath?.().map(el => ({
    tag: el.tagName,
    aria: el.getAttribute?.("aria-label"),
    testid: el.getAttribute?.("data-testid")
  }))
);
```

Put that inside your click handler temporarily.

If you share your `findComposer()` and `maybeSaveFromComposer()` functions, I can pinpoint whether the failure is in **Send-button detection** or **reading the composer text**.

## ?? User

this is the whole content of content.js   :
(function () {
  "use strict";

  const host = location.hostname;
  const platform =
    host.includes("gemini") ? "gemini" :
    host.includes("grok") || host === "x.com" ? "grok" :
    (host.includes("chatgpt") || host.includes("openai")) ? "chatgpt" :
    null;
  if (!platform) {
    chrome.storage.local.get("sideRoutes", (bag) => {
      const rules = Array.isArray(bag.sideRoutes) ? bag.sideRoutes : [];
      const hit = rules.find((item) => String(item.text || "").split(/\n/).some((line) => {
        const m = line.trim().match(/^onMsg:(\S+)/i);
        return m && location.href.startsWith(m[1]);
      }));
      if (!hit) return;
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const el = document.activeElement;
        if (!el || !(el.isContentEditable || el.tagName === "TEXTAREA")) return;
        const text = (el.value || el.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) return;
        const u = new URL(location.href);
        u.hash = "";
        chrome.runtime.sendMessage({
          type: "log-ask",
          platform: hit.id,
          conversationId: u.pathname + u.search,
          url: u.origin + u.pathname + u.search,
          title: document.title,
          text: text,
          logAsks: true,
          ts: Date.now(),
          nonce: Date.now() + "-extra"
        }, () => void chrome.runtime.lastError);
      }, true);
    });
    return;
  }

  const STAMP_CLASS = "ai-ts-stamp";
  let settings = { showStamps: true, logAsks: true, logSeenAsks: true, logSeenAnswers: true, showSeenDebug: true };

  chrome.storage.local.get(["showStamps", "logAsks", "logSeenAsks", "logSeenAnswers", "showSeenDebug"], (bag) => {
    settings.showStamps = bag.showStamps !== false;
    settings.logAsks = bag.logAsks !== false;
    settings.logSeenAsks = bag.logSeenAsks !== false;
    settings.logSeenAnswers = bag.logSeenAnswers !== false;
    settings.showSeenDebug = bag.showSeenDebug !== false;
    if (!settings.showStamps) clearAllStamps();
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.showStamps) {
      settings.showStamps = changes.showStamps.newValue !== false;
      if (!settings.showStamps) clearAllStamps();
      else { loadedConv = ""; schedule(); }
    }
    if (changes.logAsks) settings.logAsks = changes.logAsks.newValue !== false;
    if (changes.logSeenAsks) settings.logSeenAsks = changes.logSeenAsks.newValue !== false;
    if (changes.logSeenAnswers) settings.logSeenAnswers = changes.logSeenAnswers.newValue !== false;
    if (changes.showSeenDebug) settings.showSeenDebug = changes.showSeenDebug.newValue !== false;
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "settings-changed") {
      if (typeof msg.showStamps === "boolean") {
        settings.showStamps = msg.showStamps;
        if (!settings.showStamps) clearAllStamps();
        else { loadedConv = ""; schedule(); }
      }
      if (typeof msg.logAsks === "boolean") settings.logAsks = msg.logAsks;
      if (typeof msg.logSeenAsks === "boolean") settings.logSeenAsks = msg.logSeenAsks;
      if (typeof msg.logSeenAnswers === "boolean") settings.logSeenAnswers = msg.logSeenAnswers;
      if (typeof msg.showSeenDebug === "boolean") settings.showSeenDebug = msg.showSeenDebug;
    }
  });

  const style = document.createElement("style");
  style.textContent = `
    #ai-ts-layer {
      position: fixed !important; inset: 0;
      pointer-events: none !important; z-index: 2147483000 !important;
    }
    .${STAMP_CLASS} {
      position: absolute !important;
      font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
      color: #e8e8e8 !important;
      background: rgba(0,0,0,.42) !important;
      padding: 1px 5px !important;
      border-radius: 4px !important;
      white-space: nowrap !important;
      pointer-events: none !important;
    }
    .${STAMP_CLASS} .ai-ts-date::after { content: "  "; }
  `;
  (document.head || document.documentElement).appendChild(style);

  function pad(n) { return String(n).padStart(2, "0"); }
  function formatStamp(d) {
    d = d instanceof Date ? d : new Date(d);
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    };
  }
    function normalizeAsk2(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
  function normalizeAsk(text) {
    return String(text || "").replace(/\n+/g, "\n").trim();
  }

  function getConversationId() {
    const path = location.pathname || "";
    const u = new URL(location.href);
    u.searchParams.delete("rid");
    u.searchParams.delete("ridx");
    let m;
    if (platform === "chatgpt") {
      m = path.match(/^\/c\/([^/?#]+)/i) || path.match(/^\/g\/[^/]+\/c\/([^/?#]+)/i);
      if (m) return m[1];
    } else if (platform === "gemini") {
      m = path.match(/^\/app\/([^/?#]+)/i) || path.match(/^\/u\/\d+\/app\/([^/?#]+)/i);
      if (m) return m[1];
    } else if (platform === "grok") {
      m = path.match(/^\/(?:chat|c|conversation)\/([^/?#]+)/i);
      if (m) return m[1];
      m = path.match(/^\/i\/grok\/([^/?#]+)/i);
      if (m) return m[1];
      m = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (m) return m[1];
    }
    for (const key of ["chat", "cid", "conversation", "conversationId", "c"]) {
      if (u.searchParams.get(key)) return u.searchParams.get(key);
    }
    return "";
  }

  function looksLikeEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  }

  function detectAccount() {
    const candidates = [];
    const push = (s) => {
      s = String(s || "").replace(/\s+/g, " ").trim();
      if (!s || s.length > 80) return;
      candidates.push(s);
    };

    if (platform === "chatgpt") {
      document.querySelectorAll("[data-testid='accounts-profile-button'], button[aria-label*='@'], img[alt*='@']").forEach((el) => {
        push(el.getAttribute("aria-label"));
        push(el.getAttribute("alt"));
      });
      document.querySelectorAll("nav button, header button, [data-testid*='account'], [data-testid*='profile']").forEach((el) => {
        push(el.getAttribute("aria-label"));
        const t = (el.innerText || "").trim();
        if (looksLikeEmail(t) || /^@/.test(t)) push(t);
      });
    } else if (platform === "gemini") {
      document.querySelectorAll("img[alt], a[aria-label], button[aria-label]").forEach((el) => {
        const a = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
        if (/google account|@/i.test(a)) push(a);
      });
      document.querySelectorAll("[data-email], [data-user-email]").forEach((el) => {
        push(el.getAttribute("data-email") || el.getAttribute("data-user-email"));
      });
    } else if (platform === "grok") {
      document.querySelectorAll('a[href^="/"], [data-testid="SideNav_AccountSwitcher_Button"], [data-testid="DashButton_ProfileIcon_Link"]').forEach((el) => {
        push(el.getAttribute("aria-label"));
        const href = el.getAttribute("href") || "";
        const m = href.match(/^\/([A-Za-z0-9_]{1,30})$/);
        if (m && !/^(home|explore|search|i|notifications|messages|compose|settings|grok|chat)$/i.test(m[1])) {
          push("@" + m[1]);
        }
      });
    }

    let email = "";
    let name = "";
    for (const c of candidates) {
      const em = c.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (em && !email) email = em[0];
      const cleaned = c.replace(/google account[:\s]*/i, "").replace(/\s*\(.*@.*\).*/, "").trim();
      if (!name && cleaned && !looksLikeEmail(cleaned) && cleaned.length >= 2 && cleaned.length < 48) {
        if (!/^(menu|settings|profile|account|open|close|send|new chat)$/i.test(cleaned)) name = cleaned;
      }
    }
    if (email && name) return `${name} / ${email}`;
    return email || name || "";
  }

  function titledWithAccount(title, account) {
    title = String(title || "").trim();
    account = String(account || "").trim();
    if (!account) return title;
    const prefix = `[${account}] `;
    if (title.startsWith(prefix)) return title;
    if (title.includes(account)) return title;
    return prefix + (title || "");
  }

  function queryUserMessages() {
    const found = [];
    const add = (list) => { for (const el of list) found.push(el); };
    if (platform === "chatgpt") {
      add(document.querySelectorAll('[data-message-author-role="user"]'));
      add(document.querySelectorAll(".user-message-bubble-color"));
    } else if (platform === "gemini") {
      add(document.querySelectorAll("user-query, .query-text, .user-query"));
    } else {
      add(document.querySelectorAll('[data-message-author-role="user"]'));
      document.querySelectorAll("div.message-bubble, [class*='message-bubble']").forEach((b) => {
        const parent = b.parentElement;
        const cls = String((parent && parent.className) || "") + " " + String(b.className || "");
        if (/items-end|justify-end|self-end/.test(cls)) found.push(b);
      });
    }
    const seen = new Set();
    return found.filter((el) => { if (seen.has(el)) return false; seen.add(el); return true; });
  }

  function messageText(el) {
    return normalizeAsk(el.innerText || el.textContent || "");
  }

  function pickHost(el) {
    const candidates = [];
    let n = el;
    for (let i = 0; i < 8 && n; i++) { candidates.push(n); n = n.parentElement; }
    let painted = null;
    let scoreBest = -1;
    for (const c of candidates) {
      if (!(c instanceof HTMLElement)) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      const cs = getComputedStyle(c);
      const bg = cs.backgroundColor || "";
      const opaque = /rgba?\(/.test(bg) && !/,\s*0(?:\.0+)?\s*\)$/.test(bg);
      const cls = String(c.className || "");
      if (!(opaque || /bubble|query-text|user-message/i.test(cls))) continue;
      const score = (opaque ? 1000 : 0) + Math.max(0, 800 - r.width);
      if (score > scoreBest) { painted = c; scoreBest = score; }
    }
    return painted || el;
  }

  function getLayer() {
    let layer = document.getElementById("ai-ts-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "ai-ts-layer";
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  let nidSeq = 1;
  const stampBoxes = new Map();

  function clearAllStamps() {
    stampBoxes.clear();
    const layer = document.getElementById("ai-ts-layer");
    if (layer) layer.replaceChildren();
    document.querySelectorAll("[data-ai-ts-nid]").forEach((el) => el.removeAttribute("data-ai-ts-nid"));
  }

  function ensureNid(el) {
    let id = el.getAttribute("data-ai-ts-nid");
    if (!id) {
      id = String(nidSeq++);
      el.setAttribute("data-ai-ts-nid", id);
    }
    return id;
  }

  function writeStampBox(box, when) {
    const { date, time } = formatStamp(when);
    box.innerHTML = `<span class="ai-ts-date">${date}</span><span class="ai-ts-time">${time}</span>`;
    box.dataset.ts = String(when);
  }

  function placeBox(box, hostEl) {
    const r = hostEl.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) { box.style.display = "none"; return; }
    box.style.display = "block";
    const w = box.offsetWidth || 110;
    if (r.left - w - 8 < 8) {
      box.style.transform = "none";
      box.style.left = Math.round(r.left + 4) + "px";
      box.style.top = Math.round(r.top + 4) + "px";
    } else {
      box.style.transform = "translate(-100%, 0)";
      box.style.left = Math.round(r.left - 6) + "px";
      box.style.top = Math.round(r.top) + "px";
    }
  }

  function attachStamp(el, when) {
    const hostEl = pickHost(el);
    const nid = ensureNid(el);
    let box = stampBoxes.get(nid);
    if (!box || !box.isConnected) {
      box = document.createElement("div");
      box.className = STAMP_CLASS;
      getLayer().appendChild(box);
      stampBoxes.set(nid, box);
    }
    writeStampBox(box, when);
    placeBox(box, hostEl);
  }

  let convStampList = [];
  let convStampReady = false;
  let loadedConv = "";

  function loadConvAsks(convId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "get-asks", platform, conversationId: convId }, (res) => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        const rows = (res && res.rows) || [];
        resolve(
          rows
            .filter((r) => r.platform === platform && r.conversationId === convId)
            .sort((a, b) => a.ts - b.ts)
        );
      });
    });
  }

  function stampAll() {
    if (!settings.showStamps) {
      clearAllStamps();
      return;
    }
    const conv = getConversationId();
    if (conv !== loadedConv) {
      loadedConv = conv;
      convStampReady = false;
      convStampList = [];
      clearAllStamps();
      if (conv) {
        loadConvAsks(conv).then((rows) => {
          if (loadedConv !== conv) return;
          convStampList = rows;
          convStampReady = true;
          stampAll();
        });
      } else {
        convStampReady = true;
      }
      if (conv) return;
    }
    const used = new Set();
    const liveNids = new Set();
    for (const el of queryUserMessages()) {
      const text = messageText(el);
      if (!text) continue;
      let when = null;
      for (let i = 0; i < convStampList.length; i++) {
        if (used.has(i)) continue;
        if (normalizeAsk(convStampList[i].text) === text) {
          when = convStampList[i].ts;
          used.add(i);
          break;
        }
      }
      const nid = el.getAttribute("data-ai-ts-nid");
      const existing = nid ? stampBoxes.get(nid) : null;
      if (existing && existing.isConnected) {
        if (when) writeStampBox(existing, when);
        placeBox(existing, pickHost(el));
        liveNids.add(nid);
        continue;
      }
      if (!when) {
        if (!convStampReady && conv) continue;
        when = Date.now();
      }
      attachStamp(el, when);
      liveNids.add(el.getAttribute("data-ai-ts-nid"));
    }
    for (const [nid, box] of [...stampBoxes.entries()]) {
      if (!liveNids.has(nid)) {
        box.remove();
        stampBoxes.delete(nid);
      }
    }
  }

  function findComposer() {
    const selectors = {
      chatgpt: ["#prompt-textarea", '[data-testid="composer-text-input"]'],
      gemini: ["rich-textarea .ql-editor", '[aria-label="Enter a prompt here"]'],
      grok: ['[data-testid="chat-input"] textarea', 'textarea[aria-label="Ask Grok anything"]', 'textarea[placeholder="Ask anything"]', ".tiptap.ProseMirror[contenteditable=\"true\"]"]
    };
    for (const sel of selectors[platform]) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === "TEXTAREA")) return a;
    return null;
  }

  function getComposerText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }

  function setComposerText(el, text) {
    if (!el) return;
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, text);
    } catch (_) {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  }

  let lastSavedText = "";
  let lastSavedAt = 0;
  const heldAsks = [];
  let knownId = "";
  let lastSyncedTitle = "";
  const BIND_MS = 20000;

  function sessionUrl(id) {
    if (id && location.pathname.includes(id)) return location.href;
    if (platform === "grok") return location.origin + "/c/" + id;
    if (platform === "chatgpt") return location.origin + "/c/" + id;
    if (platform === "gemini") return location.origin + "/app/" + id;
    return location.href;
  }

  function cleanTitle(raw) {
    return String(raw || "")
      .replace(/\s+[-|–—]\s+(Grok|ChatGPT|Gemini|Google Gemini)\s*$/i, "")
      .trim();
  }

  function isGenericTitle(raw) {
    const bare = cleanTitle(raw).replace(/^\[[^\]]+\]\s*/, "").toLowerCase();
    return !bare || /^(grok|chatgpt|gemini|google gemini|new chat|untitled)$/.test(bare);
  }

  function postLog(conversationId, raw, ts, account) {
    const title = titledWithAccount(cleanTitle(document.title), account);
    if (settings.logAsks && raw) convStampList.push({ text: raw, ts, conversationId });
    chrome.runtime.sendMessage({
      type: "log-ask",
      platform,
      conversationId,
      url: sessionUrl(conversationId),
      title,
      account,
      text: settings.logAsks ? raw : "",
      logAsks: settings.logAsks,
      ts,
      nonce: ts + "-" + Math.random().toString(36).slice(2, 8)
    }, () => void chrome.runtime.lastError);
  }

  function syncTitle(conversationId, rawTitle) {
    if (!conversationId || String(conversationId).startsWith("pending:")) return;
    const title = cleanTitle(rawTitle || document.title);
    if (!title || isGenericTitle(title)) return;
    const key = conversationId + "\n" + title;
    if (key === lastSyncedTitle) return;
    lastSyncedTitle = key;
    chrome.runtime.sendMessage({
      type: "sync-title",
      platform,
      conversationId,
      url: sessionUrl(conversationId),
      title: titledWithAccount(title, detectAccount()),
      account: detectAccount(),
      titleSync: true,
      ts: Date.now()
    }, () => void chrome.runtime.lastError);
  }

  function rebindPending(conversationId, texts) {
    chrome.runtime.sendMessage({
      type: "rebind-pending",
      platform,
      conversationId,
      url: sessionUrl(conversationId),
      title: titledWithAccount(cleanTitle(document.title), detectAccount()),
      account: detectAccount(),
      texts: texts || [],
      ts: Date.now()
    }, () => void chrome.runtime.lastError);
  }

  function bindHeld(id, title) {
    if (!id || String(id).startsWith("pending:")) return;
    knownId = id;
    const batch = heldAsks.splice(0, heldAsks.length);
    for (const ask of batch) postLog(id, ask.text, ask.ts, ask.account);
    rebindPending(id, batch.map((ask) => ask.text));
    syncTitle(id, title || document.title);
    loadedConv = "";
    refreshHist();
  }

  function activeId() {
    return getConversationId() || knownId || "";
  }

  function logAsk(text) {
    const raw = normalizeAsk(text);
    const now = Date.now();
    if (raw && raw === lastSavedText && now - lastSavedAt < 800) return;
    if (raw) {
      lastSavedText = raw;
      lastSavedAt = now;
    }
    const account = detectAccount();
    const id = getConversationId();
    if (id) {
      knownId = id;
      postLog(id, raw, now, account);
      return;
    }
    heldAsks.push({ text: raw, ts: now, account, at: now });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "ai-chat-logger") return;
    const id = e.data.id || getConversationId() || knownId;
    if (e.data.id && !getConversationId()) bindHeld(e.data.id, e.data.title);
    else if (e.data.id) knownId = e.data.id;
    if (e.data.title) syncTitle(id, e.data.title);
  });

  window.addEventListener("pagehide", () => {
    const id = getConversationId();
    if (id) {
      bindHeld(id);
      return;
    }
    for (const ask of heldAsks.splice(0, heldAsks.length)) {
      postLog("pending:" + ask.at, ask.text, ask.ts, ask.account);
    }
  });

  function maybeSaveFromComposer() {
    logAsk(getComposerText(findComposer()));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      const comp = findComposer();
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (comp && path.includes(comp)) maybeSaveFromComposer();
    }
  }, true);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest("button");
    if (!btn) return;
    const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-testid") || "").toLowerCase();
    if (/send|submit/.test(label)) maybeSaveFromComposer();
  }, true);

  let histCache = [];
  let histIndex = -1;
  let liveDraft = "";
  let cycling = false;
  let histConv = "";

  function refreshHist() {
    const convId = getConversationId();
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "get-asks", platform, conversationId: convId }, (res) => {
        const rows = ((res && res.rows) || [])
          .filter((r) => r.platform === platform && r.conversationId === convId)
          .filter((r) => r.source === "onMsg" || String(r.recordKey || "").includes("|onMsg|"))
          .sort((a, b) => a.ts - b.ts);
        histCache = rows.map((r) => r.text).filter(Boolean);
        histConv = convId;
        resolve();
      });
    });
  }
  refreshHist();

  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const comp = findComposer();
    if (!comp) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (!(path.includes(comp) || comp.contains(e.target))) return;
    e.preventDefault();
    e.stopPropagation();
    const convNow = getConversationId();
    if (convNow !== histConv) {
      cycling = false;
      histIndex = -1;
    }
    refreshHist().then(() => {
      if (!histCache.length) return;
      if (!cycling) {
        liveDraft = getComposerText(comp);
        cycling = true;
        histIndex = histCache.length;
      }
      if (e.key === "ArrowUp") histIndex = Math.max(0, histIndex - 1);
      else histIndex = Math.min(histCache.length, histIndex + 1);
      if (histIndex >= histCache.length) {
        setComposerText(comp, liveDraft);
        cycling = false;
        histIndex = -1;
      } else {
        setComposerText(comp, histCache[histIndex]);
      }
    });
  }, true);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      stampAll();
    });
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => syncTitle(getConversationId(), document.title)).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
  schedule();
  setInterval(schedule, 1500);
  window.addEventListener("scroll", () => {
    if (!settings.showStamps) return;
    for (const el of queryUserMessages()) {
      const nid = el.getAttribute("data-ai-ts-nid");
      const box = nid && stampBoxes.get(nid);
      if (box) placeBox(box, pickHost(el));
    }
  }, true);
  window.addEventListener("resize", schedule);

  let lastHref = location.href;
  setInterval(() => {
    const id = getConversationId();
    if (id && heldAsks.length) bindHeld(id);
    else if (id && id !== knownId) {
      knownId = id;
      syncTitle(id, document.title);
      rebindPending(id, queryUserMessages().map(messageText).filter(Boolean));
    }
    heldAsks.slice().forEach((ask) => {
      if (Date.now() - ask.at > BIND_MS && !getConversationId()) {
        const i = heldAsks.indexOf(ask);
        if (i >= 0) heldAsks.splice(i, 1);
        postLog("pending:" + ask.at, ask.text, ask.ts, ask.account);
      }
    });
    logSeenBubbles();
    if (location.href === lastHref) return;
    lastHref = location.href;
    loadedConv = "";
    convStampReady = false;
    convStampList = [];
    cycling = false;
    histIndex = -1;
    histCache = [];
    histConv = "";
    clearAllStamps();
    schedule();
    refreshHist();
  }, 600);

  function grokRoleOf(sender) {
    const s = String(sender || "").toLowerCase();
    if (s === "human" || s === "user") return "user";
    if (s === "assistant" || s === "bot" || s === "grok") return "assistant";
    return s || "unknown";
  }

  async function listGrokSessions(limit) {
    const out = [];
    let pageToken;
    while (out.length < limit) {
      const url = new URL("https://grok.com/rest/app-chat/conversations");
      url.searchParams.set("pageSize", String(Math.min(30, limit - out.length)));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("grok list " + res.status);
      const data = await res.json();
      for (const c of data.conversations || []) {
        if (!c.conversationId) continue;
        out.push({
          id: c.conversationId,
          title: c.title || "(untitled)",
          createdAt: c.createTime || "",
          updatedAt: c.modifyTime || "",
          url: "https://grok.com/c/" + c.conversationId
        });
        if (out.length >= limit) break;
      }
      pageToken = data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return out;
  }

  async function fetchGrokTurns(id) {
    const enc = encodeURIComponent(id);
    const opt = { credentials: "include", headers: { accept: "application/json" } };
    const detailRes = await fetch("https://grok.com/rest/app-chat/conversations_v2/" + enc, opt);
    if (!detailRes.ok) throw new Error("conversations_v2 " + detailRes.status);
    const detail = await detailRes.json();
    const nodeRes = await fetch("https://grok.com/rest/app-chat/conversations/" + enc + "/response-node", opt);
    if (!nodeRes.ok) throw new Error("response-node " + nodeRes.status);
    const nodes = ((await nodeRes.json()).responseNodes || []);
    const responseIds = [...new Set(nodes.map((n) => n.responseId).filter(Boolean))];
    const loadRes = await fetch("https://grok.com/rest/app-chat/conversations/" + enc + "/load-responses", {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ responseIds })
    });
    if (!loadRes.ok) throw new Error("load-responses " + loadRes.status);
    const loaded = await loadRes.json();
    const byId = new Map((loaded.responses || []).map((r) => [r.responseId, r]));
    const turns = [];
    for (const rid of responseIds) {
      const r = byId.get(rid);
      if (!r) continue;
      const text = String(r.message || "").trim();
      if (!text) continue;
      const created = r.createTime ? Date.parse(r.createTime) : Date.now();
      turns.push({
        role: grokRoleOf(r.sender),
        text,
        responseId: rid,
        ts: Number.isFinite(created) ? created : Date.now()
      });
    }
    const conv = detail.conversation || detail || {};
    return {
      title: conv.title || document.title,
      url: "https://grok.com/c/" + id,
      turns
    };
  }

  async function listChatGPTSessions(limit) {
    const sess = await fetch("https://chatgpt.com/api/auth/session", {
      credentials: "include",
      headers: { accept: "application/json" }
    }).then((r) => r.json());
    const token = sess && sess.accessToken;
    if (!token) throw new Error("no ChatGPT accessToken");
    const out = [];
    let offset = 0;
    while (out.length < limit) {
      const url = new URL("https://chatgpt.com/backend-api/conversations");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(Math.min(28, limit - out.length)));
      url.searchParams.set("order", "updated");
      const res = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json", authorization: "Bearer " + token }
      });
      if (!res.ok) throw new Error("chatgpt list " + res.status);
      const data = await res.json();
      const items = data.items || [];
      for (const it of items) {
        if (!it.id) continue;
        out.push({
          id: it.id,
          title: it.title || "(untitled)",
          createdAt: it.create_time || "",
          updatedAt: it.update_time || "",
          url: "https://chatgpt.com/c/" + it.id
        });
        if (out.length >= limit) break;
      }
      if (!items.length) break;
      offset += items.length;
    }
    return { token, out };
  }

  function chatgptMessageText(msg) {
    const content = msg && msg.content;
    if (!content) return "";
    if (typeof content === "string") return content;
    const parts = content.parts || [];
    return parts.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join("\n");
  }

  async function fetchChatGPTTurns(id, token) {
    const res = await fetch("https://chatgpt.com/backend-api/conversation/" + encodeURIComponent(id), {
      credentials: "include",
      headers: { accept: "application/json", authorization: "Bearer " + token }
    });
    if (!res.ok) throw new Error("chatgpt conversation " + res.status);
    const data = await res.json();
    const mapping = data.mapping || {};
    const turns = [];
    const nodes = Object.values(mapping);
    nodes.sort((a, b) => {
      const ta = (a.message && a.message.create_time) || 0;
      const tb = (b.message && b.message.create_time) || 0;
      return ta - tb;
    });
    for (const node of nodes) {
      const msg = node && node.message;
      if (!msg) continue;
      const role = msg.author && msg.author.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = chatgptMessageText(msg).trim();
      if (!text) continue;
      turns.push({
        role,
        text,
        responseId: msg.id || node.id || "",
        ts: msg.create_time ? Math.round(msg.create_time * 1000) : Date.now()
      });
    }
    return { title: data.title || document.title, url: "https://chatgpt.com/c/" + id, turns };
  }


  const seenLogged = new Set();
  const seenLast = new Map();
  let seenLastScan = -1;
  let seenMap = null;
  let seenMapId = "";
  let seenMapAt = 0;

  function bubbleUid(el) {
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      const id = n.getAttribute("data-message-id") || n.getAttribute("data-response-id") || n.getAttribute("data-turn-id") || "";
      if (id && id.length > 4) return id;
      n = n.parentElement;
    }
    return "";
  }

  function bubbleBody(el, role) {
    if (role !== "user") {
      const md = el.querySelector(".response-content-markdown, .markdown");
      if (md) return messageText(md);
    }
    return messageText(el).replace(/^worked for \d+s\s*/i, "");
  }

  function geminiTurnId(el) {
    const marked = el.querySelector("[id^='message-content-id-r_'], [id^='model-response-message-contentr_']");
    const markedId = marked && marked.id || "";
    const fromMark = markedId.match(/r_([0-9a-f]{8,})/i);
    if (fromMark) return "r_" + fromMark[1];
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      if (/^[0-9a-f]{8,}$/i.test(n.id || "") && n.id !== "chat-history") return "r_" + n.id;
      const inner = n.querySelector && n.querySelector("[id^='message-content-id-r_']");
      if (inner) {
        const m = inner.id.match(/r_([0-9a-f]{8,})/i);
        if (m) return "r_" + m[1];
      }
      n = n.parentElement;
    }
    return "";
  }

  function domTurnId(el) {
    const wrap = el.closest && el.closest("[id^='response-']");
    if (wrap && /^response-[0-9a-f-]{8,}$/i.test(wrap.id || "")) return wrap.id.slice("response-".length);
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      const raw = n.id || "";
      if (/^response-[0-9a-f-]{8,}$/i.test(raw)) return raw.slice("response-".length);
      const mid = n.getAttribute && n.getAttribute("data-message-id") || "";
      if (mid.length > 4) return mid;
      n = n.parentElement;
    }
    return "";
  }

  function firstWalkBubbles() {
    const out = [];
    const push = (el, role) => {
      const text = bubbleBody(el, role);
      if (!text) return;
      out.push({ role, uid: domTurnId(el), text });
    };
    const take = (userSel, ansSel) => {
      document.querySelectorAll(userSel).forEach((el) => push(el, "user"));
      document.querySelectorAll(ansSel).forEach((el) => push(el, "assistant"));
    };
    if (platform === "grok") {
      document.querySelectorAll("[data-testid='chat-transcript-scroller'] div[id^='response-']").forEach((wrap) => {
        if (!/^response-[0-9a-f-]{8,}$/i.test(wrap.id || "")) return;
        const uid = wrap.id.slice("response-".length);
        const user = wrap.querySelector("[data-testid='user-message']");
        const ans = wrap.querySelector("[data-testid='assistant-message']");
        const el = user || ans;
        if (!el) return;
        const md = el.querySelector(".response-content-markdown, .markdown, p");
        const text = messageText(md || el).replace(/^worked for \d+s\s*/i, "");
        if (!text) return;
        out.push({ role: user ? "user" : "assistant", uid, text });
      });
      if (!out.length) {
        document.querySelectorAll("div[id^='response-']").forEach((wrap) => {
          if (!/^response-[0-9a-f-]{8,}$/i.test(wrap.id || "")) return;
          const uid = wrap.id.slice("response-".length);
          const user = wrap.querySelector("[data-testid='user-message']");
          const ans = wrap.querySelector("[data-testid='assistant-message']");
          const el = user || ans;
          if (!el) return;
          const md = el.querySelector(".response-content-markdown, .markdown, p");
          const text = messageText(md || el).replace(/^worked for \d+s\s*/i, "");
          if (!text) return;
          out.push({ role: user ? "user" : "assistant", uid, text });
        });
      }
    } else if (platform === "chatgpt") take('[data-message-author-role="user"]', '[data-message-author-role="assistant"]');
    else if (platform === "gemini") {
      const wraps = document.querySelectorAll("#chat-history infinite-scroller > div[id], #chat-history > div[id]");
      const list = wraps.length ? wraps : document.querySelectorAll("user-query, model-response");
      list.forEach((el) => {
        const wrap = el.matches && el.matches("user-query, model-response") ? el.parentElement : el;
        if (!wrap) return;
        const hex = (wrap.id || "").match(/^[0-9a-f]{8,}$/i);
        const uid = hex ? "r_" + wrap.id : geminiTurnId(wrap);
        if (!uid) return;
        const user = wrap.querySelector(":scope > user-query") || wrap.querySelector("user-query");
        const ans = wrap.querySelector(":scope > model-response") || wrap.querySelector("model-response");
        if (user) {
          const text = messageText(user);
          if (text) out.push({ role: "user", uid, text });
        }
        if (ans) {
          const body = ans.querySelector("message-content, model-response-content, .model-response-text") || ans;
          const text = messageText(body);
          if (text) out.push({ role: "assistant", uid, text });
        }
      });
    }
    return out;
  }

  async function secondWalkTurns(convId) {
    if (seenMap && seenMapId === convId && Date.now() - seenMapAt < 60000) return seenMap;
    let turns = [];
    if (platform === "grok") {
      const detail = await fetchGrokTurns(convId);
      turns = detail.turns || [];
    } else if (platform === "chatgpt") {
      const sess = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include", headers: { accept: "application/json" } }).then((r) => r.json());
      const token = sess && sess.accessToken;
      if (!token) return [];
      const detail = await fetchChatGPTTurns(convId, token);
      turns = detail.turns || [];
    } else return [];
    seenMap = turns;
    seenMapId = convId;
    seenMapAt = Date.now();
    return turns;
  }

  function roleOf(turn) {
    return turn.role === "user" || turn.role === "ask" || turn.role === "human" ? "user" : "assistant";
  }

  function matchSeenTurn(bubble, turns, used) {
    if (bubble.uid) {
      const hit = turns.find((turn) => turn.responseId === bubble.uid && !used.has(turn.responseId));
      if (hit) return hit;
    }
    const want = bubble.role === "user" ? "user" : "assistant";
    const text = normalizeAsk(bubble.text);
    return turns.find((turn) => {
      if (used.has(turn.responseId)) return false;
      if (roleOf(turn) !== want || !turn.responseId || !turn.ts) return false;
      const got = normalizeAsk(turn.text);
      return got === text || (text.length > 24 && (got.startsWith(text.slice(0, 80)) || text.startsWith(got.slice(0, 80))));
    }) || null;
  }

  function parentAskTurn(turns, answerTurn) {
    let prev = null;
    for (const turn of turns) {
      if (turn.responseId === answerTurn.responseId) return prev;
      if (roleOf(turn) === "user") prev = turn;
    }
    return prev;
  }

  function seenPrefix(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(ts) || Number.isNaN(d.getTime())) return "SEEN_ONLINE: ";
    const z = (n) => String(n).padStart(2, "0");
    return "SEEN_ONLINE: " + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds()) + " ";
  }

  function seenDebug(line) {
    let box = document.getElementById("ai-seen-debug");
    if (!settings.showSeenDebug) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.id = "ai-seen-debug";
      box.style.cssText = "position:fixed;top:72px;right:12px;z-index:2147483646;width:460px;max-height:46vh;overflow:auto;background:rgba(12,16,24,.62);color:#f2f2f2;font:12px/1.45 Consolas,monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.25);border-radius:8px;";
      const bar = document.createElement("div");
      bar.textContent = "seen debug (drag)";
      bar.style.cssText = "cursor:move;font-weight:600;margin-bottom:6px;";
      const pre = document.createElement("pre");
      pre.id = "ai-seen-debug-log";
      pre.style.cssText = "margin:0;white-space:pre-wrap;";
      box.appendChild(bar);
      box.appendChild(pre);
      document.documentElement.appendChild(box);
      let drag = false, dx = 0, dy = 0;
      bar.addEventListener("mousedown", (e) => { drag = true; dx = e.clientX - box.offsetLeft; dy = e.clientY - box.offsetTop; });
      window.addEventListener("mousemove", (e) => {
        if (!drag) return;
        box.style.left = (e.clientX - dx) + "px";
        box.style.top = (e.clientY - dy) + "px";
        box.style.right = "auto";
      });
      window.addEventListener("mouseup", () => { drag = false; });
    }
    const pre = document.getElementById("ai-seen-debug-log");
    pre.textContent = (line + "\n" + pre.textContent).slice(0, 5000);
  }

  function postSeen(convId, role, responseId, text, ts, ask) {
    chrome.runtime.sendMessage({
      type: "log-seen",
      platform,
      conversationId: convId,
      responseId,
      role,
      text,
      ts,
      url: sessionUrl(convId),
      title: titledWithAccount(cleanTitle(document.title), detectAccount()),
      account: detectAccount(),
      askResponseId: ask && ask.responseId || "",
      askText: ask ? (ask.text || "") : "",
      askTs: ask && ask.ts || 0,
      askDummy: !settings.logSeenAsks
    }, (res) => {
      if (chrome.runtime.lastError) {
        seenDebug("error " + role + " " + responseId + " " + chrome.runtime.lastError.message);
        return;
      }
      const added = res && res.added;
      seenDebug((added ? "recorded " : "skipped existing ") + role + " " + responseId + " " + String(text || "").slice(0, 80));
    });
  }

  async function logSeenBubbles() {
    if (!settings.logSeenAsks && !settings.logSeenAnswers) {
      seenDebug("seen checkboxes off");
      return;
    }
    const convId = getConversationId();
    if (!convId) {
      seenDebug("no conversation id " + location.pathname);
      return;
    }
    const bubbles = firstWalkBubbles();
    if (seenLastScan !== bubbles.length) {
      seenLastScan = bubbles.length;
      seenDebug("scan " + platform + " bubbles=" + bubbles.length + " " + location.pathname);
    }
    if (!bubbles.length) return;
    if (platform === "gemini" || platform === "grok" || platform === "chatgpt") {
      let lastAsk = null;
      for (const b of bubbles) {
        if (b.role === "user") lastAsk = b;
        const key = convId + "|" + b.role + "|" + b.uid;
        if (!b.uid || seenLogged.has(key)) continue;
        const wantAsk = b.role === "user" && settings.logSeenAsks;
        const wantAns = b.role !== "user" && settings.logSeenAnswers;
        if (!wantAsk && !wantAns) continue;
        if (b.role !== "user") {
          const prev = seenLast.get(key);
          seenLast.set(key, b.text);
          if (prev == null) continue;
          const ts = Date.now();
          const prefix = seenPrefix(ts) + (prev !== b.text ? "MAY_INCOMPLETE " : "");
          seenLogged.add(key);
          postSeen(convId, b.role, b.uid, prefix + b.text, ts, lastAsk && { responseId: lastAsk.uid, text: lastAsk.text, ts });
          continue;
        }
        const ts = Date.now();
        seenLogged.add(key);
        postSeen(convId, "user", b.uid, seenPrefix(ts) + b.text, ts, null);
      }
      return;
    }
    let turns;
    try { turns = await secondWalkTurns(convId); } catch (_) { return; }
    if (!turns || !turns.length) return;
    const used = new Set();
    for (const b of bubbles) {
      const wantAsk = b.role === "user" && settings.logSeenAsks;
      const wantAns = b.role !== "user" && settings.logSeenAnswers;
      if (!wantAsk && !wantAns) continue;
      let turn = matchSeenTurn(b, turns, used);
      if (!turn) {
        const want = b.role === "user" ? "user" : "assistant";
        const same = bubbles.filter((x) => x.role === b.role);
        const pool = turns.filter((item) => roleOf(item) === want && item.responseId && !used.has(item.responseId));
        turn = pool[same.indexOf(b)] || null;
      }
      if (!turn || !turn.ts || !turn.responseId) continue;
      used.add(turn.responseId);
      const key = convId + "|" + turn.responseId;
      if (seenLogged.has(key)) continue;
      seenLogged.add(key);
      const parent = b.role === "user" ? null : parentAskTurn(turns, turn);
      postSeen(convId, b.role, turn.responseId, seenPrefix(turn.ts) + b.text, turn.ts, parent);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "list-sessions") {
      (async () => {
        const to = msg.to || 10;
        if (platform === "grok") {
          const rows = await listGrokSessions(to);
          sendResponse({ ok: true, platform, rows, account: detectAccount() });
          return;
        }
        if (platform === "chatgpt") {
          const { token, out } = await listChatGPTSessions(to);
          sendResponse({ ok: true, platform, rows: out, token, account: detectAccount() });
          return;
        }
        sendResponse({ ok: false, error: "manual sync list not implemented for " + platform });
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (msg.type === "fetch-session") {
      (async () => {
        if (platform === "grok") {
          const pack = await fetchGrokTurns(msg.id);
          sendResponse({ ok: true, platform, ...pack });
          return;
        }
        if (platform === "chatgpt") {
          let token = msg.token;
          if (!token) {
            const sess = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include", headers: { accept: "application/json" } }).then((r) => r.json());
            token = sess && sess.accessToken;
          }
          const pack = await fetchChatGPTTurns(msg.id, token);
          sendResponse({ ok: true, platform, ...pack });
          return;
        }
        sendResponse({ ok: false, error: "fetch-session not implemented for " + platform });
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });
})();

## ?? Assistant

I've found the main issue in your actual `content.js`. You don't need to change the logging/storage logic or the rest of the extension.

The relevant code is these two functions:

```js
function findComposer() {
  // ...
  const el = document.querySelector("#prompt-textarea");
  // ...
}

function maybeSaveFromComposer() {
  logAsk(getComposerText(findComposer()));
}
```

Your Send-button handler calls `maybeSaveFromComposer()`, which calls `findComposer()` again instead of reading the composer associated with the clicked button.

There are **two concrete weaknesses** in the current ChatGPT implementation:

1. **Button detection is fragile.** You select only `e.target.closest("button")`, then choose either `aria-label` or `data-testid`. If neither attribute contains `send` or `submit`, your handler silently does nothing.
2. **The composer lookup is not tied to the click.** ChatGPT's composer is a `contenteditable` element, and its DOM and button attributes can change. If `findComposer()` returns `null` or a different element, `getComposerText()` returns an empty string or the wrong text.

There's also an important timing detail: your click listener uses capture mode (`true`), so it runs before ChatGPT's own button click handler. That's generally helpful here because the text is still present before submission.

## Replace only your click handler

Find this block in `content.js`:

```js
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest("button");
  if (!btn) return;
  const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-testid") || "").toLowerCase();
  if (/send|submit/.test(label)) maybeSaveFromComposer();
}, true);
```

Replace it with this:

<CodeBlock language="javascript" editable>
document.addEventListener("click", (e) => {
  const path = e.composedPath ? e.composedPath() : [e.target];

  const btn = path.find(
    (el) =>
      el instanceof Element &&
      el.matches("button, [role='button']")
  );

  if (!btn) return;

  // Check each attribute independently.
  const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
  const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
  const title = (btn.getAttribute("title") || "").toLowerCase();

  const isSend =
    /send|submit/.test(aria) ||
    /send|submit/.test(testid) ||
    /send|submit/.test(title) ||
    btn.matches('button[type="submit"]');

  if (!isSend) return;

  const comp = findComposer();
  const text = getComposerText(comp);

  console.log("[ai-chat-logger] Send clicked", {
    platform,
    button: btn,
    composerFound: !!comp,
    textLength: text.length,
    text
  });

  if (text.trim()) logAsk(text);
}, true);
</CodeBlock>

### How to verify

1. Reload the extension in `edge://extensions`.
2. Refresh the ChatGPT tab.
3. Type a test message and click **Send**.
4. Open DevTools → Console.

You should see a log containing `Send clicked`, `composerFound: true`, and the message text.

- **No log appears:** the clicked control wasn't recognized as a Send button.
- **`composerFound: false`:** `findComposer()` failed to locate the current composer.
- **`textLength: 0`:** the composer was empty when the listener read it.
- **Text appears correctly:** the click handler captured the message; if it still isn't saved, investigate `logAsk()` and the background message handler.

This patch also avoids depending on `aria-label` being empty before checking `data-testid`, which is a weakness in your original handler.

## ?? User

hellotest

## ?? Assistant

Hello! 👋 What would you like to work on today?

## ?? User

hellotest2

## ?? Assistant

Hello test 2! 😄 I'm here.

## ?? User

hjkl

## ?? Assistant

You typed `hjkl` 😄 Testing your keyboard, or shall we work on something?

## ?? User

hjkl

## ?? Assistant

`hjkl` 😄 Test received!

## ?? User

hello

## ?? Assistant

Hello! 👋 I'm here. What can I help you with?

## ?? User

hellooo

## ?? Assistant

Helloooo! 😄👋 I'm here!

## ?? User

do u have an slightly alternate approach , if that is not working

## ?? Assistant

Yes. For your `ai-chat-logger` Chrome extension, I’d try a **different approach rather than continuing to rely on identifying ChatGPT’s Send button**.

Since your Enter-key capture already works, we know the composer lookup and text extraction can work in at least one submission path. The alternative is to detect when ChatGPT actually submits a prompt, rather than guessing which button was clicked.

There are two good options:

## Option 1 — Watch for the composer to be cleared

When you click Send, ChatGPT typically processes the prompt and clears the composer. You can watch for that change and preserve the text that was present immediately before it was cleared.

- **Advantage:** Doesn't depend on the Send button's `aria-label`, `data-testid`, or DOM structure.
- **Limitation:** Clearing can happen for other reasons, and some submission flows may not clear the composer in the expected way. You need to avoid logging drafts that weren't submitted.

## Option 2 — Listen for the form's `submit` event

This is the alternative I'd test first. Instead of detecting a button click, listen for the form submission itself.

Add this listener to `content.js`:

<CodeBlock language="javascript">
document.addEventListener("submit", (e) => {
  const form = e.target;

  if (!(form instanceof HTMLFormElement)) return;

  const comp = findComposer();
  if (!comp || !form.contains(comp)) return;

  const text = getComposerText(comp).trim();
  if (!text) return;

  console.log("[ai-chat-logger] Form submitted", {
    platform,
    text
  });

  logAsk(text);
}, true);
</CodeBlock>

**Important:** Test this as an alternative to your existing click handler. Keep in mind that your Enter-key listener may log the same prompt too, so check for duplicate entries. Also, a site can submit prompts without triggering a native `submit` event.

### If neither approach works

My next choice would be a `MutationObserver` that watches the conversation for a newly rendered user message. That detects the prompt after it appears in the chat, independent of how the user submitted it.

I'd test the form listener first because it requires less code. If you share the console output after clicking Send, we can narrow down which path ChatGPT is actually using.

## ?? User

document.addEventListener("click", (e) => {
  const path = e.composedPath ? e.composedPath() : [e.target];

  const btn = path.find(
    (el) =>
      el instanceof Element &&
      el.matches("button, [role='button']")
  );

  if (!btn) return;

  // Check each attribute independently.
  const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
  const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
  const title = (btn.getAttribute("title") || "").toLowerCase();

  const isSend =
    /send|submit/.test(aria) ||
    /send|submit/.test(testid) ||
    /send|submit/.test(title) ||
    btn.matches('button[type="submit"]');

  if (!isSend) return;

  const comp = findComposer();
  const text = getComposerText(comp);

  console.log("[ai-chat-logger] Send clicked", {
    platform,
    button: btn,
    composerFound: !!comp,
    textLength: text.length,
    text
  });

  if (text.trim()) logAsk(text);
}, true);  ---can u try add the code to fetch from the current editable text bar 's text , and  escap this into a tampermonkey script , that at least log 2 things : click is detected or not ,and when click , if u can fetch the  text  , display fetched  text in an draggable transparent window  ?

## ?? Assistant

Yes. Let's make a standalone **Tampermonkey diagnostic script** so you can test ChatGPT directly, without modifying your `ai-chat-logger` extension.

This script does three things:

1. **Logs every click** to the browser console, so we can verify whether the click listener fires.
2. **Fetches the current editable text bar's contents** and logs the result, including when the text is empty.
3. Displays the fetched text in a **draggable, semi-transparent floating window** on the ChatGPT page.

## 1. Tampermonkey script

<WritingBlock id="58321" variant="document">```javascript
// ==UserScript==
// @name         ChatGPT Composer Click Debugger
// @namespace    ai-chat-logger-debug
// @version      1.0
// @description  Debug clicks and inspect the current ChatGPT composer text
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "[Composer Debugger]";

  // --------------------------------------------------
  // 1. Find the current editable text bar
  // --------------------------------------------------
  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      '[data-testid="composer-text-input"]',
      'textarea[placeholder]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'textarea',
      '[role="textbox"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (const el of elements) {
        if (!(el instanceof HTMLElement)) continue;

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        if (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        ) {
          return el;
        }
      }
    }

    // Fallback: currently focused editable element
    const active = document.activeElement;

    if (
      active instanceof HTMLElement &&
      (
        active.isContentEditable ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "INPUT"
      )
    ) {
      return active;
    }

    return null;
  }

  // --------------------------------------------------
  // 2. Read text from the editable element
  // --------------------------------------------------
  function getComposerText(el) {
    if (!el) return "";

    if (
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLInputElement
    ) {
      return el.value || "";
    }

    return (el.innerText || el.textContent || "")
      .replace(/\u00a0/g, " ");
  }

  // --------------------------------------------------
  // 3. Create a draggable, transparent debug window
  // --------------------------------------------------
  const panel = document.createElement("div");

  Object.assign(panel.style, {
    position: "fixed",
    top: "100px",
    right: "20px",
    width: "360px",
    maxWidth: "calc(100vw - 30px)",
    zIndex: "2147483647",
    background: "rgba(20, 20, 20, 0.78)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.45)",
    borderRadius: "10px",
    boxShadow: "0 4px 18px rgba(0,0,0,0.25)",
    font: "13px/1.5 monospace",
    backdropFilter: "blur(5px)"
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
  heading.textContent = "Composer Click Debugger";

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";

  Object.assign(closeButton.style, {
    color: "white",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "20px",
    lineHeight: "20px"
  });

  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.remove();
  });

  header.append(heading, closeButton);

  const status = document.createElement("div");
  status.textContent = "Waiting for click...";

  Object.assign(status.style, {
    padding: "8px 10px",
    color: "#9fe7ff",
    borderBottom: "1px solid rgba(255,255,255,0.2)"
  });

  const output = document.createElement("pre");
  output.textContent = "(No text fetched yet)";

  Object.assign(output.style, {
    margin: "0",
    padding: "10px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: "45vh",
    overflowY: "auto",
    userSelect: "text"
  });

  panel.append(header, status, output);
  document.documentElement.appendChild(panel);

  // Drag the window using its header.
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

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

    const left = Math.max(
      0,
      Math.min(
        window.innerWidth - panel.offsetWidth,
        startLeft + e.clientX - startX
      )
    );

    const top = Math.max(
      0,
      Math.min(
        window.innerHeight - header.offsetHeight,
        startTop + e.clientY - startY
      )
    );

    panel.style.left = left + "px";
    panel.style.top = top + "px";
  });

  header.addEventListener("pointerup", () => {
    dragging = false;
  });

  header.addEventListener("pointercancel", () => {
    dragging = false;
  });

  // --------------------------------------------------
  // 4. Detect clicks and display the fetched text
  // --------------------------------------------------
  let clickCount = 0;

  document.addEventListener("click", (e) => {
    // Ignore clicks inside the debugger itself.
    if (panel.contains(e.target)) return;

    clickCount++;

    const target = e.target instanceof Element
      ? e.target
      : e.target?.parentElement;

    const path = e.composedPath ? e.composedPath() : [target];

    const clickable = path.find(
      (el) =>
        el instanceof Element &&
        el.matches(
          'button, [role="button"], input[type="submit"]'
        )
    );

    const comp = findComposer();
    const text = getComposerText(comp);

    const tag = target?.tagName || "(unknown)";
    const description =
      target?.getAttribute?.("aria-label") ||
      target?.getAttribute?.("data-testid") ||
      target?.textContent?.trim().slice(0, 80) ||
      "(no label)";

    console.log(`${PREFIX} CLICK DETECTED #${clickCount}`, {
      targetTag: tag,
      target: target,
      clickableElement: clickable || null,
      clickableLabel: clickable
        ? (
            clickable.getAttribute("aria-label") ||
            clickable.getAttribute("data-testid") ||
            clickable.getAttribute("title") ||
            clickable.textContent.trim()
          )
        : null,
      composerFound: !!comp,
      composerElement: comp,
      textLength: text.length,
      text: text
    });

    status.textContent =
      `CLICK #${clickCount} detected | ` +
      `Composer: ${comp ? "FOUND" : "NOT FOUND"} | ` +
      `Text length: ${text.length}`;

    output.textContent = text
      ? text
      : "(Composer text is empty, or no composer was found.)";

    // Helpful visual indication that the click listener fired.
    status.style.color = "#9fe7ff";
  }, true);

  console.log(
    `${PREFIX} Script loaded. Click anywhere on the ChatGPT page to test.`
  );
})();
```</WritingBlock>

## 2. How to test it

<list marker="number" gap={2}>
  <list-item>Open Tampermonkey and create a new script.</list-item>
  <list-item>Replace the editor contents with the complete script above, then save it.</list-item>
  <list-item>Reload your ChatGPT tab. You should see the floating debugger window.</list-item>
  <list-item>Type a test prompt into ChatGPT's editable text bar, but **don't send it yet**.</list-item>
  <list-item>Click somewhere on the page. Check whether the floating window shows your typed text.</list-item>
  <list-item>Now click ChatGPT's Send button and inspect the floating window and browser DevTools console.</list-item>
</list>

## 3. How to interpret the results

| Result | What it tells us |
|---|---|
| No `CLICK DETECTED` console message | The listener isn't running or the click isn't reaching this document. |
| `Composer: NOT FOUND` | Our composer selectors aren't matching the current page. |
| `Text length: 0` | A composer may exist, but its text isn't being read correctly or it is already empty. |
| Text appears on ordinary clicks but is empty after Send | ChatGPT may clear the composer before our listener reads it, or the submission changes the editor. |
| Text appears correctly after Send | We have a working way to read the composer during that click. |

**One important detail:** this is intentionally a diagnostic script. It reads the composer on *every page click*, not just Send-button clicks. That lets us separate a click-detection problem from a text-extraction problem. It does not submit or save prompts anywhere.

If it works on ordinary clicks but the text disappears specifically on Send, the next step is to capture the text earlier or preserve the last non-empty composer value.

## ?? User

hi

## ?? Assistant

Hi! 👋 Ready to continue testing your Tampermonkey script whenever you are.

## ?? User

hi  is this window is shown from that start ,or only when fetched something

## ?? Assistant

In the script I gave you, **the floating window is shown immediately when the page loads**, before any text is fetched.

- **At page load:** The window appears with `Waiting for click...` and `(No text fetched yet)`.
- **When you click anywhere on the ChatGPT page:** It updates the status and displays the current editable text, if found.
- **When you click Send:** It tries to fetch the text again. If ChatGPT has already cleared the composer, it may display an empty-text message.

If you prefer, I can change it so the window **appears only after the first click**, or even **only when you click the Send button**.

## ?? User

hi  is this window is shown from that star

## ?? Assistant

Yes 😊 In the current Tampermonkey script, the floating window is shown **right from the start**, when the ChatGPT page loads. It doesn't wait for a click or for text to be fetched.

## ?? User

sdf

## ?? Assistant

`sdf` 😄 Test received!

## ?? User

hello

## ?? Assistant

Hello! 👋 I'm here. Want to continue testing the Tampermonkey script?

## ?? User

bkbk

## ?? Assistant

`bkbk` 😄 Received! Testing continues.
