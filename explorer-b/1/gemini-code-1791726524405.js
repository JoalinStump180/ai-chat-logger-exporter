const $ = (id) => document.getElementById(id);
let rows = [];
let filter = "all";
let selectedId = null;
let includeComments = false;
let includeImpAsks = false;
let includeImpAns = false;
let liveSort = "ts-asc";
let middleMode = "ptt"; // sort: "ptt" = session/title order, "item" = date-time item order
let dispStyle = "ptt"; // display: "ptt" (default multi-line tree) or "flat"
let selectedNid = null; // persistent selected item identity (nid) across sort modes
const openChats = new Set();
const openAns = new Set();
const forceOpenAsk = new Set();
const asksByConv = new Map();
let recycleItems = [];
const recycleAsks = new Map();
let recycleChats = [];
let delSort = "";
const TOKEN_COLORS = ["#e53935", "#1e88e5", "#fb8c00", "#43a047", "#8e24aa", "#00897b"];
let tokenOn = [];

function pad(n) { return String(n).padStart(2, "0"); }
function fmtTs(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function isOnMsg(c) {
  return !!(c && (c.source === "onMsg" || String(c.recordKey || "").includes("|onMsg|")));
}
function isImp(c) {
  if (!c) return false;
  if (isOnMsg(c)) return false;
  if (c.source === "import" || c.source === "seen" || c.source === "seen-dummy") return true;
  if (c.source === "live") return false;
  return !!(c.responseId);
}
function isLive(c) { return isOnMsg(c) || !isImp(c); }

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
  let s = String(q || "");
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

function parseQuery(q) { return parseSearch(q).tokens; }

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
function pageHay(r) {
  return [r.date, r.time, r.title, r.url, r.platform, r.conversationId, String(r.id)].join(" ");
}
function askHay(c) { return [fmtTs(c.ts), c.text, String(c.localIndex), c.responseId || ""].join(" "); }
function ansHay(a) { return [fmtTs(a.ts), a.text, String(a.localIndex), a.responseId || ""].join(" "); }

function viewAsks(convKey) {
  return (filter === "recycle" ? recycleAsks : asksByConv).get(convKey) || [];
}
function matchRow(r, q) {
  if (filter !== "all" && filter !== "recycle" && r.platform !== filter) return false;
  if (!chatInTime(r)) return false;
  const parsed = parseSearch(q);
  if (parsed.urlIds && parsed.urlIds.size && !parsed.urlIds.has(Number(r.id))) return false;
  const tokens = parsed.tokens;
  if (!tokens.length) return true;
  if (hayHasAll(pageHay(r), tokens)) return true;
  const list = viewAsks(r.convKey);
  if (includeComments && list.some((c) => isLive(c) && hayHasAll(askHay(c), tokens))) return true;
  if (includeImpAsks && list.some((c) => isImp(c) && hayHasAll(askHay(c), tokens))) return true;
  if (includeImpAns && list.some((c) => (c.answers || []).some((a) => hayHasAll(ansHay(a), tokens)))) return true;
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

function lineHits(text, tokens) {
  const lines = String(text || "").split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (tokens.length && hayHasAny(line, tokens)) out.push({ lineNo: i + 1, line: line });
  });
  return out;
}

function paintTokenBar(tokens) {
  const bar = $("tokenBar");
  if (!tokens.length) { bar.innerHTML = ""; tokenOn = []; return; }
  if (tokenOn.length !== tokens.length) tokenOn = tokens.map(function () { return true; });
  bar.innerHTML = tokens.map(function (t, i) {
    const col = TOKEN_COLORS[i % TOKEN_COLORS.length];
    const label = t.raw.indexOf(" ") >= 0 ? '"' + t.raw + '"' : t.raw;
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

function togPair(open, extra) {
  const mark = open ? "\u2212" : "+";
  const left = '<button type="button" class="ptt-tog" data-side="L" ' + extra + ">" + mark + "</button>";
  const right = '<button type="button" class="ptt-tog" data-side="R" ' + extra + ">" + mark + "</button>";
  return { left: left, right: right, mark: mark };
}

function pttNode(opts) {
  const hasKids = !!opts.kidsHtml;
  const open = !!opts.open;
  const extra = opts.ak ? ('data-ak="' + esc(opts.ak) + '"') : "";
  const ckAttr = opts.ck ? ('data-ck="' + esc(opts.ck) + '"') : "";
  const t = hasKids ? togPair(open, extra) : {
    left: '<button type="button" class="ptt-tog" disabled>\u00b7</button>',
    right: '<button type="button" class="ptt-tog" disabled>\u00b7</button>'
  };
  const kids = hasKids
    ? '<div class="ptt-kids"' + (open ? "" : " hidden") + ">" + opts.kidsHtml + "</div>"
    : "";
  const menu = opts.recordKey
    ? '<span class="ptt-more"><button type="button" class="ptt-dots" data-rk="' + esc(opts.recordKey) + '" data-kind="' + esc(opts.storeKind || "ask") + '" data-text="' + esc(opts.editText || "") + '">\u22ee</button>' +
      '<span class="ptt-menu" hidden><button type="button" class="ptt-edit">Edit</button><button type="button" class="ptt-del">Delete</button></span></span>'
    : "";
  return '<div class="ptt-node" data-nid="' + esc(opts.nid) + '" ' + ckAttr + '><div class="ptt-row">' +
    t.left +
    '<span class="ptt-tag">' + esc(opts.tag) + "</span>" +
    (hasKids ? t.right : "") +
    '<span class="ptt-txt">  ' + highlightText(opts.body, opts.tokens) + "</span>" + menu + "</div>" + kids + "</div>";
}

function pttAskNode(c, tokens, kidsOpen, kind, convKey) {
  const tag = kind === "onMsg" ? ("onMsg#" + c.localIndex) : ("ask#" + c.localIndex);
  const nid = kind + "-" + (c.recordKey || c.localIndex);
  const seenAns = (c.answers || []).some((a) => a.source === "seen");
  const kidsHtml = (kind !== "onMsg" && (includeImpAns || seenAns) && (c.answers || []).some((a) => inTime(a.ts)))
    ? (c.answers || []).filter((a) => inTime(a.ts) && (includeImpAns || a.source === "seen")).map(function (a) {
        return pttNode({
          nid: "ans-" + (a.recordKey || a.localIndex),
          ck: convKey,
          tag: "ans#" + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex),
          body: fmtTs(a.ts) + "  " + (a.text || ""),
          tokens: tokens,
          kidsHtml: "",
          open: false,
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
    tokens: tokens,
    kidsHtml: kidsHtml,
    open: !!(kidsHtml && kidsOpen),
    ak: c.recordKey,
    recordKey: c.recordKey || "",
    storeKind: kind === "onMsg" ? "onMsg" : "ask",
    editText: c.text || ""
  });
}

function askBlock(r, list, tokens) {
  const parts = [];
  if (includeComments) {
    const live = liveAsks(list).filter((c) => inTime(c.ts));
    if (live.length) {
      parts.push('<div class="ptt-tree">' + live.map(function (c) {
        return pttAskNode(c, tokens, false, "onMsg", r.convKey);
      }).join("") + "</div>");
    }
  }
  if (includeImpAsks || includeImpAns || list.some((c) => c.source === "seen")) {
    const imp = list.filter((c) => (c.source === "seen" || (includeImpAsks && isImp(c)) || (includeImpAns && isImp(c))) && (inTime(c.ts) || (c.answers || []).some((a) => inTime(a.ts))));
    if (imp.length) {
      const ansOpenAll = openAns.has(r.convKey) || batchAnsOpen;
      const askOpen = batchAskOpen || openChats.has(r.convKey);
      const nodes = imp.map(function (c) {
        const hitAns = tokens.length && (c.answers || []).some(function (a) { return