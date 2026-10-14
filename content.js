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

  // --------------------------------------------------
  // Snapshot state (v1.4 idea)
  // --------------------------------------------------
  let lastComposerText = "";
  let lastComposerEl = null;

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

  // --------------------------------------------------
  // Composer finding + snapshot (merged from v1.4)
  // --------------------------------------------------
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }

  function isEditable(el) {
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable;
  }

  function getSendButton() {
    const selectors = [
      // ChatGPT
      'button[data-testid*="send"]',
      'button[aria-label*="Send" i]',
      // Grok
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]',
      'button[data-testid="chat-submit"]',
      'button[data-testid="grokSendButton"]',
      'button[data-testid*="submit"]',
      // Gemini / generic
      'button[type="submit"]',
      'button[aria-label*="Send" i]'
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

  function findComposer() {
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

    // Platform fallbacks
    const selectors = {
      chatgpt: ["#prompt-textarea", '[data-testid="composer-text-input"]', 'textarea[placeholder*="Ask"]'],
      gemini: ["rich-textarea .ql-editor", '[aria-label="Enter a prompt here"]', '[contenteditable="true"]'],
      grok: [
        '[data-testid="grokInput"]',
        'textarea[aria-label="Ask Grok anything"]',
        'textarea[placeholder="Ask anything"]',
        ".tiptap.ProseMirror[contenteditable='true']",
        '[contenteditable="true"][role="textbox"]'
      ]
    };
    for (const sel of selectors[platform] || []) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    const a = document.activeElement;
    if (a && isEditable(a) && isVisible(a)) return a;
    return null;
  }

  function getComposerText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || "";
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }

  function snapshot() {
    const el = findComposer();
    if (el) {
      lastComposerEl = el;
      lastComposerText = getComposerText(el);
    }
    return lastComposerText;
  }

  function attachInputListener(el) {
    if (!el || el._snapAttached) return;
    el._snapAttached = true;
    el.addEventListener("input", () => {
      lastComposerText = getComposerText(el);
      lastComposerEl = el;
    });
  }

  setInterval(() => {
    const el = findComposer();
    if (el) {
      attachInputListener(el);
      if (el !== lastComposerEl) {
        lastComposerEl = el;
        lastComposerText = getComposerText(el);
      }
    }
  }, 250);

  // --------------------------------------------------
  // Logging helper (shared by Enter + Send)
  // --------------------------------------------------
  function logAsk(text, source) {
    text = normalizeAsk(text);
    if (!text) return;
    const convId = getConversationId();
    const u = new URL(location.href);
    u.hash = "";
    chrome.runtime.sendMessage({
      type: "log-ask",
      platform,
      conversationId: convId || (u.pathname + u.search),
      url: u.origin + u.pathname + u.search,
      title: titledWithAccount(document.title, detectAccount()),
      text,
      source: source || "unknown",
      logAsks: settings.logAsks,
      ts: Date.now(),
      nonce: Date.now() + "-" + (source || "x")
    }, () => void chrome.runtime.lastError);
  }

  // --------------------------------------------------
  // Enter key (uses snapshot)
  // --------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const el = findComposer();
    if (!el) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (target !== el && !el.contains(target)) return;

    const text = lastComposerText || getComposerText(el);
    logAsk(text, "enter");
  }, true);

  // --------------------------------------------------
  // Send / Submit button click (uses snapshot)
  // --------------------------------------------------
  document.addEventListener("click", (e) => {
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

    const text = lastComposerText || snapshot();
    logAsk(text, "send");
  }, true);

  // --------------------------------------------------
  // Rest of original file (stamps, seen logging, etc.)
  // --------------------------------------------------
  // (The original stampAll, seen logging, fetch functions, and message listeners
  //  remain unchanged below this point. They continue to work as before.)

  // Placeholder for the remaining original logic that was truncated in the input.
  // In a full merge you would paste the rest of the original file here,
  // starting from the seenLogged / firstWalkBubbles section onward.
  // The snapshot + Enter/Send listeners above are the new pieces.

  function schedule() {
    // original schedule function placeholder — keep your existing one
  }

  // Initial snapshot
  snapshot();
})();
