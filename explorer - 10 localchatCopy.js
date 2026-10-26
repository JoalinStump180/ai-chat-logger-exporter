

const nidToConvKey = new Map(); // Maps every node ID directly to its exact convKey

const $ = (id) => document.getElementById(id);

// Keep the user-adjustable head-alignment offset across explorer reloads.
(function initHeadOffsetControl() {
  const key = "aiChatExplorerHeadOffsetPx";
  const input = $("headOffsetPx");
  if (!input) return;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && /^[-+]?\d+$/.test(saved)) input.value = saved;
  } catch (_) {}
  input.addEventListener("change", function () {
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value)) return;
    input.value = String(value);
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  });
})();
let rows = [];
let filter = "all";
let selectedId = null;
let showOnMsg = false;
let showSei = false;
let showSeo = false;
let showAsk = false;
let showAns = false;
let includeComments = false; // alias of showOnMsg, kept for older call sites
let includeImpAsks = false;  // alias: sei or manual-sync asks
let includeImpAns = false;   // alias: seo or manual-sync answers
let liveSort = "ts-asc";
let middleMode = "ptt"; // sort: "ptt" = session/title order, "item" = date-time item order
let dispStyle = "ptt"; // display: "ptt" (default multi-line tree) or "flat"
let selectedNid = null; // persistent selected item identity (nid) across sort modes
let hitNavFresh = 0; // 1 = next prev/next hit should find the neighbor of the selection
let hitNavNid = null; // last item jumped to, so later clicks step one item not one line
const openChats = new Set();
const openAns = new Set();
const forceOpenAsk = new Set();
// Runtime-only UI state survives DOM removal/recreation by the datetime sliding window.
const expandedMessageNids = new Set();
// Explicit per-message choices override the current chat-wide search unfolding policy.
const messageFoldOverrides = new Map();
// Per-chat search unfolding policy: "hit" (default) or "all".
const chatUnfoldModes = new Map();
// Item identities that contain at least one hit in the current search session.
const searchHitNids = new Set();
const openedGaps = new Set(); // "fromNid->toNid": non-hit items between two hits are unfolded
let lastUnfoldQuery = null;

// UI-only preferences live in a separate IndexedDB database to avoid changing
// the schema used by the logger's message records.
const UI_STATE_DB_NAME = "aiChatLoggerExplorerUiState";
const UI_STATE_STORE = "uiState";
let uiStateDbPromise = null;
function openUiStateDb() {
  if (uiStateDbPromise) return uiStateDbPromise;
  uiStateDbPromise = new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error("IndexedDB is unavailable")); return; }
    const request = indexedDB.open(UI_STATE_DB_NAME, 1);
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(UI_STATE_STORE)) {
        db.createObjectStore(UI_STATE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error("Could not open UI state database")); };
    request.onblocked = function () { reject(new Error("UI state database upgrade is blocked")); };
  }).catch(function (error) {
    uiStateDbPromise = null;
    throw error;
  });
  return uiStateDbPromise;
}
function readAllUiState() {
  return openUiStateDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      const request = db.transaction(UI_STATE_STORE, "readonly").objectStore(UI_STATE_STORE).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error || new Error("Could not read UI state")); };
    });
  });
}
function saveUiState(key, value) {
  openUiStateDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(UI_STATE_STORE, "readwrite");
      tx.objectStore(UI_STATE_STORE).put({ key: String(key), value: value });
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error("Could not save UI state")); };
      tx.onabort = function () { reject(tx.error || new Error("UI state save was aborted")); };
    });
  }).catch(function (error) { console.warn("AI Chat Explorer: UI state was not saved", error); });
}
async function restoreUiState() {
  try {
    const saved = await readAllUiState();
    expandedMessageNids.clear();
    messageFoldOverrides.clear();
    for (const entry of saved) {
      // An expanded:<nid> record exists only after an explicit user toggle.
      // Restore BOTH true and false: false is a meaningful explicit choice.
      if (typeof entry.key === "string" && entry.key.indexOf("expanded:") === 0 && typeof entry.value === "boolean") {
        const nid = entry.key.slice("expanded:".length);
        messageFoldOverrides.set(nid, entry.value);
        if (entry.value) expandedMessageNids.add(nid);
        else expandedMessageNids.delete(nid);
      }
      if (entry.key === "rawSearch" && $("rawSearch")) $("rawSearch").checked = entry.value === true;
    }
  } catch (error) {
    // The Explorer remains usable in memory-only mode if IndexedDB is blocked.
    console.warn("AI Chat Explorer: could not restore UI state", error);
  }
}
function initializeUiStateAndLoad() {
  return restoreUiState().finally(function () { return loadLazy(); });
}
const asksByConv = new Map();
let recycleItems = [];
const recycleAsks = new Map();
let recycleChats = [];
let delSort = "";
const TOKEN_COLORS = ["#e53935", "#1e88e5", "#fb8c00", "#43a047", "#8e24aa", "#00897b"];
let tokenOn = [];
let foldM = 3;
let foldN = 3;

function pad(n) { return String(n).padStart(2, "0"); }
function fmtTs(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function isTyped(c) {
  if (!c) return false;
  const k = String(c.recordKey || "");
  return c.source === "onMsg" || c.source === "seen" || c.source === "seen-dummy"
    || c.source === "import"
    || /\|(?:onMsg|ask|ans|sei|seo)\|/.test(k);
}
function isOnMsg(c) {
  // Untyped old rows (source "live", no marker in the key) are grouped as onMsg.
  return !!(c && (c.source === "onMsg" || String(c.recordKey || "").includes("|onMsg|") || !isTyped(c)));
}
function isSeenRecord(c) {
  return !!(c && (c.source === "seen" || c.source === "seen-dummy"));
}
function askNidPrefix(c) { return isSeenRecord(c) ? "sei" : (isOnMsg(c) ? "onMsg" : "ask"); }
function answerNidPrefix(a) { return isSeenRecord(a) ? "seo" : "ans"; }
function isImp(c) {
  if (!c) return false;
  if (isOnMsg(c)) return false;
  if (c.source === "import" || c.source === "seen" || c.source === "seen-dummy") return true;
  if (c.source === "live") return false;
  return !!(c.responseId);
}
function isLive(c) { return isOnMsg(c) || !isImp(c); }
function isSeenAsk(c) { return isSeenRecord(c) && !isOnMsg(c); }
function isSyncAsk(c) { return !!(c && c.source === "import" && !isOnMsg(c)); }
function isSeenAns(a) { return !!(a && (a.source === "seen" || a.source === "seen-dummy")); }
function isSyncAns(a) { return !!(a && a.source === "import"); }
function showAskNode(c) {
  if (!c) return false;
  if (isOnMsg(c)) return showOnMsg;
  if (isSeenAsk(c)) return showSei;
  if (isSyncAsk(c)) return showAsk;
  return false;
}
function showAnsNode(a) {
  if (!a) return false;
  if (isSeenAns(a)) return showSeo;
  if (isSyncAns(a)) return showAns;
  return false;
}
function syncSourceFlags() {
  includeComments = showOnMsg;
  includeImpAsks = showSei || showAsk;
  includeImpAns = showSeo || showAns;
}

async function getAll() {
  try {
    const db = await openDb();
    const fromIdb = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (fromIdb.length) return fromIdb.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  } catch (_) {}
  try {
    const bag = await chrome.storage.local.get("recordsCache");
    if (Array.isArray(bag.recordsCache) && bag.recordsCache.length) {
      return bag.recordsCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
  } catch (_) {}
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-records" });
    return Array.isArray(res && res.rows) ? res.rows : [];
  } catch (_) {
    return [];
  }
}

async function loadAsksIndex() {
  asksByConv.clear();
  let all = [];
  try {
    const db = await openDb();
    all = await new Promise((resolve, reject) => {
      const req = db.transaction(ASK_STORE, "readonly").objectStore(ASK_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {}
  if (!all.length) {
    try { all = (await chrome.storage.local.get("asksCache")).asksCache || []; } catch (_) {}
  }
  if (!all.length) {
    try { all = ((await chrome.runtime.sendMessage({ type: "get-asks" })) || {}).rows || []; } catch (_) {}
  }
  for (const a of all) {
    a.answers = [];
    const list = asksByConv.get(a.convKey) || [];
    list.push(a);
    asksByConv.set(a.convKey, list);
  }
  let ans = [];
  try {
    const db = await openDb();
    if (typeof ANSWER_STORE !== "undefined" && db.objectStoreNames.contains(ANSWER_STORE)) {
      ans = await new Promise((resolve, reject) => {
        const req = db.transaction(ANSWER_STORE, "readonly").objectStore(ANSWER_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }
  } catch (_) {}
  if (!ans.length) {
    try { ans = (await chrome.storage.local.get("answersCache")).answersCache || []; } catch (_) {}
  }
  ans.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const a of ans) {
    const list = asksByConv.get(a.convKey) || [];
    let parent = list.find((ask) => a.askKey && ask.recordKey === a.askKey);
    if (!parent && a.askLocalIndex) parent = list.find((ask) => ask.localIndex === a.askLocalIndex);
    if (!parent) parent = list.filter((ask) => isImp(ask) && (ask.ts || 0) <= (a.ts || 0)).pop()
      || list.filter((ask) => (ask.ts || 0) <= (a.ts || 0)).pop()
      || list[list.length - 1];
    if (parent) {
      parent.answers = parent.answers || [];
      parent.answers.push(a);
    }
  }
  for (const list of asksByConv.values()) {
    list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    list.forEach((c, i) => { if (!c.localIndex) c.localIndex = i + 1; });
  }
}

const PAGE = 80;
const DT_BATCH = 120; // items loaded per chronological scroll batch
let datetimeItems = [];
let dtStart = 0;
let dtEnd = 0;
let matched = [];
let shown = 0;
let hitList = [];
let hitSort = "";
let lastLoggedQ = "";
let searchHist = [];
let batchAskOpen = false;
let batchAnsOpen = false;

function setSeek(pct, label) { $("seek").textContent = label || ("Seek " + pct + "%"); }

function parseIdList(raw) {
  const ids = new Set();
  String(raw || "").split(/[\s,]+/).filter(Boolean).forEach((part) => {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b; i++) ids.add(i);
    } else if (/^\d+$/.test(part)) ids.add(parseInt(part, 10));
  });
  return ids;
}

let fromHist = [];
let toHist = [];

function parseBound(raw, endOfDay) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + (endOfDay ? "T23:59:59" : "T00:00:00"));
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function rowTs(r) {
  if (r.updatedAt) return r.updatedAt;
  if (r.createdAt) return r.createdAt;
  const t = Date.parse(String(r.date || "") + " " + String(r.time || ""));
  return Number.isFinite(t) ? t : 0;
}
function inTime(ts) {
  const from = parseBound($("fromBox") && $("fromBox").value, false);
  const to = parseBound($("toBox") && $("toBox").value, true);
  const n = Number(ts) || 0;
  if (from != null && n < from) return false;
  if (to != null && n > to) return false;
  return true;
}
function chatInTime(r) {
  const from = parseBound($("fromBox") && $("fromBox").value, false);
  const to = parseBound($("toBox") && $("toBox").value, true);
  if (from == null && to == null) return true;
  if (inTime(rowTs(r))) return true;
  const list = viewAsks(r.convKey);
  return list.some((c) => inTime(c.ts) || (c.answers || []).some((a) => inTime(a.ts)));
}

function parseSearch(q) {
  let s = String(q == null ? "" : q);
  if ($("rawSearch") && $("rawSearch").checked) {
    return { tokens: s.length ? [{ raw: s, low: s.toLowerCase() }] : [], urlIds: null, raw: true };
  }
  let urlIds = null;
  const quoted = [];
  s = s.replace(/"([^"]*)"/g, (_, inner) => {
    const m = String(inner).trim().match(/^urlid\s+([\s\S]+)$/i);
    if (m) {
      urlIds = parseIdList(m[1]);
      return " ";
    }
    quoted.push(inner);
    return " ";
  });
  const um = s.match(/(^|\s)urlid:(\S+)/i);
  if (um) {
    urlIds = parseIdList(um[2]);
    s = s.replace(/(^|\s)urlid:\S+/ig, " ");
  }
  const tokens = [];
  quoted.forEach((raw) => {
    raw = raw.trim();
    if (raw) tokens.push({ raw: raw, low: raw.toLowerCase() });
  });
  s.trim().split(/\s+/).filter(Boolean).forEach((raw) => {
    tokens.push({ raw: raw, low: raw.toLowerCase() });
  });
  return { tokens, urlIds };
}

function tokLow(t) { return typeof t === "string" ? t : t.low; }
function hayHasAll(hay, tokens) {
  if (!tokens.length) return true;
  const h = String(hay || "").toLowerCase();
  return tokens.every((t) => h.includes(tokLow(t)));
}
function hayHasAny(hay, tokens) {
  if (!tokens.length) return false;
  const h = String(hay || "").toLowerCase();
  return tokens.some((t) => h.includes(tokLow(t)));
}
function searchIsAnd() {
  const andBox = $("searchAnd");
  return !!(andBox && andBox.checked);
}
function hayHasTokens(hay, tokens) {
  return searchIsAnd() ? hayHasAll(hay, tokens) : hayHasAny(hay, tokens);
}
function lineFilterValue(id) {
  const el = $(id);
  if (!el || String(el.value).trim() === "") return null;
  const n = Number(el.value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function messageLineCount(text) { return String(text == null ? "" : text).split(/\r\n|\n|\r/).length; }
function messagePassesLineCount(text) {
  const count = messageLineCount(text);
  const min = lineFilterValue("minLines");
  const max = lineFilterValue("maxLines");
  if (min !== null && count < min) return false;
  if (max !== null && count > max) return false;
  return true;
}
function searchableMessageText(text) {
  const lines = String(text == null ? "" : text).split(/\r\n|\n|\r/);
  const firstN = lineFilterValue("searchFirstN");
  const lastN = lineFilterValue("searchLastN");
  if (firstN === null && lastN === null) return lines.join("\n");
  const keep = new Set();
  if (firstN !== null) for (let i = 0; i < Math.min(firstN, lines.length); i++) keep.add(i);
  if (lastN !== null) for (let i = Math.max(0, lines.length - lastN); i < lines.length; i++) keep.add(i);
  return lines.filter((_, i) => keep.has(i)).join("\n");
}
function pageHay(r) {
  return [r.date, r.time, r.title, r.url, r.platform, r.conversationId, String(r.id)].join(" ");
}
function askHay(c) {
  if (!messagePassesLineCount(c.text)) return "";
  return [fmtTs(c.ts), searchableMessageText(c.text), String(c.localIndex), c.responseId || ""].join(" ");
}
function ansHay(a) {
  if (!messagePassesLineCount(a.text)) return "";
  return [fmtTs(a.ts), searchableMessageText(a.text), String(a.localIndex), a.responseId || ""].join(" ");
}

function viewAsks(convKey) {
  return (filter === "recycle" ? recycleAsks : asksByConv).get(convKey) || [];
}
function nodeLiked(n) { return !!(n && n.liked); }
function findByNid(nid) {
  const id = String(nid || "");
  const kind = (id.startsWith("ans-") || id.startsWith("seo-")) ? "answer" : id.startsWith("onMsg-") ? "onMsg" : "ask";
  const rest = id.replace(/^(?:onMsg|ask|ans|sei|seo)-/, "");
  const maps = [asksByConv, recycleAsks];
  for (const map of maps) {
    for (const list of map.values()) {
      for (const ask of list) {
        const askNid = askNidPrefix(ask) + "-" + (ask.recordKey || ask.localIndex);
        if (kind !== "answer" && (ask.recordKey === rest || askNid === id)) return { node: ask, kind: isOnMsg(ask) ? "onMsg" : "ask" };
        for (const ans of (ask.answers || [])) {
          const ansNid = answerNidPrefix(ans) + "-" + (ans.recordKey || ans.localIndex);
          if (kind === "answer" && (ans.recordKey === rest || ansNid === id)) return { node: ans, kind: "answer", parent: ask };
        }
      }
    }
  }
  return null;
}
function chatHasLiked(r) {
  return viewAsks(r.convKey).some((c) => nodeLiked(c) || (c.answers || []).some(nodeLiked));
}
function matchRow(r, q) {
  if (filter === "favorites") {
    if (!chatHasLiked(r)) return false;
  } else if (filter !== "all" && filter !== "recycle" && r.platform !== filter) return false;
  if (!chatInTime(r)) return false;
  const parsed = parseSearch(q);
  if (parsed.urlIds && parsed.urlIds.size && !parsed.urlIds.has(Number(r.id))) return false;
  const tokens = parsed.tokens;
  if (!tokens.length) return true;
  if (hayHasTokens(pageHay(r), tokens)) return true;
  const list = viewAsks(r.convKey);
  if (list.some((c) => showAskNode(c) && hayHasTokens(askHay(c), tokens))) return true;
  if (list.some((c) => (c.answers || []).some((a) => showAnsNode(a) && hayHasTokens(ansHay(a), tokens)))) return true;
  return false;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    if (c === "&") return "&" + "amp;";
    if (c === "<") return "&" + "lt;";
    if (c === ">") return "&" + "gt;";
    if (c === '"') return "&" + "quot;";
    return "&#39;";
  });
}

function highlightText(text, tokens) {
  const src = String(text == null ? "" : text);
  if (!tokens.length) return esc(src);
  const active = tokens.map((t, i) => Object.assign({}, t, { i: i })).filter((t) => tokenOn[t.i] !== false);
  if (!active.length) return esc(src);
  const low = src.toLowerCase();
  const marks = [];
  for (const t of active) {
    let from = 0;
    while (from < low.length) {
      const at = low.indexOf(t.low, from);
      if (at < 0) break;
      marks.push({ start: at, end: at + t.low.length, i: t.i });
      from = at + Math.max(1, t.low.length);
    }
  }
  marks.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  let out = "", cur = 0, last = 0;
  for (const m of marks) {
    if (m.start < last) continue;
    out += esc(src.slice(cur, m.start));
    const col = TOKEN_COLORS[m.i % TOKEN_COLORS.length];
    out += '<span class="hit" style="background:' + col + "33;outline:1px solid " + col + '">' + esc(src.slice(m.start, m.end)) + "</span>";
    cur = m.end;
    last = m.end;
  }
  return out + esc(src.slice(cur));
}

function messageLines(text) {
  return String(text == null ? "" : text).split(/\r\n|\n|\r/);
}
function shouldFoldMessage(text) {
  return messageLines(text).length > foldM + foldN;
}
function foldedMessageText(text, expanded) {
  const src = String(text == null ? "" : text);
  const lines = messageLines(src);
  if (expanded || lines.length <= foldM + foldN) return src;
  const first = foldM > 0 ? lines.slice(0, foldM) : [];
  const last = foldN > 0 ? lines.slice(lines.length - foldN) : [];
  return first.concat(["…"], last).join("\n");
}
function messageIsExpanded(nid, convKey, tokens) {
  const key = String(nid || "");
  // Explicit per-message choices win in both search and non-search modes.
  if (messageFoldOverrides.has(key)) return messageFoldOverrides.get(key);
  // Untouched messages are collapsed by default everywhere, including search.
  return false;
}
function hitLinesHtml(text, tokens) {
  const lines = messageLines(text);
  const firstN = lineFilterValue("searchFirstN");
  const lastN = lineFilterValue("searchLastN");
  const allowed = new Set();
  if (firstN === null && lastN === null) {
    lines.forEach((_, i) => allowed.add(i));
  } else {
    if (firstN !== null) for (let i = 0; i < Math.min(firstN, lines.length); i++) allowed.add(i);
    if (lastN !== null) for (let i = Math.max(0, lines.length - lastN); i < lines.length; i++) allowed.add(i);
  }
  return lines.filter((line, i) => allowed.has(i) && tokens.length && hayHasAny(line, tokens))
    .map(line => highlightText(line, tokens)).join("\n");
}
function messageShownHtml(text, tokens, nid, isExpanded, convKey, titlePane) {
  const key = String(nid || "");
  const hitMode = !!(titlePane && tokens && tokens.length && convKey &&
    (chatUnfoldModes.get(String(convKey)) || "hit") === "hit");
  // Hit mode decides WHICH message nodes are included in the Title pane,
  // not WHICH lines are printed inside each included node. Keep all of the
  // logical folded text when collapsed, and the complete source text when
  // expanded; search matches remain highlighted without deleting other lines.
  if (hitMode && !searchHitNids.has(key) && !inOpenedGap(key, convKey)) return "";
  return highlightText(foldedMessageText(text, isExpanded), tokens);
}
function messageContentHtml(text, tokens, nid, expanded, convKey, titlePane) {
  const isExpanded = messageIsExpanded(nid, convKey, tokens);
  return '<span class="msg-content" data-fold-id="' + esc(nid) + '" data-text="' + esc(String(text == null ? "" : text)) + '" data-foldable="' + (shouldFoldMessage(text) ? '1' : '0') + '" data-expanded="' + (isExpanded ? '1' : '0') + '">' + messageShownHtml(text, tokens, nid, isExpanded, convKey, titlePane) + '</span>';
}
function messageToggleHtml(text, nid, expanded, convKey, tokens) {
  if (!shouldFoldMessage(text)) return '';
  const isExpanded = messageIsExpanded(nid, convKey, tokens);
  return '<a href="#" class="msg-toggle" data-fold-id="' + esc(nid) + '" aria-expanded="' + (isExpanded ? 'true' : 'false') + '">' + (isExpanded ? 'Show less' : 'Read more') + '</a>';
}
function hitDotHtml(nid) {
  return searchHitNids.has(String(nid))
    ? '<span class="ptt-hit-dot" aria-label="Contains a search hit" title="Contains a search hit"></span>'
    : '';
}

function lineHits(text, tokens, isMessage) {
  if (isMessage && !messagePassesLineCount(text)) return [];
  const lines = String(text == null ? "" : text).split(/\r\n|\n|\r/);
  const firstN = isMessage ? lineFilterValue("searchFirstN") : null;
  const lastN = isMessage ? lineFilterValue("searchLastN") : null;
  const allowed = new Set();
  if (firstN === null && lastN === null) lines.forEach((_, i) => allowed.add(i));
  else {
    if (firstN !== null) for (let i = 0; i < Math.min(firstN, lines.length); i++) allowed.add(i);
    if (lastN !== null) for (let i = Math.max(0, lines.length - lastN); i < lines.length; i++) allowed.add(i);
  }
  const out = [];
  lines.forEach((line, i) => {
    if (allowed.has(i) && tokens.length && hayHasAny(line, tokens)) out.push({ lineNo: i + 1, line: line });
  });
  return out;
}

function paintTokenBar(tokens) {
  const bar = $("tokenBar");
  if (!tokens.length) { bar.innerHTML = ""; tokenOn = []; return; }
  if (tokenOn.length !== tokens.length) tokenOn = tokens.map(function () { return true; });
  bar.innerHTML = tokens.map(function (t, i) {
    const col = TOKEN_COLORS[i % TOKEN_COLORS.length];
    const label = (!$("rawSearch") || !$("rawSearch").checked) && t.raw.indexOf(" ") >= 0 ? '"' + t.raw + '"' : t.raw;
    return '<label style="color:' + col + '"><input type="checkbox" data-tok="' + i + '" ' + (tokenOn[i] !== false ? "checked" : "") + " /> " + esc(label) + "</label>";
  }).join("");
  bar.querySelectorAll("input").forEach(function (inp) {
    inp.addEventListener("change", function () {
      tokenOn[Number(inp.dataset.tok)] = inp.checked;
      seek($("q").value);
    });
  });
}

function liveAsks(list) {
  const live = list.filter(isLive);
  live.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (liveSort === "ts-desc") live.reverse();
  return live;
}


function chatItemOrder(convKey) {
  const list = viewAsks(convKey);
  const out = [];
  list.forEach(function (c) {
    if (!inTime(c.ts) && !(c.answers || []).some(function (a) { return inTime(a.ts); })) return;
    if (isOnMsg(c)) {
      if (showOnMsg) out.push({ nid: "onMsg-" + (c.recordKey || c.localIndex), kind: "ask" });
      return;
    }
    if (showAskNode(c)) out.push({ nid: askNidPrefix(c) + "-" + (c.recordKey || c.localIndex), kind: "ask" });
    (c.answers || []).forEach(function (a) {
      if (!inTime(a.ts) || !showAnsNode(a)) return;
      out.push({ nid: answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex), kind: "answer" });
    });
  });
  return out;
}
function gapAfter(nid, convKey) {
  const order = chatItemOrder(convKey);
  const i = order.findIndex(function (it) { return it.nid === nid; });
  if (i < 0) return null;
  const between = [];
  let to = "end";
  for (let j = i + 1; j < order.length; j++) {
    if (searchHitNids.has(order[j].nid)) { to = order[j].nid; break; }
    between.push(order[j].nid);
  }
  if (!between.length) return null;
  return { from: nid, to: to, nids: between, count: between.length, key: nid + "->" + to };
}
function inOpenedGap(nid, convKey) {
  const order = chatItemOrder(convKey);
  const i = order.findIndex(function (it) { return it.nid === nid; });
  if (i < 0) return false;
  for (const key of openedGaps) {
    const parts = key.split("->");
    const from = order.findIndex(function (it) { return it.nid === parts[0]; });
    if (from < 0 || from >= i) continue;
    let to = order.length;
    if (parts[1] !== "end") {
      to = order.findIndex(function (it) { return it.nid === parts[1]; });
      if (to < 0) continue;
    }
    if (i < to) return true;
  }
  return false;
}
function nodeHtmlFor(nid, convKey, tokens) {
  const hit = findByNid(nid);
  if (!hit) return "";
  if (hit.kind === "answer") {
    const a = hit.node;
    const parent = hit.parent;
    return pttNode({
      nid: nid,
      ck: convKey,
      tag: (isSeenAns(a) ? "seo#" : "ans#") + (parent ? parent.localIndex : "?") + "." + (a.localIndex == null ? "?" : a.localIndex),
      body: fmtTs(a.ts) + "  " + (a.text || ""),
      bodyPrefix: fmtTs(a.ts) + "  ",
      foldText: a.text || "",
      tokens: tokens,
      kidsHtml: "",
      open: false,
      liked: nodeLiked(a),
      titlePane: true,
      recordKey: a.recordKey || "",
      storeKind: "answer",
      editText: a.text || ""
    });
  }
  return pttAskNode(hit.node, tokens, false, hit.kind, convKey, true);
}
function gapButtonHtml(nid, convKey, tokens) {
  if (!tokens || !tokens.length || !nid || !convKey) return "";
  if ((chatUnfoldModes.get(String(convKey)) || "hit") !== "hit") return "";
  const gap = gapAfter(nid, convKey);
  if (!gap) return "";
  const open = openedGaps.has(gap.key);
  return '<button type="button" class="ptt-gap" data-gap="' + esc(gap.key) + '" title="' +
    (open ? "Fold" : "Unfold") + " " + gap.count + ' non-hit item(s) before the next hit">' +
    gap.count + "</button>";
}
function togPair(open, extra) {
  const mark = open ? "\u2212" : "+";
  const left = '<button type="button" class="ptt-tog" data-side="L" ' + extra + ">" + mark + "</button>";
  const right = '<button type="button" class="ptt-tog" data-side="R" ' + extra + ">" + mark + "</button>";
  return { left: left, right: right, mark: mark };
}

function pttNode(opts) {
  const hasKids = !!opts.kidsHtml;
  const open = !!opts.open;
  if (opts.ck && opts.nid) nidToConvKey.set(String(opts.nid), String(opts.ck));
  const extra = opts.ak ? ('data-ak="' + esc(opts.ak) + '"') : "";
  const ckAttr = opts.ck ? ('data-ck="' + esc(opts.ck) + '"') : "";
  const t = hasKids ? togPair(open, extra) : {
    left: '<button type="button" class="ptt-tog" disabled>\u00b7</button>',
    right: '<button type="button" class="ptt-tog" disabled>\u00b7</button>'
  };
  const gapBtn = gapButtonHtml(opts.nid, opts.ck, opts.tokens);
  const kids = hasKids
    ? '<div class="ptt-kids"' + (open ? "" : " hidden") + ">" + opts.kidsHtml + "</div>"
    : "";
  const liked = !!opts.liked;
  const menu = opts.recordKey
    ? '<span class="ptt-more"><button type="button" class="ptt-dots" data-nid="' + esc(opts.nid || "") + '" data-rk="' + esc(opts.recordKey) + '" data-kind="' + esc(opts.storeKind || "ask") + '" data-liked="' + (liked ? "1" : "0") + '" data-text="' + esc(opts.editText || "") + '">\u22ee</button>' +
      '<span class="ptt-menu" hidden><button type="button" class="ptt-edit">Edit</button>' +
      (liked ? '<button type="button" class="ptt-unlike">Unlike</button>' : '<button type="button" class="ptt-like">Like</button>') +
      '<button type="button" class="ptt-del">Delete</button></span></span>'
    : "";
  const star = liked ? '<span class="ptt-like-mark" title="liked">\u2605</span>' : "";
  const label = hitDotHtml(opts.nid) + star + '<span class="ptt-label-wrap"><span class="ptt-tag">' + esc(opts.tag) + '</span>' +
    (opts.foldText !== undefined ? messageToggleHtml(opts.foldText, opts.nid, false, opts.ck, opts.tokens) : '') + '</span>';
  const bodyHtml = opts.foldText !== undefined
    ? esc(opts.bodyPrefix || '') + messageContentHtml(opts.foldText, opts.tokens, opts.nid, false, opts.ck, !!opts.titlePane)
    : highlightText(opts.body, opts.tokens);
  return '<div class="ptt-node" data-nid="' + esc(opts.nid) + '" ' + ckAttr + '><div class="ptt-row">' +
    t.left + gapBtn + label +
    (hasKids ? t.right : "") +
    '<span class="ptt-txt">  ' + bodyHtml + "</span>" + menu + "</div>" + kids + "</div>";
}

function pttAskNode(c, tokens, kidsOpen, kind, convKey, titlePane = false) {

  const tag = isOnMsg(c) ? ("onMsg#" + c.localIndex)
    : isSeenAsk(c) ? ("sei#" + c.localIndex)
    : ("ask#" + c.localIndex);
  const nid = (kind === "ask" ? askNidPrefix(c) : kind) + "-" + (c.recordKey || c.localIndex);
  if (convKey) nidToConvKey.set(nid, convKey);

  const hitModeHere = !!(tokens && tokens.length && convKey && (chatUnfoldModes.get(String(convKey)) || "hit") === "hit");
  const shownAnswers = (c.answers || []).filter((a) => inTime(a.ts) && showAnsNode(a) &&
    (!hitModeHere || searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)) || inOpenedGap(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex), convKey)));
  const kidsHtml = (kind !== "onMsg" && shownAnswers.length)
    ? shownAnswers.map(function (a) {
        if (filter === "favorites" && !nodeLiked(a)) return "";
        return pttNode({
          nid: answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex),
          ck: convKey,
          tag: (isSeenAns(a) ? "seo#" : "ans#") + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex),
          body: fmtTs(a.ts) + "  " + (a.text || ""),
          bodyPrefix: fmtTs(a.ts) + "  ",
          foldText: a.text || "",
          tokens: tokens,
          kidsHtml: "",
          open: false,
          liked: nodeLiked(a),
          titlePane: titlePane,
          recordKey: a.recordKey || "",
          storeKind: "answer",
          editText: a.text || ""
        });
      }).join("")
    : "";
  return pttNode({
    nid: nid,
    ck: convKey,
    tag: tag,
    body: fmtTs(c.ts) + "  " + (c.text || ""),
    bodyPrefix: fmtTs(c.ts) + "  ",
    foldText: c.text || "",
    tokens: tokens,
    kidsHtml: kidsHtml,
    open: !!(kidsHtml && kidsOpen),
    ak: c.recordKey,
    recordKey: c.recordKey || "",
    storeKind: kind === "onMsg" ? "onMsg" : "ask",
    editText: c.text || "",
    liked: nodeLiked(c),
    titlePane: titlePane
  });
}

function askBlock(r, list, tokens) {
  const parts = [];
  const showAsk = (c) => filter !== "favorites" || nodeLiked(c) || (c.answers || []).some(nodeLiked);
  if (showOnMsg || filter === "favorites") {
    const hitMode = tokens.length && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
    const live = liveAsks(list).filter((c) => isOnMsg(c) && inTime(c.ts) && showAsk(c) &&
      (!hitMode || searchHitNids.has("onMsg-" + (c.recordKey || c.localIndex)) || inOpenedGap("onMsg-" + (c.recordKey || c.localIndex), r.convKey)));
    if (live.length) {
      parts.push('<div class="ptt-tree">' + live.map(function (c) {
        return pttAskNode(c, tokens, false, "onMsg", r.convKey, true);
      }).join("") + "</div>");
    }
  }
  if (showSei || showAsk || showSeo || showAns || filter === "favorites") {
    const imp = list.filter((c) => !isOnMsg(c) && showAsk(c) && (showAskNode(c) || (c.answers || []).some(showAnsNode) || (filter === "favorites" && (nodeLiked(c) || (c.answers || []).some(nodeLiked)))) && (inTime(c.ts) || (c.answers || []).some((a) => inTime(a.ts))));
    if (imp.length) {
      const ansOpenAll = openAns.has(r.convKey) || batchAnsOpen;
      const hitMode = tokens.length && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
      const nodes = imp.map(function (c) {
        const hitAns = tokens.length && (c.answers || []).some(function (a) { return showAnsNode(a) && searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)); });
        const hitAsk = showAskNode(c) && searchHitNids.has(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex));
        const openKids = ansOpenAll || forceOpenAsk.has(c.recordKey) || hitAns || (c.answers || []).some(showAnsNode);
        const gapAsk = inOpenedGap(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex), r.convKey);
        if (hitMode && !hitAsk && !hitAns && !gapAsk) return "";
        if (!showAskNode(c) && !openKids) return "";
        return pttAskNode(c, tokens, openKids, "ask", r.convKey, true);
      }).join("");
      parts.push('<div class="ptt-tree">' + nodes + "</div>");
    }
  }
  if (!parts.length) return '<div class="cmt">Nothing to show for current checkboxes.</div>';
  return parts.join("");
}

function applySearchUnfold(r, tokens) {
  if (!tokens.length || !includeImpAns) return;
  const list = viewAsks(r.convKey);
  for (const c of list.filter(isImp)) {
    if ((c.answers || []).some(function (a) { return hayHasAny(ansHay(a), tokens); })) {
      forceOpenAsk.add(c.recordKey);
    }
  }
}

function collectHits(r, tokens) {
  const list = viewAsks(r.convKey);
  function add(kind, idLabel, text, ts, isMessage) {
    lineHits(text, tokens, !!isMessage).forEach(function (h) {
      hitList.push({
        urlid: r.id,
        convKey: r.convKey,
        node: idLabel,
        nid: kind,
        lineNo: h.lineNo,
        line: h.line,
        ts: ts || 0,
        deletedAt: r.deletedAt || 0
      });
    });
  }
  if (hayHasAny(pageHay(r), tokens)) add("meta-" + r.id, "url#" + r.id, pageHay(r), rowTs(r));
  if (showOnMsg) {
    liveAsks(list).filter((c) => isOnMsg(c) && inTime(c.ts)).forEach(function (c) {
      add("onMsg-" + (c.recordKey || c.localIndex), "onMsg#" + c.localIndex, (c.text || ""), c.ts, true);
    });
  }
  list.filter((c) => !isOnMsg(c) && (inTime(c.ts) || (c.answers || []).some((a) => inTime(a.ts)))).forEach(function (c) {
    if (showAskNode(c) && inTime(c.ts)) add(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex), (isSeenAsk(c) ? "sei#" : "ask#") + c.localIndex, c.text || "", c.ts, true);
    (c.answers || []).filter((a) => inTime(a.ts) && showAnsNode(a)).forEach(function (a) {
      add(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex), (isSeenAns(a) ? "seo#" : "ans#") + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex), a.text || "", a.ts, true);
    });
  });
}

function rowHtml(r) {
  const q = $("q").value;
  const parsed = parseSearch(q);
  const tokens = parsed.tokens;
  const all = viewAsks(r.convKey);
  applySearchUnfold(r, tokens);
  // Session folding is always manual/per-chat, whether search is active or not.
  // Search hits affect message content, not whether the chat session is forced open.
  const show = openChats.has(r.convKey);
  const ansOn = openAns.has(r.convKey) || batchAnsOpen;
  const fold = '<button class="fold" data-ck="' + esc(r.convKey) + '" type="button">' + (show ? "\u2212" : "+") + "</button>";
  const ansFold = '<button class="ansfold" data-ck="' + esc(r.convKey) + '" type="button" title="fold/unfold all imported answers">' + (ansOn ? "\u2212a" : "+a") + "</button>";
  const unfoldMode = tokens.length
    ? '<button class="chat-unfold-mode" data-ck="' + esc(r.convKey) + '" type="button" title="Toggle matching lines only vs all message lines in this chat">' + ((chatUnfoldModes.get(String(r.convKey)) || "hit") === "all" ? "All" : "Hit") + '</button>'
    : "";
  const detail = show
    ? '<tr class="cmt-row" data-ck="' + esc(r.convKey) + '"><td colspan="6">' + askBlock(r, all, tokens) + "</td></tr>"
    : "";
  return '<tr data-id="' + r.id + '" data-ck="' + esc(r.convKey) + '" class="' + (r.id === selectedId ? "sel" : "") + '">' +
    "<td>" + esc(fmtTs(rowTs(r))) + "</td><td>" + esc(r.platform) + "</td>" +
    '<td title="' + esc(r.title) + '">' + unfoldMode + fold + ansFold + esc(r.title || "") + "</td>" +
    '<td title="' + esc(r.url) + '">' + esc(r.conversationId || r.url || "") + "</td>" +
    "<td>" + (all.length || r.askCount || 0) + "</td><td>" + r.id + "</td></tr>" + detail;
}

function collectItems(sessions, tokens) {
  const items = [];
  sessions.forEach(function (r) {
    const list = viewAsks(r.convKey);
    list.forEach(function (c) {
      const answers = c.answers || [];
      const isLiveAsk = isOnMsg(c) || !isImp(c);
      const hasShownAns = answers.some(function (a) { return inTime(a.ts) && showAnsNode(a); });
      if (isOnMsg(c) && !showOnMsg) return;
      if (!isOnMsg(c) && !showAskNode(c) && !hasShownAns) return;
      if (!inTime(c.ts) && !hasShownAns) return;
      if (filter === "favorites" && !nodeLiked(c) && !answers.some(nodeLiked)) return;
      const askHit = !tokens.length || hayHasAll(askHay(c), tokens) || hayHasAll(pageHay(r), tokens);
      const ansHit = answers.some(function (a) { return showAnsNode(a) && hayHasAll(ansHay(a), tokens); });
      if (tokens.length && !askHit && !ansHit) return;
      items.push({
        ts: c.ts || 0,
        convKey: r.convKey,
        session: r,
        kind: isOnMsg(c) ? "onMsg" : "ask",
        source: c.source || "",
        localIndex: c.localIndex,
        text: c.text || "",
        recordKey: c.recordKey || "",
        liked: !!c.liked,
        answers: answers
      });
    });
  });
  items.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return items;
}

function groupItems(items) {
  const groups = [];
  items.forEach(function (it) {
    const last = groups[groups.length - 1];
    if (!last || last.convKey !== it.convKey) {
      groups.push({ convKey: it.convKey, session: it.session, items: [it] });
    } else {
      last.items.push(it);
    }
  });
  return groups;
}


function bannerRowHtml(session) {
  return '<tr class="banner' + (session.id === selectedId ? " sel" : "") + '" data-id="' + session.id + '" data-ck="' + esc(session.convKey) + '">' +
    "<td>" + esc(fmtTs(rowTs(session))) + "</td><td>" + esc(session.platform) + "</td>" +
    '<td title="' + esc(session.title) + '"><b>' + esc(session.title || "(no title)") + "</b></td>" +
    '<td title="' + esc(session.url) + '">' + esc(session.conversationId || session.url || "") + "</td>" +
    "<td>" + (viewAsks(session.convKey).length || session.askCount || 0) + "</td><td>" + session.id + "</td></tr>";
}

function datetimeItemNid(it) {
  return askNidPrefix(it) + "-" + (it.recordKey || it.localIndex);
}

function datetimeRangeHtml(start, end, tokens) {
  const groups = groupItems(datetimeItems.slice(start, end));
  const html = [];
  groups.forEach(function (g) {
    html.push(bannerRowHtml(g.session));
    const ptt = g.items.map(function (it) {
      return pttAskNode({
        localIndex: it.localIndex,
        ts: it.ts,
        text: it.text,
        recordKey: it.recordKey,
        source: it.source || "",
        liked: !!it.liked,
        answers: it.answers || []
      }, tokens, (it.answers || []).some(showAnsNode), it.kind, g.convKey);
    }).join("");
    html.push('<tr class="cmt-row" data-ck="' + esc(g.convKey) + '"><td colspan="6"><div class="ptt-tree">' + ptt + "</div></td></tr>");
  });
  return html.join("");
}

function buildDateTimeItems(tokens) {
  datetimeItems = collectItems(matched, tokens);
  // collectItems already sorts newest-to-oldest across every conversation.
  dtStart = dtEnd = 0;
}

function renderDateTimeWindow(nid, scroll, scrollMode = "center") {
  const tb = $("dateTimeView");
  const tokens = parseSearch($("q").value).tokens;
  if (!datetimeItems.length) buildDateTimeItems(tokens);
  let target = nid ? datetimeItems.findIndex(it => datetimeItemNid(it) === nid) : -1;
  if (nid && target < 0) {
    // Rebuild once in case the selected item was added/changed since the last search.
    buildDateTimeItems(tokens);
    target = datetimeItems.findIndex(it => datetimeItemNid(it) === nid);
  }
  if (!datetimeItems.length) {
    tb.innerHTML = "";
    dtStart = dtEnd = 0;
    $("empty").hidden = false;
    $("status").textContent = "0 items in 0 groups";
    return;
  }
  const center = target >= 0 ? target : 0;
  dtStart = Math.max(0, center - DT_BATCH);
  dtEnd = Math.min(datetimeItems.length, center + DT_BATCH + 1);
  tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
  $("empty").hidden = true;
  $("status").textContent = (dtEnd - dtStart) + " of " + datetimeItems.length + " chronological items loaded";
  if (nid) requestAnimationFrame(() => selectItemByNid(nid, !!scroll, scrollMode));
}

let datetimeHeadRefreshInFlight = false;
let datetimeHeadRefreshAt = 0;

async function refreshDateTimeHead() {
  if (datetimeHeadRefreshInFlight || Date.now() - datetimeHeadRefreshAt < 1200) return;
  datetimeHeadRefreshInFlight = true;
  datetimeHeadRefreshAt = Date.now();
  const wrap = $(".listwrap");
  const tb = $("dateTimeView");
  const oldHeight = wrap.scrollHeight;
  try {
    // Refresh the backing records as well as the ask index; scrolling alone
    // cannot reveal records that were absent from the in-memory snapshot.
    const freshRows = await getAll();
    if (freshRows.length) rows = freshRows;
    await loadAsksIndex();
    const q = $("q").value;
    const source = filter === "recycle" ? recycleChats : rows;
    matched = source.filter(r => matchRow(r, q));
    const tokens = parseSearch(q).tokens;
    buildDateTimeItems(tokens);
    dtStart = 0;
    dtEnd = Math.min(datetimeItems.length, DT_BATCH);
    tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
    $("empty").hidden = datetimeItems.length > 0;
    $("status").textContent = (dtEnd - dtStart) + " of " + datetimeItems.length + " chronological items loaded";
    // Keep the old content anchored instead of leaving the user pinned to the
    // absolute top after newly discovered items have been inserted.
    const addedHeight = wrap.scrollHeight - oldHeight;
    if (addedHeight > 0) wrap.scrollTop += addedHeight;
  } catch (err) {
    console.warn("Could not refresh datetime head", err);
  } finally {
    datetimeHeadRefreshInFlight = false;
  }
}
function appendDateTimeBatch(direction) {
  if (middleMode !== "item" || !datetimeItems.length) return;
  const tb = $("dateTimeView");
  const tokens = parseSearch($("q").value).tokens;
  
  if (direction === "down" && dtEnd < datetimeItems.length) {
    const oldEnd = dtEnd;
    dtEnd = Math.min(datetimeItems.length, dtEnd + DT_BATCH);
    tb.insertAdjacentHTML("beforeend", datetimeRangeHtml(oldEnd, dtEnd, tokens));
  } else if (direction === "up" && dtStart > 0) {
    const oldStart = dtStart;
    const nextStart = Math.max(0, dtStart - DT_BATCH);
    const wrap = $(".listwrap");
    const beforeHeight = wrap ? wrap.scrollHeight : 0;
    
    tb.insertAdjacentHTML("afterbegin", datetimeRangeHtml(nextStart, oldStart, tokens));
    dtStart = nextStart;
    
    // Compensate for newly prepended items so scroll position remains stable
    if (wrap) {
      wrap.scrollTop += wrap.scrollHeight - beforeHeight;
    }
  } else if (direction === "up" && dtStart === 0) {
    refreshDateTimeHead();
  }
  $("status").textContent = (dtEnd - dtStart) + " of " + datetimeItems.length + " chronological items loaded";
}

function renderItemMode(tokens) {
  // A fresh search/filter invalidates the cached chronological list; ordinary
  // pane switching reuses it and does not rebuild the DOM.
  buildDateTimeItems(tokens);
  renderDateTimeWindow(selectedId, false);
}

function getVisibleItems() {
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  return body ? Array.from(body.querySelectorAll(".ptt-node, tr.item-row")) : [];
}

function clearItemSelection() {
  document.querySelectorAll("#titleView .ptt-selected, #dateTimeView .ptt-selected").forEach(function (el) { el.classList.remove("ptt-selected"); });
}

function findConvForNid(nid) {
  // 1. Check DOM first if visible
  const el = document.querySelector('.ptt-node[data-nid="' + CSS.escape(nid) + '"][data-ck], tr.item-row[data-nid="' + CSS.escape(nid) + '"][data-ck]');
  if (el && el.dataset.ck) return el.dataset.ck;

  // 2. Use our direct lookup map (no guesswork)
  if (nidToConvKey.has(nid)) return nidToConvKey.get(nid);

  return null;
}

function selectItemByNid(nid, scroll = false, scrollMode = "center") {
  if (!nid) return false;

  selectedNid = nid;
  clearItemSelection();

  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  const el = body && Array.from(
    body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]")
  ).find((node) => node.dataset.nid === nid);

  if (!el) return false;

  el.classList.add("ptt-selected");

  if (scroll) {
    // For pane switches and Prev/Next navigation, keep the beginning of a
    // long item visible (tag/fold icon + timestamp + opening text). Short
    // items retain the usual centered scrolling behavior.
    const textEl = el.querySelector(":scope > .ptt-row .ptt-txt") || el.querySelector("td:nth-child(3)");
    const textLength = textEl ? (textEl.textContent || "").trim().length : 0;
    const revealHead = scrollMode === "head" && textLength >= 240;

    if (revealHead) {
      // Positive offset places the item this many pixels below the top of
      // the scroll viewport (clear of the sticky DateTime/title header).
      // Negative values are supported to move the item closer to/above the top.
      const wrap = document.querySelector(".listwrap");
      const offsetInput = $("headOffsetPx");
      const parsedOffset = offsetInput ? Number.parseInt(offsetInput.value, 10) : 36;
      const offset = Number.isFinite(parsedOffset) ? parsedOffset : 36;
      if (wrap) {
        const itemRect = el.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const targetTop = wrap.scrollTop + itemRect.top - wrapRect.top - offset;
        wrap.scrollTo({ top: targetTop, behavior: "smooth" });
      } else {
        el.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
      }
    } else {
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth"
      });
    }
  }

  return true;
}

function revealChat(ck) {
  if (!ck) return;
  openChats.add(ck);
  const detail = document.querySelector('tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
  if (detail) detail.hidden = false;
  const fold = document.querySelector('button.fold[data-ck="' + CSS.escape(ck) + '"]');
  if (fold) fold.textContent = "\u2212";
}
function jumpItem(delta) {
  const items = getVisibleItems();
  if (!items.length) return;
  let idx = items.findIndex(function (el) { return el.dataset.nid === selectedNid; });
  if (idx < 0) idx = 0;
  else idx = (idx + delta + items.length) % items.length;
  const el = items[idx];
  const nid = el.dataset.nid;
  revealChat(el.dataset.ck || findConvForNid(nid));
  selectItemByNid(nid, true, "head");
}

function updateHeaderIndicators() {
  const thDt = $("thDateTime");
  const thTi = $("thTitle");
  if (thDt) thDt.textContent = "date-time" + (middleMode === "item" ? " ↓" : "");
  if (thTi) thTi.innerHTML = "Title" + (middleMode === "ptt" ? " ↓" : "") + ' <span class="grip" data-col="thTitle"></span>';
  const sel = $("dispMode");
  if (sel && sel.value !== dispStyle) sel.value = dispStyle;
}

function sortHits() {
  if (hitSort === "ts-desc") hitList.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  else if (hitSort === "ts-asc") hitList.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const th = $("thHitDt");
  if (th) th.textContent = "datetime" + (hitSort === "ts-desc" ? " ↓" : hitSort === "ts-asc" ? " ↑" : "");
}

function paintHits(tokens) {
  // Keep hitList populated for Prev/Next Hit navigation, but do not render the
  // lower pane while the user has explicitly invalidated it.
  if ($("invalidateLowerPane") && $("invalidateLowerPane").checked) return;
  if (!delSort) sortHits();
  const tb = $("hitBody");
  tb.innerHTML = hitList.map(function (h, i) {
    return '<tr data-hi="' + i + '"><td>' + esc(fmtTs(h.ts)) + "</td><td>" + esc(fmtTs(h.deletedAt)) + "</td><td>" + h.urlid + "</td><td>" + esc(h.node) + "</td><td>" + h.lineNo + "</td><td>" + highlightText(h.line, tokens) + "</td></tr>";
  }).join("");
}

function renderSlice(reset) {
  if (middleMode === "item") {
    //if (reset || !datetimeItems.length) renderItemMode(parseSearch($("q").value).tokens);
     
     if (selectedId && !$("dateTimeView").querySelector('[data-nid="' + CSS.escape(selectedId) + '"]')) renderDateTimeWindow(selectedId, true);
   
    // if (selectedId ) renderDateTimeWindow(selectedId, true);
    updateHeaderIndicators();
    return;
  }
  const tb = $("titleView");
  if (reset) { shown = 0; tb.innerHTML = ""; }
  const next = matched.slice(shown, shown + PAGE);
  if (next.length) tb.insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
  shown += next.length;
  $("empty").hidden = matched.length > 0;
  $("status").textContent = shown + " of " + matched.length + " shown";
  updateHeaderIndicators();
  if (selectedNid) selectItemByNid(selectedNid, false);
}

function pushHist(q) {
  const s = String(q || "").trim();
  if (!s || s === lastLoggedQ) return;
  lastLoggedQ = s;
  searchHist = searchHist.filter((x) => x !== s);
  searchHist.unshift(s);
  searchHist = searchHist.slice(0, 40);
  try { chrome.storage.local.set({ explorerSearchHist: searchHist }); } catch (_) {}
  paintHist();
}

function paintHist() {
  const box = $("qHist");
  box.innerHTML = searchHist.map((s) => "<div>" + esc(s) + "</div>").join("");
}

function applyEditedText(recordKey, kind, text) {
  if (!recordKey) return;
  asksByConv.forEach(function (list) {
    list.forEach(function (ask) {
      if (kind !== "answer" && ask.recordKey === recordKey) ask.text = text;
      (ask.answers || []).forEach(function (ans) {
        if (kind === "answer" && ans.recordKey === recordKey) ans.text = text;
      });
    });
  });
  rows.forEach(function (row) {
    if (row.recordKey === recordKey) row.text = text;
  });
  recycleAsks.forEach(function (list) {
    list.forEach(function (ask) {
      if (ask.recordKey === recordKey) ask.text = text;
    });
  });
}

function readFoldSetting(input) {
  const raw = String(input.value == null ? "" : input.value).trim();
  if (raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
["foldM", "foldN"].forEach(function (id) {
  const input = $(id);
  if (!input) return;
  input.addEventListener("change", function () {
    const value = readFoldSetting(input);
    input.value = String(value);
    if (id === "foldM") foldM = value; else foldN = value;
    document.documentElement.style.setProperty("--fold-visual-lines", String(Math.max(1, foldM + foldN + 1)));
    seek($("q").value);
  });
});

document.documentElement.style.setProperty("--fold-visual-lines", String(Math.max(1, foldM + foldN + 1)));

function seek(q) {
  const unfoldQuery = String(q == null ? "" : q);
  const isNewQuery = lastUnfoldQuery !== unfoldQuery;
  if (lastUnfoldQuery !== null && isNewQuery) {
    // A genuinely new query starts with the default "Hit" policy per chat.
    // Do not clear messageFoldOverrides: explicit per-message choices survive
    // query changes just like they survive pane refreshes and DOM recreation.
    chatUnfoldModes.clear();
    openedGaps.clear();
  }
  lastUnfoldQuery = unfoldQuery;
  forceOpenAsk.clear();
  const parsed = parseSearch(q);
  paintTokenBar(parsed.tokens);
  const source = filter === "recycle" ? recycleChats : rows;
  matched = source.filter(function (r) { return matchRow(r, q); });
  if (isNewQuery && parsed.tokens.length) matched.forEach(function (r) { openChats.add(r.convKey); });
  hitList = [];
  if (parsed.tokens.length) matched.forEach(function (r) { collectHits(r, parsed.tokens); });
  searchHitNids.clear();
  hitList.forEach(function (h) {
    if (/^(?:onMsg|ask|ans|sei|seo)-/.test(String(h.nid || ""))) searchHitNids.add(String(h.nid));
  });
  hitCursor = hitList.length ? 0 : -1;
  setSeek(100, "Seek 100%  " + matched.length + " urls + " + hitList.length + " hits");
  datetimeItems = []; dtStart = dtEnd = 0;
  if ($("dateTimeView")) $("dateTimeView").innerHTML = "";
  shown = 0;
  $("titleView").innerHTML = "";
  const firstPage = matched.slice(0, PAGE);
  if (firstPage.length) $("titleView").insertAdjacentHTML("beforeend", firstPage.map(rowHtml).join(""));
  shown = firstPage.length;
  if (middleMode === "item") {
    renderItemMode(parsed.tokens);
  } else {
    $("empty").hidden = matched.length > 0;
    $("status").textContent = shown + " of " + matched.length + " shown";
  }
  paintHits(parsed.tokens);
  updateHeaderIndicators();
  if (selectedNid) selectItemByNid(selectedNid, false);
}



function jumpHit(i) {
  if (!hitList.length) return;

  hitCursor = (i + hitList.length) % hitList.length;
  const h = hitList[hitCursor];

  //selectedId = h.urlid;
  
  console.log( "in jumpHit , h.urlid is :", h.urlid   );
  console.log( "in jumpHit , h.nid is :", h.nid   );
  
  
  selectedId = h.nid;
  revealChat(h.convKey);

  if (String(h.node).indexOf("ans#") === 0 || String(h.node).indexOf("seo#") === 0) {
    openAns.add(h.convKey);
  }

  if (middleMode === "item") {
    // Preserve the existing DateTime-pane behavior.
    renderSlice(true);
    //alert (' hit ');
  } else {
    // Find the target session in the complete search result list.
    const targetIndex = matched.findIndex(
      r => String(r.id) === String(h.urlid)
    );

    if (targetIndex >= 0) {
      const tb = $("titleView");
      const pageStart = Math.floor(targetIndex / PAGE) * PAGE;
      const pageItems = matched.slice(pageStart, pageStart + PAGE);

      // Render the target page BEFORE looking for the target node.
      //tb.innerHTML = pageItems.map(rowHtml).join("");
      shown = pageStart + pageItems.length;

      $("empty").hidden = matched.length > 0;
      $("status").textContent =
        shown + " of " + matched.length + " shown";

      updateHeaderIndicators();
    }
  }

  paintHits(parseSearch($("q").value).tokens);

  document.querySelectorAll("#hitBody tr").forEach(tr => {
    tr.classList.toggle(
      "on",
      Number(tr.dataset.hi) === hitCursor
    );
  });

  // Wait until the new title-pane DOM has been laid out.
  requestAnimationFrame(() => {
    const activeBody = middleMode === "item"
      ? $("dateTimeView")
      : $("titleView");

    const row = $("titleView").querySelector(
      'tr[data-id="' + CSS.escape(String(h.urlid)) + '"]'
    );

    if (row) {
      row.scrollIntoView({ block: "center" });
    }

    const node = activeBody.querySelector(
      '.ptt-node[data-nid="' + CSS.escape(String(h.nid)) + '"]'
    );

    if (node) {
      node.classList.add("ptt-jump");
      node.scrollIntoView({ block: "center" });

      setTimeout(() => {
        node.classList.remove("ptt-jump");
      }, 1200);
    }
  });
}

 
 
 
 
 
 
 
 
 
 
 
 

async function loadRecycle() {
  recycleItems = [];
  recycleAsks.clear();
  recycleChats = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-recycle" });
    recycleItems = (res && res.rows) || [];
  } catch (_) {}
  const chats = new Map();
  recycleItems.forEach(function (item) {
    const convKey = item.convKey || ("recycle|" + item.id);
    if (!chats.has(convKey)) {
      const d = new Date(item.deletedAt || item.ts || Date.now());
      chats.set(convKey, {
        id: item.id,
        convKey: convKey,
        platform: item.platform || "",
        title: item.title || (rows.find(function (r) { return r.convKey === convKey; }) || {}).title || "(recycled)",
        conversationId: item.conversationId || "",
        url: item.url || "",
        date: fmtTs(d.getTime()).slice(0, 10),
        time: fmtTs(d.getTime()).slice(11),
        deletedAt: item.deletedAt || 0,
        askCount: 0
      });
    }
    const list = recycleAsks.get(convKey) || [];
    const kind = item.kind || (String(item.originKey || "").includes("|onMsg|") ? "onMsg" : "ask");
    if (kind === "answer") {
      const parentIndex = item.askLocalIndex || 0;
      let parent = list.find(function (a) { return a.localIndex === parentIndex && a.kind !== "answer"; });
      if (!parent) {
        parent = {
          recordKey: "recycle-dummy:" + item.id,
          text: "(ask not logged)",
          ts: item.ts || 0,
          source: "seen-dummy",
          kind: "ask",
          localIndex: parentIndex || "?",
          answers: []
        };
        list.push(parent);
      }
      parent.answers.push({
        recordKey: "recycle:" + item.id,
        text: item.text || "",
        ts: item.ts || 0,
        localIndex: item.localIndex || item.id,
        source: "seen"
      });
    } else {
      list.push({
        recordKey: "recycle:" + item.id,
        text: item.text || "",
        ts: item.ts || 0,
        deletedAt: item.deletedAt || 0,
        responseId: item.responseId || "",
        source: kind === "onMsg" ? "onMsg" : "seen",
        kind: kind,
        localIndex: item.localIndex || item.id,
        answers: []
      });
    }
    recycleAsks.set(convKey, list);
    chats.get(convKey).askCount = list.length;
    chats.get(convKey).deletedAt = Math.max(chats.get(convKey).deletedAt || 0, item.deletedAt || 0);
  });
  recycleChats = Array.from(chats.values());
}

async function loadLazy() {
  rows = []; matched = []; shown = 0;
  if ($("titleView")) $("titleView").innerHTML = "";
  if ($("dateTimeView")) $("dateTimeView").innerHTML = "";
  datetimeItems = []; dtStart = dtEnd = 0;
  setSeek(0, "Loading 0%");
  try {
    await loadAsksIndex();
    rows = await getAll();
    await loadRecycle();
    seek($("q").value);
    $("status").textContent = rows.length
      ? (shown + " of " + matched.length + " shown")
      : "0 chats.";
  } catch (err) {
    $("status").textContent = "Load error: " + err;
    $("empty").hidden = false;
    $("empty").textContent = String(err);
  }
}

function onTreeToggle(e) {
  const tog = e.target.closest(".ptt-tog");
  if (!tog || tog.disabled) return;
  e.stopPropagation();
  const node = tog.closest(".ptt-node");
  const kids = node && node.querySelector(":scope > .ptt-kids");
  if (!kids) return;
  kids.hidden = !kids.hidden;
  const mark = kids.hidden ? "+" : "\u2212";
  node.querySelectorAll(":scope > .ptt-row > .ptt-tog").forEach(function (b) {
    if (!b.disabled) b.textContent = mark;
  });
  const ak = tog.dataset.ak;
  if (ak) {
    if (kids.hidden) forceOpenAsk.delete(ak);
    else forceOpenAsk.add(ak);
  }
}

function placeMenu(menu, dots) {
  menu.hidden = false;
  menu.style.position = "fixed";
  menu.style.zIndex = "1000";
  const r = dots.getBoundingClientRect();
  const w = menu.offsetWidth || 88;
  const h = menu.offsetHeight || 0;
  const below = r.bottom + 2;
  const top = (below + h > window.innerHeight && r.top - h - 2 > 0) ? (r.top - h - 2) : below;
  let left = r.right - w;
  if (left < 4) left = 4;
  if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
  menu.style.top = top + "px";
  menu.style.left = left + "px";
}
function closeMenus() {
  document.querySelectorAll(".ptt-menu").forEach(function (m) { m.hidden = true; });
}
document.querySelectorAll(".listwrap, .hitwrap").forEach(function (box) {
  box.addEventListener("scroll", closeMenus, true);
});
window.addEventListener("resize", closeMenus);
// Delegate from the document so Read more / Show less works in both panes.
document.addEventListener("click", function (e) {
  const dots = e.target.closest(".ptt-dots");
  if (dots) {
    e.stopPropagation();
    const menu = dots.parentElement.querySelector(".ptt-menu");
    const open = menu.hidden;
    closeMenus();
    if (open) placeMenu(menu, dots);
    return;
  }
  const editBtn = e.target.closest(".ptt-edit");
  if (editBtn) {
    const more = editBtn.closest(".ptt-more");
    const dotsBtn = more.querySelector(".ptt-dots");
    const row = editBtn.closest(".ptt-row");
    const txt = row.querySelector(".ptt-txt");
    closeMenus();
    const box = document.createElement("textarea");
    box.className = "ptt-editbox";
    box.value = dotsBtn.dataset.text || "";
    txt.replaceChildren(box);
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    txt.appendChild(save);
    txt.appendChild(cancel);
    cancel.onclick = function () { seek($("q").value); };
    save.onclick = function () {
      const rk = dotsBtn.dataset.rk;
      const kind = dotsBtn.dataset.kind;
      const text = box.value;
      const msg = rk.indexOf("recycle:") === 0
        ? { type: "update-recycle-text", id: Number(rk.slice(8)), text: text }
        : { type: "update-node-text", recordKey: rk, kind: kind, text: text };
      chrome.runtime.sendMessage(msg, function () {
        void chrome.runtime.lastError;
        applyEditedText(rk, kind, text);
        seek($("q").value);
      });
    };
    return;
  }
  const likeBtn = e.target.closest(".ptt-like, .ptt-unlike");
  if (likeBtn) {
    const more = likeBtn.closest(".ptt-more");
    const dotsBtn = more && more.querySelector(".ptt-dots");
    closeMenus();
    if (!dotsBtn) return;
    const nodeEl = likeBtn.closest(".ptt-node");
    const nid = dotsBtn.dataset.nid || (nodeEl && nodeEl.dataset.nid) || "";
    const hit = findByNid(nid);
    const rk = (hit && hit.node && hit.node.recordKey) || dotsBtn.dataset.rk || "";
    const kind = (hit && hit.kind) || dotsBtn.dataset.kind || "ask";
    const liked = likeBtn.classList.contains("ptt-like");
    const ck = (nodeEl && nodeEl.dataset.ck) || nidToConvKey.get(nid) || "";
    if (!rk) { $("status").textContent = "Like failed: no record for " + nid; return; }
    if (hit && hit.node) hit.node.liked = liked;
    if (ck) openChats.add(ck);
    chrome.runtime.sendMessage({ type: "set-liked", recordKey: rk, kind: kind, liked: liked }, function (res) {
      const err = chrome.runtime.lastError;
      const again = findByNid(nid);
      if (again && again.node) again.node.liked = liked;
      if (ck) openChats.add(ck);
      seek($("q").value);
      $("status").textContent = err
        ? ("Like not saved: " + err.message)
        : ((liked ? "Liked " : "Unliked ") + nid + (res && res.updated === false ? " (not in DB)" : ""));
    });
    return;
  }
  if (e.target.closest(".ptt-del")) {
    const more = e.target.closest(".ptt-more");
    const dotsBtn = more && more.querySelector(".ptt-dots");
    closeMenus();
    if (!dotsBtn) return;
    const rk = dotsBtn.dataset.rk || "";
    if (rk.indexOf("recycle:") === 0) return;
    chrome.runtime.sendMessage({ type: "recycle-node", recordKey: rk, kind: dotsBtn.dataset.kind }, function () {
      void chrome.runtime.lastError;
      loadLazy();
    });
    return;
  }
  const msgToggle = e.target.closest(".msg-toggle");
  if (msgToggle) {
    e.preventDefault();
    e.stopPropagation();
    const nid = String(msgToggle.dataset.foldId || "");
    if (!nid) return;
    const clickedContent = msgToggle.closest(".ptt-node, tr.item-row");
    const localContent = clickedContent && clickedContent.querySelector('.msg-content[data-fold-id="' + CSS.escape(nid) + '"]');
    const expanded = localContent ? localContent.dataset.expanded !== "1" : !messageIsExpanded(nid, nidToConvKey.get(nid), parseSearch($("q").value).tokens);
    messageFoldOverrides.set(nid, expanded);
    if (expanded) expandedMessageNids.add(nid);
    else expandedMessageNids.delete(nid);
    saveUiState("expanded:" + nid, expanded);

    // Apply the same state to every currently rendered copy in both panes.
    const tokens = parseSearch($("q").value).tokens;
    document.querySelectorAll(".msg-content").forEach(function (content) {
      if (String(content.dataset.foldId || "") !== nid) return;
      const text = content.dataset.text || "";
      content.dataset.expanded = expanded ? "1" : "0";
      const titlePane = !!content.closest("#titleView");
      content.innerHTML = messageShownHtml(text, tokens, nid, expanded, nidToConvKey.get(nid), titlePane);
    });
    document.querySelectorAll(".msg-toggle").forEach(function (toggle) {
      if (String(toggle.dataset.foldId || "") !== nid) return;
      toggle.textContent = expanded ? "Show less" : "Read more";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
    return;
  }
  const gapBtnEl = e.target.closest(".ptt-gap");
  if (gapBtnEl) {
    e.preventDefault();
    e.stopPropagation();
    const node = gapBtnEl.closest(".ptt-node");
    const nid = node && node.dataset.nid;
    const convKey = node && node.dataset.ck;
    const gap = nid && convKey ? gapAfter(nid, convKey) : null;
    if (!gap) return;
    const tokens = parseSearch($("q").value).tokens;
    if (openedGaps.has(gap.key)) {
      openedGaps.delete(gap.key);
      document.querySelectorAll(".ptt-node").forEach(function (el) {
        if (el.dataset.gapKey === gap.key) el.remove();
      });
    } else {
      openedGaps.add(gap.key);
      const template = document.createElement("template");
      template.innerHTML = gap.nids.map(function (n) { return nodeHtmlFor(n, convKey, tokens); }).join("");
      template.content.querySelectorAll(".ptt-node").forEach(function (el) { el.dataset.gapKey = gap.key; });
      node.after(template.content);
    }
    gapBtnEl.title = (openedGaps.has(gap.key) ? "Fold" : "Unfold") + " " + gap.count + " non-hit item(s) before the next hit";
    return;
  }
  if (e.target.closest(".ptt-tog")) { onTreeToggle(e); return; }
  const pttNode = e.target.closest(".ptt-node");
  if (pttNode && pttNode.dataset.nid) {
    hitNavFresh = 1;
    selectItemByNid(pttNode.dataset.nid, false);
    return;
  }
  const itemRow = e.target.closest("tr.item-row");
  if (itemRow && itemRow.dataset.nid) {
    hitNavFresh = 1;
    selectItemByNid(itemRow.dataset.nid, false);
    return;
  }
  const chatModeBtn = e.target.closest(".chat-unfold-mode");
  if (chatModeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const ck = String(chatModeBtn.dataset.ck || "");
    if (!ck) return;
    const nextMode = (chatUnfoldModes.get(ck) || "hit") === "hit" ? "all" : "hit";
    chatUnfoldModes.set(ck, nextMode);
    // The Hit/All policy controls which lines are shown; it must not erase
    // the user's explicit expanded/collapsed choice for individual messages.
    seek($("q").value);
    return;
  }
  const ans = e.target.closest(".ansfold");
  if (ans) {
    const ck = ans.dataset.ck;
    if (openAns.has(ck)) openAns.delete(ck);
    else openAns.add(ck);
    seek($("q").value);
    return;
  }
  const fold = e.target.closest(".fold");
  if (fold) {
    const ck = String(fold.dataset.ck || "");
    if (!ck) return;
    const bar = fold.closest("tr[data-id][data-ck]");
    let detail = bar && bar.nextElementSibling;
    if (!detail || !detail.classList.contains("cmt-row") || String(detail.dataset.ck || "") !== ck) detail = null;
    if (openChats.has(ck)) {
      openChats.delete(ck);
      if (detail) detail.hidden = true;
      fold.textContent = "+";
    } else {
      openChats.add(ck);
      if (detail) {
        detail.hidden = false;
      } else if (bar) {
        const session = matched.find(function (r) { return String(r.convKey) === ck; });
        if (session) {
          const tokens = parseSearch($("q").value).tokens;
          bar.insertAdjacentHTML("afterend", '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6">' + askBlock(session, viewAsks(ck), tokens) + "</td></tr>");
        }
      }
      fold.textContent = "\u2212";
    }
    return;
  }
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  selectedId = Number(tr.dataset.id);
  document.querySelectorAll("#titleView tr[data-id], #dateTimeView tr[data-id]").forEach(function (x) {
    x.classList.toggle("sel", Number(x.dataset.id) === selectedId);
  });
});

$("hitBody").addEventListener("click", function (e) {
  const tr = e.target.closest("tr[data-hi]");
  if (!tr) return;
  document.querySelectorAll("#hitBody tr").forEach((x) => x.classList.remove("on"));
  tr.classList.add("on");
  hitCursor = Number(tr.dataset.hi);
});
$("hitBody").addEventListener("dblclick", function (e) {
  const tr = e.target.closest("tr[data-hi]");
  if (!tr) return;
  jumpHit(Number(tr.dataset.hi));
});

$("thHitDt").addEventListener("click", function () {
  hitSort = hitSort === "ts-desc" ? "ts-asc" : "ts-desc";
  delSort = "";
  paintHits(parseSearch($("q").value).tokens);
});

function showMiddleMode(mode) {
  middleMode = mode;
  $("titleView").hidden = mode !== "ptt";
  $("dateTimeView").hidden = mode !== "item";
  updateHeaderIndicators();
}

$("thDateTime").addEventListener("click", function () {
  showMiddleMode("item");
  if (selectedNid) jumpToItemByNid(selectedNid, true, "head");
  else if (!datetimeItems.length) renderItemMode(parseSearch($("q").value).tokens);
});

$("thTitle").addEventListener("click", function () {
  showMiddleMode("ptt");
  if (selectedNid) jumpToItemByNid(selectedNid, true, "head");
});

function jumpToItemByNid(nid, scroll = true, scrollMode = "center") {
  if (!nid) return;

  const ck = findConvForNid(nid);
  if (!ck) return;
  revealChat(ck);

  const tokens = parseSearch($("q").value).tokens;
  if (middleMode === "item") {
    const existing = $("dateTimeView").querySelector('[data-nid="' + CSS.escape(nid) + '"]');
    if (existing) {
      selectItemByNid(nid, scroll, scrollMode);
      return;
    }
    renderDateTimeWindow(nid, scroll, scrollMode);
    return;
  }

  const tb = $("titleView");
  const existingTitleNode = tb.querySelector('[data-nid="' + CSS.escape(nid) + '"]');
  if (existingTitleNode) {
    selectItemByNid(nid, scroll, scrollMode);
    return;
  }

  // PTT / title view:
  // Find the SESSION containing the target item.
  const sessionIndex = matched.findIndex(
    (r) => r.convKey === ck
  );

  if (sessionIndex < 0) return;

  // Expand the correct parent before rendering.
  openChats.add(ck);

  // Render enough session rows to include the target parent.
  const end = Math.min(
    matched.length,
    Math.max(
      PAGE,
      Math.ceil((sessionIndex + 1) / PAGE) * PAGE
    )
  );

  tb.innerHTML = "";

  if (end > 0) {
    tb.insertAdjacentHTML(
      "beforeend",
      matched.slice(0, end).map(rowHtml).join("")
    );
  }

  shown = end;

  $("empty").hidden = matched.length > 0;
  $("status").textContent =
    shown + " of " + matched.length + " shown";

  updateHeaderIndicators();

  // Wait until the target node exists in the rendered DOM.
  requestAnimationFrame(() => {
    selectItemByNid(nid, scroll, scrollMode);
  });
}

$("dispMode").addEventListener("change", function () {
  dispStyle = this.value === "flat" ? "flat" : "ptt";
  seek($("q").value);
});
$("thDelDt").addEventListener("click", function () {
  delSort = delSort === "del-desc" ? "del-asc" : "del-desc";
  hitList.sort(function (a, b) { return delSort === "del-desc" ? (b.deletedAt || 0) - (a.deletedAt || 0) : (a.deletedAt || 0) - (b.deletedAt || 0); });
  const th = $("thDelDt");
  if (th) th.textContent = "del datetime" + (delSort === "del-desc" ? " ↓" : " ↑");
  paintHits(parseSearch($("q").value).tokens);
});
function selectedNodeTs() {
  if (!selectedNid) return null;
  const hit = findByNid(selectedNid);
  if (hit && hit.node && hit.node.ts) return hit.node.ts;
  const it = datetimeItems.find(function (x) {
    return (x.kind + "-" + (x.recordKey || x.localIndex)) === selectedNid;
  });
  return it ? it.ts : null;
}
function hitsByTime() {
  const seen = new Set();
  return hitList
    .filter(function (h) {
      if (seen.has(h.nid)) return false;
      seen.add(h.nid);
      return true;
    })
    .slice()
    .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
}
function jumpToHit(h) {
  if (!h) return;
  hitNavNid = h.nid;
  const i = hitList.findIndex(function (x) { return x.nid === h.nid; });
  if (i >= 0) jumpHit(i);
}
function stepUniqueHit(delta) {
  const list = hitsByTime();
  if (!list.length) return;
  let i = list.findIndex(function (h) { return h.nid === hitNavNid; });
  if (i < 0 && hitCursor >= 0 && hitList[hitCursor]) {
    i = list.findIndex(function (h) { return h.nid === hitList[hitCursor].nid; });
  }
  if (i < 0) i = delta > 0 ? -1 : list.length;
  const next = list[i + delta];
  if (next) jumpToHit(next);
}
$("prevHit").onclick = function () {
  if (hitNavFresh === 1) {
    hitNavFresh = 0;
    const ts = selectedNodeTs();
    const list = hitsByTime();
    if (ts == null) { stepUniqueHit(-1); return; }
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      if ((list[i].ts || 0) <= ts && list[i].nid !== selectedNid) prev = list[i];
      else if ((list[i].ts || 0) > ts) break;
    }
    jumpToHit(prev);
    return;
  }
  stepUniqueHit(-1);
};
$("nextHit").onclick = function () {
  if (hitNavFresh === 1) {
    hitNavFresh = 0;
    const ts = selectedNodeTs();
    const list = hitsByTime();
    if (ts == null) { stepUniqueHit(1); return; }
    const next = list.find(function (h) { return (h.ts || 0) > ts; });
    jumpToHit(next);
    return;
  }
  stepUniqueHit(1);
};
$("prevItem").onclick = function () { jumpItem(-1); };
$("nextItem").onclick = function () { jumpItem(1); };
$("foldAsksBtn").onclick = function () { batchAskOpen = false; matched.forEach((r) => openChats.delete(r.convKey)); seek($("q").value); };
$("unfoldAsksBtn").onclick = function () { batchAskOpen = true; matched.forEach((r) => openChats.add(r.convKey)); seek($("q").value); };
$("foldAnsBtn").onclick = function () { batchAnsOpen = false; openAns.clear(); forceOpenAsk.clear(); seek($("q").value); };
$("unfoldAnsBtn").onclick = function () { batchAnsOpen = true; matched.forEach((r) => openAns.add(r.convKey)); seek($("q").value); };

if (0) document.querySelector(".listwrap").addEventListener("scroll", function (e) {
  const el = e.target;
  if (middleMode === "item") {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) enforceSlidingWindow("down");
    else if (el.scrollTop < 80) enforceSlidingWindow("up");
  } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && shown < matched.length) {
    renderSlice(false);
  }
});

if (0) document.addEventListener("keydown", function (e) {
  if (e.key === "PageUp") {
    if (middleMode === "item") {
      const wrap = document.querySelector(".listwrap");
      if (wrap && wrap.scrollTop <= 80) {
        e.preventDefault();
        appendDateTimeBatch("up");
      }
    }
  }
});

function patternLen(q) {
  let s = String(q == null ? "" : q);
  if ($("rawSearch") && $("rawSearch").checked) return s.length;
  s = s.replace(/"urlid\s+[^"]*"/ig, " ");
  s = s.replace(/(^|\s)urlid:\S+/ig, " ");
  s = s.replace(/"/g, "");
  return s.trim().length;
}
let searchTimer = null;
let flickerTimer = null;
function flickerShort() {
  clearTimeout(flickerTimer);
  const el = $("status");
  const msg = "search pattern string length leq 3, need to press enter key";
  el.textContent = msg;
  let n = 0;
  const tick = function () {
    el.style.background = n % 2 === 0 ? "#7a0000" : "";
    n += 1;
    if (n < 6) flickerTimer = setTimeout(tick, 280);
    else el.style.background = "";
  };
  tick();
}
function scheduleSearchFromControls() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () { seek($("q").value); }, 120);
}
function bindSearchRelation() {
  const andBox = $("searchAnd");
  const orBox = $("searchOr");
  if (!andBox || !orBox) return;
  andBox.addEventListener("change", function () {
    if (andBox.checked) orBox.checked = false;
    seek($("q").value);
  });
  orBox.addEventListener("change", function () {
    if (orBox.checked) andBox.checked = false;
    seek($("q").value);
  });
}
bindSearchRelation();
$("rawSearch").addEventListener("change", function () {
  saveUiState("rawSearch", $("rawSearch").checked);
  seek($("q").value);
});
["searchFirstN", "searchLastN", "minLines", "maxLines"].forEach(function (id) {
  $(id).addEventListener("input", scheduleSearchFromControls);
  $(id).addEventListener("change", scheduleSearchFromControls);
});
$("q").addEventListener("input", function () {
  clearTimeout(searchTimer);
  const n = patternLen($("q").value);
  if (n <= 3 && n >= 1) { flickerShort(); return; }
  if (n > 3 || n === 0) searchTimer = setTimeout(function () { seek($("q").value); }, 500);
});
$("q").addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  clearTimeout(searchTimer);
  seek($("q").value);
});
$("q").addEventListener("focus", function () { $("qHist").style.display = searchHist.length ? "block" : "none"; });
$("q").addEventListener("blur", function () { setTimeout(function () { $("qHist").style.display = "none"; pushHist($("q").value); }, 180); });
$("qHist").addEventListener("mousedown", function (e) {
  const d = e.target.closest("div");
  if (!d) return;
  $("q").value = d.textContent;
  seek($("q").value);
});
document.querySelector(".side").addEventListener("click", function (e) {
  const el = e.target.closest("[data-filter]");
  if (!el) return;
  document.querySelectorAll(".side [data-filter]").forEach(function (x) { x.classList.remove("on"); });
  el.classList.add("on");
  filter = el.dataset.filter;
  seek($("q").value);
});

function bindCheck(id, labelId, apply, key) {
  const box = $(id);
  const lab = $(labelId);
  function paint(on) {
    apply(!!on);
    box.checked = !!on;
    lab.textContent = on ? "on" : "off";
  }
  box.addEventListener("change", function () {
    paint(box.checked);
    const o = {};
    o[key] = box.checked;
    chrome.storage.local.set(o);
    seek($("q").value);
  });
  return paint;
}
const paintOnMsg = bindCheck("showOnMsg", "showOnMsgLabel", function (v) { showOnMsg = v; syncSourceFlags(); }, "showOnMsg");
const paintSei = bindCheck("showSei", "showSeiLabel", function (v) { showSei = v; syncSourceFlags(); }, "showSei");
const paintSeo = bindCheck("showSeo", "showSeoLabel", function (v) { showSeo = v; syncSourceFlags(); }, "showSeo");
const paintAsk = bindCheck("showAsk", "showAskLabel", function (v) { showAsk = v; syncSourceFlags(); }, "showAsk");
const paintAns = bindCheck("showAns", "showAnsLabel", function (v) { showAns = v; syncSourceFlags(); }, "showAns");

chrome.storage.local.get({ showOnMsg: false, showSei: false, showSeo: false, showAsk: false, showAns: false, liveAskSort: "ts-asc", explorerSearchHist: [], explorerFromHist: [], explorerToHist: [], explorerFromValue: "", explorerToValue: "" }).then(function (bag) {
  paintOnMsg(bag.showOnMsg);
  paintSei(bag.showSei);
  paintSeo(bag.showSeo);
  paintAsk(bag.showAsk);
  paintAns(bag.showAns);
  liveSort = bag.liveAskSort === "ts-desc" ? "ts-desc" : "ts-asc";
  $("liveSort").value = liveSort;
  searchHist = Array.isArray(bag.explorerSearchHist) ? bag.explorerSearchHist.slice(0, 40) : [];
  fromHist = Array.isArray(bag.explorerFromHist) ? bag.explorerFromHist.slice(0, 20) : [];
  toHist = Array.isArray(bag.explorerToHist) ? bag.explorerToHist.slice(0, 20) : [];
  if ($("fromBox")) $("fromBox").value = bag.explorerFromValue || "";
  if ($("toBox")) $("toBox").value = bag.explorerToValue || "";
  paintHist();
  paintTimeHist("from");
  paintTimeHist("to");
  seek($("q").value);
});
$("liveSort").addEventListener("change", function () {
  liveSort = $("liveSort").value;
  chrome.storage.local.set({ liveAskSort: liveSort });
  seek($("q").value);
});

$("reloadBtn").onclick = function () { loadLazy(); };
$("delBtn").onclick = async function () {
  if (!selectedId) return;
  await chrome.runtime.sendMessage({ type: "delete-record", id: selectedId });
  selectedId = null;
  await loadLazy();
};

$("exportBtn").onclick = async function () {
  const payload = { records: await getAll(), asks: [], answers: [] };
  asksByConv.forEach(function (list) {
    list.forEach(function (c) {
      const copy = Object.assign({}, c);
      delete copy.answers;
      payload.asks.push(copy);
      payload.answers.push.apply(payload.answers, c.answers || []);
    });
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ai-chat-ask-log.json";
  a.click();
};
$("importBtn").onclick = function () { $("fileInput").click(); };
$("fileInput").onchange = async function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  const recs = Array.isArray(data) ? data : (data.records || []);
  const asks = Array.isArray(data) ? [] : (data.asks || []);
  const answers = Array.isArray(data) ? [] : (data.answers || []);
  const db = await openDb();
  const names = [STORE, ASK_STORE];
  if (db.objectStoreNames.contains(ANSWER_STORE)) names.push(ANSWER_STORE);
  await new Promise(function (resolve, reject) {
    const tx = db.transaction(names, "readwrite");
    const rs = tx.objectStore(STORE);
    const as = tx.objectStore(ASK_STORE);
    recs.forEach(function (row) {
      const rest = Object.assign({}, row);
      delete rest.id;
      if (!rest.convKey && rest.platform && rest.conversationId) rest.convKey = rest.platform + "|" + rest.conversationId;
      if (rest.convKey) rs.put(rest);
    });
    asks.forEach(function (a) {
      if (!a.recordKey) return;
      a.source = "import";
      as.put(a);
    });
    if (names.indexOf(ANSWER_STORE) >= 0) {
      const ns = tx.objectStore(ANSWER_STORE);
      answers.forEach(function (a) {
        if (!a.recordKey) return;
        a.source = "import";
        ns.put(a);
      });
    }
    tx.oncomplete = resolve;
    tx.onerror = function () { reject(tx.error); };
  });
  e.target.value = "";
  await loadLazy();
};

function bindColResize() {
  document.querySelectorAll(".grip").forEach(function (g) {
    g.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      const th = document.getElementById(g.dataset.col);
      const startX = ev.clientX;
      const startW = th.getBoundingClientRect().width;
      function move(e) {
        th.style.width = Math.max(80, startW + (e.clientX - startX)) + "px";
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  });
}
bindColResize();

(function bindInvalidateLowerPane() {
  const checkbox = $("invalidateLowerPane");
  if (!checkbox) return;
  const split = $("hSplit");
  const pane = $("hitsPane");
  const storageKey = "aiChatExplorerInvalidateLowerPane";
  function apply() {
    const disabled = checkbox.checked;
    if (split) split.style.display = disabled ? "none" : "";
    if (pane) pane.style.display = disabled ? "none" : "";
    if (disabled) $("hitBody").innerHTML = "";
    else paintHits(parseSearch($("q").value).tokens);
  }
  try {
    chrome.storage.local.get(storageKey, function (bag) {
      checkbox.checked = bag[storageKey] === true;
      apply();
    });
  } catch (_) { apply(); }
  checkbox.addEventListener("change", function () {
    apply();
    try { chrome.storage.local.set({ [storageKey]: checkbox.checked }); } catch (_) {}
  });
})();

(function bindHSplit() {
  const split = $("hSplit");
  const pane = $("hitsPane");
  split.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = pane.getBoundingClientRect().height;
    function move(e) {
      pane.style.height = Math.max(60, startH - (e.clientY - startY)) + "px";
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
})();

function pushTimeHist(which, value) {
  const s = String(value || "").trim();
  if (!s) return;
  const storeKey = which === "from" ? "explorerFromHist" : "explorerToHist";
  let arr = which === "from" ? fromHist : toHist;
  arr = arr.filter((x) => x !== s);
  arr.unshift(s);
  arr = arr.slice(0, 20);
  if (which === "from") fromHist = arr;
  else toHist = arr;
  const o = {};
  o[storeKey] = arr;
  try { chrome.storage.local.set(o); } catch (_) {}
  paintTimeHist(which);
}
function paintTimeHist(which) {
  const box = $(which === "from" ? "fromHist" : "toHist");
  const arr = which === "from" ? fromHist : toHist;
  if (!box) return;
  box.innerHTML = arr.map((s) => "<div>" + esc(s) + "</div>").join("");
}
function saveTimeValue(which, value) {
  const key = which === "from" ? "explorerFromValue" : "explorerToValue";
  const o = {};
  o[key] = String(value || "");
  try { chrome.storage.local.set(o); } catch (_) {}
}
function bindTimeBox(which) {
  const box = $(which === "from" ? "fromBox" : "toBox");
  const hist = $(which === "from" ? "fromHist" : "toHist");
  const cal = $(which === "from" ? "fromCal" : "toCal");
  const picker = $(which === "from" ? "fromPicker" : "toPicker");
  box.addEventListener("focus", function () { hist.style.display = (which === "from" ? fromHist : toHist).length ? "block" : "none"; });
  box.addEventListener("blur", function () {
    setTimeout(function () { hist.style.display = "none"; pushTimeHist(which, box.value); saveTimeValue(which, box.value); }, 180);
  });
  box.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { saveTimeValue(which, box.value); seek($("q").value); }, 120);
  });
  hist.addEventListener("mousedown", function (e) {
    const d = e.target.closest("div");
    if (!d) return;
    box.value = d.textContent;
    saveTimeValue(which, box.value);
    seek($("q").value);
  });
  function openCal() {
    if (box.value && /^\d{4}-\d{2}-\d{2}/.test(box.value)) picker.value = box.value.slice(0, 10);
    if (picker.showPicker) picker.showPicker();
    else picker.click();
  }
  cal.addEventListener("click", openCal);
  box.addEventListener("click", openCal);
  picker.addEventListener("change", applyPicker);
  picker.addEventListener("input", applyPicker);
  function applyPicker() {
    box.value = picker.value || "";
    saveTimeValue(which, box.value);
    if (box.value) pushTimeHist(which, box.value);
    seek($("q").value);
  }
  const clr = $(which === "from" ? "fromClr" : "toClr");
  clr.addEventListener("click", function () {
    box.value = "";
    picker.value = "";
    saveTimeValue(which, "");
    seek($("q").value);
  });
}
bindTimeBox("from");
bindTimeBox("to");

void initializeUiStateAndLoad();

let sideRoutes = [];
let sideTarget = null;
function paintSideRoutes() {
  document.querySelectorAll(".side .extra-route").forEach((el) => el.remove());
  const side = document.querySelector(".side");
  sideRoutes.forEach(function (item) {
    const div = document.createElement("div");
    div.className = "extra-route";
    div.dataset.filter = item.id;
    div.dataset.extra = "1";
    div.textContent = item.name;
    if (filter === item.id) div.classList.add("on");
    side.appendChild(div);
  });
}
chrome.storage.local.get("sideRoutes", function (bag) {
  sideRoutes = Array.isArray(bag.sideRoutes) ? bag.sideRoutes : [];
  paintSideRoutes();
});

// Export/import only user-created sidebar items (sideRoutes). Built-in filters
// such as All chats, ChatGPT, Gemini, Grok, favorites, and recycle are defined
// in explorer.html and are intentionally not part of this backup.
$("exportSideBtn").addEventListener("click", function () {
  const payload = {
    format: "ai-chat-logger-side-pane",
    version: 1,
    sideRoutes: sideRoutes.map(function (item) {
      return { id: item.id, name: item.name, text: item.text || "" };
    })
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ai-chat-logger-side-pane.json";
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
});

$("importSideBtn").addEventListener("click", function () {
  $("sideFileInput").click();
});

$("sideFileInput").addEventListener("change", async function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : data && data.sideRoutes;
    if (!Array.isArray(imported)) {
      throw new Error("This JSON does not contain a sideRoutes array.");
    }

    const seenIds = new Set();
    const clean = [];
    imported.forEach(function (item, index) {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !item.name.trim()) return;
      let id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
      if (!id || seenIds.has(id)) id = "route-import-" + Date.now() + "-" + index;
      seenIds.add(id);
      clean.push({ id: id, name: item.name.trim(), text: typeof item.text === "string" ? item.text : "" });
    });

    if (clean.length !== imported.length) {
      const ok = confirm("The file contains " + imported.length + " entries, but only " + clean.length + " valid sidebar items. Import the valid items anyway?");
      if (!ok) return;
    } else if (!confirm("Replace the current " + sideRoutes.length + " custom sidebar item(s) with " + clean.length + " item(s) from this file? Built-in filters and conversation data will not be changed.")) {
      return;
    }

    await new Promise(function (resolve, reject) {
      chrome.storage.local.set({ sideRoutes: clean }, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    sideRoutes = clean;
    if (filter !== "all" && !["chatgpt", "gemini", "grok", "favorites", "recycle"].includes(filter) && !sideRoutes.some(function (item) { return item.id === filter; })) {
      filter = "all";
      document.querySelectorAll(".side [data-filter]").forEach(function (el) {
        el.classList.toggle("on", el.dataset.filter === "all");
      });
    }
    paintSideRoutes();
    seek($("q").value);
    alert("Imported " + clean.length + " custom sidebar item(s).");
  } catch (err) {
    alert("Side Pane import failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    e.target.value = "";
  }
});
document.querySelector(".side").addEventListener("contextmenu", function (e) {
  e.preventDefault();
  sideTarget = e.target.closest("[data-filter]");
  $("sideAdd").hidden = false;
  $("sideConfig").hidden = !(sideTarget && sideTarget.dataset.extra === "1");
  $("sideDelete").hidden = !(sideTarget && sideTarget.dataset.extra === "1");
  const menu = $("sideMenu");
  menu.hidden = false;
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
});
// YouTube-style copy behavior: when a user selects text in a folded message,
// Ctrl+C copies the canonical full message text rather than only the visible preview.
if (0) document.addEventListener("copy", function (e) {
  const selection = window.getSelection && window.getSelection();
  if (!selection || selection.isCollapsed || !e.clipboardData) return;

  function containingMessage(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return el && el.closest ? el.closest(".msg-content") : null;
  }

  const startMessage = containingMessage(selection.anchorNode);
  const endMessage = containingMessage(selection.focusNode);
  if (!startMessage || startMessage !== endMessage || startMessage.dataset.expanded === "1") return;

  // Only override copying when the selection is inside one collapsed message.
  const fullText = startMessage.dataset.text;
  if (typeof fullText !== "string") return;
  e.clipboardData.setData("text/plain", fullText);
  e.preventDefault();
});

document.addEventListener("click", function () { $("sideMenu").hidden = true; });
$("sideAdd").addEventListener("click", function () {
  const name = prompt("Item name");
  if (!name) return;
  sideRoutes.push({ id: "route-" + Date.now(), name: name.trim(), text: "" });
  chrome.storage.local.set({ sideRoutes: sideRoutes });
  paintSideRoutes();
});
$("sideConfig").addEventListener("click", function () {
  if (!sideTarget) return;
  const item = sideRoutes.find((x) => x.id === sideTarget.dataset.filter);
  if (!item) return;
  $("routeTitle").textContent = item.name;
  $("routeText").value = item.text || "";
  $("routeBox").hidden = false;
  $("routeBox").dataset.id = item.id;
});
$("routeSave").addEventListener("click", function () {
  const item = sideRoutes.find((x) => x.id === $("routeBox").dataset.id);
  if (!item) return;
  item.text = $("routeText").value;
  chrome.storage.local.set({ sideRoutes: sideRoutes });
  $("routeBox").hidden = true;
});
$("routeClose").addEventListener("click", function () { $("routeBox").hidden = true; });
$("sideDelete").addEventListener("click", function () {
  if (!sideTarget) return;
  sideRoutes = sideRoutes.filter((x) => x.id !== sideTarget.dataset.filter);
  chrome.storage.local.set({ sideRoutes: sideRoutes });
  paintSideRoutes();
});

 let isScrollFetching = false;

document.querySelector(".listwrap").addEventListener("scroll", function (e) {
  const el = e.target;
  
  if (middleMode === "item") {
    if (isScrollFetching) return;

    const scrollPercentage = (el.scrollTop + el.clientHeight) / el.scrollHeight;
    
    // Trigger when user scrolls past 95%
    if (scrollPercentage >= 0.99) {
      if (dtEnd < datetimeItems.length) {
        isScrollFetching = true;
        enforceSlidingWindow("down");
        
        // --- BREAK THE LOOP: Nudge scroll position up to ~85% ---
        // This drops the percentage below 95%, so it won't auto-trigger again 
        // until the user actively scrolls down further.
        setTimeout(() => {
          el.scrollTop -=200;
          isScrollFetching = false;
        }, 0);
      }
    } 
    // Trigger when user scrolls near the top
    else if (el.scrollTop <= 80) {
      if (dtStart > 0) {
        isScrollFetching = true;
        enforceSlidingWindow("up");
        
        setTimeout(() => {
          el.scrollTop += 150; // Nudge down slightly so it doesn't spam top triggers
          isScrollFetching = false;
        }, 50);
      }
    }
  } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && shown < matched.length) {
  
  // renderSlice(false);   ---this is needed by the title pane,   if without this , title pane 's down scroll appending becomes stutter . ---by jcx
   renderSlice(false);
  }
});
 
const MAX_WINDOW = 300; // Can safely handle small or large windows now

 let isSliding = false;

function enforceSlidingWindow(direction) {
  if (isSliding) return;
  isSliding = true;

  try {
    if (middleMode !== "item" || !datetimeItems.length) return;

    const tb = $("dateTimeView");
    const wrap = document.querySelector(".listwrap");
    const tokens = parseSearch($("q").value).tokens;

    if (datetimeItems.length <= MAX_WINDOW) {
      if (dtStart !== 0 || dtEnd !== datetimeItems.length) {
        dtStart = 0;
        dtEnd = datetimeItems.length;
        tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
      }
      return;
    }

    if (direction === "down") {
      if (dtEnd < datetimeItems.length) {
        dtEnd = Math.min(datetimeItems.length, dtEnd + DT_BATCH);

        // Enforce maximum window size by shifting dtStart forward if needed.
        if (dtEnd - dtStart > MAX_WINDOW) {
          dtStart = dtEnd - MAX_WINDOW;
        }

        tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
      }
    } else if (direction === "up") {
      if (dtStart > 0) {
        const beforeHeight = wrap ? wrap.scrollHeight : 0;

        dtStart = Math.max(0, dtStart - DT_BATCH);

        // Enforce maximum window size by shifting dtEnd backward if needed.
        if (dtEnd - dtStart > MAX_WINDOW) {
          dtEnd = dtStart + MAX_WINDOW;
        }

        tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);

        if (wrap) {
          wrap.scrollTop += wrap.scrollHeight - beforeHeight;
        }
      } else {
         //refreshDateTimeHead();
        return;
      }
    }

    $("status").textContent =  
      `  Showing items ${dtStart} to ${dtEnd} of ${datetimeItems.length} (Sliding window active)`;

  } finally {
    isSliding = false;
    console.log("--> enforceSlidingWindow finished: isSliding =", isSliding);
  }
}

// Ctrl-hover popup: parent session, site, and exact hovered item information.
(function initCtrlHoverChatInfo() {
  const popup = document.createElement("div");
  popup.id = "ctrlHoverChatInfo";
  Object.assign(popup.style, {
    position: "fixed", zIndex: "99999", display: "none",
    maxWidth: "min(560px, calc(100vw - 24px))",
    maxHeight: "min(70vh, calc(100vh - 24px))", overflow: "auto",
    padding: "9px 12px", border: "1px solid #777", borderRadius: "5px",
    background: "#fffbe6", color: "#222", boxShadow: "0 2px 8px rgba(0,0,0,.28)",
    font: '13px/1.4 "Segoe UI", Tahoma, sans-serif',
    whiteSpace: "normal", overflowWrap: "anywhere", pointerEvents: "none"
  });
  const lines = {};
  function addLine(key, strong) {
    const line = document.createElement("div");
    if (strong) line.style.fontWeight = "700";
    lines[key] = line;
    popup.appendChild(line);
  }
  addLine("session", true); addLine("chatId", false); addLine("site", false); addLine("siteUrl", false);
  const separator = document.createElement("div");
  separator.textContent = "────────────────────────";
  separator.style.color = "#aaa";
  popup.appendChild(separator);
  addLine("itemTitle", true); addLine("itemText", false); addLine("kind", false);
  addLine("nid", false); addLine("convKey", false); addLine("recordKey", false);
  document.body.appendChild(popup);

  let lastX = 0, lastY = 0, lastItemKey = null;
  function findSession(convKey) {
    if (!convKey) return null;
    for (const source of [matched, rows, recycleChats]) {
      const session = source.find((item) => item && item.convKey === convKey);
      if (session) return session;
    }
    return null;
  }
  function setLine(key, label, value) {
    lines[key].textContent = label + ": " + (value == null || value === "" ? "(not available)" : String(value));
  }
  function findItemRecord(convKey, nid) {
    if (!convKey || !nid) return null;
    for (const ask of viewAsks(convKey)) {
      const askKind = isOnMsg(ask) ? "onMsg" : "ask";
      if (askNidPrefix(ask) + "-" + (ask.recordKey || ask.localIndex) === nid) {
        return { kind: askKind, recordKey: ask.recordKey, text: ask.text, localIndex: ask.localIndex };
      }
      for (const answer of (ask.answers || [])) {
        if (answerNidPrefix(answer) + "-" + (answer.recordKey || answer.localIndex) === nid) {
          return { kind: "answer", recordKey: answer.recordKey, text: answer.text, localIndex: answer.localIndex };
        }
      }
    }
    return null;
  }
  function hide() { popup.style.display = "none"; lastItemKey = null; }
  function position(x, y) {
    const gap = 14;
    popup.style.left = "0px"; popup.style.top = "0px";
    const rect = popup.getBoundingClientRect();
    let left = x + gap, top = y + gap;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - gap;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - gap;
    popup.style.left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)) + "px";
    popup.style.top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)) + "px";
  }
  function updateFromPoint(x, y, ctrlHeld) {
    lastX = x; lastY = y;
    if (!ctrlHeld) { hide(); return; }
    const target = document.elementFromPoint(x, y);
    const wrap = target && target.closest(".listwrap");
    const item = wrap && target.closest(".ptt-node[data-ck], tr.item-row[data-ck]");
    if (!item) { hide(); return; }
    const nid = item.dataset.nid || "";
    const convKey = item.dataset.ck || (nid && nidToConvKey.get(nid));
    const session = findSession(convKey);
    if (!session) { hide(); return; }
    const itemKey = convKey + "\n" + nid;
    if (lastItemKey !== itemKey) {
      const record = findItemRecord(convKey, nid);
      let domText = "";
      if (item.matches("tr.item-row")) {
        const cell = item.cells && item.cells[2];
        domText = cell ? cell.textContent.trim() : item.textContent.trim();
      } else {
        const textNode = item.querySelector(":scope > .ptt-row > .ptt-txt");
        domText = textNode ? textNode.textContent.trim() : "";
      }
      const kind = record ? record.kind : (nid.split("-")[0] || "item");
      setLine("session", "Chat session", session.title || "(no title)");
      setLine("chatId", "Chat ID", session.conversationId || session.url);
      setLine("site", "Site", session.platform);
      setLine("siteUrl", "Site URL", session.url);
      setLine("itemTitle", "Hovered item", kind === "answer" ? "Answer" : kind === "onMsg" ? "Ask / message" : "Ask");
      //setLine("itemText", "Item text", record && record.text != null ? record.text : domText);
      setLine("kind", "Type", kind);
      setLine("nid", "NID", nid);
      setLine("convKey", "convKey", convKey);
      setLine("recordKey", "recordKey", record && record.recordKey);
      lastItemKey = itemKey;
    }
    popup.style.display = "block";
    position(x, y);
  }
  document.addEventListener("mousemove", (event) => updateFromPoint(event.clientX, event.clientY, event.ctrlKey), true);
  document.addEventListener("keydown", (event) => { if (event.key === "Control" && !event.repeat) updateFromPoint(lastX, lastY, true); }, true);
  document.addEventListener("keyup", (event) => { if (event.key === "Control") hide(); }, true);
  window.addEventListener("blur", hide);
})();

