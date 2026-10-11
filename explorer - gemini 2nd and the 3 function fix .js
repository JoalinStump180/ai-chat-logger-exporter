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
      const nodes = imp.map(function (c) {
        const hitAns = tokens.length && (c.answers || []).some(function (a) { return hayHasAny(ansHay(a), tokens); });
        const openKids = ansOpenAll || forceOpenAsk.has(c.recordKey) || hitAns;
        if (!includeImpAsks && includeImpAns && !hitAns && !openKids) return "";
        return pttAskNode(c, tokens, openKids && includeImpAns, "ask", r.convKey);
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
  function add(kind, idLabel, text, ts) {
    lineHits(text, tokens).forEach(function (h) {
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
  if (includeComments) {
    liveAsks(list).filter((c) => inTime(c.ts)).forEach(function (c) {
      add("onMsg-" + (c.recordKey || c.localIndex), "onMsg#" + c.localIndex, (c.text || ""), c.ts);
    });
  }
  if (includeImpAsks || includeImpAns) {
    list.filter((c) => isImp(c) && (inTime(c.ts) || (c.answers || []).some((a) => inTime(a.ts)))).forEach(function (c) {
      if (includeImpAsks && inTime(c.ts)) add("ask-" + (c.recordKey || c.localIndex), "ask#" + c.localIndex, c.text || "", c.ts);
      if (includeImpAns) (c.answers || []).filter((a) => inTime(a.ts)).forEach(function (a) {
        add("ans-" + (a.recordKey || a.localIndex), "ans#" + c.localIndex + "." + (a.localIndex == null ? "?" : a.localIndex), a.text || "", a.ts);
      });
    });
  }
}

function rowHtml(r) {
  const q = $("q").value;
  const parsed = parseSearch(q);
  const tokens = parsed.tokens;
  const all = viewAsks(r.convKey);
  applySearchUnfold(r, tokens);
  const auto = tokens.length && matchRow(r, q) && (includeComments || includeImpAsks || includeImpAns);
  const show = openChats.has(r.convKey) || auto || batchAskOpen;
  const ansOn = openAns.has(r.convKey) || batchAnsOpen;
  const fold = '<button class="fold" data-ck="' + esc(r.convKey) + '" type="button">' + (show ? "\u2212" : "+") + "</button>";
  const ansFold = '<button class="ansfold" data-ck="' + esc(r.convKey) + '" type="button" title="fold/unfold all imported answers">' + (ansOn ? "\u2212a" : "+a") + "</button>";
  const detail = show
    ? '<tr class="cmt-row" data-ck="' + esc(r.convKey) + '"><td colspan="6">' + askBlock(r, all, tokens) + "</td></tr>"
    : "";
  return '<tr data-id="' + r.id + '" data-ck="' + esc(r.convKey) + '" class="' + (r.id === selectedId ? "sel" : "") + '">' +
    "<td>" + esc(fmtTs(rowTs(r))) + "</td><td>" + esc(r.platform) + "</td>" +
    '<td title="' + esc(r.title) + '">' + fold + ansFold + esc(r.title || "") + "</td>" +
    '<td title="' + esc(r.url) + '">' + esc(r.conversationId || r.url || "") + "</td>" +
    "<td>" + (all.length || r.askCount || 0) + "</td><td>" + r.id + "</td></tr>" + detail;
}

function collectItems(sessions, tokens) {
  const items = [];
  sessions.forEach(function (r) {
    const list = viewAsks(r.convKey);
    list.forEach(function (c) {
      const isLiveAsk = isOnMsg(c) || !isImp(c);
      if (isLiveAsk && !includeComments && isOnMsg(c)) return;
      if (!isLiveAsk && !includeImpAsks) return;
      if (isOnMsg(c) || !isImp(c) || (includeImpAsks && isImp(c))) {
        if (!inTime(c.ts)) return;
        if (tokens.length && !hayHasAll(askHay(c), tokens) && !hayHasAll(pageHay(r), tokens)) return;
        items.push({
          ts: c.ts || 0,
          convKey: r.convKey,
          session: r,
          kind: isOnMsg(c) ? "onMsg" : "ask",
          localIndex: c.localIndex,
          text: c.text || "",
          recordKey: c.recordKey || ""
        });
      }
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

function itemRowHtml(it, tokens) {
  const tag = it.kind === "onMsg" ? ("onMsg#" + it.localIndex) : ("ask#" + it.localIndex);
  return '<tr class="item-row" data-ck="' + esc(it.convKey) + '" data-nid="' + esc(it.kind + "-" + (it.recordKey || it.localIndex)) + '">' +
    "<td>" + esc(fmtTs(it.ts)) + "</td><td>" + esc(it.session.platform) + "</td>" +
    '<td>' + esc(tag) + "  " + highlightText(it.text, tokens) + "</td>" +
    '<td title="' + esc(it.session.url) + '">' + esc(it.session.conversationId || it.session.url || "") + "</td>" +
    "<td></td><td></td></tr>";
}

function bannerRowHtml(session) {
  return '<tr class="banner' + (session.id === selectedId ? " sel" : "") + '" data-id="' + session.id + '" data-ck="' + esc(session.convKey) + '">' +
    "<td>" + esc(fmtTs(rowTs(session))) + "</td><td>" + esc(session.platform) + "</td>" +
    '<td title="' + esc(session.title) + '"><b>' + esc(session.title || "(no title)") + "</b></td>" +
    '<td title="' + esc(session.url) + '">' + esc(session.conversationId || session.url || "") + "</td>" +
    "<td>" + (viewAsks(session.convKey).length || session.askCount || 0) + "</td><td>" + session.id + "</td></tr>";
}







function renderItemMode(tokens) {
  const items = collectItems(matched, tokens);
  const groups = groupItems(items); // Groups consecutive items by convKey
  const tb = $("tbody");
  tb.innerHTML = "";
  const html = [];
  
  groups.forEach(function (g) {
    // 1. Display the chat session banner row first!
    html.push(bannerRowHtml(g.session));
    
    // 2. Render the items underneath using the exact same PTT tree nodes
    const ptt = g.items.map(function (it) {
      const fake = {
        localIndex: it.localIndex,
        ts: it.ts,
        text: it.text,
        recordKey: it.recordKey,
        answers: []
      };
      return pttAskNode(fake, tokens, false, it.kind, g.convKey);
    }).join("");
    
    html.push('<tr class="cmt-row" data-ck="' + esc(g.convKey) + '"><td colspan="6"><div class="ptt-tree">' + ptt + "</div></td></tr>");
  });
  
  tb.innerHTML = html.join("");
  $("empty").hidden = groups.length > 0;
  $("status").textContent = items.length + " items in " + groups.length + " groups";
}





function renderItemMode2 (tokens) {
  const items = collectItems(matched, tokens);
  const groups = groupItems(items);
  const tb = $("tbody");
  tb.innerHTML = "";
  const html = [];
  groups.forEach(function (g) {
    html.push(bannerRowHtml(g.session));
    if (dispStyle === "ptt") {
      const ptt = g.items.map(function (it) {
        const fake = {
          localIndex: it.localIndex,
          ts: it.ts,
          text: it.text,
          recordKey: it.recordKey,
          answers: []
        };
        return pttAskNode(fake, tokens, false, it.kind, g.convKey);
      }).join("");
      html.push('<tr class="cmt-row" data-ck="' + esc(g.convKey) + '"><td colspan="6"><div class="ptt-tree">' + ptt + "</div></td></tr>");
    } else {
      g.items.forEach(function (it) { html.push(itemRowHtml(it, tokens)); });
    }
  });
  tb.innerHTML = html.join("");
  $("empty").hidden = groups.length > 0;
  $("status").textContent = items.length + " items in " + groups.length + " groups";
}

function getVisibleItems() {
  return Array.from(document.querySelectorAll(".ptt-node, tr.item-row"));
}

function clearItemSelection() {
  document.querySelectorAll(".ptt-selected").forEach(function (el) { el.classList.remove("ptt-selected"); });
}

function findConvForNid(nid) {
  const el = document.querySelector('.ptt-node[data-nid="' + CSS.escape(nid) + '"][data-ck], tr.item-row[data-nid="' + CSS.escape(nid) + '"][data-ck]');
  if (el && el.dataset.ck) return el.dataset.ck;
  let found = null;
  asksByConv.forEach(function (list, ck) {
    if (found) return;
    if (list.some(function (c) {
      return (c.recordKey && String(nid).indexOf(c.recordKey) >= 0) || String(nid).endsWith("-" + c.localIndex);
    })) found = ck;
  });
  return found;
}

let pendingScroll = false;








function selectItemByNid(nid, scroll) {
  if (!nid) return;
  selectedNid = nid;
  if (scroll) pendingScroll = true;
  const ck = findConvForNid(nid);
  const needsExpand = ck && !openChats.has(ck) && middleMode === "ptt";
  if (needsExpand) {
    openChats.add(ck);
    renderSlice(true);
    return;
  }
  clearItemSelection();
  const el = document.querySelector('.ptt-node[data-nid="' + CSS.escape(nid) + '"], tr.item-row[data-nid="' + CSS.escape(nid) + '"]');
  if (!el && ck && middleMode === "ptt" && !openChats.has(ck)) {
    openChats.add(ck);
    renderSlice(true);
    return;
  }
  if (!el) return;
  el.classList.add("ptt-selected");
  
  // Force scroll into view when switching or selecting
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}






function selectItemByNid2(nid, scroll) {
  if (!nid) return;
  selectedNid = nid;
  if (scroll) pendingScroll = true;
  const ck = findConvForNid(nid);
  const needsExpand = ck && !openChats.has(ck) && middleMode === "ptt";
  if (needsExpand) {
    openChats.add(ck);
    renderSlice(true);
    return;
  }
  clearItemSelection();
  const el = document.querySelector('.ptt-node[data-nid="' + CSS.escape(nid) + '"], tr.item-row[data-nid="' + CSS.escape(nid) + '"]');
  if (!el && ck && middleMode === "ptt" && !openChats.has(ck)) {
    openChats.add(ck);
    renderSlice(true);
    return;
  }
  if (!el) return;
  el.classList.add("ptt-selected");
  if (pendingScroll) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    pendingScroll = false;
  }
}

function jumpItem(delta) {
  const items = getVisibleItems();
  if (!items.length) return;
  let idx = items.findIndex(function (el) { return el.dataset.nid === selectedNid; });
  if (idx < 0) idx = 0;
  else idx = (idx + delta + items.length) % items.length;
  const el = items[idx];
  const nid = el.dataset.nid;
  selectItemByNid(nid, true);
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
  if (!delSort) sortHits();
  const tb = $("hitBody");
  tb.innerHTML = hitList.map(function (h, i) {
    return '<tr data-hi="' + i + '"><td>' + esc(fmtTs(h.ts)) + "</td><td>" + esc(fmtTs(h.deletedAt)) + "</td><td>" + h.urlid + "</td><td>" + esc(h.node) + "</td><td>" + h.lineNo + "</td><td>" + highlightText(h.line, tokens) + "</td></tr>";
  }).join("");
}








function renderSlice(reset) {
  if (middleMode === "item") {
    const tokens = parseSearch($("q").value).tokens;
    renderItemMode(tokens);
    updateHeaderIndicators();
    if (selectedNid) selectItemByNid(selectedNid, true); // Scroll to item
    return;
  }
  // ptt / session mode
  const tb = $("tbody");
  if (reset) { shown = 0; tb.innerHTML = ""; }
  const next = matched.slice(shown, shown + PAGE);
  if (next.length) tb.insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
  shown += next.length;
  $("empty").hidden = matched.length > 0;
  $("status").textContent = shown + " of " + matched.length + " shown";
  updateHeaderIndicators();
  if (selectedNid) selectItemByNid(selectedNid, true); // Scroll to item
}






function renderSlice2(reset) {
  if (middleMode === "item") {
    const tokens = parseSearch($("q").value).tokens;
    renderItemMode(tokens);
    updateHeaderIndicators();
    if (selectedNid) selectItemByNid(selectedNid, false);
    return;
  }
  // ptt / session mode
  const tb = $("tbody");
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

function seek(q) {
  forceOpenAsk.clear();
  const parsed = parseSearch(q);
  paintTokenBar(parsed.tokens);
  const source = filter === "recycle" ? recycleChats : rows;
  matched = source.filter(function (r) { return matchRow(r, q); });
  hitList = [];
  if (parsed.tokens.length) matched.forEach(function (r) { collectHits(r, parsed.tokens); });
  hitCursor = hitList.length ? 0 : -1;
  setSeek(100, "Seek 100%  " + matched.length + " urls + " + hitList.length + " hits");
  renderSlice(true);
  paintHits(parsed.tokens);
  updateHeaderIndicators();
  if (selectedNid) selectItemByNid(selectedNid, false);
}

function jumpHit(i) {
  if (!hitList.length) return;
  hitCursor = (i + hitList.length) % hitList.length;
  const h = hitList[hitCursor];
  selectedId = h.urlid;
  openChats.add(h.convKey);
  if (String(h.node).indexOf("ans#") === 0) openAns.add(h.convKey);
  renderSlice(true);
  paintHits(parseSearch($("q").value).tokens);
  document.querySelectorAll("#hitBody tr").forEach((tr) => tr.classList.toggle("on", Number(tr.dataset.hi) === hitCursor));
  const row = document.querySelector('#tbody tr[data-id="' + h.urlid + '"]');
  if (row) row.scrollIntoView({ block: "center" });
  const node = document.querySelector('.ptt-node[data-nid="' + CSS.escape(h.nid) + '"]');
  if (node) {
    node.classList.add("ptt-jump");
    node.scrollIntoView({ block: "center" });
    setTimeout(() => node.classList.remove("ptt-jump"), 1200);
  }
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
  $("tbody").innerHTML = "";
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

function closeMenus() {
  document.querySelectorAll(".ptt-menu").forEach(function (m) { m.hidden = true; });
}
$("tbody").addEventListener("click", function (e) {
  const dots = e.target.closest(".ptt-dots");
  if (dots) {
    e.stopPropagation();
    const menu = dots.parentElement.querySelector(".ptt-menu");
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
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
  if (e.target.closest(".ptt-tog")) { onTreeToggle(e); return; }
  const pttNode = e.target.closest(".ptt-node");
  if (pttNode && pttNode.dataset.nid) {
    selectItemByNid(pttNode.dataset.nid, false);
    return;
  }
  const itemRow = e.target.closest("tr.item-row");
  if (itemRow && itemRow.dataset.nid) {
    selectItemByNid(itemRow.dataset.nid, false);
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
    const ck = fold.dataset.ck;
    if (openChats.has(ck)) openChats.delete(ck);
    else openChats.add(ck);
    seek($("q").value);
    return;
  }
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  selectedId = Number(tr.dataset.id);
  document.querySelectorAll("#tbody tr[data-id]").forEach(function (x) {
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
$("thDateTime").addEventListener("click", function () {
  middleMode = "item";
  seek($("q").value);
});
$("thTitle").addEventListener("click", function () {
  middleMode = "ptt";
  seek($("q").value);
});
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
$("prevHit").onclick = function () { jumpHit(hitCursor < 0 ? 0 : hitCursor - 1); };
$("nextHit").onclick = function () { jumpHit(hitCursor < 0 ? 0 : hitCursor + 1); };
$("prevItem").onclick = function () { jumpItem(-1); };
$("nextItem").onclick = function () { jumpItem(1); };
$("foldAsksBtn").onclick = function () { batchAskOpen = false; matched.forEach((r) => openChats.delete(r.convKey)); seek($("q").value); };
$("unfoldAsksBtn").onclick = function () { batchAskOpen = true; matched.forEach((r) => openChats.add(r.convKey)); seek($("q").value); };
$("foldAnsBtn").onclick = function () { batchAnsOpen = false; openAns.clear(); forceOpenAsk.clear(); seek($("q").value); };
$("unfoldAnsBtn").onclick = function () { batchAnsOpen = true; matched.forEach((r) => openAns.add(r.convKey)); seek($("q").value); };

document.querySelector(".listwrap").addEventListener("scroll", function (e) {
  const el = e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
    if (shown < matched.length) renderSlice(false);
  }
});

function patternLen(q) {
  let s = String(q || "");
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
const paintInclude = bindCheck("includeComments", "includeCommentsLabel", function (v) { includeComments = v; }, "includeComments");
const paintImpAsks = bindCheck("includeImpAsks", "includeImpAsksLabel", function (v) { includeImpAsks = v; }, "includeImpAsks");
const paintImpAns = bindCheck("includeImpAns", "includeImpAnsLabel", function (v) { includeImpAns = v; }, "includeImpAns");

chrome.storage.local.get({ includeComments: false, includeImpAsks: false, includeImpAns: false, liveAskSort: "ts-asc", explorerSearchHist: [], explorerFromHist: [], explorerToHist: [] }).then(function (bag) {
  paintInclude(bag.includeComments);
  paintImpAsks(bag.includeImpAsks);
  paintImpAns(bag.includeImpAns);
  liveSort = bag.liveAskSort === "ts-desc" ? "ts-desc" : "ts-asc";
  $("liveSort").value = liveSort;
  searchHist = Array.isArray(bag.explorerSearchHist) ? bag.explorerSearchHist.slice(0, 40) : [];
  fromHist = Array.isArray(bag.explorerFromHist) ? bag.explorerFromHist.slice(0, 20) : [];
  toHist = Array.isArray(bag.explorerToHist) ? bag.explorerToHist.slice(0, 20) : [];
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
function bindTimeBox(which) {
  const box = $(which === "from" ? "fromBox" : "toBox");
  const hist = $(which === "from" ? "fromHist" : "toHist");
  const cal = $(which === "from" ? "fromCal" : "toCal");
  const picker = $(which === "from" ? "fromPicker" : "toPicker");
  box.addEventListener("focus", function () { hist.style.display = (which === "from" ? fromHist : toHist).length ? "block" : "none"; });
  box.addEventListener("blur", function () {
    setTimeout(function () { hist.style.display = "none"; pushTimeHist(which, box.value); }, 180);
  });
  box.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { seek($("q").value); }, 120);
  });
  hist.addEventListener("mousedown", function (e) {
    const d = e.target.closest("div");
    if (!d) return;
    box.value = d.textContent;
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
    if (box.value) pushTimeHist(which, box.value);
    seek($("q").value);
  }
  const clr = $(which === "from" ? "fromClr" : "toClr");
  clr.addEventListener("click", function () {
    box.value = "";
    picker.value = "";
    seek($("q").value);
  });
}
bindTimeBox("from");
bindTimeBox("to");

loadLazy();

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