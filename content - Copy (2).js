(function () {
  "use strict";
let lastActiveComposer = null;
  let lastComposerText = "";
  let mousedownText = "";          // filled on mousedown, used by Send


let flags = { flag1: false, flag2: false, flag3: false };

chrome.storage.local.get(["flag1", "flag2", "flag3"], (bag) => {
  flags.flag1 = !!bag.flag1;
  flags.flag2 = !!bag.flag2;
  flags.flag3 = !!bag.flag3;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.flag1) flags.flag1 = !!changes.flag1.newValue;
  if (changes.flag2) flags.flag2 = !!changes.flag2.newValue;
  if (changes.flag3) flags.flag3 = !!changes.flag3.newValue;
});



  // --------------------------------------------------
  // mousedown: only store text, do NOT call logAsk
  // --------------------------------------------------
  if  (1) document.addEventListener("mousedown", (e) => {
    const el = (lastActiveComposer && isVisible(lastActiveComposer))
      ? lastActiveComposer
      : findComposer();
    mousedownText = el ? getComposerText(el) : "";
    // intentionally no logAsk here
  }, true);




  const host = location.hostname;
  const platform =
    host.includes("gemini") ? "gemini" :
    host.includes("grok") || host === "x.com" ? "grok" :
    (host.includes("chatgpt") || host.includes("openai")) ? "chatgpt" :
    //(host.includes("notebook") || host.includes("notebook")) ? "notebook" :
    null;

   if (!platform) {
    chrome.storage.local.get("sideRoutes", (bag) => {
      const rules = Array.isArray(bag.sideRoutes) ? bag.sideRoutes : [];
      const findRouteHit = (routeRules) => routeRules.find((item) => String(item.text || "").split(/\r?\n/).some((line) => {
        const m = line.trim().match(/^onMsg:(\S+)/i);
        return m && location.href.startsWith(m[1]);
      }));
      let hit = findRouteHit(rules);
      if (!hit) return;

      // Optional per-route ancestor filters:
      //   wldiv:token, div.classPart, div#idPart
      //   bldiv:token, div.classPart, div#idPart
      // Case-insensitive substring matching; blacklist always overrides whitelist.
      function parseAncestorFilterTerms(prefix) {
        const terms = [];
        for (const rawLine of String(hit && hit.text || "").split(/\r?\n/)) {
          const m = rawLine.trim().match(new RegExp("^" + prefix + "\\s*:\\s*(.*)$", "i"));
          if (!m) continue;
          for (const part of m[1].split(",")) {
            const value = part.trim();
            if (value) terms.push(value);
          }
        }
        return terms;
      }

      let whiteAncestorTerms = parseAncestorFilterTerms("wldiv");
      let blackAncestorTerms = parseAncestorFilterTerms("bldiv");

      // Keep this already-open page in sync when sideRoutes / wldiv / bldiv
      // are edited in chrome.storage.local. No page refresh is needed.
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.sideRoutes) return;
        const latestRules = Array.isArray(changes.sideRoutes.newValue)
          ? changes.sideRoutes.newValue
          : [];
        hit = findRouteHit(latestRules);
        whiteAncestorTerms = parseAncestorFilterTerms("wldiv");
        blackAncestorTerms = parseAncestorFilterTerms("bldiv");
      });

      function ancestorTermMatches(el, rawTerm) {
        const term = String(rawTerm || "").trim().toLowerCase();
        if (!term) return false;
        let mode = "tag";
        let needle = term;

        // div.names means class substring "names" on a DIV.
        // div#search (or div.id:search) means id substring "search" on a DIV.
        if (/^div\.id:/i.test(term)) {
          mode = "id";
          needle = term.slice(7);
        } else if (/^div\./i.test(term)) {
          mode = "class";
          needle = term.slice(4);
        } else if (/^div#/i.test(term)) {
          mode = "id";
          needle = term.slice(4);
        }
        if (!needle) return false;

        for (let node = el && el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
          const tag = String(node.localName || node.tagName || "").toLowerCase();
          if (mode === "class") {
            const classes = typeof node.className === "string" ? node.className : (node.getAttribute("class") || "");
            if (tag === "div" && classes.toLowerCase().includes(needle)) return true;
          } else if (mode === "id") {
            if (tag === "div" && String(node.id || "").toLowerCase().includes(needle)) return true;
          } else if (tag.includes(needle)) {
            return true;
          }
        }
        return false;
      }

      function passesAncestorFilters(el) {
        if (!el) return false;
        if (blackAncestorTerms.some((term) => ancestorTermMatches(el, term))) return false;
        if (whiteAncestorTerms.length && !whiteAncestorTerms.some((term) => ancestorTermMatches(el, term))) return false;
        return true;
      }
    if (flags.flag1) alert("hit's val is " + (hit.text || ""));
 
 
 
 

      
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        if (!hit) return;
        const target = e.target;
        const el = target instanceof HTMLElement && isEditable(target) && isVisible(target)
          ? target
          : findComposer();
        if (!el || !passesAncestorFilters(el)) return;

        const text = getText(el);
       if (flags.flag1)  alert('enterkey path for 3rd site is ' + (text || ""));
        if (!text) return;
        const u = new URL(location.href);
        u.hash = "";
        chrome.runtime.sendMessage({
          type: "log-ask",
          platform: hit.id,
          conversationId: u.pathname + u.search,
          url: u.origin + u.pathname + u.search,
          title: document.title,
          text: text+'     other plat',
          logAsks: true,
          ts: Date.now(),
          nonce: Date.now() + "-extra"
        }, () => void chrome.runtime.lastError);
      
      
      },  true      );
      
      
      //add click listener for 3rd party site of  mouse click there .
    //document.addEventListener("mousedown",   async (e) => {   ---if i use "mouse-down"  herer it will intercept the click event , 
    document.addEventListener("click",   async (e) => {
  //console.log("[DEBUG] document click handler fired");
  //var isSend = getSendButton();
  
  
   const bag = await chrome.storage.local.get(["flag1"]);
 // var sendbtn = getSendButton();
  
    //if (!sendbtn) if (bag.flag1)  alert('!sendbtn and goto eof');
   //if (!sendbtn)  return;
  
    const path =
    typeof e.composedPath === "function"
      ? e.composedPath()
      : [e.target];

  let isSend = false;

if (1) {
  isSend = path.some((el) => {
    if (!(el instanceof Element)) return false;

    const btn = el.closest("button");
    if (!(btn instanceof HTMLButtonElement)) return false;

    const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    const text = (btn.textContent || "").trim().toLowerCase();

    return (
      testid.includes("send") ||
      testid.includes("submit") ||
      aria.includes("send") ||
      aria.includes("submit") ||
      text === "send" ||
      text === "submit" ||
      (btn.type === "submit" && btn.closest("form"))||
      
      
      
      
        testid.includes("chat-submit") ||
  testid.includes("groksend") ||
  
  
  
  
  
  
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
}
  
  
if (0)   {isSend = path.some((el) => {
  if (!(el instanceof Element)) return false;

  const btn = el.closest("button") || el;
  if (!(btn instanceof HTMLElement)) return false;

  const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
  const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
  const text = (btn.textContent || "").trim().toLowerCase();

  if (testid.includes("send")) {
    console.log("[SEND MATCH] 1: testid.includes('send')", { btn, testid });
    return true;
  }

  if (aria.includes("send")) {
    console.log("[SEND MATCH] 2: aria.includes('send')", { btn, aria });
    return true;
  }

  if (aria.includes("submit")) {
    console.log("[SEND MATCH] 3: aria.includes('submit')", { btn, aria });
    return true;
  }

  if (testid.includes("submit")) {
    console.log("[SEND MATCH] 4: testid.includes('submit')", { btn, testid });
    return true;
  }

  if (testid.includes("chat-submit")) {
    console.log("[SEND MATCH] 5: testid.includes('chat-submit')", { btn, testid });
    return true;
  }

  if (testid.includes("groksend")) {
    console.log("[SEND MATCH] 6: testid.includes('groksend')", { btn, testid });
    return true;
  }

  if (text === "submit") {
    console.log("[SEND MATCH] 7: text === 'submit'", { btn, text });
    return true;
  }

  if (text === "send") {
    console.log("[SEND MATCH] 8: text === 'send'", { btn, text });
    return true;
  }

  if (btn.type === "submit" && btn.closest("form")) {
    console.log("[SEND MATCH] 9: submit button inside form", {
      btn,
      type: btn.type,
      form: btn.closest("form")
    });
    return true;
  }

  return false;
});

}


  if (!isSend) {
    if (bag.flag1) alert ("[DEBUG] Not a Send-button click");
    return;
  }

  const liveComposer = findComposer();
  const liveText = liveComposer
    ? getComposerText(liveComposer)
    : "";

  const text = liveText || mousedownText || lastComposerText;
  


if (bag.flag1) {
  alert(
    "\nliveText is: " + (liveText || "") +
    "\nmousedownText is: " + (mousedownText || "") +
    "\nlastComposerText is: " + (lastComposerText || "") +
    
    "\ngetComposerText(findComposer()); is: " +      (getComposerText(findComposer()) || "")
  );
}

  //console.log("[DEBUG] calling logAsk; text =", text);
  //logAsk(text, "send");
  
          const u = new URL(location.href);
        u.hash = "";
        chrome.runtime.sendMessage({
          type: "log-ask",
          platform: hit.id,
          conversationId: u.pathname + u.search,
          url: u.origin + u.pathname + u.search,
          title: document.title,
          text: text+'     op click path',
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
  // v1.5 state (no text polling)
  // --------------------------------------------------
  //let lastActiveComposer = null;
  //let lastComposerText = "";
  //let mousedownText = "";          // filled on mousedown, used by Send

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
  // Composer helpers (v1.5 style)
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
      'button[data-testid*="send"]',
      'button[aria-label*="Send" i]',
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]',
            'button[aria-label="Search"]',
      'button[aria-label="search"]',
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

  function findComposer() {
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

  function attachComposerListeners(el) {
    if (!el || el._dbgAttached) return;
    el._dbgAttached = true;

    el.addEventListener("focus", () => {
      lastActiveComposer = el;
    });

    el.addEventListener("input", () => {
      lastActiveComposer = el;
      lastComposerText = getComposerText(el);
    });

    // Re-read after paste
    el.addEventListener("paste", () => {
      lastActiveComposer = el;
      setTimeout(() => {
        lastComposerText = getComposerText(el);
      }, 0);
    });
  }

  function ensureComposerAttached() {
    const el = findComposer();
    if (el) attachComposerListeners(el);
  }
 // ensureComposerAttached();
 // setInterval(ensureComposerAttached, 1000);




  function getText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value || "";
    }
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }


document.addEventListener("focus", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
     //lastComposerText = getText(el);  
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
    //lastComposerText = getText(el);   // also update text
  }
});

document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
    lastActiveComposer = el;
     //lastComposerText = getText(el);  
  }
});

if (0)  document.addEventListener("paste", (e) => {
  const el = e.target;
  if (isEditable(el) && isVisible(el)) {
   
  if   (lastActiveComposer !== el) alert('in paste listener ,   lastActiveComposer !== el  ')    ;
    lastActiveComposer = el;
    requestAnimationFrame(() => {
      lastComposerText = getText(el);
    });
  }
});
  // ---why u do not do it like this   ?



  // --------------------------------------------------
  // Hold asks until a real conversation id appears (from content-1.3 bindHeld)
  // --------------------------------------------------
  let lastSavedText = "";
  let lastSavedAt = 0;
  const heldAsks = [];
  const settledPending = new Set(); // texts committed as pending after 20s; never rebind
  let knownId = "";
  let lastSyncedTitle = "";
  const BIND_MS = 20000;

  function settlePending(ask) {
    settledPending.add(String(ask.text || "").replace(/\s+/g, " ").trim());
    postLog("pending:" + ask.at, ask.text, ask.ts, ask.account, ask.source);
  }

  function isGenericTitle(raw) {
    const bare = cleanTitle(raw).replace(/^\[[^\]]+\]\s*/, "").toLowerCase();
    return !bare || /^(grok|chatgpt|gemini|google gemini|new chat|untitled)$/.test(bare);
  }

  function postLog(conversationId, raw, ts, account, source) {
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
      source: source || "unknown",
      logAsks: settings.logAsks,
      ts,
      nonce: ts + "-" + (source || "x")
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
    const live = (texts || []).filter((t) => !settledPending.has(String(t || "").replace(/\s+/g, " ").trim()));
    if (!live.length) return;
    chrome.runtime.sendMessage({
      type: "rebind-pending",
      platform,
      conversationId,
      url: sessionUrl(conversationId),
      title: titledWithAccount(cleanTitle(document.title), detectAccount()),
      account: detectAccount(),
      texts: live,
      ts: Date.now()
    }, () => void chrome.runtime.lastError);
  }

  function bindHeld(id, title) {
    if (!id || String(id).startsWith("pending:")) return;
    knownId = id;
    const batch = heldAsks.splice(0, heldAsks.length);
    for (const ask of batch) postLog(id, ask.text, ask.ts, ask.account, ask.source);
    rebindPending(id, batch.map((ask) => ask.text));
    syncTitle(id, title || document.title);
    loadedConv = "";
  }

  // --------------------------------------------------
  // logAsk (called only from Enter and Send)
  // --------------------------------------------------
  function logAsk(text, source) {
    text = normalizeAsk(text);
    if (!text) return;
    const now = Date.now();
    if (text === lastSavedText && now - lastSavedAt < 800) return;
    lastSavedText = text;
    lastSavedAt = now;
    const account = detectAccount();
    const id = getConversationId();
    if (id) {
      knownId = id;
      postLog(id, text, now, account, source);
      return;
    }
    heldAsks.push({ text, ts: now, account, at: now, source: source || "unknown" });
  }



  // --------------------------------------------------
  // Enter key → logAsk
  // --------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const el = lastActiveComposer || findComposer();
    if (!el) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (target !== el && !el.contains(target)) return;

    const text =   getComposerText(el);
    logAsk(text, "enter");
  }, true);

  // --------------------------------------------------
  // Send / Submit click → logAsk (prefers mousedownText)
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
        aria.includes("submit") || aria.includes("Submit") ||
                aria.includes("Search") ||
        aria.includes("search") ||
        testid.includes("submit") || testid.includes("Submit") ||
        testid.includes("chat-submit") ||
        testid.includes("groksend") ||
        text === "submit" ||
        text === "send" ||
        (btn.type === "submit" && btn.closest("form"))
      );
    });
    if (!isSend) return;

    //const text =mousedownText || lastComposerText;
    const text = mousedownText || lastComposerText || getComposerText(findComposer());
            if (flags.flag1)   alert(
        "\nmousedownText is: " + (mousedownText || "") +
        "\nlastComposerText is: " + (lastComposerText || "")+
        " \nText is: " + (text || "") 
      );
    logAsk(text, "send");
  }, true);

  // --------------------------------------------------
  // Restored from v0.3.7: stamps schedule + SEEN_ONLINE (ask/ans) path
  // --------------------------------------------------
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
  schedule();
  setInterval(schedule, 1500);
  window.addEventListener("resize", schedule);

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

  const seenLogged = new Set();
  const seenLast = new Map();
  let seenLastScan = -1;

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
      // fallback if the scroller structure is missing
      if (!out.length) take('[data-message-author-role="user"]', '[data-message-author-role="assistant"]');
    } else if (platform === "chatgpt") {
      take('[data-message-author-role="user"]', '[data-message-author-role="assistant"]');
    } else if (platform === "gemini") {
      document.querySelectorAll("user-query").forEach((el) => {
        const uid = geminiTurnId(el);
        const text = messageText(el);
        if (uid && text) out.push({ role: "user", uid, text });
      });
      document.querySelectorAll("model-response").forEach((el) => {
        const body = el.querySelector("message-content, model-response-content, .model-response-text") || el;
        const uid = geminiTurnId(el);
        const text = messageText(body);
        if (uid && text) out.push({ role: "assistant", uid, text });
      });
    }
    return out;
  }

  function seenPrefix(ts) {
    const d = new Date(ts);
    const z = (n) => String(n).padStart(2, "0");
    if (!Number.isFinite(ts) || Number.isNaN(d.getTime())) return "SEEN_ONLINE: ";
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
    if (pre) pre.textContent = (line + "\n" + pre.textContent).slice(0, 5000);
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
      askText: ask ? (seenPrefix(ask.ts) + (ask.text || "")) : "",
      askTs: ask && ask.ts || 0
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
    // Pure DOM path used by the three main platforms in 0.3.7
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
    for (const ask of heldAsks.splice(0, heldAsks.length)) settlePending(ask);
  });

  setInterval(() => {
    const id = getConversationId();
    if (id && heldAsks.length) bindHeld(id);
    else if (id && id !== knownId) {
      knownId = id;
      syncTitle(id, document.title);
      // Only still-held asks (under 20s) may move. Timed-out pending stay pending.
    }
    heldAsks.slice().forEach((ask) => {
      if (Date.now() - ask.at > BIND_MS && !getConversationId()) {
        const i = heldAsks.indexOf(ask);
        if (i >= 0) heldAsks.splice(i, 1);
        settlePending(ask);
      }
    });
    logSeenBubbles();
  }, 800);


  // --------------------------------------------------
  // Manual sync: list / fetch sessions (restored from 0.3.7)
  // --------------------------------------------------
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
    if (!token) throw new Error("chatgpt no session token");
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

  // Initial attach
  ensureComposerAttached();
})();

