

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



let lasttotal=10000;
let lastsorteditems=[];
let rows = [];
let filter = "all";
let selectedId = null;
let showOnMsg = false;
let dirtyflag1 = false;
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
// Debounced live navigation for the PT/NT existing-items slider.
let existingTimeSliderTimer = null;
let existingTimeSliderNavigating = false;
const EXISTING_TIME_SLIDER_DEBOUNCE_MS = 0;

function cancelPendingExistingTimeSliderNavigation() {
  if (existingTimeSliderTimer !== null) {
    clearTimeout(existingTimeSliderTimer);
    existingTimeSliderTimer = null;
  }
}
let globalIndexByNid = new Map();
let globalNidByIndex = new Map();
// Per-conversation chronological navigation index; reused until the global item index changes.
const currentChatNavIndexCache = new Map();
let globalChronologicalIndexGeneration = 0;
let hitNavFresh = 0; // 1 = next prev/next hit should find the neighbor of the selection
let hitNavNid = null; // last item jumped to, so later clicks step one item not one line
const openChats = new Set();
const openAns = new Set();
const renderedCks = new Set(); // global anti-dup for chat bars; cleared only by Clear all
const forceOpenAsk = new Set();
// Runtime-only UI state survives DOM removal/recreation by the datetime sliding window.
const expandedMessageNids = new Set();
// Explicit per-message choices override the current chat-wide search unfolding policy.
const messageFoldOverrides = new Map();
// Per-chat search unfolding policy: "hit" (default) or "all".
const chatUnfoldModes = new Map();
// Item identities that contain at least one hit in the current search session.
const searchHitNids = new Set();
// NIDs materialized by m/n/p/q. Kept until the next search or a cleared search.
const navigationPinnedNids = new Set();
const openedGaps = new Set(); // "fromNid->toNid": non-hit items between two hits are unfolded
const openedOlderHistory = new Map(); // convKey -> first-hit NID whose older history is unfolded
// Persist gap expansion for the lifetime of the browser session (not in local storage).
const GAP_EXPANSION_SESSION_KEY = "explorerGapExpansionState";
let gapExpansionSessionReady = false;
let gapExpansionSaveChain = Promise.resolve();
function gapExpansionSessionSnapshot() {
  return {
    openedGaps: Array.from(openedGaps),
    openedOlderHistory: Array.from(openedOlderHistory.entries())
  };
}
async function restoreGapExpansionSessionState() {
  try {
    if (!chrome.storage || !chrome.storage.session) return;
    const bag = await chrome.storage.session.get(GAP_EXPANSION_SESSION_KEY);
    const saved = bag && bag[GAP_EXPANSION_SESSION_KEY];
    if (saved && Array.isArray(saved.openedGaps)) {
      saved.openedGaps.forEach(function (key) { if (typeof key === "string") openedGaps.add(key); });
    }
    if (saved && Array.isArray(saved.openedOlderHistory)) {
      saved.openedOlderHistory.forEach(function (entry) {
        if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string" && typeof entry[1] === "string") {
          openedOlderHistory.set(entry[0], entry[1]);
        }
      });
    }
  } catch (error) {
    console.warn("AI Chat Explorer: could not restore session gap expansion state", error);
  } finally {
    gapExpansionSessionReady = true;
  }
}
function saveGapExpansionSessionState() {
  if (!chrome.storage || !chrome.storage.session) return;
  const snapshot = gapExpansionSessionSnapshot();
  // Serialize writes so a slower earlier write cannot overwrite a newer toggle.
  gapExpansionSaveChain = gapExpansionSaveChain.then(function () {
    return chrome.storage.session.set({ [GAP_EXPANSION_SESSION_KEY]: snapshot });
  }).catch(function (error) {
    console.warn("AI Chat Explorer: could not save session gap expansion state", error);
  });
}
const olderHistoryNidsCache = new Map(); // convKey|firstNid -> ordered array of older NIDs
const olderHistoryNidSetCache = new Map(); // same key -> Set for O(1) membership checks
const chatItemOrderCache = new Map(); // convKey -> ordered NID records for this search/render pass
const firstHitForChatCache = new Map(); // convKey -> first hit NID (or null) for this search/render pass
let lastUnfoldQuery = null;

// UI-only preferences live in a separate IndexedDB database to avoid changing
// the schema used by the logger's message records.
const UI_STATE_DB_NAME = "aiChatLoggerExplorerUiState";
const UI_STATE_STORE = "uiState";
let uiStateDbPromise = null;

let isScrollFetching = false;
let scrollFetchGuardDepth = 0;

function beginScrollFetchGuard() {
  scrollFetchGuardDepth++;
  isScrollFetching = true;
  let released = false;
  return function releaseScrollFetchGuard() {
    if (released) return;
    released = true;
    // Keep the guard through layout and any scroll event queued by DOM/scrollTop changes.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () {
          scrollFetchGuardDepth = Math.max(0, scrollFetchGuardDepth - 1);
          if (scrollFetchGuardDepth === 0) isScrollFetching = false;
        }, 0);
      });
    });
  };
}
function openUiStateDb() {
  if (uiStateDbPromise) return uiStateDbPromise;
  uiStateDbPromise = new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error("IndexedDB is unavailable")); return; }
    const request = indexedDB.open(UI_STATE_DB_NAME, 2);
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
  return Promise.all([restoreUiState(), restoreGapExpansionSessionState()]).finally(function () { return loadLazy(); });
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

// The status bar keeps its existing count/message and appends metadata for the
// most recently selected search hit or main-pane item on the same line.
let selectionStatusKind = "";
let selectionStatusNid = "";
let selectionStatusConvKey = "";
function findStatusSession(convKey) {
  if (!convKey) return null;
  const key = String(convKey);
  const pools = [matched, rows, recycleChats];
  for (const pool of pools) {
    const found = (pool || []).find(function (r) { return String(r.convKey) === key; });
    if (found) return found;
  }
  return null;
}
function updateSelectionStatus(kind, nid, convKey) {
  selectionStatusKind = kind || selectionStatusKind;
  selectionStatusNid = String(nid || selectionStatusNid || "");
  selectionStatusConvKey = String(convKey || findConvForNid(selectionStatusNid) || selectionStatusConvKey || "");
  const status = $("status");
  if (!status || !selectionStatusKind) return;
  const session = findStatusSession(selectionStatusConvKey);
  if (!session) {
    status.dataset.selectionStatus = selectionStatusKind === "hit"
      ? "Last hit: " + (selectionStatusNid || "(unknown item)")
      : "Last selected: " + (selectionStatusNid || "(unknown item)");
    status.title = status.dataset.selectionStatus;
    return;
  }
  const label = selectionStatusKind === "hit" ? "Last hit" : "Last selected";
  const updated = rowTs(session) ? fmtTs(rowTs(session)) : "unknown update time";
  const site = String(session.platform || "unknown site");
  const title = String(session.title || "(untitled chat)");
  const url = String(session.url || session.conversationId || "(no chat URL)");
  const detail = label + ": " + updated + " | " + site + " | " + title + " | " + url;
  status.dataset.selectionStatus = detail;
  status.title = detail + " | Item: " + selectionStatusNid;
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
let forceAll = false;
let forceAllActive = false;
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




function chatMatchesBag_original(r) {
  if (filter === "favorites") return chatHasLiked(r);
  if (filter === "recycle") return true;
  if (filter === "all") return true;
  return r.platform === filter;
}
function chatMatchesBag(r) {
  if (filter === "favorites") return chatHasLiked(r);
  if (filter === "recycle") return true;
  if (filter === "all") return true;
  if (r.platform === filter) return true;

  // Check custom sidebar routes for platfilter rules in their text
  const customRoute = sideRoutes.find(function (item) { return item.id === filter; });
  if (customRoute && customRoute.text) {
    const lines = customRoute.text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.indexOf("platfilter:") === 0) {
        const target = line.slice("platfilter:".length).trim();
        if (target && r.platform === target) return true;
      }
      if (line.indexOf("chatidfilter:") === 0) {
      const rangeSpec = line.slice("chatidfilter:".length).trim();
      if (rangeSpec && chatIdInRanges(Number(r.id), rangeSpec)) return true;
    }
      
      
      
    }
  }
  return false;
}

 function chatIdInRanges(id, spec) {
  if (!Number.isFinite(id)) return false;
  return spec.split(",").some(part => {
    part = part.trim();
    if (!part) return false;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const lo = +m[1], hi = +m[2];
      return id >= Math.min(lo, hi) && id <= Math.max(lo, hi);
    }
    return id === +part;   // single number
  });
}

function matchRow(r, q) {

if (filter === "favorites") {
    if (!chatHasLiked(r)) return false;
  } else if (filter !== "all" && filter !== "recycle" && !chatMatchesBag(r)) return false;
 


  if (0) if (filter === "favorites") {
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
  //if (hitMode && !searchHitNids.has(key) && !inOpenedGap(key, convKey) && !inOpenedOlderHistory(key, convKey)) return "";
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
  if (forceAll) {
    const first = String(text || "").split(/\r?\n/).find(function (l) { return l.trim(); }) || "";
    return first ? [{ lineNo: 1, line: first }] : [];
  }
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
    if (allowed.has(i) && tokens.length && hayHasTokens(line, tokens)) out.push({ lineNo: i + 1, line: line });
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
  const cacheKey = String(convKey);
  const cached = chatItemOrderCache.get(cacheKey);
  if (cached) return cached;
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
  chatItemOrderCache.set(cacheKey, out);
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
function firstHitForChat(convKey) {
  const cacheKey = String(convKey);
  if (firstHitForChatCache.has(cacheKey)) return firstHitForChatCache.get(cacheKey);
  const order = chatItemOrder(convKey);
  const hits = order.filter(function (it) { return searchHitNids.has(it.nid); });
  if (!hits.length) { firstHitForChatCache.set(cacheKey, null); return null; }
  // “First” means the earliest timestamp in the session, independent of pane order.
  hits.sort(function (a, b) {
    const ah = findByNid(a.nid), bh = findByNid(b.nid);
    return ((Number(ah && ah.node && ah.node.ts) || 0) - (Number(bh && bh.node && bh.node.ts) || 0));
  });
  const firstNid = hits[0].nid;
  firstHitForChatCache.set(cacheKey, firstNid);
  return firstNid;
}
function olderHistoryNids(convKey, firstNid) {
  const cacheKey = String(convKey) + "|" + String(firstNid);
  const cached = olderHistoryNidsCache.get(cacheKey);
  if (cached) return cached;
  const first = findByNid(firstNid);
  const firstTs = Number(first && first.node && first.node.ts) || 0;
  if (!first || !firstTs) {
    olderHistoryNidsCache.set(cacheKey, []);
    olderHistoryNidSetCache.set(cacheKey, new Set());
    return [];
  }
  const result = chatItemOrder(convKey).filter(function (it) {
    if (it.nid === firstNid) return false;
    const h = findByNid(it.nid);
    return !!(h && h.node && Number(h.node.ts) && Number(h.node.ts) < firstTs);
  }).map(function (it) { return it.nid; });
  olderHistoryNidsCache.set(cacheKey, result);
  olderHistoryNidSetCache.set(cacheKey, new Set(result));
  return result;
}
function inOpenedOlderHistory(nid, convKey) {
  const firstNid = openedOlderHistory.get(String(convKey));
  if (!firstNid) return false;
  const cacheKey = String(convKey) + "|" + String(firstNid);
  // Populate both caches together if this is the first membership check.
  olderHistoryNids(convKey, firstNid);
  const nids = olderHistoryNidSetCache.get(cacheKey);
  return !!(nids && nids.has(String(nid)));
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
function nodeHtmlFor(nid, convKey, tokens, titlePane = true) {
  const hit = findByNid(nid);
  if (!hit) return "";
  if (hit.kind === "answer") {
    const a = hit.node;
    const parent = hit.parent;
    return pttNode({
      nid: nid,
      ts: a.ts,
      ck: convKey,
      tag: (isSeenAns(a) ? "seo#" : "ans#") + (parent ? parent.localIndex : "?") + "." + (a.localIndex == null ? "?" : a.localIndex),
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
  }
  return pttAskNode(hit.node, tokens, false, hit.kind, convKey, titlePane);
}
function gapButtonHtml(nid, convKey, tokens) {
  return "";
  if ((!tokens || !tokens.length) && !forceAll || !nid || !convKey) return "";
  if ((chatUnfoldModes.get(String(convKey)) || "hit") !== "hit") return "";
  const gap = gapAfter(nid, convKey);
  const firstNid = firstHitForChat(convKey);
  const isFirstHit = !!(firstNid && firstNid === String(nid));
  const olderNids = isFirstHit ? olderHistoryNids(convKey, firstNid) : [];
  if (!gap && !olderNids.length) return "";
  const key = gap ? gap.key : (String(nid) + "->older:" + String(convKey));
  const open = openedGaps.has(key) || (isFirstHit && openedOlderHistory.get(String(convKey)) === firstNid);
  const count = (gap ? gap.count : 0) + (isFirstHit ? olderNids.length : 0);
  return '<button type="button" class="ptt-gap" data-gap="' + esc(key) + '" title="' +
    (open ? "Fold" : "Unfold") + " " + count + ' hidden item(s); first hit also reveals all older items in this chat">' +
    count + "</button>";
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
  // Chat metadata is resolved from the owning conversation; every ask and
  // answer node carries the same convKey. Keep it presentation-only.
  const chat = findStatusSession(opts.ck);
  const chatUpdated = chat && rowTs(chat) ? fmtTs(rowTs(chat)) : "unknown update time";
  const chatTitle = chat && chat.title ? chat.title : "(untitled chat)";
  const chatMeta = '<div class="ptt-chat-meta">' + esc(chatUpdated) + '  ' + esc(chatTitle) + '</div>';
  const label = hitDotHtml(opts.nid) + star + '<span class="ptt-label-wrap">' + globalIndexLabel(opts.nid) + '<span class="ptt-tag">' + esc(opts.tag) + '</span>' +
    (opts.foldText !== undefined ? messageToggleHtml(opts.foldText, opts.nid, false, opts.ck, opts.tokens) : '') + '</span>';
  const itemMeta = '<div class="ptt-item-meta">' + esc(opts.ts != null && Number(opts.ts) ? fmtTs(opts.ts) : "unknown item time") + '  ' + label + '</div>';
  const bodyHtml = opts.foldText !== undefined
    ? messageContentHtml(opts.foldText, opts.tokens, opts.nid, false, opts.ck, !!opts.titlePane)
    : highlightText(opts.body, opts.tokens);
  const globalIndex = globalIndexByNid.get(String(opts.nid || ""));
  const nodeTs = opts.ts != null ? Number(opts.ts) || 0 : 0;
  return '<div class="ptt-node" data-nid="' + esc(opts.nid) + '" data-ts="' + nodeTs + '"' + (globalIndex == null ? '' : ' data-global-index="' + globalIndex + '"') + ' ' + ckAttr + '><div class="ptt-row">' +
    t.left + (hasKids ? t.right : "") +
    '<div class="ptt-txt">' + chatMeta + itemMeta + '<div class="ptt-message-content">' + bodyHtml + '</div></div>' + menu + "</div>" + kids + "</div>";
}

function pttAskNode(c, tokens, kidsOpen, kind, convKey, titlePane = false) {

  const tag = isOnMsg(c) ? ("onMsg#" + c.localIndex)
    : isSeenAsk(c) ? ("sei#" + c.localIndex)
    : ("ask#" + c.localIndex);
  const nid = (kind === "ask" ? askNidPrefix(c) : kind) + "-" + (c.recordKey || c.localIndex);
  if (convKey) nidToConvKey.set(nid, convKey);

  const hitModeHere = !!((tokens && tokens.length || forceAll || forceAllActive) && convKey && (chatUnfoldModes.get(String(convKey)) || "hit") === "hit");
  const shownAnswers = (c.answers || []).filter((a) => inTime(a.ts) && showAnsNode(a) &&
    (!hitModeHere || searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)) || inOpenedGap(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex), convKey)));
  const kidsHtml = (kind !== "onMsg" && shownAnswers.length)
    ? shownAnswers.map(function (a) {
        if (filter === "favorites" && !nodeLiked(a)) return "";
        return pttNode({
          nid: answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex),
          ts: a.ts,
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
    ts: c.ts,
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
  const flatItems = [];
  const hitMode = (tokens.length || forceAll || forceAllActive) && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
  const showAsk = (c) => filter !== "favorites" || nodeLiked(c) || (c.answers || []).some(nodeLiked);

  // Read the time offset dynamically from Tab 3 inputs (defaulting to 0)
  const h = Number.parseInt($("offsetH") ? $("offsetH").value : 0, 10) || 0;
  const m = Number.parseInt($("offsetM") ? $("offsetM").value : 0, 10) || 0;
  const s = Number.parseInt($("offsetS") ? $("offsetS").value : 0, 10) || 0;
  const TIME_OFFSET_MS = (h * 3600 + m * 60 + s) * 1000;

  list.forEach(function (c) {
    // onMsg uses local time as-is; ask/sei (UTC) have the offset added
    const askTs = isOnMsg(c) ? (c.ts || 0) : ((c.ts || 0) + TIME_OFFSET_MS);

    // 1. Collect OnMsg nodes
    if (isOnMsg(c)) {
      if ((showOnMsg || filter === "favorites") && inTime(askTs) && showAsk(c)) {
        const nid = "onMsg-" + (c.recordKey || c.localIndex);
        if (!hitMode || searchHitNids.has(nid) || inOpenedGap(nid, r.convKey) || inOpenedOlderHistory(nid, r.convKey)) {
          flatItems.push({
            ts: askTs,
            html: pttNode({
              nid: nid,
              ts: askTs,
              ck: r.convKey,
              tag: "onMsg#" + c.localIndex,
              body: fmtTs(askTs) + "  " + (c.text || ""),
              bodyPrefix: fmtTs(askTs) + "  ",
              foldText: c.text || "",
              tokens: tokens,
              kidsHtml: "", // No child container
              open: false,
              liked: nodeLiked(c),
              titlePane: true,
              recordKey: c.recordKey || "",
              storeKind: "onMsg",
              editText: c.text || ""
            })
          });
        }
      }
      return;
    }

    // 2. Collect Ask / Sei nodes independently (flat)
    if ((showSei || showAsk || filter === "favorites") && showAsk(c) && showAskNode(c) && inTime(askTs)) {
      const askNid = askNidPrefix(c) + "-" + (c.recordKey || c.localIndex);
      const askHit = searchHitNids.has(askNid);
      const gapAsk = inOpenedGap(askNid, r.convKey);
      const olderAsk = inOpenedOlderHistory(askNid, r.convKey);

      if (!hitMode || askHit || gapAsk || olderAsk || (c.answers || []).some(a => searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)))) {
        flatItems.push({
          ts: askTs,
          html: pttNode({
            nid: askNid,
            ts: askTs,
            ck: r.convKey,
            tag: (isSeenAsk(c) ? "sei#" : "ask#") + c.localIndex,
            body: fmtTs(askTs) + "  " + (c.text || ""),
            bodyPrefix: fmtTs(askTs) + "  ",
            foldText: c.text || "",
            tokens: tokens,
            kidsHtml: "", // No child container
            open: false,
            liked: nodeLiked(c),
            titlePane: true,
            recordKey: c.recordKey || "",
            storeKind: "ask",
            editText: c.text || ""
          })
        });
      }
    }

    // 3. Collect Answer / Seo nodes independently as top-level items
    if (showSeo || showAns || filter === "favorites") {
      (c.answers || []).forEach(function (a) {
        const ansTs = (a.ts || 0) + TIME_OFFSET_MS;

        if (!inTime(ansTs) || !showAnsNode(a)) return;
        if (filter === "favorites" && !nodeLiked(a)) return;
        const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
        const ansHit = searchHitNids.has(ansNid);
        const gapAns = inOpenedGap(ansNid, r.convKey);

        if (!hitMode || ansHit || gapAns || inOpenedOlderHistory(ansNid, r.convKey)) {
          flatItems.push({
            ts: ansTs,
            html: pttNode({
              nid: ansNid,
              ts: ansTs,
              ck: r.convKey,
              tag: (isSeenAns(a) ? "seo#" : "ans#") + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex),
              body: fmtTs(ansTs) + "  " + (a.text || ""),
              bodyPrefix: fmtTs(ansTs) + "  ",
              foldText: a.text || "",
              tokens: tokens,
              kidsHtml: "", // No child container
              open: false,
              liked: nodeLiked(a),
              titlePane: true,
              recordKey: a.recordKey || "",
              storeKind: "answer",
              editText: a.text || ""
            })
          });
        }
      });
    }
  });

  // Sort everything strictly by time ascending





  flatItems.sort((a, b) => (b.ts || 0) - (a.ts || 0));







  if (!flatItems.length) return '<div class="cmt">Nothing to show for current checkboxes.</div>';
  return '<div class="ptt-tree">' + flatItems.map(item => item.html).join("") + '</div>';
}
function askBlock_parentchild(r, list, tokens) {
  const flatItems = [];
  const hitMode = (tokens.length || forceAll || forceAllActive) && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
  const showAsk = (c) => filter !== "favorites" || nodeLiked(c) || (c.answers || []).some(nodeLiked);

  // Read offset values dynamically from the UI inputs (defaulting to 0 if empty)
  const h = Number.parseInt($("offsetH") ? $("offsetH").value : 0, 10) || 0;
  const m = Number.parseInt($("offsetM") ? $("offsetM").value : 0, 10) || 0;
  const s = Number.parseInt($("offsetS") ? $("offsetS").value : 0, 10) || 0;
  const TIME_OFFSET_MS = (h * 3600 + m * 60 + s) * 1000;

  list.forEach(function (c) {
    const askTs = isOnMsg(c) ? (c.ts || 0) : ((c.ts || 0) + TIME_OFFSET_MS);

    // 1. Collect OnMsg nodes
    if (isOnMsg(c)) {
      if ((showOnMsg || filter === "favorites") && inTime(askTs) && showAsk(c)) {
        const nid = "onMsg-" + (c.recordKey || c.localIndex);
        if (!hitMode || searchHitNids.has(nid) || inOpenedGap(nid, r.convKey) || inOpenedOlderHistory(nid, r.convKey)) {
          flatItems.push({
            ts: askTs,
            html: pttNode({
              nid: nid,
              ts: askTs,
              ck: r.convKey,
              tag: "onMsg#" + c.localIndex,
              body: fmtTs(askTs) + "  " + (c.text || ""),
              bodyPrefix: fmtTs(askTs) + "  ",
              foldText: c.text || "",
              tokens: tokens,
              kidsHtml: "",
              open: false,
              liked: nodeLiked(c),
              titlePane: true,
              recordKey: c.recordKey || "",
              storeKind: "onMsg",
              editText: c.text || ""
            })
          });
        }
      }
      return;
    }

    // 2. Collect Ask / Sei nodes
    if ((showSei || showAsk || filter === "favorites") && showAsk(c) && showAskNode(c) && inTime(askTs)) {
      const askNid = askNidPrefix(c) + "-" + (c.recordKey || c.localIndex);
      const askHit = searchHitNids.has(askNid);
      const gapAsk = inOpenedGap(askNid, r.convKey);
      const olderAsk = inOpenedOlderHistory(askNid, r.convKey);

      if (!hitMode || askHit || gapAsk || olderAsk || (c.answers || []).some(a => searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)))) {
        flatItems.push({
          ts: askTs,
          html: pttNode({
            nid: askNid,
            ts: askTs,
            ck: r.convKey,
            tag: (isSeenAsk(c) ? "sei#" : "ask#") + c.localIndex,
            body: fmtTs(askTs) + "  " + (c.text || ""),
            bodyPrefix: fmtTs(askTs) + "  ",
            foldText: c.text || "",
            tokens: tokens,
            kidsHtml: "",
            open: false,
            liked: nodeLiked(c),
            titlePane: true,
            recordKey: c.recordKey || "",
            storeKind: "ask",
            editText: c.text || ""
          })
        });
      }
    }

    // 3. Collect Answer / Seo nodes independently
    if (showSeo || showAns || filter === "favorites") {
      (c.answers || []).forEach(function (a) {
        const ansTs = (a.ts || 0) + TIME_OFFSET_MS;

        if (!inTime(ansTs) || !showAnsNode(a)) return;
        if (filter === "favorites" && !nodeLiked(a)) return;
        const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
        const ansHit = searchHitNids.has(ansNid);
        const gapAns = inOpenedGap(ansNid, r.convKey);

        if (!hitMode || ansHit || gapAns || inOpenedOlderHistory(ansNid, r.convKey)) {
          flatItems.push({
            ts: ansTs,
            html: pttNode({
              nid: ansNid,
              ts: ansTs,
              ck: r.convKey,
              tag: (isSeenAns(a) ? "seo#" : "ans#") + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex),
              body: fmtTs(ansTs) + "  " + (a.text || ""),
              bodyPrefix: fmtTs(ansTs) + "  ",
              foldText: a.text || "",
              tokens: tokens,
              kidsHtml: "",
              open: false,
              liked: nodeLiked(a),
              titlePane: true,
              recordKey: a.recordKey || "",
              storeKind: "answer",
              editText: a.text || ""
            })
          });
        }
      });
    }
  });

  // Sort strictly by adjusted timestamp in chronological order
  flatItems.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (!flatItems.length) return '<div class="cmt">Nothing to show for current checkboxes.</div>';
  return '<div class="ptt-tree">' + flatItems.map(item => item.html).join("") + '</div>';
}



function askBlock_original(r, list, tokens) {
  const parts = [];
  const showAsk = (c) => filter !== "favorites" || nodeLiked(c) || (c.answers || []).some(nodeLiked);
  if (showOnMsg || filter === "favorites") {
    const hitMode = (tokens.length || forceAll || forceAllActive) && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
    const live = liveAsks(list).filter((c) => isOnMsg(c) && inTime(c.ts) && showAsk(c) &&
      (!hitMode || searchHitNids.has("onMsg-" + (c.recordKey || c.localIndex)) || inOpenedGap("onMsg-" + (c.recordKey || c.localIndex), r.convKey) || inOpenedOlderHistory("onMsg-" + (c.recordKey || c.localIndex), r.convKey)));
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
      const hitMode = (tokens.length || forceAll || forceAllActive) && (chatUnfoldModes.get(String(r.convKey)) || "hit") === "hit";
      const nodes = imp.map(function (c) {
        const hitAns = tokens.length && (c.answers || []).some(function (a) { return showAnsNode(a) && searchHitNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex)); });
        const hitAsk = showAskNode(c) && searchHitNids.has(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex));
        const openKids = ansOpenAll || forceOpenAsk.has(c.recordKey) || hitAns || (c.answers || []).some(showAnsNode);
        const gapAsk = inOpenedGap(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex), r.convKey);
        if (hitMode && !hitAsk && !hitAns && !gapAsk && !inOpenedOlderHistory(askNidPrefix(c) + "-" + (c.recordKey || c.localIndex), r.convKey)) return "";
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
  if ((!tokens.length && !forceAll) || !includeImpAns) return;
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
  const ansFold = '<button class="ansfold" data-ck="' + esc(r.convKey) + '" type="button" title="fold/unfold all imported answers">' + (ansOn ? "\u2212a" : "+a") + "</button>";
  const chatBtns =
    '<button class="chat-unfold-all" data-ck="' + esc(r.convKey) + '" type="button" title="Create and show every item in this chat">ua</button>' +
    '<button class="chat-unfold-existing" data-ck="' + esc(r.convKey) + '" type="button" title="Show items already created for this chat">ue</button>' +
    '<button class="chat-unfold-range" data-ck="' + esc(r.convKey) + '" type="button" title="Unfold a range of items (e.g. 9:18,-17:-8)">ur</button>' +
    '<button class="chat-fold" data-ck="' + esc(r.convKey) + '" type="button" title="Hide this chat\'s items">Fold</button>';
  const detail = (tokens.length || forceAll || forceAllActive) && show
    ? '<tr class="cmt-row" data-ck="' + esc(r.convKey) + '"><td colspan="6">' + askBlock(r, all, tokens) + "</td></tr>"
    : "";
  return '<tr data-id="' + r.id + '" data-ck="' + esc(r.convKey) + '" class="' + (r.id === selectedId ? "sel" : "") + '">' +
    "<td>" + esc(fmtTs(rowTs(r))) + "</td><td>" + esc(r.platform) + "</td>" +
    '<td title="' + esc(r.title) + '">' + chatBtns + ansFold +
      '<span class="chat-title-controls"><button type="button" class="chat-title-edit" data-title-edit="1" data-ck="' + esc(r.convKey) + '" title="Edit this conversation title">Edit</button>' +
      '<label class="chat-title-lock-label" title="Prevent platform sync from replacing this title"><input class="chat-title-lock" type="checkbox" data-title-lock="1" data-ck="' + esc(r.convKey) + '"' + (r.titleLocked ? ' checked' : '') + '>Lock</label></span>' +
      esc(r.title || "") + '</td>' +
    '<td title="' + esc(r.url) + '">' + esc(r.conversationId || r.url || "") + "</td>" +
    "<td>" + (all.length || r.askCount || 0) + "</td><td>" + r.id + "</td></tr>" + detail;
}

function buildGlobalChronologicalIndex() {
  // A rebuilt global index can reflect changed records or visibility settings, so
  // invalidate per-chat indexes at the same boundary. Otherwise they stay cached.
  currentChatNavIndexCache.clear();
  globalChronologicalIndexGeneration++;
  const entries = [];
  let seq = 0;
  const sourceMaps = [asksByConv, recycleAsks];
  const seen = new Set();
  sourceMaps.forEach(function (map) {
    map.forEach(function (list, convKey) {
      (list || []).forEach(function (c) {
        const askNid = askNidPrefix(c) + "-" + (c.recordKey || c.localIndex);
        if (showAskNode(c) && !seen.has(askNid)) {
          seen.add(askNid);
          entries.push({ nid: askNid, ts: Number(c.ts) || 0, seq: seq++ });
        }
        (c.answers || []).forEach(function (a) {
          const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
          if (showAnsNode(a) && !seen.has(ansNid)) {
            seen.add(ansNid);
            entries.push({ nid: ansNid, ts: Number(a.ts) || 0, seq: seq++ });
          }
        });
      });
    });
  });
  // Global numbering is oldest = 1, newest = N. Sequence is a stable
  // deterministic tie-breaker for equal or missing timestamps.
  entries.sort(function (a, b) { return a.ts - b.ts || a.seq - b.seq || a.nid.localeCompare(b.nid); });
  globalIndexByNid = new Map();
  globalNidByIndex = new Map();
  entries.forEach(function (entry, i) {
    const index = i + 1;
    globalIndexByNid.set(entry.nid, index);
    globalNidByIndex.set(index, entry.nid);
  });
  updateGlobalNavSlider(globalIndexByNid.get(String(selectedNid || "")) || 1);
  updateExistingTimeNavSlider();
}
function globalIndexLabel(nid) {
  const index = globalIndexByNid.get(String(nid || ""));
  return index == null ? "" : '<span class="global-item-index" title="Global chronological index">#' + index + '</span>';
}

function updateGlobalNavSlider(index) {
  const slider = $("globalNavSlider");
  const count = $("globalNavSliderCount");
  if (!slider || !count) return;
  const total = globalNidByIndex.size;
  slider.min = total ? "1" : "0";
  slider.max = String(Math.max(1, total));
  slider.disabled = total === 0;
  const current = total ? Math.max(1, Math.min(total, Number(index) || 1)) : 0;
  slider.value = String(current || 0);
  count.textContent = total ? current + " / " + total : "0 / 0";
}

// This is deliberately the same logical collection as ptExist / ntExist:
// items already present in the active pane, ordered by the global time index.
// Hidden/folded DOM items remain eligible, just as they do for those buttons.




function getExistingTimeNavigationItems() {
  if (globalChronologicalIndexGeneration === 0) buildGlobalChronologicalIndex();
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  if (!body) return [];
  const existing = new Map();
  
  body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]").forEach(function (el) {
    const nid = String(el.dataset.nid || "");
    if (!nid || existing.has(nid)) return;
    
    // --- PLATFORM / PLATFILTER RESTRICTION ---
    const ck = el.dataset.ck || findConvForNid(nid);
    const session = findStatusSession(ck);
    if (session && !chatMatchesBag(session)) {
      return; // Skip items outside the current bag's platform/platfilters
    }
    // -----------------------------------------

    existing.set(nid, el);
  });
  
  return Array.from(existing.entries()).map(function (entry) {
    return { nid: entry[0], el: entry[1], index: globalIndexByNid.get(entry[0]) };
  }).sort(function (a, b) { return a.index - b.index; });
}










function getExistingTimeNavigationItems_original() {
  if (globalChronologicalIndexGeneration === 0) buildGlobalChronologicalIndex();
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  if (!body) return [];
  const existing = new Map();
  body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]").forEach(function (el) {
    const nid = String(el.dataset.nid || "");
    if (nid && !existing.has(nid) && globalIndexByNid.has(nid)) existing.set(nid, el);
  });
  return Array.from(existing.entries()).map(function (entry) {
    return { nid: entry[0], el: entry[1], index: globalIndexByNid.get(entry[0]) };
  }).sort(function (a, b) { return a.index - b.index; });
}

function drawExistingTimeHitStrip(items) {
  const canvas = $("existingTimeHitStrip");
  if (!canvas) return;
  const total = items.length;
  const tokens = parseSearch($("q") ? $("q").value : "").tokens;
  const hasKeywordSearch = tokens.length > 0;
  const height = 4;

  // One backing-store pixel column per existing NID. CSS scales this bitmap
  // to the available width; item colors are assigned discretely, not blended.
  canvas.width = Math.max(1, total);
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!total) return;

  for (let i = 0; i < total; i++) {
    const color = !hasKeywordSearch
      ? "#9aa0a6"                         // no active keyword search
      : searchHitNids.has(items[i].nid)
        ? "#269b68"                       // item has a keyword hit
        : "#d7a33d";                      // existing item, but no keyword hit
    ctx.fillStyle = color;
    ctx.fillRect(i, 0, 1, height);
  }
}

function updateExistingTimeNavSlider4() {}



function updateExistingTimeNavSlider2() {
  console.log ("updateExistingTimeNavSlider#2    is called ")

//  ---if using this , when 'unfold all'  for a chat , it will induce a race condition. 
  const slider = $("existingTimeNavSlider");
  const count = $("existingTimeNavSliderCount");
  if (!slider || !count) return;
 
  
  //drawExistingTimeHitStrip(lastsorteditems);
  
  
  //TODO:   lastsorteditems is the stale one or empty . no one is updating it  !
  const current = lastsorteditems&&(lastsorteditems.findIndex(function (item) { return item.nid === String(selectedNid || ""); }) + 1);
  const total = lastsorteditems.length;
  slider.min = total ? "1" : "0";
  slider.max = String(Math.max(1, total));
    const previousPosition = Number(slider.value) || 0;
  const retained = total && previousPosition > 0 ? Math.max(1, Math.min(total, previousPosition)) : 0;
  const position = current > 0 ? current : retained;
  slider.value = String(position);
count.textContent = total ? position + " ------ " + total : "0 / 0";

}

function updateExistingTimeNavSlider() {
  console.log ("updateExistingTimeNavSlider is called ")
  const slider = $("existingTimeNavSlider");
  const count = $("existingTimeNavSliderCount");
  if (!slider || !count) return;
  const items = getExistingTimeNavigationItems();
    lastsorteditems = items;
  drawExistingTimeHitStrip(items);
  const total = items.length;
  lasttotal = total;
  const current = items.findIndex(function (item) { return item.nid === String(selectedNid || ""); }) + 1;
  slider.min = total ? "1" : "0";
  slider.max = String(Math.max(1, total));
  //slider.disabled = total === 0;
  slider.disabled = 0;
  // If the selected NID is outside this slider's PT/NT collection, preserve
  // its last thumb position instead of snapping it to zero.
  const previousPosition = Number(slider.value) || 0;
  const retained = total && previousPosition > 0 ? Math.max(1, Math.min(total, previousPosition)) : 0;
  const position = current > 0 ? current : retained;
  slider.value = String(position);
  count.textContent = total ? position + " ++++ " + total : "0 / 0";
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
      const showAll = (chatUnfoldModes.get(String(r.convKey)) || "hit") === "all";
      if (tokens.length && !showAll && !askHit && !ansHit) return;
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
    '<td title="' + esc(session.title) + '"><b>' + esc(session.title || "(no title)") + "</b>" +
      '<span class="chat-title-controls"><button type="button" class="chat-title-edit" data-title-edit="1" data-ck="' + esc(session.convKey) + '" title="Edit this conversation title">Edit</button>' +
      '<label class="chat-title-lock-label" title="Prevent platform sync from replacing this title"><input class="chat-title-lock" type="checkbox" data-title-lock="1" data-ck="' + esc(session.convKey) + '"' + (session.titleLocked ? ' checked' : '') + '>Lock</label></span></td>' +
    '<td title="' + esc(session.url) + '">' + esc(session.conversationId || session.url || "") + "</td>" +
    "<td>" + (viewAsks(session.convKey).length || session.askCount || 0) + "</td><td>" + session.id + "</td></tr>";
}

function datetimeItemNid(it) {
  return askNidPrefix(it) + "-" + (it.recordKey || it.localIndex);
}

function datetimeItemsHtml(items, tokens) {
  const groups = groupItems(items);
  const html = [];
  groups.forEach(function (g) {
    html.push(bannerRowHtml(g.session));
    const groupNodes = [];
    const emittedNids = new Set();
    const firstNid = openedOlderHistory.get(String(g.convKey));
    const olderNids = firstNid ? olderHistoryNids(g.convKey, firstNid).slice().reverse() : [];
    const olderSet = new Set(olderNids);

    // Reconstruct expanded gap contents from logical state whenever the
    // datetime sliding window rebuilds this conversation's DOM.
    g.items.forEach(function (it) {
      const nid = datetimeItemNid(it);
      const gap = gapAfter(nid, g.convKey);
      if (gap && openedGaps.has(gap.key)) {
        gap.nids.slice().reverse().forEach(function (gapNid) {
          if (emittedNids.has(gapNid) || g.items.some(function (visibleIt) { return datetimeItemNid(visibleIt) === gapNid; })) return;
          const template = document.createElement("template");
          template.innerHTML = nodeHtmlFor(gapNid, g.convKey, tokens, false);
          template.content.querySelectorAll(".ptt-node").forEach(function (el) { el.dataset.gapKey = gap.key; });
          groupNodes.push(template.content.firstElementChild ? template.content.firstElementChild.outerHTML : template.innerHTML);
          emittedNids.add(gapNid);
        });
      }
      if (!emittedNids.has(nid)) {
        groupNodes.push(pttAskNode({
          localIndex: it.localIndex,
          ts: it.ts,
          text: it.text,
          recordKey: it.recordKey,
          source: it.source || "",
          liked: !!it.liked,
          answers: it.answers || []
        }, tokens, (it.answers || []).some(showAnsNode), it.kind, g.convKey));
        emittedNids.add(nid);
      }
      // Older history is attached immediately after its first-hit anchor,
      // not blindly appended at the end of the conversation tree.
      if (firstNid === nid) {
        olderNids.forEach(function (olderNid) {
          if (emittedNids.has(olderNid) || g.items.some(function (visibleIt) { return datetimeItemNid(visibleIt) === olderNid; })) return;
          const template = document.createElement("template");
          template.innerHTML = nodeHtmlFor(olderNid, g.convKey, tokens, false);
          template.content.querySelectorAll(".ptt-node").forEach(function (el) { el.dataset.olderHistoryKey = String(g.convKey); });
          groupNodes.push(template.content.firstElementChild ? template.content.firstElementChild.outerHTML : template.innerHTML);
          emittedNids.add(olderNid);
        });
      }
    });
    html.push('<tr class="cmt-row" data-ck="' + esc(g.convKey) + '"><td colspan="6"><div class="ptt-tree">' + groupNodes.join("") + "</div></td></tr>");
  });
  return html.join("");
}

function datetimeRangeHtml(start, end, tokens) {
  return datetimeItemsHtml(datetimeItems.slice(start, end), tokens);
}

function datetimeItemFromNid(nid) {
  const hit = findByNid(nid);
  if (!hit) return null;
  const ask = hit.kind === "answer" ? hit.parent : hit.node;
  if (!ask) return null;
  const askNid = askNidPrefix(ask) + "-" + (ask.recordKey || ask.localIndex);
  const convKey = owningConversationKeyForNid(askNid);
  const session = sessionForConversationKey(convKey);
  if (!session) return null;
  return {
    ts: Number(ask.ts) || 0,
    convKey: convKey,
    session: session,
    kind: isOnMsg(ask) ? "onMsg" : "ask",
    source: ask.source || "",
    localIndex: ask.localIndex,
    text: ask.text || "",
    recordKey: ask.recordKey || "",
    liked: !!ask.liked,
    answers: ask.answers || []
  };
}

function pinNavigationNids(nids) {
  (nids || []).forEach(function (nid) {
    const key = String(nid || "");
    if (key) navigationPinnedNids.add(key);
  });
}

function titlePaneExistingNids() {
  const body = $("titleView");
  if (!body) return new Set();
  // Include nodes inside folded/hidden detail rows. A chat that was never
  // unfolded has no item DOM, so those nids are intentionally absent.
  const nids = new Set();
  body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]").forEach(function (node) {
    const nid = String(node.dataset.nid || "");
    if (nid) nids.add(nid);
  });
  return nids;
}

function buildDateTimeItems(tokens) {
  // DateTime is a fixed projection of sessions currently unfolded in the title
  // pane. Folded sessions contribute no ordinary items. Navigation can unfold
  // a session through revealChat() before this list is rebuilt.
  // Optional: ignore the openChats filter, but still only show items that
  // already exist in the title pane (including ones hidden by a chat fold).
  const ignoreFold = $("datePaneIgnoreFold") && $("datePaneIgnoreFold").checked;
  const titleNids = ignoreFold ? titlePaneExistingNids() : null;
  const visibleSessions = ignoreFold
    ? matched.slice()
    : matched.filter(function (r) { return openChats.has(String(r.convKey)); });
  datetimeItems = collectItems(visibleSessions, tokens);
  if (titleNids) {
    datetimeItems = datetimeItems.filter(function (it) {
      if (titleNids.has(datetimeItemNid(it))) return true;
      return (it.answers || []).some(function (a) {
        return titleNids.has(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex));
      });
    });
  }
  // m/n/p/q can land on non-hit items. Keep those pinned items in the date
  // pane until the next search, even if collectItems filtered them out.
  const present = new Set();
  datetimeItems.forEach(function (it) {
    present.add(datetimeItemNid(it));
    (it.answers || []).forEach(function (a) {
      present.add(answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex));
    });
  });
  navigationPinnedNids.forEach(function (nid) {
    if (titleNids && !titleNids.has(String(nid))) return;
    if (present.has(String(nid))) return;
    const item = datetimeItemFromNid(nid);
    if (!item) return;
    // Checkbox off: pins must not resurrect a chat that is folded in the title pane.
    if (!ignoreFold && !openChats.has(String(item.convKey))) return;
    const askNid = datetimeItemNid(item);
    if (present.has(askNid)) return;
    datetimeItems.push(item);
    present.add(askNid);
  });
  datetimeItems.sort(function (a, b) { return (Number(b.ts) || 0) - (Number(a.ts) || 0); });
  // collectItems sorts newest-to-oldest; the complete list is rendered at once.
  dtStart = 0;
  dtEnd = datetimeItems.length;
}

function renderDateTimeWindow(nid, scroll, scrollMode = "center") {
  return;
  const releaseScrollGuard = beginScrollFetchGuard();
  const tb = $("dateTimeView");
  const tokens = parseSearch($("q").value).tokens;
  // Recompute on every sync so title-pane fold/unfold and navigation state are
  // reflected immediately. There is no centered window or batch eviction.
  buildDateTimeItems(tokens);
  const targetExists = !!nid && datetimeItems.some(function (it) {
    return datetimeItemNid(it) === nid || (it.answers || []).some(function (a) {
      return answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex) === nid;
    });
  });
  tb.innerHTML = datetimeItems.length ? datetimeItemsHtml(datetimeItems, tokens) : "";
  $("empty").hidden = datetimeItems.length > 0;
  $("status").textContent = datetimeItems.length + " chronological items (fixed list)";
  if (nid && targetExists) requestAnimationFrame(() => selectItemByNid(nid, !!scroll, scrollMode));
  releaseScrollGuard();
}

let datetimeHeadRefreshInFlight = false;
let datetimeHeadRefreshAt = 0;

async function refreshDateTimeHead() {
  if (datetimeHeadRefreshInFlight || Date.now() - datetimeHeadRefreshAt < 1200) return;
  const releaseScrollGuard = beginScrollFetchGuard();
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
    renderDateTimeWindow(selectedNid, false);
    // Fixed-list mode intentionally does not compensate for sliding-window batches.
  } catch (err) {
    console.warn("Could not refresh datetime head", err);
  } finally {
    datetimeHeadRefreshInFlight = false;
    releaseScrollGuard();
  }
}
function appendDateTimeBatch(direction) {
  // Kept as a compatibility hook for existing scroll listeners. DateTime no
  // longer fetches or evicts batches; its complete list is rendered in place.
  if (middleMode === "item") renderDateTimeWindow(selectedNid, false);
}

function renderItemMode(tokens) {
  return;
  // A fresh search/filter invalidates the cached chronological list; ordinary
  // pane switching reuses it and does not rebuild the DOM.
  buildDateTimeItems(tokens);
  renderDateTimeWindow(selectedId, false);
}

function isItemDisplayed(node, body) {
  if (!node || !node.isConnected || node.hidden) return false;
  for (let parent = node; parent && parent !== body; parent = parent.parentElement) {
    if (parent.hidden || parent.style.display === "none") return false;
  }
  return !!(node.getClientRects && node.getClientRects().length);
}

function getVisibleItems() {
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  if (!body) return [];
  return Array.from(body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]"))
    .filter(function (node) { return isItemDisplayed(node, body); });
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
  // A new selection from another navigation route supersedes a pending
  // debounced slider target. The slider's own callback sets the guard below.
  if (!existingTimeSliderNavigating) cancelPendingExistingTimeSliderNavigation();

  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  const candidates = body ? Array.from(
    body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]")
  ).filter((node) => node.dataset.nid === nid) : [];
  // The title pane can temporarily contain duplicate physical DOM nodes for
  // one logical NID while older/revealed trees are being reconciled. Prefer a
  // displayed copy so selection and scrolling do not get trapped on a hidden
  // duplicate; navigation itself continues to use the unique logical NID.
  const isDisplayed = function (node) {
    if (!node || !node.isConnected || node.hidden) return false;
    for (let parent = node; parent && parent !== body; parent = parent.parentElement) {
      if (parent.hidden || parent.style.display === "none") return false;
    }
    return !!(node.getClientRects && node.getClientRects().length);
  };
  // In title mode, prefer a visible copy inside the owning conversation's
  // detail row. Duplicate NIDs can temporarily exist in stale/recycled trees;
  // never let an earlier hidden copy win merely because it appears first.
  let preferredCandidates = candidates;
  if (middleMode !== "item") {
    const ck = owningConversationKeyForNid(nid);
    if (ck != null) {
      const detail = Array.from(body.querySelectorAll("tr.cmt-row[data-ck]"))
        .find((row) => String(row.dataset.ck) === String(ck));
      if (detail) {
        const inOwner = candidates.filter((node) => detail.contains(node));
        if (inOwner.length) preferredCandidates = inOwner;
      }
    }
  }
  const el = preferredCandidates.find(isDisplayed) || preferredCandidates[0];

  // Do not commit selectedNid until a physical target was actually found.
  // Otherwise the next press starts from a logical selection that never got
  // focused, which can make navigation appear stuck.
  if (!el) return false;
  selectedNid = nid;
  updateGlobalNavSlider(globalIndexByNid.get(String(nid)) || 1);
  //updateExistingTimeNavSlider();
  updateExistingTimeNavSlider2();
  updateSelectionStatus("item", nid, findConvForNid(nid));
  clearItemSelection();
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
  cancelPendingExistingTimeSliderNavigation();
  const items = getVisibleItems();
  if (!items.length) return;
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  const selectedEl = body && body.querySelector(".ptt-selected[data-nid], tr.ptt-selected[data-nid]");
  let idx = selectedEl ? items.indexOf(selectedEl) : -1;
  if (idx < 0) idx = items.findIndex(function (el) { return el.dataset.nid === selectedNid; });
  if (idx < 0) idx = 0;
  else idx = (idx + delta + items.length) % items.length;
  const el = items[idx];
  const nid = el.dataset.nid;
  revealChat(el.dataset.ck || findConvForNid(nid));
  selectedNid = nid;
  updateGlobalNavSlider(globalIndexByNid.get(String(nid)) || 1);
     if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
  clearItemSelection();
  el.classList.add("ptt-selected");
  updateSelectionStatus("item", nid, el.dataset.ck || findConvForNid(nid));
  el.scrollIntoView({ block: "center" });
}

function getExistingItems() {
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  if (!body) return [];
  return Array.from(body.querySelectorAll(".ptt-node[data-nid], tr.item-row[data-nid]"));
}

function revealExistingItem(el) {
  if (!el) return;
  const ck = el.dataset.ck || findConvForNid(el.dataset.nid);
  if (ck) revealChat(ck);
  el.hidden = false;
  if (el.style.display === "none") el.style.display = "";
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  let parent = el.parentElement;
  while (parent && parent !== body) {
    parent.hidden = false;
    if (parent.style.display === "none") parent.style.display = "";
    parent = parent.parentElement;
  }
}

function jumpExistingItem(delta) {
  cancelPendingExistingTimeSliderNavigation();
  const items = getExistingItems();
  if (!items.length) return;
  const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
  const selectedEl = body && body.querySelector(".ptt-selected[data-nid], tr.ptt-selected[data-nid]");
  let idx = selectedEl ? items.indexOf(selectedEl) : -1;
  if (idx < 0) idx = items.findIndex(function (el) { return el.dataset.nid === selectedNid; });
  if (idx < 0) idx = 0;
  else idx = (idx + delta + items.length) % items.length;
  const el = items[idx];
  revealExistingItem(el);
  const nid = el.dataset.nid;
  selectedNid = nid;
  updateGlobalNavSlider(globalIndexByNid.get(String(nid)) || 1);
    if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
  clearItemSelection();
  el.classList.add("ptt-selected");
  updateSelectionStatus("item", nid, el.dataset.ck || findConvForNid(nid));
  el.scrollIntoView({ block: "center" });
}

function jumpExistingByTime(delta) {
  const items = getExistingTimeNavigationItems();
  if (!items.length) {
    //updateExistingTimeNavSlider();
    return;
  }
  let idx = items.findIndex(function (item) { return item.nid === String(selectedNid || ""); });
  if (idx < 0) {
    const body = middleMode === "item" ? $("dateTimeView") : $("titleView");
    const selectedEl = body && body.querySelector(".ptt-selected[data-nid], tr.ptt-selected[data-nid]");
    if (selectedEl) idx = items.findIndex(function (item) { return item.nid === String(selectedEl.dataset.nid || ""); });
  }
  if (idx < 0) {
    $("status").textContent = "Select an indexed item first.";
    if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
    return;
  }
  const targetIndex = idx + (delta < 0 ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= items.length) {
    $("status").textContent = "No further existing item in time order.";
       if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
    return;
  }
  const target = items[targetIndex];
  revealExistingItem(target.el);
  const selected = selectItemByNid(target.nid, true, "head");
  if (!selected) $("status").textContent = "Could not focus existing item " + target.nid + ".";
    if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
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
  if (0) next.forEach(function (r) {
    const index = matched.indexOf(r);
    if (index >= 0) insertTitleSessionAtSearchPosition(index);
  });
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

// Refresh only the edited message inside its existing three-line PTT node.
// Keep chat metadata, item metadata, tree controls, menu and node identity intact.
function refreshEditedMessageInNode(nodeEl, dotsBtn, text) {
  if (!nodeEl) return;
  const nid = String(nodeEl.dataset.nid || (dotsBtn && dotsBtn.dataset.nid) || "");
  const convKey = String(nodeEl.dataset.ck || nidToConvKey.get(nid) || "");
  const tokens = parseSearch($("q").value).tokens;
  const titlePane = !!nodeEl.closest("#titleView");
  const content = nodeEl.querySelector(":scope > .ptt-row .ptt-message-content .msg-content");
  const labelWrap = nodeEl.querySelector(":scope > .ptt-row .ptt-item-meta .ptt-label-wrap");
  if (!content) return;

  const expanded = content.dataset.expanded === "1";
  content.dataset.text = String(text == null ? "" : text);
  content.dataset.foldable = shouldFoldMessage(text) ? "1" : "0";
  content.dataset.expanded = expanded ? "1" : "0";
  content.innerHTML = messageShownHtml(text, tokens, nid, expanded, convKey, titlePane);

  if (labelWrap) {
    let toggle = labelWrap.querySelector(".msg-toggle");
    if (shouldFoldMessage(text)) {
      if (!toggle) {
        toggle = document.createElement("a");
        toggle.href = "#";
        toggle.className = "msg-toggle";
        toggle.dataset.foldId = nid;
        labelWrap.appendChild(toggle);
      }
      toggle.dataset.foldId = nid;
      toggle.textContent = expanded ? "Show less" : "Read more";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    } else if (toggle) {
      toggle.remove();
    }
  }
  if (dotsBtn) dotsBtn.dataset.text = String(text == null ? "" : text);
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
  if (!forceAll) forceAllActive = false;
  // These derived indexes are scoped to one search/render pass. Build lazily and
  // reuse them across every item and gap rendered for the same conversation.
  chatItemOrderCache.clear();
  firstHitForChatCache.clear();
  olderHistoryNidsCache.clear();
  olderHistoryNidSetCache.clear();
  const unfoldQuery = String(q == null ? "" : q);
  const isNewQuery = lastUnfoldQuery !== unfoldQuery;
  if (lastUnfoldQuery !== null && isNewQuery) {
    // A genuinely new query starts with the default "Hit" policy per chat.
    // Gap expansion is different: keep it for the browser session and let the
    // stable NID boundary keys decide whether an expansion applies to a gap
    // in this query. Explicit per-message choices also survive query changes.
    chatUnfoldModes.clear();
    olderHistoryNidsCache.clear();
    olderHistoryNidSetCache.clear();
    // m/n/p/q insertions are scoped to the current search only.
    navigationPinnedNids.clear();
  }
  lastUnfoldQuery = unfoldQuery;
  forceOpenAsk.clear();
  const parsed = parseSearch(q);
  paintTokenBar(parsed.tokens);
  const source = filter === "recycle" ? recycleChats : rows;
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
  matched = source.filter(function (r) { return matchRow(r, q); });
  if ((isNewQuery && parsed.tokens.length) || forceAll) matched.forEach(function (r) { openChats.add(r.convKey); });
  hitList = [];
  if (parsed.tokens.length || forceAll) matched.forEach(function (r) { collectHits(r, parsed.tokens); });
  searchHitNids.clear();
  hitList.forEach(function (h) {
    if (/^(?:onMsg|ask|ans|sei|seo)-/.test(String(h.nid || ""))) searchHitNids.add(String(h.nid));
  });
  hitCursor = hitList.length ? 0 : -1;
  setSeek(100, "Seek 100%  " + matched.length + " urls + " + hitList.length + " hits");
  datetimeItems = []; dtStart = dtEnd = 0;
  if ($("dateTimeView")) $("dateTimeView").innerHTML = "";
  shown = 0;
  const titleBody = $("titleView");
  // Same query (a bag switch, refresh of the list): keep the pane and only
  // hide/show by bag, in search and no-search. A new query still rebuilds.
  const keepExisting = !forceAll && !isNewQuery && titleBody && titleBody.querySelector("tr[data-id][data-ck]");
   if (keepExisting) {
    const allowed = new Set(matched.map(function (r) { return String(r.convKey); }));
    titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
      const ck = String(row.dataset.ck || "");
      renderedCks.add(ck);
      const inBag = allowed.has(ck);
      row.hidden = false ;
      const detail = titleBody.querySelector('tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
      if (!inBag) {
        if (detail) detail.hidden = false;
      } else if (detail) {
        openChats.add(ck);
        detail.hidden = false;
        detail.querySelectorAll(".ptt-node").forEach(function (node) {
          node.hidden = false;
          if (node.style.display === "none") node.style.display = "";
        });
      } else if (parsed.tokens.length) {
        // Chat is entering this bag with no detail yet. Create its hits once.
        const session = matched.find(function (r) { return String(r.convKey) === ck; });
        if (session) {
          openChats.add(ck);
          row.insertAdjacentHTML("afterend",
            '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6">' +
            askBlock(session, viewAsks(ck), parsed.tokens) + "</td></tr>");
        }
      }
    });
    matched.slice(0, PAGE).forEach(function (r) {
      const ck = String(r.convKey);
      if (renderedCks.has(ck)) return;
      renderedCks.add(ck);
      if (parsed.tokens.length) openChats.add(ck);
      titleBody.insertAdjacentHTML("beforeend", rowHtml(r));
    });
    shown = matched.filter(function (r) { return renderedCks.has(String(r.convKey)); }).length;
    } else if (forceAll) {
  // original wipe + rebuild
  //if (titleBody) titleBody.innerHTML = "";
  const firstPage = matched.slice(0, PAGE);
  if (firstPage.length && titleBody) titleBody.insertAdjacentHTML("beforeend", firstPage.map(rowHtml).join(""));
  shown = firstPage.length;
  } else {
  //jcx
    //if (titleBody) titleBody.innerHTML = "";
    //const firstPage = matched.slice(0, PAGE);
    //if (firstPage.length && titleBody) titleBody.insertAdjacentHTML("beforeend", firstPage.map(rowHtml).join(""));
    //shown = firstPage.length;
    // New query, but do not wipe. Treat it like an incremental update.
  const allowed = new Set(matched.map(function (r) { return String(r.convKey); }));

  if (titleBody) {
    titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
      const ck = String(row.dataset.ck || "");
      renderedCks.add(ck);
      const inBag = allowed.has(ck);
        //jcx
      //row.hidden = !inBag;
      row.hidden = false ;
      const detail = titleBody.querySelector('tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
      if (!inBag) {
        //jcx
        //if (detail) detail.hidden = true;
        if (detail) detail.hidden = false ;
      } else if (detail) {
        openChats.add(ck);
        detail.hidden = false;
        // optionally: only unhide hit nodes, or leave them and let paintHits handle visibility
        detail.querySelectorAll(".ptt-node").forEach(function (node) {
          node.hidden = false;
          if (node.style.display === "none") node.style.display = "";
        });
      } else if (parsed.tokens.length) {
        // Chat is entering this bag with no detail yet. Create its hits once.
        const session = matched.find(function (r) { return String(r.convKey) === ck; });
        if (session) {
          openChats.add(ck);
          row.insertAdjacentHTML("afterend",
            '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6">' +
            askBlock(session, viewAsks(ck), parsed.tokens) + "</td></tr>");
        }
      }
    });

    // Create rows/details only for matched chats that are not yet in the DOM
    matched.slice(0, PAGE).forEach(function (r) {
      const ck = String(r.convKey);
      if (renderedCks.has(ck)) return;
      renderedCks.add(ck);
      if (parsed.tokens.length) openChats.add(ck);
      titleBody.insertAdjacentHTML("beforeend", rowHtml(r));
    });
  }
  shown = matched.filter(function (r) { return renderedCks.has(String(r.convKey)); }).length;
    


    
    
    
    
  }
  // Search fills both panes. Date-pane render happens before the pin replay
  // below, so a later m/n insert is not wiped by this search render.
  renderItemMode(parsed.tokens);
  if (middleMode !== "item") {
    $("empty").hidden = matched.length > 0;
    $("status").textContent = shown + " of " + matched.length + " shown";
  }
  paintHits(parsed.tokens);
  updateHeaderIndicators();
  // Re-apply m/n/p/q pins after a same-query rebuild (fold, filter, etc.).
  // A new or cleared search already emptied the set above.
  // No-search: restore only nodes that were already on screen, and only for
  // chats this bag listed. Do not pin-replay items from outside the bag.
  if (keepExisting) {
    // Pane was kept. m/n nodes are still in their detail rows.
  } else if (navigationPinnedNids.size) {
    const pinTokens = parsed.tokens;
    navigationPinnedNids.forEach(function (nid) {
      ensureTitleNidRendered(nid, pinTokens);
      ensureDateTimeNidRendered(nid, pinTokens);
    });
  }
  if (selectedNid) selectItemByNid(selectedNid, false);
  // Both search-hit membership and the rendered item collection are current.
  updateExistingTimeNavSlider();
}



function jumpHit(i) {
  if (!hitList.length) return;

  hitCursor = (i + hitList.length) % hitList.length;
  const h = hitList[hitCursor];

  //selectedId = h.urlid;
  
  console.log( "in jumpHit , h.urlid is :", h.urlid   );
  console.log( "in jumpHit , h.nid is :", h.nid   );
  
  
  selectedId = h.nid;
  updateSelectionStatus("hit", h.nid, h.convKey);
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
    updateLockAllTitlesButton();
    await loadRecycle();
    seek($("q").value);
    $("status").textContent = rows.length
      ? (shown + " of " + matched.length + " shown")
      : "0 chats.";
    if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
 
    
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
// Conversation title editing and locking are persisted by the background script,
// which also guards the canonical title-update path used by platform sync.
function updateLockAllTitlesButton() {
  const button = $("lockAllTitlesBtn");
  if (!button) return;
  const allLocked = rows.length > 0 && rows.every(function (r) { return !!r.titleLocked; });
  button.dataset.allLocked = allLocked ? "1" : "0";
  button.textContent = "lockAllTitlesBtn";
  button.title = allLocked
    ? "Currently all titles are locked; click to unlock all titles"
    : "Currently not all titles are locked; click to lock all titles";
}

$("lockAllTitlesBtn").addEventListener("click", async function () {
  const lock = $("lockAllTitlesBtn").dataset.allLocked !== "1";
  const result = await chrome.runtime.sendMessage({ type: "set-all-title-locks", locked: lock });
  if (result && result.error) {
    $("status").textContent = "Title lock update failed: " + result.error;
    return;
  }
  await loadLazy();
  $("status").textContent = lock ? "All saved conversation titles locked." : "All saved conversation titles unlocked.";
});

document.addEventListener("change", async function (e) {
  const checkbox = e.target.closest("input[data-title-lock][data-ck]");
  if (!checkbox) return;
  const result = await chrome.runtime.sendMessage({
    type: "set-title-lock", convKey: checkbox.dataset.ck, locked: checkbox.checked
  });
  if (!result || result.error || !result.ok) {
    checkbox.checked = !checkbox.checked;
    $("status").textContent = "Could not save title lock" + (result && result.error ? ": " + result.error : ".");
    return;
  }
  const rec = rows.find(function (r) { return String(r.convKey) === String(checkbox.dataset.ck); });
  if (rec) rec.titleLocked = checkbox.checked;
  updateLockAllTitlesButton();
  $("status").textContent = checkbox.checked ? "Conversation title locked." : "Conversation title unlocked.";
});

// Delegate from the document so Read more / Show less works in both panes.
document.addEventListener("click", function (e) {
  const titleEdit = e.target.closest("button[data-title-edit][data-ck]");
  if (titleEdit) {
    e.preventDefault();
    e.stopPropagation();
    const ck = titleEdit.dataset.ck;
    const rec = rows.find(function (r) { return String(r.convKey) === String(ck); }) || matched.find(function (r) { return String(r.convKey) === String(ck); });
    if (!rec) { $("status").textContent = "Could not find conversation for title edit."; return; }
    const edited = window.prompt("Edit conversation title:", String(rec.title || ""));
    if (edited === null) return;
    const title = edited.trim();
    if (!title) { $("status").textContent = "Title was not changed: title cannot be empty."; return; }
    chrome.runtime.sendMessage({ type: "set-conversation-title", convKey: ck, title: title }, async function (result) {
      const err = chrome.runtime.lastError;
      if (err || !result || !result.ok) {
        $("status").textContent = "Title edit failed: " + (err ? err.message : (result && result.error) || "conversation not found");
        return;
      }
      await loadLazy();
      $("status").textContent = "Conversation title saved.";
    });
    return;
  }
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
    e.preventDefault();
    e.stopPropagation();
    const more = editBtn.closest(".ptt-more");
    const dotsBtn = more && more.querySelector(".ptt-dots");
    const nodeEl = editBtn.closest(".ptt-node");
    const messageBox = nodeEl && nodeEl.querySelector(":scope > .ptt-row .ptt-message-content");
    if (!dotsBtn || !nodeEl || !messageBox) return;
    closeMenus();
    const originalHtml = messageBox.innerHTML;
    const box = document.createElement("textarea");
    box.className = "ptt-editbox";
    box.value = dotsBtn.dataset.text || "";
    const actions = document.createElement("div");
    actions.className = "ptt-edit-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    messageBox.replaceChildren(box, actions);
    actions.append(save, cancel);

    cancel.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      messageBox.innerHTML = originalHtml;
    };
    save.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const rk = dotsBtn.dataset.rk;
      const kind = dotsBtn.dataset.kind;
      const editedText = box.value;
      const msg = rk.indexOf("recycle:") === 0
        ? { type: "update-recycle-text", id: Number(rk.slice(8)), text: editedText }
        : { type: "update-node-text", recordKey: rk, kind: kind, text: editedText };
      save.disabled = true;
      cancel.disabled = true;
      chrome.runtime.sendMessage(msg, function (result) {
        const err = chrome.runtime.lastError;
        if (err || (result && (result.ok === false || result.error))) {
          save.disabled = false;
          cancel.disabled = false;
          $("status").textContent = "Text save failed: " + (err ? err.message : result.error);
          return;
        }
        applyEditedText(rk, kind, editedText);
        messageBox.innerHTML = originalHtml;
        refreshEditedMessageInNode(nodeEl, dotsBtn, editedText);
        $("status").textContent = "Text saved.";
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
  if (e.target.closest(".ptt-tog")) { clearTemporaryNavigationReveal(); onTreeToggle(e); return; }
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
  const unfoldAllBtn = e.target.closest(".chat-unfold-all");
  if (unfoldAllBtn) {
    e.preventDefault();
    e.stopPropagation();
    const ck = String(unfoldAllBtn.dataset.ck || "");
    if (!ck) return;
    openChats.add(ck);
    chatUnfoldModes.set(ck, "all");
    const bar = document.querySelector('#titleView tr[data-id][data-ck="' + CSS.escape(ck) + '"]');
    let detail = bar && bar.nextElementSibling;
    if (!detail || !detail.classList.contains("cmt-row") || String(detail.dataset.ck || "") !== ck) {
      const session = matched.find(function (r) { return String(r.convKey) === ck; }) || sessionForConversationKey(ck);
      if (bar && session) {
        const tokens = parseSearch($("q").value).tokens;
        bar.insertAdjacentHTML("afterend", '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6">' + askBlock(session, viewAsks(ck), tokens) + "</td></tr>");
        dirtyflag1 = true;
      }
    }
    applyChatItemVisibility(ck, true);
    const shown = document.querySelector('#titleView tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (shown) {
      shown.hidden = false;
      shown.querySelectorAll(".ptt-node").forEach(function (node) {
        node.hidden = false;
        if (node.style.display === "none") node.style.display = "";
      });
    }
    return;
  }
  const unfoldExistingBtn = e.target.closest(".chat-unfold-existing");
  if (unfoldExistingBtn) {
    e.preventDefault();
    e.stopPropagation();
    const ck = String(unfoldExistingBtn.dataset.ck || "");
    if (!ck) return;
    openChats.add(ck);
    const detail = document.querySelector('#titleView tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (!detail) return;
    detail.hidden = false;
    detail.querySelectorAll(".ptt-node").forEach(function (node) {
      node.hidden = false;
      if (node.style.display === "none") node.style.display = "";
    });
    return;
  }

  // ---- unfold range (ur) ----
  function chatLocalNids(ck) {
    // Returns ordered list of NIDs from oldest to newest for this chat.
    const asks = viewAsks(ck) || [];
    const nids = [];
    for (const ask of asks) {
      nids.push(askNidPrefix(ask) + "-" + (ask.recordKey || ask.localIndex));
      for (const ans of (ask.answers || [])) {
        nids.push(answerNidPrefix(ans) + "-" + (ans.recordKey || ans.localIndex));
      }
    }
    return nids;
  }

  function parseUnfoldRange(raw, total) {
    // Positive ranges count from the most-recent end (1 = newest).
    // Negative ranges count from the oldest end (-1 = oldest).
    // Overlaps are merged; out-of-scope values are clamped.
    if (!total) return [];
    const ranges = [];
    String(raw || "").split(/[\s,]+/).filter(Boolean).forEach(function (part) {
      const m = part.match(/^(-?\d+):(-?\d+)$/);
      if (!m) return;
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      function toIndex(n) {
        // return 0-based index into oldest→newest array
        if (n < 0) {
          // negative: from oldest. -1 = oldest (index 0), -2 = next, ...
          const fromOld = -n;               // 1-based from old end
          return Math.max(0, Math.min(total - 1, fromOld - 1));
        } else {
          // positive: from newest. 1 = newest (index total-1), 2 = second newest, ...
          const fromNew = n;                // 1-based from new end
          return Math.max(0, Math.min(total - 1, total - fromNew));
        }
      }
      let ia = toIndex(a);
      let ib = toIndex(b);
      if (ia > ib) { const t = ia; ia = ib; ib = t; }
      ranges.push([ia, ib]);
    });
    if (!ranges.length) return [];
    ranges.sort(function (x, y) { return x[0] - y[0]; });
    const merged = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      const cur = ranges[i];
      if (cur[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], cur[1]);
      } else {
        merged.push(cur.slice());
      }
    }
    return merged;
  }

  const unfoldRangeBtn = e.target.closest(".chat-unfold-range");
  if (unfoldRangeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const ck = String(unfoldRangeBtn.dataset.ck || "");
    if (!ck) return;
    const raw = prompt("Unfold range (e.g. 9:18,-17:-8)\nPositive = from newest, negative = from oldest", "1:20");
    if (raw == null) return;
    const nids = chatLocalNids(ck);
    const total = nids.length;
    if (!total) {
      if ($("status")) $("status").textContent = "No items in this chat.";
      return;
    }
    const ranges = parseUnfoldRange(raw, total);
    if (!ranges.length) {
      if ($("status")) $("status").textContent = "No valid range.";
      return;
    }
    openChats.add(ck);
    const tokens = parseSearch($("q").value).tokens;
    let count = 0;
    ranges.forEach(function (rg) {
      for (let i = rg[0]; i <= rg[1]; i++) {
        const nid = nids[i];
        if (nid) {
          ensureTitleNidRendered(nid, tokens);
          ensureDateTimeNidRendered(nid, tokens);
          count++;
        }
      }
    });
    // make sure the detail row is visible
    const detail = document.querySelector('#titleView tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (detail) {
      detail.hidden = false;
      detail.querySelectorAll(".ptt-node").forEach(function (node) {
        node.hidden = false;
        if (node.style.display === "none") node.style.display = "";
      });
    }
    if ($("status")) $("status").textContent = "Unfolded " + count + " item(s) in range.";
    return;
  }
  const foldOneBtn = e.target.closest(".chat-fold");
  if (foldOneBtn) {
    e.preventDefault();
    e.stopPropagation();
    const ck = String(foldOneBtn.dataset.ck || "");
    if (!ck) return;
    openChats.delete(ck);
    const detail = document.querySelector('#titleView tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (detail) detail.hidden = true;
    return;
  }
  const ans = e.target.closest(".ansfold");
  if (ans) {
    clearTemporaryNavigationReveal();
    const ck = ans.dataset.ck;
    if (openAns.has(ck)) openAns.delete(ck);
    else openAns.add(ck);
    seek($("q").value);
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

function nearestIndexedNid(index) {
  if (!globalNidByIndex.size) return null;
  const wanted = Number(index);
  if (!Number.isFinite(wanted)) return null;
  if (globalNidByIndex.has(wanted)) return globalNidByIndex.get(wanted);
  let bestNid = null, bestDistance = Infinity, bestIndex = Infinity;
  globalIndexByNid.forEach(function (candidateIndex, nid) {
    const distance = Math.abs(candidateIndex - wanted);
    if (distance < bestDistance || (distance === bestDistance && candidateIndex < bestIndex)) {
      bestDistance = distance; bestIndex = candidateIndex; bestNid = nid;
    }
  });
  return bestNid;
}
function goToGlobalIndex(goAll) {
  const input = $("globalIndexInput");
  const requested = Number.parseInt(input && input.value, 10);
  if (!Number.isFinite(requested) || requested < 1) {
    if (input) input.focus();
    $("status").textContent = "Enter a global index (1 or greater).";
    return;
  }
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
  let nid = globalNidByIndex.get(requested) || nearestIndexedNid(requested);
  if (!nid) { $("status").textContent = "No indexed items are available with the current item-type checkboxes."; return; }
  const actualIndex = globalIndexByNid.get(nid);
  if (actualIndex != null && actualIndex !== requested) {
    $("status").textContent = "Index " + requested + " is unavailable; jumping to nearest item #" + actualIndex + ".";
  }
  const tokens = parseSearch($("q").value).tokens;
  if (middleMode === "item") {
    // The datetime pane contains ask/onMsg rows with answers nested inside them.
    // Compare both the parent item and each answer by its own global index, but
    // retain the actual answer NID when an answer is the nearest target.
    buildDateTimeItems(tokens);
    if (!datetimeItems.length) { $("status").textContent = "No datetime-pane items match the current filters/search."; return; }
    const targetIndex = globalIndexByNid.get(nid);
    if (targetIndex == null) { $("status").textContent = "The requested global index could not be resolved."; return; }
    let bestNid = null, distance = Infinity, bestIdx = Infinity, bestCk = null;
    function consider(candidateNid, candidateCk) {
      const idx = globalIndexByNid.get(candidateNid);
      if (idx == null) return;
      const d = Math.abs(idx - targetIndex);
      if (d < distance || (d === distance && idx < bestIdx)) {
        bestNid = candidateNid; bestCk = candidateCk; distance = d; bestIdx = idx;
      }
    }
    datetimeItems.forEach(function (it) {
      consider(datetimeItemNid(it), it.convKey);
      (it.answers || []).forEach(function (a) {
        if (!showAnsNode(a) || !inTime(a.ts)) return;
        if (filter === "favorites" && !nodeLiked(a)) return;
        const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
        // In Hit-only search mode, only answer nodes that the renderer would
        // actually emit are valid Goto targets. Go All switches to All mode
        // below, so it can consider the answer even if it is not a search hit.
        const hitMode = tokens.length && (chatUnfoldModes.get(String(it.convKey)) || "hit") === "hit";
        if (hitMode && !goAll && !searchHitNids.has(ansNid) && !inOpenedGap(ansNid, it.convKey)) return;
        consider(ansNid, it.convKey);
      });
    });
    if (!bestNid) { $("status").textContent = "No indexed datetime-pane item is available."; return; }
    if (goAll && bestCk) {
      datetimeItems.filter(it => String(it.convKey) === String(bestCk)).forEach(function (it) {
        (it.answers || []).forEach(function (a) {
          const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
          expandedMessageNids.add(ansNid);
          messageFoldOverrides.set(ansNid, true);
        });
      });
    }
    renderDateTimeWindow(bestNid, true, "head");
    return;
  }
  const hit = findByNid(nid);
  if (!hit) { $("status").textContent = "The indexed item could not be resolved to a message record."; return; }
  const ck = findConvForNid(nid) || (function () {
    for (const [key, list] of asksByConv) if (list.some(c => c === hit.node || (c.answers || []).includes(hit.node))) return key;
    return null;
  })();
  if (!ck) { $("status").textContent = "Could not locate the owning chat session for this item."; return; }
  if (goAll) {
    openChats.add(ck);
    openAns.add(ck);
  }
  // Make sure the owning session row exists even if search/time/favorites filters
  // excluded it from the current list. It is added only to the title-pane DOM.
  let session = matched.find(r => String(r.convKey) === String(ck)) || rows.find(r => String(r.convKey) === String(ck)) || recycleChats.find(r => String(r.convKey) === String(ck));
  if (!session) { $("status").textContent = "The owning chat session is not available in the current data snapshot."; return; }
  const titleBody = $("titleView");
  let sessionRow = Array.from(titleBody.querySelectorAll('tr[data-ck]')).find(el => String(el.dataset.ck) === String(ck) && el.dataset.id);
  if (!sessionRow) {
    // Render only this session's row, not the entire result set.
    titleBody.insertAdjacentHTML("beforeend", rowHtml(session));
    sessionRow = Array.from(titleBody.querySelectorAll('tr[data-ck]')).find(el => String(el.dataset.ck) === String(ck) && el.dataset.id);
  }
  openChats.add(String(ck));
  let detail = sessionRow && sessionRow.nextElementSibling;
  if (!detail || !detail.classList.contains("cmt-row") || String(detail.dataset.ck) !== String(ck)) {
    if (sessionRow) {
      sessionRow.insertAdjacentHTML("afterend", '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6"><div class="ptt-tree"></div></td></tr>');
      detail = sessionRow.nextElementSibling;
    }
  }
  if (detail) detail.hidden = false;
  const fold = sessionRow && sessionRow.querySelector("button.fold");
  if (fold) fold.textContent = "\u2212";
  requestAnimationFrame(function () {
    if (!titleBody.querySelector('[data-nid="' + CSS.escape(nid) + '"]')) {
      // If the target is filtered out, add it only inside its owning session.
      // Keep ask nodes in timestamp order within the appropriate tree; answers
      // remain children of their parent ask whenever that parent can be found.
      const cell = detail && detail.querySelector("td");
      if (cell && !cell.querySelector(".ptt-tree")) cell.insertAdjacentHTML("beforeend", '<div class="ptt-tree"></div>');
      const tree = cell && cell.querySelector(".ptt-tree");
      const targetHtml = nodeHtmlFor(nid, ck, []);
      const insertTimestampOrdered = function (container, html, ts) {
        if (!container || !html) return;
        const siblings = Array.from(container.children).filter(el => el.classList.contains("ptt-node"));
        const next = siblings.find(el => (Number(el.dataset.ts) || 0) > (Number(ts) || 0));
        if (next) next.insertAdjacentHTML("beforebegin", html); else container.insertAdjacentHTML("beforeend", html);
      };
      if (hit.kind === "answer") {
        const parent = hit.parent;
        const parentNid = askNidPrefix(parent) + "-" + (parent.recordKey || parent.localIndex);
        let parentEl = titleBody.querySelector('[data-nid="' + CSS.escape(parentNid) + '"]');
        if (!parentEl && tree) {
          insertTimestampOrdered(tree, nodeHtmlFor(parentNid, ck, []), parent.ts);
          parentEl = titleBody.querySelector('[data-nid="' + CSS.escape(parentNid) + '"]');
        }
        if (parentEl && targetHtml) {
          let kids = parentEl.querySelector(":scope > .ptt-kids");
          if (!kids) {
            parentEl.insertAdjacentHTML("beforeend", '<div class="ptt-kids"></div>');
            kids = parentEl.querySelector(":scope > .ptt-kids");
          }
          if (kids) { kids.hidden = false; insertTimestampOrdered(kids, targetHtml, hit.node.ts); }
          const row = parentEl.querySelector(":scope > .ptt-row");
          if (row && !row.querySelector('.ptt-tog[data-side="R"]')) row.insertAdjacentHTML("beforeend", '<button type="button" class="ptt-tog" data-side="R">−</button>');
        }
      } else {
        insertTimestampOrdered(tree, targetHtml, hit.node.ts);
      }
    }
    selectItemByNid(nid, true, "head");
  });
}


function owningConversationKeyForNid(nid) {
  const mapped = findConvForNid(nid);
  if (mapped != null) return String(mapped);
  const hit = findByNid(nid);
  if (!hit) return null;
  const maps = [asksByConv, recycleAsks];
  for (const map of maps) {
    for (const [ck, list] of map) {
      if ((list || []).some(function (ask) {
        return ask === hit.node || ask === hit.parent || (ask.answers || []).includes(hit.node);
      })) return String(ck);
    }
  }
  return null;
}

function sessionForConversationKey(ck) {
  return matched.find(r => String(r.convKey) === String(ck)) ||
    rows.find(r => String(r.convKey) === String(ck)) ||
    recycleChats.find(r => String(r.convKey) === String(ck)) || null;
}

const timestampNormalizedContainers = new WeakSet();

function insertNidTimestampOrdered(container, html, ts) {
  if (!container || !html) return;

  const readTs = function (el) {
    const value = Number(el && el.dataset ? el.dataset.ts : NaN);
    return Number.isFinite(value) ? value : null;
  };

  // Normalize a container once because older versions of this helper could
  // insert newly revealed items at the wrong end. Keep existing nodes (and
  // their event handlers/state) intact while moving them into newest-first
  // order. Items without a usable timestamp go last.
  if (!timestampNormalizedContainers.has(container)) {
    const existing = Array.from(container.children)
      .filter(el => el.classList.contains("ptt-node"));
    existing.sort(function (a, b) {
      const aTs = readTs(a), bTs = readTs(b);
      if (aTs == null && bTs == null) return 0;
      if (aTs == null) return 1;
      if (bTs == null) return -1;
      return bTs - aTs;
    });
    existing.forEach(el => container.appendChild(el));
    timestampNormalizedContainers.add(container);
  }

  const numericTs = Number(ts);
  const newTs = Number.isFinite(numericTs) ? numericTs : null;
  const siblings = Array.from(container.children)
    .filter(el => el.classList.contains("ptt-node"));
  // Newest first. Insert before the first older (or timestamp-less) item;
  // equal timestamps stay stable, with the new item following existing peers.
  const next = siblings.find(function (el) {
    const siblingTs = readTs(el);
    if (newTs == null) return false;
    return siblingTs == null || siblingTs < newTs;
  });
  if (next) next.insertAdjacentHTML("beforebegin", html);
  else container.insertAdjacentHTML("beforeend", html);
}

function clearTemporaryNavigationReveal() {
  const titleBody = $("titleView");
  if (!titleBody) return;
  titleBody.querySelectorAll('tr.cmt-row[data-navigation-temporary="1"]').forEach(function (detail) {
    detail.querySelectorAll('.ptt-node[data-navigation-display-saved]').forEach(function (node) {
      node.style.display = node.dataset.navigationDisplaySaved;
      delete node.dataset.navigationDisplaySaved;
      delete node.dataset.navigationRevealed;
    });
    detail.querySelectorAll('.ptt-kids[data-navigation-hidden-saved]').forEach(function (kids) {
      kids.hidden = kids.dataset.navigationHiddenSaved === "1";
      delete kids.dataset.navigationHiddenSaved;
    });
    detail.hidden = !openChats.has(String(detail.dataset.ck || ""));
    delete detail.dataset.navigationTemporary;
  });
}

function temporarilyRevealNavigationTarget(nid) {
  const titleBody = $("titleView");
  if (!titleBody) return false;
  const ck = owningConversationKeyForNid(nid);
  if (ck == null) return false;
  const sessionRow = Array.from(titleBody.querySelectorAll('tr[data-id][data-ck]'))
    .find(row => String(row.dataset.ck) === String(ck));
  const detail = sessionRow && sessionRow.nextElementSibling;
  if (!detail || !detail.classList.contains('cmt-row') || String(detail.dataset.ck) !== String(ck)) return false;
  // An already-open chat still needs the stepped node unhidden. Fold all and
  // Hit mode can leave the node or its detail row hidden.
  if (openChats.has(String(ck))) {
    detail.hidden = false;
    const openTarget = Array.from(detail.querySelectorAll('[data-nid]'))
      .find(node => String(node.dataset.nid) === String(nid));
    if (openTarget) {
      openTarget.hidden = false;
      if (openTarget.style.display === "none") openTarget.style.display = "";
      let parent = openTarget.parentElement;
      while (parent && parent !== detail) {
        parent.hidden = false;
        if (parent.style.display === "none") parent.style.display = "";
        parent = parent.parentElement;
      }
    }
    return !!openTarget;
  }

  // Choose the copy in this conversation's own detail row, not the first
  // same-NID node elsewhere in the pane (which may be hidden/stale).
  const target = Array.from(detail.querySelectorAll('[data-nid]'))
    .find(node => String(node.dataset.nid) === String(nid));
  if (!target) return false;
  target.hidden = false;

  // Keep the session folded in its normal state, but expose the accumulated
  // navigation-revealed items plus this target. Previous revealed items stay
  // visible until the user explicitly changes Hit/All or fold state.
  detail.dataset.navigationTemporary = "1";
  detail.hidden = false;
  detail.querySelectorAll('.ptt-node').forEach(function (node) {
    if (node.dataset.navigationRevealed === "1") return;
    if (!Object.prototype.hasOwnProperty.call(node.dataset, 'navigationDisplaySaved')) {
      node.dataset.navigationDisplaySaved = node.style.display;
    }
    node.style.display = "none";
  });
  const parentAsk = target.closest('.ptt-kids') && target.closest('.ptt-kids').parentElement;
  [parentAsk, target].filter(Boolean).forEach(function (node) {
    if (!Object.prototype.hasOwnProperty.call(node.dataset, 'navigationDisplaySaved')) {
      node.dataset.navigationDisplaySaved = node.style.display;
    }
    node.dataset.navigationRevealed = "1";
    node.style.display = node.dataset.navigationDisplaySaved || "";
  });
  if (parentAsk) {
    const kids = parentAsk.querySelector(':scope > .ptt-kids');
    if (kids) {
      if (!Object.prototype.hasOwnProperty.call(kids.dataset, 'navigationHiddenSaved')) {
        kids.dataset.navigationHiddenSaved = kids.hidden ? "1" : "0";
      }
      kids.hidden = false;
    }
  }
  return true;
}


function chatNidShouldShow(nid, ck, tokens) {
  const mode = chatUnfoldModes.get(String(ck)) || "hit";
  if (!tokens.length || mode === "all") return true;
  return searchHitNids.has(String(nid)) || inOpenedGap(nid, ck) || inOpenedOlderHistory(nid, ck);
}

function paneNode(pane, nid) {
  if (!pane || !nid) return null;
  return pane.querySelector('[data-nid="' + CSS.escape(String(nid)) + '"]');
}

function syncDatePaneGroupVisibility() {
  const pane = $("dateTimeView");
  if (!pane) return;
  pane.querySelectorAll("tr.cmt-row[data-ck]").forEach(function (row) {
    const nodes = Array.from(row.querySelectorAll(".ptt-node[data-nid]"));
    const anyVisible = nodes.some(function (node) { return !node.hidden; });
    row.hidden = !anyVisible;
    const banner = row.previousElementSibling;
    if (banner && banner.classList.contains("banner") && String(banner.dataset.ck || "") === String(row.dataset.ck || "")) {
      banner.hidden = !anyVisible;
    }
  });
}

function datePaneNodesForChat(ck) {
  const pane = $("dateTimeView");
  if (!pane || !ck) return [];
  return Array.from(pane.querySelectorAll('.ptt-node[data-ck="' + CSS.escape(String(ck)) + '"]'));
}

function applyChatItemVisibility(ck, createMissing, preserveExisting) {
  const tokens = parseSearch($("q").value).tokens;
  const titlePane = $("titleView");
  const datePane = $("dateTimeView");
  const ignoreFold = $("datePaneIgnoreFold") && $("datePaneIgnoreFold").checked;
  const chatOpen = openChats.has(String(ck));
  chatItemOrder(ck).forEach(function (it) {
    const nid = String(it.nid || "");
    if (!nid) return;
    const show = preserveExisting ? true : chatNidShouldShow(nid, ck, tokens);
    let titleNode = paneNode(titlePane, nid);
    if (!titleNode && show && createMissing && chatOpen) ensureTitleNidRendered(nid, tokens);
    titleNode = paneNode(titlePane, nid);
    if (titleNode) titleNode.hidden = !show;
    const dateShow = show && (chatOpen || ignoreFold);
    let dateNode = paneNode(datePane, nid);
    if (!dateNode && dateShow && createMissing) ensureDateTimeNidRendered(nid, tokens);
    dateNode = paneNode(datePane, nid);
    if (dateNode) dateNode.hidden = !dateShow;
  });
  // Unfold restores nodes already on screen, including m/n inserts that are
  // not search hits. Hit/All remains the control that filters them.
  if (preserveExisting && chatOpen && titlePane) {
    const detail = titlePane.querySelector('tr.cmt-row[data-ck="' + CSS.escape(String(ck)) + '"]');
    if (detail) {
      detail.hidden = false;
      detail.querySelectorAll(".ptt-node").forEach(function (node) {
        node.hidden = false;
        if (node.style.display === "none") node.style.display = "";
      });
    }
  }
  // Fold must hide every on-screen date-pane node for this chat, including
  // All Go Prev inserts that are outside chatItemOrder's from-to filter.
  if (!chatOpen && !ignoreFold) {
    datePaneNodesForChat(ck).forEach(function (node) { node.hidden = true; });
  } else if (chatOpen) {
    datePaneNodesForChat(ck).forEach(function (node) { node.hidden = false; });
  }
  syncDatePaneGroupVisibility();
}

function ensureTitleNidRendered(nid, tokens) {
    //dirtyflag1 = false;
    console.log("in begin of   ensureTitleNidRendered :    "  ,nid, tokens   );
  const titleBody = $("titleView");
  const already = titleBody.querySelector('[data-nid="' + CSS.escape(nid) + '"]');
  if (already) { already.hidden = false; return true; }
  
  
  
   dirtyflag1 = true;
   //alert ("  in  ensureTitleNidRendered dirtyflag1 = true;");
  const hit = findByNid(nid);
  const ck = owningConversationKeyForNid(nid);
  if (!hit || !ck) return false;
  const session = sessionForConversationKey(ck);
  if (!session) return false;

  // Navigation may materialize an item, but must not change the user's
  // per-chat folded/unfolded choice. Keep openChats as the source of truth.
  let sessionRow = Array.from(titleBody.querySelectorAll('tr[data-id][data-ck]'))
    .find(el => String(el.dataset.ck) === String(ck));
  if (!sessionRow) {
    const sessionIndex = matched.findIndex(r => String(r.convKey) === String(ck));
    const nextSession = Array.from(titleBody.querySelectorAll('tr[data-id][data-ck]')).find(function (el) {
      const idx = matched.findIndex(r => String(r.convKey) === String(el.dataset.ck));
      return sessionIndex >= 0 && idx > sessionIndex;
    });
    if (nextSession) nextSession.insertAdjacentHTML("beforebegin", rowHtml(session));
    else titleBody.insertAdjacentHTML("beforeend", rowHtml(session));
    sessionRow = Array.from(titleBody.querySelectorAll('tr[data-id][data-ck]'))
      .find(el => String(el.dataset.ck) === String(ck));
  }
  if (!sessionRow) return false;

  let detail = sessionRow.nextElementSibling;
  if (!detail || !detail.classList.contains("cmt-row") || String(detail.dataset.ck) !== String(ck)) {
    sessionRow.insertAdjacentHTML("afterend",
      '<tr class="cmt-row" data-ck="' + esc(ck) + '" data-navigation-materialized="1"><td colspan="6"><div class="ptt-tree"></div></td></tr>');
    detail = sessionRow.nextElementSibling;
  }
  if (!detail) return false;
  // A newly materialized detail row follows the existing fold state. If the
  // row already existed, preserve its current visibility rather than revealing it.
  if (detail.dataset.navigationMaterialized === "1") {
    detail.hidden = !openChats.has(String(ck));
    delete detail.dataset.navigationMaterialized;
  }
  const cell = detail.querySelector("td");
  if (!cell) return false;

  const chooseTree = function (forLive) {
    let trees = Array.from(cell.querySelectorAll(".ptt-tree"));
    if (!trees.length) {
      cell.insertAdjacentHTML("beforeend", '<div class="ptt-tree"></div>');
      trees = Array.from(cell.querySelectorAll(".ptt-tree"));
    }
    return forLive ? trees[0] : trees[trees.length - 1];
  };

  // For an answer, make sure its parent ask is rendered first.
  if (hit.kind === "answer") {
    const parent = hit.parent;
    const parentNid = askNidPrefix(parent) + "-" + (parent.recordKey || parent.localIndex);
    let parentEl = titleBody.querySelector('[data-nid="' + CSS.escape(parentNid) + '"]');
    if (!parentEl) {
      const parentTree = chooseTree(false);
      insertNidTimestampOrdered(parentTree, nodeHtmlFor(parentNid, ck, []), parent.ts);
      parentEl = titleBody.querySelector('[data-nid="' + CSS.escape(parentNid) + '"]');
    }
    if (!parentEl) return false;
    let kids = parentEl.querySelector(":scope > .ptt-kids");
    if (!kids) {
      parentEl.insertAdjacentHTML("beforeend", '<div class="ptt-kids"></div>');
      kids = parentEl.querySelector(":scope > .ptt-kids");
    }
    if (!kids) return false;
    // Do not change the parent's answer-fold state merely to materialize a
    // navigation target. The target can remain inside a folded subtree.
    insertNidTimestampOrdered(kids, nodeHtmlFor(nid, ck, []), hit.node.ts);
    const row = parentEl.querySelector(":scope > .ptt-row");
    if (row && !row.querySelector('.ptt-tog[data-side="R"]')) {
      row.insertAdjacentHTML("beforeend", '<button type="button" class="ptt-tog" data-side="R">' + (kids.hidden ? '+' : '−') + '</button>');
    }
  } else {
    const tree = chooseTree(hit.kind === "onMsg");
    insertNidTimestampOrdered(tree, nodeHtmlFor(nid, ck, []), hit.node.ts);
  }
  return !!titleBody.querySelector('[data-nid="' + CSS.escape(nid) + '"]');
}

function datePaneRank(nid) {
  const idx = globalIndexByNid.get(String(nid || ""));
  if (idx != null) return idx;
  const hit = findByNid(nid);
  return hit && hit.node ? Number(hit.node.ts) || 0 : 0;
}

function datePaneItemCk(node) {
  if (!node) return "";
  return String(node.dataset.ck || owningConversationKeyForNid(node.dataset.nid) || "");
}

function ensureDateTimeNidRendered(nid, tokens) {
  return false;
  const tbody = $("dateTimeView");
  if (!tbody) return false;
  const already = tbody.querySelector('[data-nid="' + CSS.escape(String(nid)) + '"]');
  if (already) {
    already.hidden = false;
    const row = already.closest("tr.cmt-row");
    if (row) {
      row.hidden = false;
      const banner = row.previousElementSibling;
      if (banner && banner.classList.contains("banner")) banner.hidden = false;
    }
    return true;
  }
  const hit = findByNid(nid);
  const ck = owningConversationKeyForNid(nid);
  if (!hit || !ck) return false;
  const session = sessionForConversationKey(ck);
  if (!session) return false;
  // Date pane is not the title pane: do not apply hit-only text suppression.
  const html = nodeHtmlFor(nid, ck, tokens || [], false);
  if (!html) return false;

  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
  const rank = datePaneRank(nid);
  const nodes = Array.from(tbody.querySelectorAll(".ptt-node[data-nid]"));
  // Newest-first: a higher global index belongs earlier.
  let insertBefore = null;
  let prevItem = null;
  for (let i = 0; i < nodes.length; i++) {
    if (datePaneRank(nodes[i].dataset.nid) < rank) { insertBefore = nodes[i]; break; }
    prevItem = nodes[i];
  }
  const prevCk = datePaneItemCk(prevItem);
  const nextCk = datePaneItemCk(insertBefore);
  const sameAsPrev = !!prevItem && String(prevCk) === String(ck);
  const sameAsNext = !!insertBefore && String(nextCk) === String(ck);
  // A bar is needed only when neither neighbor is this chat. The same-chat
  // neighbor is often the next item, because the pane is newest-first.
  const needBanner = !sameAsPrev && !sameAsNext;
  const splitsRun = !!(needBanner && insertBefore && prevCk && nextCk === prevCk && nextCk !== String(ck));

  if (sameAsPrev || sameAsNext) {
    const anchor = sameAsPrev ? prevItem : insertBefore;
    const tree = anchor.closest(".ptt-tree");
    if (tree) {
      if (sameAsNext) insertBefore.insertAdjacentHTML("beforebegin", html);
      else if (insertBefore && tree.contains(insertBefore)) insertBefore.insertAdjacentHTML("beforebegin", html);
      else tree.insertAdjacentHTML("beforeend", html);
    } else if (sameAsNext) {
      insertBefore.insertAdjacentHTML("beforebegin", html);
    } else {
      prevItem.insertAdjacentHTML("afterend", html);
    }
  } else {
    const block = bannerRowHtml(session) +
      '<tr class="cmt-row" data-ck="' + esc(ck) + '"><td colspan="6"><div class="ptt-tree">' + html + "</div></td></tr>";
    if (insertBefore) {
      const row = insertBefore.closest("tr.cmt-row") || insertBefore;
      const anchor = row.previousElementSibling && row.previousElementSibling.classList.contains("banner")
        ? row.previousElementSibling
        : row;
      anchor.insertAdjacentHTML("beforebegin", block);
    } else {
      tbody.insertAdjacentHTML("beforeend", block);
    }
  }

  if (splitsRun) {
    const nextRow = insertBefore.closest("tr.cmt-row");
    const nextBanner = nextRow && nextRow.previousElementSibling;
    const hasOwnBanner = nextBanner && nextBanner.classList.contains("banner") &&
      String(nextBanner.dataset.ck) === nextCk;
    if (nextRow && !hasOwnBanner) {
      const nextSession = sessionForConversationKey(nextCk);
      if (nextSession) nextRow.insertAdjacentHTML("beforebegin", bannerRowHtml(nextSession));
    }
  }
  return !!tbody.querySelector('[data-nid="' + CSS.escape(String(nid)) + '"]');
}

function nearestVisibleDateTimeNid(index) {
  const wanted = Number(index);
  let best = null, bestDistance = Infinity, bestIndex = Infinity;
  function consider(nid) {
    const idx = globalIndexByNid.get(String(nid || ""));
    if (idx == null) return;
    const d = Math.abs(idx - wanted);
    if (d < bestDistance || (d === bestDistance && idx < bestIndex)) {
      best = nid; bestDistance = d; bestIndex = idx;
    }
  }
  datetimeItems.forEach(function (it) {
    consider(datetimeItemNid(it));
    (it.answers || []).forEach(function (a) {
      const ansNid = answerNidPrefix(a) + "-" + (a.recordKey || a.localIndex);
      if (showAnsNode(a) && inTime(a.ts) && (filter !== "favorites" || nodeLiked(a))) consider(ansNid);
    });
  });
  return best;
}
async function navigateGlobalOffset2(offset, directionLabel) {
  try {
    cancelPendingExistingTimeSliderNavigation();
    if (!Number.isInteger(offset) || offset === 0) {
      $("status").textContent = "Enter a non-zero integer offset (positive for next, negative for previous).";
      return;
    }
    if (!globalNidByIndex.size) buildGlobalChronologicalIndex();

    // 1. Filter global items to ONLY those belonging to the current bag/platfilter scope
    const allowedEntries = [];
    for (let i = 1; i <= globalNidByIndex.size; i++) {
      const nid = globalNidByIndex.get(i);
      if (!nid) continue;
      const ck = findConvForNid(nid) || owningConversationKeyForNid(nid);
      const session = findStatusSession(ck);
      if (session && chatMatchesBag(session)) {
        allowedEntries.push({ index: i, nid: String(nid) });
      }
    }

    if (!allowedEntries.length) {
      $("status").textContent = "No items match the current bag or platfilter scope.";
      return;
    }

    // 2. Find where our current selected NID sits within this scoped subset
    let currentNid = String(selectedNid || "");
    let scopedPos = allowedEntries.findIndex(function (entry) { return entry.nid === currentNid; });

    if (scopedPos < 0) {
      // If current selection isn't in scope, find the nearest scoped item by global index
      const globalCurrIdx = globalIndexByNid.get(currentNid) || 1;
      let closestDist = Infinity;
      allowedEntries.forEach(function (entry, pos) {
        const dist = Math.abs(entry.index - globalCurrIdx);
        if (dist < closestDist) {
          closestDist = dist;
          scopedPos = pos;
        }
      });
    }

    if (scopedPos < 0) scopedPos = 0;

    // 3. Apply the offset strictly within the filtered bag items
    const targetScopedPos = scopedPos + offset;
    if (targetScopedPos < 0 || targetScopedPos >= allowedEntries.length) {
      $("status").textContent = directionLabel === "next"
        ? "Reached the end of the current bag items."
        : "Reached the beginning of the current bag items.";
      return;
    }

    const targetEntry = allowedEntries[targetScopedPos];
    const targetNid = targetEntry.nid;
    selectedNid = targetNid;

    const tokens = parseSearch($("q").value).tokens;
    ensureTitleNidRendered(targetNid, tokens);
    ensureDateTimeNidRendered(targetNid, tokens);

    if (middleMode === "item") {
      renderDateTimeWindow(targetNid, true, "head");
    } else {
      temporarilyRevealNavigationTarget(targetNid);
      selectItemByNid(targetNid, true, "head");
    }

    $("status").textContent = "Jumped to scoped item #" + (targetScopedPos + 1) + " of " + allowedEntries.length + " in current bag.";

  } finally {
    if (dirtyflag1) updateExistingTimeNavSlider();
    if (dirtyflag1) dirtyflag1 = false;
  }
}
async function navigateGlobalOffset(offset, directionLabel) {  try {
 
  cancelPendingExistingTimeSliderNavigation();
  if (!Number.isInteger(offset) || offset === 0) {
    $("status").textContent = "Enter a non-zero integer offset (positive for next, negative for previous).";
    return;
  }
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();

  // Resolve the current logical item independently of the number/order of DOM
  // copies. If the cached index no longer contains it, recover the NID from the
  // selected title-pane node and rebuild the chronological index once before
  // giving up. This makes Next/Prev resilient to duplicate/stale title nodes.
  let currentNid = String(selectedNid || "");
  let currentIndex = currentNid ? globalIndexByNid.get(currentNid) : null;
  if (currentIndex == null) {
    const selectedNode = document.querySelector(
      (middleMode === "item" ? "#dateTimeView" : "#titleView") + " .ptt-selected[data-nid], " +
      (middleMode === "item" ? "#dateTimeView" : "#titleView") + " tr.ptt-selected[data-nid]"
    );
    if (selectedNode && selectedNode.dataset.nid) currentNid = String(selectedNode.dataset.nid);
    if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
    currentIndex = currentNid ? globalIndexByNid.get(currentNid) : null;
  }
  if (currentIndex == null) {
    $("status").textContent = "Select an indexed item first; the current selection has no global index even after rebuilding the index.";
    return;
  }
  selectedNid = currentNid;
  if ((directionLabel === "next" && offset < 0) || (directionLabel === "prev" && offset > 0)) {
    $("status").textContent = directionLabel === "next"
      ? "Go Next N requires a positive n."
      : "Go Prev M requires a negative m.";
    return;
  }
  const requestedIndex = currentIndex + offset;
  if (requestedIndex < 1 || requestedIndex > globalNidByIndex.size) {
    $("status").textContent = "Target index " + requestedIndex + " is outside the global index range (1–" + globalNidByIndex.size + ").";
    return;
  }

  let targetNid = globalNidByIndex.get(requestedIndex);
  if (!targetNid) {
    $("status").textContent = "Could not resolve target global index " + requestedIndex + ".";
    return;
  }
  // Navigation reveals accumulate: each visited item stays visible until the
  // user explicitly changes a fold/unfold or Hit/All display control.
  const low = Math.min(currentIndex, requestedIndex);
  const high = Math.max(currentIndex, requestedIndex);
  const tokens = parseSearch($("q").value).tokens;
  const intervalNidsForBoth = [];
  for (let idx = low; idx <= high; idx++) {
    const nid = globalNidByIndex.get(idx);
    if (nid) intervalNidsForBoth.push(String(nid));
  }
  pinNavigationNids(intervalNidsForBoth);
  // Keep both panes in sync. A hidden existing node must be unhidden, not skipped.
  intervalNidsForBoth.forEach(function (nid) {
    ensureTitleNidRendered(nid, tokens);
    ensureDateTimeNidRendered(nid, tokens);
  });

  if (middleMode === "item") {
    const tbody = $("dateTimeView");
    if (!tbody) {
      $("status").textContent = "Datetime pane is not available.";
      return;
    }
    // One ordered insert per missing nid. No pre-insert and no full innerHTML rebuild.
    let renderedInterval = 0;
    intervalNidsForBoth.forEach(function (nid) {
      if (ensureDateTimeNidRendered(nid, tokens)) renderedInterval++;
    });
    const hasRenderedNodes = !!tbody.querySelector('.ptt-node[data-nid]');
    $("empty").hidden = hasRenderedNodes;
    $("status").textContent = "Inserted " + renderedInterval + " interval item(s); global indexes " + low + "–" + high + ".";
    requestAnimationFrame(function () { selectItemByNid(targetNid, true, "head"); });
    
    

    
    return;
  }
   
  // In title mode, materialize AND reveal every indexed NID in the interval.
  // This is important for strides > 1: intermediate items must remain visible
  // too, not merely exist as hidden DOM nodes. For folded chats the reveal is
  // item-scoped, accumulates across navigation presses, and does not mark the
  // whole chat as unfolded. Explicit fold/unfold or Hit/All controls clear it.
  let rendered = 0;
  const intervalNids = [];
  for (let idx = low; idx <= high; idx++) {
    const nid = globalNidByIndex.get(idx);
    if (!nid) continue;
    if (ensureTitleNidRendered(nid, tokens)) {
      rendered++;
      intervalNids.push(String(nid));
    }
  }
  // Reveal each item after all interval nodes have been materialized, so each
  // target can be located in its final timestamp-ordered position. Reveals
  // persist because temporarilyRevealNavigationTarget preserves prior reveals.
  intervalNids.forEach(function (nid) {
    temporarilyRevealNavigationTarget(nid);
  });
  if (!ensureTitleNidRendered(targetNid, tokens)) {
    $("status").textContent = "Could not render target item #" + requestedIndex + ".";
    return;
  }
  requestAnimationFrame(function () {
    temporarilyRevealNavigationTarget(targetNid);
    const selected = selectItemByNid(targetNid, true, "head");
    
    
    
    if (!selected) {
      // A hidden duplicate or stale rendered tree must not make the button
      // claim success. Re-materialize/reveal the target once, then retry.
      ensureTitleNidRendered(targetNid, tokens);
      temporarilyRevealNavigationTarget(targetNid);
      
      

      
      
      const retried = selectItemByNid(targetNid, true, "head");
      $("status").textContent = retried
        ? "Recovered title-pane target #" + requestedIndex + " after refreshing its rendered node."
        : "Could not focus title-pane target #" + requestedIndex + " (NID " + targetNid + "). Try Refresh, then navigate again.";
      return;
    }
    $("status").textContent = "Rendered " + rendered + " indexed item(s) across global indexes " +
      low + "–" + high + "; selected #" + requestedIndex + " (NID " + targetNid + ").";
  });






} finally {

               //if (1) updateExistingTimeNavSlider();
              if (dirtyflag1)  updateExistingTimeNavSlider();
       //alert ('in naviglobal any ');
        //if (dirtyflag1) alert ('in naviglobal dirty ');
    //if (dirtyflag1) dirtyflag1 = false; 
}

}

function currentChatChronologicalIndex(convKey) {
  const key = String(convKey == null ? "" : convKey);
  const cached = currentChatNavIndexCache.get(key);
  if (cached && cached.generation === globalChronologicalIndexGeneration) return cached;

  // Build from this conversation's own ask/answer collections. This index is
  // independent of the global chronological index; seq gives deterministic
  // stable ordering for equal timestamps within the source collections.
  const entries = [];
  const seen = new Set();
  let seq = 0;
  for (const sourceMap of [asksByConv, recycleAsks]) {
    const list = sourceMap.get(key) || [];
    for (const ask of list) {
      const askNid = askNidPrefix(ask) + "-" + (ask.recordKey || ask.localIndex);
      if (showAskNode(ask) && !seen.has(askNid)) {
        seen.add(askNid);
        entries.push({ nid: String(askNid), ts: Number(ask.ts) || 0, seq: seq++ });
      }
      for (const answer of (ask.answers || [])) {
        const answerNid = answerNidPrefix(answer) + "-" + (answer.recordKey || answer.localIndex);
        if (showAnsNode(answer) && !seen.has(answerNid)) {
          seen.add(answerNid);
          entries.push({ nid: String(answerNid), ts: Number(answer.ts) || 0, seq: seq++ });
        }
      }
    }
  }

  entries.sort(function (a, b) {
    return a.ts - b.ts || a.seq - b.seq || a.nid.localeCompare(b.nid);
  });
  const nids = entries.map(entry => entry.nid);
  const positionByNid = new Map();
  nids.forEach((nid, position) => positionByNid.set(nid, position));

  const result = {
    convKey: key,
    generation: globalChronologicalIndexGeneration,
    nids,
    positionByNid
  };
  currentChatNavIndexCache.set(key, result);
  return result;
}

async function navigateCurrentChatOffset(step, directionLabel) {
  cancelPendingExistingTimeSliderNavigation();
  if (!Number.isInteger(step) || step <= 0) {
    $("status").textContent = "Enter a positive integer step.";
    return;
  }
  if (!selectedNid) {
    $("status").textContent = "Select an item in the chat first.";
    return;
  }

  // p/q are intentionally chat-local: do not build or consult the global
  // chronological index to find either the destination or intermediate items.
  const startNid = String(selectedNid);
  const convKey = findConvForNid(startNid) || owningConversationKeyForNid(startNid);
  if (convKey == null) {
    $("status").textContent = "Could not determine the current chat for the selected item.";
    return;
  }

  const chatIndex = currentChatChronologicalIndex(convKey);
  const startPosition = chatIndex.positionByNid.get(startNid);
  if (startPosition == null) {
    // Refresh only this chat's cache. No global index build is needed.
    currentChatNavIndexCache.delete(String(convKey));
    const refreshed = currentChatChronologicalIndex(convKey);
    const refreshedStart = refreshed.positionByNid.get(startNid);
    if (refreshedStart == null) {
      $("status").textContent = "The selected item is not present in the current chat's navigation index.";
      return;
    }
    return navigateCurrentChatOffsetFromIndex(refreshed, refreshedStart, step, directionLabel);
  }
  return navigateCurrentChatOffsetFromIndex(chatIndex, startPosition, step, directionLabel);
}

async function navigateCurrentChatOffsetFromIndex(chatIndex, startPosition, step, directionLabel) {
  const direction = directionLabel === "next" ? 1 : -1;
  const targetPosition = startPosition + direction * step;
  if (targetPosition < 0 || targetPosition >= chatIndex.nids.length) {
    $("status").textContent = direction > 0
      ? "Reached the end of the current chat before finding " + step + " more item(s)."
      : "Reached the beginning of the current chat before finding " + step + " previous item(s).";
    return;
  }

  const targetNid = String(chatIndex.nids[targetPosition]);
  const low = Math.min(startPosition, targetPosition);
  const high = Math.max(startPosition, targetPosition);
  const tokens = parseSearch($("q").value).tokens;
  let rendered = 0;

  // Materialize every item in the chat-local interval, then reveal each one.
  // This preserves stride behavior while avoiding global-index work and items
  // belonging to other conversations.
  const intervalNids = chatIndex.nids.slice(low, high + 1).map(String);
  pinNavigationNids(intervalNids);
  // Insert into both panes so a later switch does not lose the stepped items.
  intervalNids.forEach(function (nid) {
    ensureTitleNidRendered(nid, tokens);
    ensureDateTimeNidRendered(nid, tokens);
  });
  if (middleMode === "item") {
    const tbody = $("dateTimeView");
    if (!tbody) {
      $("status").textContent = "Datetime pane is not available.";
      return;
    }
    for (const nid of intervalNids) {
      if (ensureDateTimeNidRendered(nid, tokens)) rendered++;
    }
    requestAnimationFrame(function () {
      const selected = selectItemByNid(targetNid, true, "head");
      $("status").textContent = selected
        ? "Rendered " + rendered + " current-chat item(s) across chat-local positions " + (low + 1) + "–" + (high + 1) + "; selected " + targetNid + "."
        : "Could not focus current-chat target " + targetNid + ".";
    });
    return;
  }

  for (const nid of intervalNids) {
    if (ensureTitleNidRendered(nid, tokens)) rendered++;
  }
  intervalNids.forEach(function (nid) { temporarilyRevealNavigationTarget(nid); });
  requestAnimationFrame(function () {
    temporarilyRevealNavigationTarget(targetNid);
    const selected = selectItemByNid(targetNid, true, "head");
    $("status").textContent = selected
      ? "Rendered and revealed " + rendered + " current-chat item(s) across chat-local positions " + (low + 1) + "–" + (high + 1) + "; selected " + targetNid + "."
      : "Could not focus current-chat target " + targetNid + ".";
  });
}

function bindGlobalOffsetControls() {
  $("goNextGlobalBtn").addEventListener("click", function () {
    const raw = $("goNextGlobalOffset").value.trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n <= 0) { $("status").textContent = "Enter a positive integer n for All Go Next."; return; }
      navigateGlobalOffset(n, "next");
    if (dirtyflag1)  updateExistingTimeNavSlider();
    
    if (dirtyflag1) dirtyflag1 = false; 
  });
  $("goPrevGlobalBtn").addEventListener("click", function () {
    const raw = $("goPrevGlobalOffset").value.trim();
    const m = Number(raw);
    if (!raw || !Number.isInteger(m) || m <= 0) { $("status").textContent = "Enter a positive integer m for All Go Prev."; return; }
       navigateGlobalOffset(-m, "prev");
        if (dirtyflag1)  updateExistingTimeNavSlider();
       
      //  if (dirtyflag1)  alert("updateExistingTimeNavSlider()  ;   in goPrevGlobalOffset handler    ");
    if (dirtyflag1) dirtyflag1 = false; 
  });
  $("goNextPBtn").addEventListener("click", function () {
    const raw = $("goNextOffset").value.trim();
    const p = Number(raw);
    if (!raw || !Number.isInteger(p) || p <= 0) { $("status").textContent = "Enter a positive integer p."; return; }
    navigateCurrentChatOffset(p, "next");
        if (dirtyflag1)  updateExistingTimeNavSlider();
    if (dirtyflag1) dirtyflag1 = false; 
  });
  $("goPrevQBtn").addEventListener("click", function () {
    const raw = $("goPrevOffset").value.trim();
    const q = Number(raw);
    if (!raw || !Number.isInteger(q) || q <= 0) { $("status").textContent = "Enter a positive integer q."; return; }
    navigateCurrentChatOffset(q, "prev");
        if (dirtyflag1)  updateExistingTimeNavSlider();
    if (dirtyflag1) dirtyflag1 = false; 
  });
  [
    ["goNextGlobalOffset", "goNextGlobalBtn"],
    ["goPrevGlobalOffset", "goPrevGlobalBtn"],
    ["goNextOffset", "goNextPBtn"],
    ["goPrevOffset", "goPrevQBtn"]
  ].forEach(function (pair) {
    $(pair[0]).addEventListener("keydown", function (e) { if (e.key === "Enter") $(pair[1]).click(); });
  });
}
bindGlobalOffsetControls();

(function bindGlobalNavSlider() {
  const slider = $("globalNavSlider");
  if (!slider) return;
  slider.addEventListener("input", function () {
    const total = globalNidByIndex.size;
    $("globalNavSliderCount").textContent = total ? Number(slider.value) + " / " + total : "0 / 0";
  });
  slider.addEventListener("change", function () {
    if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
    const total = globalNidByIndex.size;
    if (!total) { updateGlobalNavSlider(0); return; }
    const target = Math.max(1, Math.min(total, Number(slider.value) || 1));
    const nid = globalNidByIndex.get(target);
    if (!nid) return;
    const input = $("globalIndexInput");
    if (input) input.value = String(target);
    // Reuse the established global-index jump path so folded/filtered sessions
    // are handled consistently with Goto; no full pane rebuild is requested here.
    goToGlobalIndex(false);
    updateGlobalNavSlider(globalIndexByNid.get(String(nid)) || target);
  });
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
  updateGlobalNavSlider(globalIndexByNid.get(String(selectedNid || "")) || 1);
})();


(function bindExistingTimeNavSlider() {
  const slider = $("existingTimeNavSlider");
  if (!slider) return;
    if (slider && slider.parentElement) {
      slider.parentElement.addEventListener("click", function (e) {
        if (dirtyflag1)  updateExistingTimeNavSlider();
        if (dirtyflag1)  dirtyflag1 = false;
      });
    }
  function navigateToSliderPosition() {
    existingTimeSliderTimer = null;
    const items = getExistingTimeNavigationItems();
    const total = items.length;
    if (!total) { updateExistingTimeNavSlider(); return; }
    const targetPosition = Math.max(1, Math.min(total, Number(slider.value) || 1));
    const target = items[targetPosition - 1];
    if (!target) return;
    revealExistingItem(target.el);
    existingTimeSliderNavigating = true;
    let selected = false;
    try {
      selected = selectItemByNid(target.nid, true, "head");
    } finally {
      existingTimeSliderNavigating = false;
    }
    if (!selected) $("status").textContent = "Could not focus existing item " + target.nid + ".";
            if (dirtyflag1)  updateExistingTimeNavSlider();
        if (dirtyflag1)  dirtyflag1 = false;
  }

  slider.addEventListener("input", function () {
    const total = getExistingTimeNavigationItems().length;
    const position = total ? Math.max(1, Math.min(total, Number(slider.value) || 1)) : 0;
    $("existingTimeNavSliderCount").textContent = total ? position + " / " + total : "0 / 0";

    // Live/debounced navigation: thumb and counter respond immediately, while
    // actual NID selection runs after the user pauses for 200 ms.
    cancelPendingExistingTimeSliderNavigation();
    if (total) {
      existingTimeSliderTimer = setTimeout(navigateToSliderPosition, EXISTING_TIME_SLIDER_DEBOUNCE_MS);
    }
  });

  // Native range controls fire change when the drag is released. Flush the
  // pending target immediately so the final position never waits for timeout.
  slider.addEventListener("change", function () {
    cancelPendingExistingTimeSliderNavigation();
    navigateToSliderPosition();
  });

         if (dirtyflag1)  updateExistingTimeNavSlider();
        if (dirtyflag1)  dirtyflag1 = false;
})();

$("globalGotoBtn").addEventListener("click", function () { 
const newest = globalNidByIndex.get(globalNidByIndex.size);
  if (newest) {
    selectedNid = newest;
    const tokens = parseSearch($("q").value).tokens;
    const existing = document.querySelector('[data-nid="' + CSS.escape(newest) + '"]');
    if (!existing) ensureTitleNidRendered(newest, tokens);
    revealChat(findConvForNid(newest));
    selectItemByNid(newest, true, "head");
  }
 });
if (0) $("globalGotoBtn").addEventListener("click", function () { 
if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
  const newest = globalNidByIndex.get(globalNidByIndex.size);
  if (!newest) {
    $("status").textContent = "No indexed items.";
    return;
  }
  const tokens = parseSearch($("q").value).tokens;
  const existing = document.querySelector('#titleView [data-nid="' + CSS.escape(newest) + '"]');
  if (!existing) ensureTitleNidRendered(newest, tokens);
  revealChat(findConvForNid(newest));
  selectItemByNid(newest, true, "head");
  selectedNid = newest;
 });
$("globalGoAllBtn").addEventListener("click", function () { goToGlobalIndex(true); });
$("globalIndexInput").addEventListener("keydown", function (e) { if (e.key === "Enter") goToGlobalIndex(false); });

function showMiddleMode(mode) {
  middleMode = mode;
  $("titleView").hidden = mode !== "ptt";
  $("dateTimeView").hidden = mode !== "item";
  updateHeaderIndicators();
  updateExistingTimeNavSlider();
}


$("thTitle").addEventListener("click", function () {
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

  // Target is not in the title pane. Insert that nid only. Do not flip the
  // chat to All mode or rebuild every item; Unfold all is the chat-bar button.
  openChats.add(ck);
  ensureTitleNidRendered(nid, tokens);
  revealChat(ck);
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
$("prevExisting").onclick = function () { jumpExistingItem(-1); };
$("nextExisting").onclick = function () { jumpExistingItem(1); };
$("ptExist").onclick = function () { jumpExistingByTime(-1); };
$("ntExist").onclick = function () { jumpExistingByTime(1); };
$("foldAllChatsBtn").onclick = function () {
  clearTemporaryNavigationReveal();
  batchAskOpen = false;
  const cks = new Set();
  openChats.forEach(function (ck) { cks.add(String(ck)); });
  document.querySelectorAll("#titleView [data-ck], #dateTimeView [data-ck]").forEach(function (el) {
    if (el.dataset.ck) cks.add(String(el.dataset.ck));
  });
  cks.forEach(function (ck) {
    // openChats.delete(ck);  // commented out so bag switch / later reveal still sees open state
    const detail = document.querySelector('#titleView tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (detail) detail.hidden = true;
  });
};
$("foldAsksBtn").onclick = function () { clearTemporaryNavigationReveal(); batchAskOpen = false; matched.forEach((r) => openChats.delete(r.convKey)); seek($("q").value); };
$("unfoldAsksBtn").onclick = function () { clearTemporaryNavigationReveal(); batchAskOpen = true; matched.forEach((r) => openChats.add(r.convKey)); seek($("q").value); };
$("foldAnsBtn").onclick = function () { clearTemporaryNavigationReveal(); batchAnsOpen = false; openAns.clear(); forceOpenAsk.clear(); seek($("q").value); };
$("unfoldAnsBtn").onclick = function () { clearTemporaryNavigationReveal(); batchAnsOpen = true; matched.forEach((r) => openAns.add(r.convKey)); seek($("q").value); };

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
function applyBagFilter() {
  const titleBody = $("titleView");
  if (!titleBody) return;

  // rebuild the matched set using the current filter + current query,
  // but only for bag/time rules (after you have removed search filtering from matchRow)
  const q = $("q") ? $("q").value : "";
  const source = filter === "recycle" ? recycleChats : rows;
  const matchedNow = source.filter(function (r) { return matchRow(r, q); });
  const allowed = new Set(matchedNow.map(function (r) { return String(r.convKey); }));

  titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
    const ck = String(row.dataset.ck || "");
    const inBag = allowed.has(ck);
    row.hidden = !inBag;
    const detail = titleBody.querySelector('tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
    if (detail) detail.hidden = !inBag;
  });
}

if (0) document.querySelector(".side").addEventListener("click", function (e) {
   applyBagFilter( );
   })
if (1) document.querySelector(".side").addEventListener("click", function (e) {
  const el = e.target.closest("[data-filter]");
  if (!el) return;
  document.querySelectorAll(".side [data-filter]").forEach(function (x) { x.classList.remove("on"); });
  el.classList.add("on");
  filter = el.dataset.filter;
  
  
  // --- ADD THIS LINE TO RE-SYNC HITS AND NAVIGATION STATE ON BAG SWITCH ---
seek($("q").value);

  
  
  // Bag click only: hide other chat bars + details, reveal own. No seek, no rebuild.
  const titleBody = $("titleView");
  if (!titleBody) return;
  const source = filter === "recycle" ? recycleChats : rows;
  const byKey = new Map(source.map(function (r) { return [String(r.convKey), r]; }));
  titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
    const ck = String(row.dataset.ck || "");
    const r = byKey.get(ck);
    const inBag = r ? chatMatchesBag(r) : false;
    row.hidden = !inBag;
          const detail = titleBody.querySelector('tr.cmt-row[data-ck="' + CSS.escape(ck) + '"]');
      if (detail) detail.hidden = !inBag;
    

    
    
    
  });
  // Keep lower pane in sync when a search is active
  const parsed = parseSearch($("q").value);
  if (parsed.tokens.length) {
    const allowed = new Set();
    titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
      if (!row.hidden) allowed.add(String(row.dataset.ck || ""));
    });
    hitList = hitList.filter(function (h) { return allowed.has(String(h.convKey)); });
    searchHitNids.clear();
    hitList.forEach(function (h) {
      if (/^(?:onMsg|ask|ans|sei|seo)-/.test(String(h.nid || ""))) searchHitNids.add(String(h.nid));
    });
    paintHits(parsed.tokens);
  }
  updateExistingTimeNavSlider();
  if (filter === "favorites") showFavPane(); else hideFavPane();
  
     

  
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

// Optional compact layout for each PTT node. This is presentation-only:
// the node structure, ordering, selection and delegated event handlers remain unchanged.
function functionSetPttSingleLine() {
  const box = $("pttSingleLine");
  if (!box) return;
  function paint(on) {
    box.checked = !!on;
    document.body.classList.toggle("ptt-single-line", !!on);
  }
  box.addEventListener("change", function () {
    paint(box.checked);
    chrome.storage.local.set({ pttSingleLine: box.checked });
  });
  chrome.storage.local.get({ pttSingleLine: false }).then(function (bag) {
    paint(bag.pttSingleLine);
  });
}
functionSetPttSingleLine();

// Global chat metadata visibility for every PTT node. This is a CSS-only
// presentation toggle: it does not rebuild nodes or refresh either pane.
function functionSetPttShowChatInfo() {
  const box = $("pttShowChatInfo");
  if (!box) return;
  function paint(on) {
    box.checked = !!on;
    document.body.classList.toggle("ptt-hide-chat-info", !on);
  }
  box.addEventListener("change", function () {
    paint(box.checked);
    chrome.storage.local.set({ pttShowChatInfo: box.checked });
  });
  chrome.storage.local.get({ pttShowChatInfo: true }).then(function (bag) {
    paint(bag.pttShowChatInfo !== false);
  });
}
functionSetPttShowChatInfo();

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

function clearExistingKeepHits() {
  const body = $("titleView");
  if (!body) return;
  const nodes = Array.from(body.querySelectorAll(".ptt-node[data-nid]"));
  const drop = nodes.filter(function (node) {
    const nid = String(node.dataset.nid || "");
    const isHit = searchHitNids.has(nid) || !!node.querySelector(":scope > .ptt-row .ptt-hit-dot");
    const holdsHit = Array.from(node.querySelectorAll(".ptt-node[data-nid]")).some(function (child) {
      return searchHitNids.has(String(child.dataset.nid || "")) || !!child.querySelector(":scope > .ptt-row .ptt-hit-dot");
    });
    return !isHit && !holdsHit;
  });
  drop.forEach(function (node) { if (node.isConnected) node.remove(); });
  body.querySelectorAll("tr.cmt-row").forEach(function (detail) {
    if (!detail.querySelector(".ptt-node[data-nid]")) detail.remove();
  });
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
 
  
  $("status").textContent = "Cleared non-hit items. Selected newest.";
}

$("reloadBtn").onclick = function () { clearExistingKeepHits(); };
$("clearAllBtn").onclick = function () {
  $("q").value = "";
  searchHitNids.clear();
  navigationPinnedNids.clear();  //added this 
  renderedCks.clear();
  const body = $("titleView");
  if (body) {
    body.querySelectorAll(".ptt-node[data-nid]").forEach(function (node) { node.remove(); });
    body.querySelectorAll("tr.cmt-row").forEach(function (detail) { detail.remove(); });
  }
  seek("");
  if (!globalNidByIndex.size) buildGlobalChronologicalIndex();
 
  
  $("status").textContent = "Cleared search and existing items.";
};
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
      if (!rest.convKey && rest.platform && rest.conversationId) rest.convKey = rest.platform + "|" + rest.conversationId;
      if (!rest.convKey) return;
      const existingReq = rs.index("byConv").get(rest.convKey);
      existingReq.onsuccess = function () {
        const existing = existingReq.result;
        if (existing) {
          // An import may update other metadata, but it must not bypass a title lock.
          rest.id = existing.id;
          if (existing.titleLocked) {
            rest.title = existing.title;
            rest.titleLocked = true;
          } else if (rest.titleLocked == null) {
            rest.titleLocked = !!existing.titleLocked;
          }
        } else {
          delete rest.id;
          if (rest.titleLocked == null) rest.titleLocked = false;
        }
        rs.put(rest);
      };
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
  const side = document.querySelector(".side-current-items");
  if (!side) return;
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

function withFavContext(fn) {
  const saved = { filter: filter, showAsk: showAsk, showAns: showAns, showSei: showSei, showSeo: showSeo, showOnMsg: showOnMsg };
  filter = "favorites";
  showAsk = showAns = showSei = showSeo = showOnMsg = true;
  try { return fn(); } finally {
    filter = saved.filter;
    showAsk = saved.showAsk; showAns = saved.showAns;
    showSei = saved.showSei; showSeo = saved.showSeo; showOnMsg = saved.showOnMsg;
  }
}
function favOnlyNodes(session) {
  const list = viewAsks(session.convKey);
  const parts = [];
  withFavContext(function () {
    list.forEach(function (c) {
      const likedAns = (c.answers || []).filter(nodeLiked);
      if (!nodeLiked(c) && !likedAns.length) return;
      const savedAns = c.answers;
      c.answers = likedAns;
      try {
        parts.push(pttAskNode(c, [], true, isOnMsg(c) ? "onMsg" : "ask", session.convKey, true));
      } finally {
        c.answers = savedAns;
      }
    });
  });
  return parts.length ? '<div class="ptt-tree">' + parts.join("") + "</div>" : '<div class="cmt">No liked items in this chat.</div>';
}
function favBarHtml(session, withDetail) {
  const detail = withDetail
    ? '<tr class="cmt-row fav-detail" data-ck="' + esc(session.convKey) + '"><td colspan="6">' + favOnlyNodes(session) + "</td></tr>"
    : "";
  return '<tr data-id="' + session.id + '" data-ck="' + esc(session.convKey) + '" class="fav-bar">' +
    "<td>" + esc(fmtTs(rowTs(session))) + "</td><td>" + esc(session.platform) + "</td>" +
    '<td><button type="button" class="unfoldfav" data-ck="' + esc(session.convKey) + '">unfoldfav</button>' +
    esc(session.title || "(untitled)") + "</td>" +
    '<td>' + esc(session.conversationId || session.url || "") + "</td>" +
    "<td></td><td>" + session.id + "</td></tr>" + detail;
}
function chatsWithFavs() {
  const source = rows.concat(recycleChats || []);
  const seen = new Set();
  return source.filter(function (r) {
    const k = String(r.convKey);
    if (seen.has(k)) return false;
    if (!chatHasLiked(r)) return false;
    seen.add(k);
    return true;
  });
}
function showFavPane() {
  const pane = $("thfavPane");
  if (pane) pane.classList.add("on");
}
function hideFavPane() {
  const pane = $("thfavPane");
  if (pane) pane.classList.remove("on");
}
function unfoldAllFav() {
  const tb = $("thfavView");
  if (!tb) return;
  showFavPane();
  const chats = chatsWithFavs();
  tb.innerHTML = chats.map(function (r) { return favBarHtml(r, true); }).join("");
  $("status").textContent = "Favorites pane: " + chats.length + " chat(s) with liked items.";
}
function unfoldFavChat(ck) {
  const tb = $("thfavView");
  if (!tb) return;
  showFavPane();
  const session = rows.concat(recycleChats || []).find(function (r) { return String(r.convKey) === String(ck); });
  if (!session) return;
  const existing = tb.querySelector('tr.fav-bar[data-ck="' + CSS.escape(ck) + '"]');
  const html = favBarHtml(session, true);
  if (existing) {
    const detail = existing.nextElementSibling;
    if (detail && detail.classList.contains("fav-detail")) detail.remove();
    existing.outerHTML = html;
  } else {
    tb.insertAdjacentHTML("beforeend", html);
  }
}

document.querySelector(".side").addEventListener("contextmenu", function (e) {
  e.preventDefault();
  sideTarget = e.target.closest("[data-filter]");
  if (sideTarget && sideTarget.dataset.filter === "favorites") {
    const fm = $("favMenu");
    if (fm) {
      fm.hidden = false;
      fm.style.left = e.clientX + "px";
      fm.style.top = e.clientY + "px";
    }
    $("sideMenu").hidden = true;
    return;
  }
  $("favMenu").hidden = true;
  $("sideAdd").hidden = false;
  $("sideConfig").hidden = !(sideTarget && sideTarget.dataset.extra === "1");
  $("sideDelete").hidden = !(sideTarget && sideTarget.dataset.extra === "1");
  const menu = $("sideMenu");
  menu.hidden = false;
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
});
$("favUnfoldAll").addEventListener("click", function () {
  $("favMenu").hidden = true;
  alert ('using the \' force search button \' instead ....');
  //unfoldAllFav();
});
document.addEventListener("click", function (e) {
  if (!e.target.closest("#favMenu")) $("favMenu").hidden = true;
});
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".unfoldfav");
  if (!btn) return;
  unfoldFavChat(btn.dataset.ck);
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
if (0) $("sideConfig").addEventListener("click", function () {
  if (!sideTarget) return;
  const item = sideRoutes.find((x) => x.id === sideTarget.dataset.filter);
  if (!item) return;
  $("routeTitle").textContent = item.name;
  $("routeText").value = item.text || "";
  $("routeBox").hidden = false;
  $("routeBox").dataset.id = item.id;
});

$("sideConfig").addEventListener("click", function () {
  if (!sideTarget) return;
  const item = sideRoutes.find((x) => x.id === sideTarget.dataset.filter);
  if (!item) return;
  
  $("routeTitle").textContent = item.name;
  $("routeText").value = item.text || "";
  
  // --- ADD THIS BLOCK TO DISPLAY PLATFORM / ROUTE ID ---
  let platformDisplay = document.getElementById("routePlatformInfo");
  if (!platformDisplay) {
    platformDisplay = document.createElement("div");
    platformDisplay.id = "routePlatformInfo";
    platformDisplay.style.cssText = "margin-bottom: 6px; font-size: 11px; color: #555;";
    const textarea = $("routeText");
    textarea.parentNode.insertBefore(platformDisplay, textarea);
  }
  // Make the platform text copyable using a read-only input or selectable text box
  platformDisplay.innerHTML = 'Platform ID: <input type="text" readonly value="' + esc(item.id) + '" style="width: 230px; font-family: Consolas, monospace; font-size: 11px; background: #f0f0f0; border: 1px solid #ccc; padding: 2px 4px;" title="Click to select and copy">';
  // ----------------------------------------------------

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
$("sideRename").addEventListener("click", function (e) {
if (!sideTarget) return;
  const item = sideRoutes.find((x) => x.id === sideTarget.dataset.filter);
  if (!item) return;

  // This will pop out the native prompt message box
  const newName = prompt("Enter new name:", item.name);
  if (!newName || !newName.trim()) return;

  // Update the item name
  item.name = newName.trim();

  // Save to storage and refresh the sidebar UI
  chrome.storage.local.set({ sideRoutes: sideRoutes }, function () {
    paintSideRoutes();
    
    // Hide the side menu after renaming
    $("sideMenu").hidden = true;
  });
});




$("sideDelete").addEventListener("click", function () {
  if (!sideTarget) return;
  sideRoutes = sideRoutes.filter((x) => x.id !== sideTarget.dataset.filter);
  chrome.storage.local.set({ sideRoutes: sideRoutes });
  paintSideRoutes();
});

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
          if (scrollFetchGuardDepth === 0) isScrollFetching = false;
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
          if (scrollFetchGuardDepth === 0) isScrollFetching = false;
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

    dtStart = 0;
    dtEnd = datetimeItems.length;
    // Fixed list: do not append, prepend, or trim a datetime window.
    return;

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








// Bind offset inputs to automatically trigger a seek/re-render when modified
["offsetH", "offsetM", "offsetS"].forEach(function (id) {
  const input = $(id);
  if (!input) return;
  input.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      const vals = {
        offsetH: Number.parseInt($("offsetH").value, 10) || 0,
        offsetM: Number.parseInt($("offsetM").value, 10) || 0,
        offsetS: Number.parseInt($("offsetS").value, 10) || 0
      };
      chrome.storage.local.set(vals);
      seek($("q").value);
    }, 120);
  });
});

// Load saved offset values on startup
if ($("forceSearch")) $("forceSearch").addEventListener("click", function () {
  forceAllActive = true;
  forceAll = true;
  seek($("q").value);
  forceAll = false;

  
});


// Tab 3: one checkbox per toolbar/bar2/slider control, to hide or show it.
(function buildTab3Toggles() {
  const panel = $("tab3Toggles");
  if (!panel) return;
  const seen = new Set();
  const entries = [];
  function add(el, target, name) {
    if (!el || !el.id || seen.has(el.id)) return;
    seen.add(el.id);
    entries.push({ id: el.id, target: target || el, name: name });
  }
  document.querySelectorAll(".toolbar button, .bar2 button").forEach(function (el) {
    add(el, el, el.textContent.trim() || el.id);
  });
  document.querySelectorAll(".toolbar input, .bar2 input, .toolbar select, .bar2 select").forEach(function (el) {
    if (el.type === "hidden" || el.hidden) return;
    const label = el.closest("label");
    const caption = label ? label.textContent.replace(/\s+/g, " ").trim() : "";
    add(el, label || el, caption || el.id);
  });
  const seek = $("seek");
  if (seek) add(seek, seek, "Seek");
  const gSlider = $("globalNavSliderRow");
  if (gSlider) add(gSlider, gSlider, "Sorted items slider");
  const eSlider = $("existingTimeNavSliderWrap");
  if (eSlider) add(eSlider, eSlider, "PT / NT slider");

  const keys = entries.map(function (e) { return "uiHide_" + e.id; });
  chrome.storage.local.get(keys, function (bag) {
    entries.forEach(function (e) {
      const hidden = bag["uiHide_" + e.id] === true;
      const row = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hidden;
      e.target.style.display = hidden ? "none" : "";
      cb.addEventListener("change", function () {
        e.target.style.display = cb.checked ? "" : "none";
        const rec = {};
        rec["uiHide_" + e.id] = !cb.checked;
        chrome.storage.local.set(rec);
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(" " + e.name));
      panel.appendChild(row);
    });
  });
})();

chrome.storage.local.get({ offsetH: 0, offsetM: 0, offsetS: 0 }).then(function (bag) {
  if ($("offsetH")) $("offsetH").value = bag.offsetH;
  if ($("offsetM")) $("offsetM").value = bag.offsetM;
  if ($("offsetS")) $("offsetS").value = bag.offsetS;
})














function appendUnrevealedForBag(limit) {
  const titleBody = document.getElementById("titleView");
  if (!titleBody) return;

  const source = (typeof filter !== "undefined" && filter === "recycle") ? recycleChats : rows;
  const bagMatched = source.filter(function (r) { return matchRow(r, ""); });

  const present = new Set();
  titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
    present.add(String(row.dataset.ck || ""));
  });

  let missing = bagMatched.filter(function (r) { return !present.has(String(r.convKey)); });
  if (typeof limit === "number" && limit > 0) {
    missing = missing.slice(0, limit);   // ← only the next N
  }

  if (!missing.length) {
    document.getElementById("status").textContent = "No more unrevealed chat bars.";
    return;
  }

  titleBody.insertAdjacentHTML("beforeend", missing.map(rowHtml).join(""));
  document.getElementById("status").textContent = "Appended " + missing.length + " chat bars.";
}


function fillHolesInChatBars(limit) {
  const titleBody = document.getElementById("titleView");
  if (!titleBody) return;

  const source = (typeof filter !== "undefined" && filter === "recycle") ? recycleChats : rows;
  // bag only, ignore search
  const bagMatched = source.filter(function (r) { return matchRow(r, ""); });

  const present = new Set();
  titleBody.querySelectorAll("tr[data-id][data-ck]").forEach(function (row) {
    present.add(String(row.dataset.ck || ""));
  });

  let missing = bagMatched.filter(function (r) { return !present.has(String(r.convKey)); });
  if (typeof limit === "number" && limit > 0) missing = missing.slice(0, limit);
  if (!missing.length) {
    document.getElementById("status").textContent = "No holes to fill.";
    return;
  }

  // Insert each missing bar at the correct place according to bagMatched order
  missing.forEach(function (r) {
    const ck = String(r.convKey);
    const idx = bagMatched.findIndex(function (x) { return String(x.convKey) === ck; });
    // find the first already-rendered bar that should come AFTER this one
    let insertBefore = null;
    for (let i = idx + 1; i < bagMatched.length; i++) {
      const laterCk = String(bagMatched[i].convKey);
      const laterRow = titleBody.querySelector('tr[data-id][data-ck="' + CSS.escape(laterCk) + '"]');
      if (laterRow) { insertBefore = laterRow; break; }
    }
    const html = rowHtml(r);
    if (insertBefore) {
      insertBefore.insertAdjacentHTML("beforebegin", html);
    } else {
      titleBody.insertAdjacentHTML("beforeend", html);
    }
  });

  document.getElementById("status").textContent = "Filled " + missing.length + " hole(s).";
}



document.addEventListener("keydown", function (e) {
  if (e.key === "PageDown") {
    e.preventDefault();          // optional: stop the normal page scroll
    fillHolesInChatBars(20);
  }
});
