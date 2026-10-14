
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



  const PREFIX = "[Composer Debugger]";

  // --------------------------------------------------
  // 1. Find the current editable text bar
  // --------------------------------------------------

function findComposer() {
  const isChatGPT =
    location.hostname === "chatgpt.com" ||
    location.hostname === "chat.openai.com";

  // --------------------------------------------------
  // ChatGPT: locate the composer relative to Send button
  // --------------------------------------------------
  if (isChatGPT) {
    const isEditable = (el) =>
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLInputElement ||
      el.isContentEditable;

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);

      return (
        r.width > 0 &&
        r.height > 0 &&
        s.display !== "none" &&
        s.visibility !== "hidden"
      );
    };

    // Find the Send button, not arbitrary page buttons.
    const buttons = [
      ...document.querySelectorAll(
        'button[data-testid*="send"],' +
        'button[aria-label*="Send" i],' +
        'button[aria-label*="Send" i] [role="button"]'
      )
    ];

    const sendButton = buttons.find((el) => {
      const btn = el.closest("button") || el;

      return (
        btn instanceof HTMLElement &&
        isVisible(btn) &&
        !btn.disabled
      );
    });

    if (!sendButton) return null;

    // Walk upward from the Send button. At each level,
    // find editable elements in that container and choose
    // the one nearest to the button.
    let node = sendButton.parentElement;

    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      const candidates = [
        ...node.querySelectorAll(
          '[contenteditable="true"], textarea, input'
        )
      ].filter((el) =>
        isEditable(el) &&
        isVisible(el) &&
        !el.closest("#peek-box")
      );

      if (candidates.length) {
        const b = sendButton.getBoundingClientRect();
        const bx = b.left + b.width / 2;
        const by = b.top + b.height / 2;

        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();

          const da =
            (bx - Math.max(ra.left, Math.min(bx, ra.right))) ** 2 +
            (by - Math.max(ra.top, Math.min(by, ra.bottom))) ** 2;

          const db =
            (bx - Math.max(rb.left, Math.min(bx, rb.right))) ** 2 +
            (by - Math.max(rb.top, Math.min(by, rb.bottom))) ** 2;

          return da - db;
        });

        return candidates[0];
      }

      node = node.parentElement;
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

  function findComposer2() {
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

  function getComposerText2(el) {
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







  
   if (0) document.addEventListener("click", (e) => {
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
