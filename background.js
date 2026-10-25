importScripts("db.js");

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowParts(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

function stableUrl(platform, conversationId, href) {
  try {
    const u = new URL(href);
    u.hash = "";
    u.searchParams.delete("rid");
    u.searchParams.delete("ridx");
    return u.origin + u.pathname + (u.search ? u.search : "");
  } catch {
    return `${platform}:${conversationId}`;
  }
}

async function getAllRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getAllAsks() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ASK_STORE, "readonly").objectStore(ASK_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getAllAnswers() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ANSWER_STORE, "readonly").objectStore(ANSWER_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function findByConvKey(convKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).index("byConv").get(convKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    if (record.id != null) tx.objectStore(STORE).put(record);
    else tx.objectStore(STORE).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function refreshCache() {
  const all = await getAllRecords();
  const asks = await getAllAsks();
  let answers = [];
  try { answers = await getAllAnswers(); } catch (_) {}
  await chrome.storage.local.set({ recordsCache: all, asksCache: asks, answersCache: answers });
}

async function addAskOnce(row) {
  const recordKey = row.onMsg ? onMsgRecordKey(row.platform, row.conversationId, row.nonce || row.ts) : ((row.source === "seen" || row.source === "seen-dummy") ? seenAskRecordKey(row.platform, row.conversationId, row.ts, row.text, row.responseId) : askRecordKey(row.platform, row.conversationId, row.ts, row.text, row.responseId));
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASK_STORE, "readwrite");
    const store = tx.objectStore(ASK_STORE);
    const getReq = store.get(recordKey);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        const incoming = String(row.text || "");
        const dummy = existing.source === "seen-dummy" || existing.text === "(ask not logged)";
        if (dummy && incoming && incoming !== "(ask not logged)") {
          existing.text = incoming;
          existing.source = row.source || "seen";
          store.put(existing);
        }
        resolve({ added: false, recordKey, localIndex: existing.localIndex, filled: dummy && incoming !== "(ask not logged)" });
        return;
      }
      const countReq = store.index("byConvKey").count(row.convKey);
      countReq.onsuccess = () => {
        const localIndex = row.localIndex || (countReq.result || 0) + 1;
        store.add({
          recordKey,
          convKey: row.convKey,
          platform: row.platform,
          conversationId: row.conversationId,
          text: row.text || "",
          ts: row.ts || Date.now(),
          responseId: row.responseId || "",
          localIndex,
          source: row.source || "live",
          createdAt: Date.now()
        });
        resolve({ added: true, recordKey, localIndex });
      };
    };
    tx.onerror = () => {
      if (tx.error && /constraint/i.test(String(tx.error))) resolve({ added: false, recordKey });
      else reject(tx.error);
    };
  });
}

async function addAnswerOnce(row) {
  const recordKey = row.source === "seen" ? seenAnswerRecordKey(row.platform, row.conversationId, row.responseId, row.ts, row.text) : answerRecordKey(row.platform, row.conversationId, row.responseId, row.ts, row.text);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANSWER_STORE, "readwrite");
    const store = tx.objectStore(ANSWER_STORE);
    const getReq = store.get(recordKey);
    getReq.onsuccess = () => {
      if (getReq.result) {
        resolve({ added: false, recordKey, localIndex: getReq.result.localIndex });
        return;
      }
      const countReq = store.index("byConvKey").count(row.convKey);
      countReq.onsuccess = () => {
        const localIndex = row.localIndex || (countReq.result || 0) + 1;
        store.add({
          recordKey,
          convKey: row.convKey,
          platform: row.platform,
          conversationId: row.conversationId,
          text: row.text || "",
          ts: row.ts || Date.now(),
          responseId: row.responseId || "",
          askKey: row.askKey || "",
          askLocalIndex: row.askLocalIndex || 0,
          localIndex,
          status: row.status || "finished",
          source: row.source || "import",
          createdAt: Date.now()
        });
        resolve({ added: true, recordKey, localIndex });
      };
    };
    tx.onerror = () => {
      if (tx.error && /constraint/i.test(String(tx.error))) resolve({ added: false, recordKey });
      else reject(tx.error);
    };
  });
}


function stripAccountPrefix(title) {
  return String(title || "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

function isGenericTitle(title) {
  const bare = stripAccountPrefix(title).toLowerCase();
  return !bare || /^(grok|chatgpt|gemini|google gemini|new chat|untitled|\(untitled\))$/.test(bare);
}

function shouldReplaceTitle(current, incoming, force) {
  if (!incoming) return false;
  if (!current) return true;
  if (incoming === current) return false;
  if (isGenericTitle(incoming) && !isGenericTitle(current)) return false;
  if (force) return true;
  return stripAccountPrefix(incoming) !== stripAccountPrefix(current);
}

async function syncTitle(payload) {
  const platform = payload.platform;
  const conversationId = payload.conversationId;
  if (!platform || !conversationId || String(conversationId).startsWith("pending:")) return { ok: false, reason: "no-id" };
  return upsertConversation({ ...payload, text: "", titleSync: true, ts: payload.ts || Date.now() });
}

async function rebindPending(payload) {
  const platform = payload.platform;
  const conversationId = payload.conversationId;
  if (!platform || !conversationId || String(conversationId).startsWith("pending:")) return { ok: false, reason: "no-id" };
  const wanted = new Set((payload.texts || []).map((t) => String(t || "").replace(/\s+/g, " ").trim()).filter(Boolean));
  const asks = await getAllAsks();
  const pending = asks.filter((a) => {
    if (a.platform !== platform) return false;
    if (!String(a.conversationId || "").startsWith("pending:")) return false;
    if (wanted.size && !wanted.has(String(a.text || "").replace(/\s+/g, " ").trim())) return false;
    if (!wanted.size && payload.since && a.ts < payload.since) return false;
    return true;
  });
  let moved = 0;
  const touched = new Set();
  for (const ask of pending) {
    const next = {
      ...ask,
      conversationId,
      convKey: makeConvKey(platform, conversationId),
      recordKey: askRecordKey(platform, conversationId, ask.ts, ask.text, ask.responseId || "")
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASK_STORE, "readwrite");
      tx.objectStore(ASK_STORE).delete(ask.recordKey);
      tx.objectStore(ASK_STORE).put(next);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    touched.add(ask.convKey);
    moved += 1;
  }
  if (moved) {
    const convKey = makeConvKey(platform, conversationId);
    await upsertConversation({
      platform,
      conversationId,
      url: payload.url || "",
      title: payload.title || "",
      account: payload.account || "",
      text: "",
      ts: payload.ts || Date.now()
    });
    const rec = await findByConvKey(convKey);
    if (rec) {
      const all = await getAllAsks();
      rec.askCount = all.filter((a) => a.convKey === convKey).length;
      await putRecord(rec);
    }
    const records = await getAllRecords();
    for (const key of touched) {
      const left = (await getAllAsks()).filter((a) => a.convKey === key);
      if (left.length) continue;
      const stale = records.find((r) => r.convKey === key);
      if (stale && stale.id != null) await deleteRecord(stale.id);
    }
   // await refreshCache();
  }
  return { ok: true, moved };
}

async function upsertConversation(payload) {
  const platform = payload.platform;
  const conversationId = payload.conversationId;
  if (!platform || !conversationId || conversationId === "pending") return { ok: false, reason: "no-id" };
  const convKey = makeConvKey(platform, conversationId);
  const href = stableUrl(platform, conversationId, payload.url || "");
  const account = String(payload.account || "").trim();
  let title = String(payload.title || "").trim();
  const text = String(payload.text || "").trim();
  const ts = payload.ts || Date.now();
  const { date, time } = nowParts(new Date(ts));
  if (account) {
    const prefix = "[" + account + "] ";
    if (title && !title.startsWith(prefix) && !title.includes(account)) title = prefix + title;
    if (!title) title = prefix.trim();
  }

  let rec = await findByConvKey(convKey);
  if (!rec) {
    rec = {
      convKey,
      platform,
      conversationId,
      url: href,
      title: title || text.slice(0, 80) || conversationId,
      account: account || "",
      date,
      time,
      comments: "",
      askCount: 0,
      answerCount: 0,
      createdAt: ts,
      updatedAt: ts
    };
    await putRecord(rec);
    rec = await findByConvKey(convKey);
  } else {
    rec.url = href || rec.url;
    if (account && !rec.account) rec.account = account;
    if (account && rec.title && !String(rec.title).includes(account)) {
      rec.title = "[" + account + "] " + rec.title;
    }
    if (title && shouldReplaceTitle(rec.title, title, payload.titleSync)) rec.title = title;
    if (payload.titleSync && title) rec.titleUpdatedAt = ts;
    if (!(payload.titleSync && !text)) rec.updatedAt = ts;
    await putRecord(rec);
  }

  let savedAsk = false;
  let askMeta = null;
  if (text) {
    askMeta = await addAskOnce({
      platform,
      conversationId,
      convKey,
      text,
      ts,
      responseId: payload.responseId || "",
      source: "onMsg",
      onMsg: true,
      nonce: payload.nonce || ts
    });
    savedAsk = !!(askMeta && askMeta.added);
    if (savedAsk) {
      rec = await findByConvKey(convKey);
      rec.askCount = (rec.askCount || 0) + 1;
      rec.updatedAt = ts;
      await putRecord(rec);
    }
  }

 // await refreshCache();
  return { ok: true, savedAsk, convKey, askKey: askMeta && askMeta.recordKey, askLocalIndex: askMeta && askMeta.localIndex };
}

async function importTurns(payload) {
  const platform = payload.platform;
  const conversationId = payload.conversationId;
  const wantAsk = payload.logAsk !== false;
  const wantAnswer = payload.logAnswer !== false;
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  if (!platform || !conversationId) return { ok: false, reason: "no-id" };

  await upsertConversation({
    platform,
    conversationId,
    url: payload.url || "",
    title: payload.title || "",
    account: payload.account || "",
    text: "",
    ts: payload.ts || Date.now()
  });

  const convKey = makeConvKey(platform, conversationId);
  let asksAdded = 0;
  let answersAdded = 0;
  let lastAsk = null;

  for (const turn of turns) {
    const role = String(turn.role || "").toLowerCase();
    const text = String(turn.text || "").trim();
    const ts = turn.ts || Date.now();
    const responseId = String(turn.responseId || "").trim();
    if (role === "user" || role === "ask" || role === "human") {
      if (!wantAsk || !text) {
        lastAsk = null;
        continue;
      }
      const meta = await addAskOnce({
        platform, conversationId, convKey, text, ts, responseId, localIndex: turn.localIndex, source: "import"
      });
      if (!meta.added && payload.overwriteText && responseId) {
        await updateNodeText({ recordKey: meta.recordKey, kind: "ask", text });
        asksAdded += 1;
      } else if (meta.added) asksAdded += 1;
      lastAsk = meta;
    } else if (role === "assistant" || role === "answer" || role === "grok" || role === "bot") {
      if (!wantAnswer || !text) continue;
      const meta = await addAnswerOnce({
        platform,
        conversationId,
        convKey,
        text,
        ts,
        responseId,
        askKey: lastAsk && lastAsk.recordKey || "",
        askLocalIndex: lastAsk && lastAsk.localIndex || 0,
        status: turn.status || "finished",
        source: "import"
      });
      if (!meta.added && payload.overwriteText && responseId) {
        await updateNodeText({ recordKey: meta.recordKey, kind: "answer", text });
        answersAdded += 1;
      } else if (meta.added) answersAdded += 1;
    }
  }

  const rec = await findByConvKey(convKey);
  if (rec) {
    rec.askCount = (rec.askCount || 0);
    rec.answerCount = (rec.answerCount || 0);
    if (asksAdded) rec.askCount = (rec.askCount || 0); // recount below
    await putRecord(rec);
  }
  const allAsks = (await getAllAsks()).filter((a) => a.convKey === convKey);
  const allAns = (await getAllAnswers()).filter((a) => a.convKey === convKey);
  if (rec) {
    rec.askCount = allAsks.length;
    rec.answerCount = allAns.length;
    rec.updatedAt = Date.now();
    await putRecord(rec);
  }
 // await refreshCache();
  return { ok: true, asksAdded, answersAdded, askTotal: allAsks.length, answerTotal: allAns.length };
}

async function deleteRecord(id) {
  const recs = await getAllRecords();
  const rec = recs.find((r) => r.id === id);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const stores = [STORE, ASK_STORE];
    if (db.objectStoreNames.contains(ANSWER_STORE)) stores.push(ANSWER_STORE);
    const tx = db.transaction(stores, "readwrite");
    tx.objectStore(STORE).delete(id);
    if (rec) {
      const wipe = (name) => {
        if (!db.objectStoreNames.contains(name)) return;
        const idx = tx.objectStore(name).index("byConvKey");
        const req = idx.openCursor(IDBKeyRange.only(rec.convKey));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      };
      wipe(ASK_STORE);
      wipe(ANSWER_STORE);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
 // await refreshCache();
}


async function logSeen(payload) {
  const platform = payload.platform;
  const conversationId = payload.conversationId;
  const responseId = String(payload.responseId || "").trim();
  const role = String(payload.role || "").toLowerCase();
  const text = String(payload.text || "").trim();
  if (!platform || !conversationId || !responseId || !text) return { ok: false, reason: "no-id" };
  if (String(conversationId).startsWith("pending:")) return { ok: false, reason: "pending" };
  await upsertConversation({
    platform,
    conversationId,
    url: payload.url || "",
    title: payload.title || "",
    account: payload.account || "",
    text: "",
    ts: payload.ts || Date.now()
  });
  const convKey = makeConvKey(platform, conversationId);
  if (role === "user" || role === "ask") {
    const meta = await addAskOnce({
      platform, conversationId, convKey, text, ts: payload.ts || Date.now(),
      responseId, source: "seen"
    });
    if (meta.added) {
      const rec = await findByConvKey(convKey);
      if (rec) { rec.askCount = (rec.askCount || 0) + 1; await putRecord(rec); }
    }
   // await refreshCache();
    return { ok: true, added: meta.added, recordKey: meta.recordKey };
  }
  let askKey = "";
  let askLocalIndex = 0;
  const parentId = payload.askResponseId || ("dummy-" + responseId);
  if (parentId) {
    const askMeta = await addAskOnce({
      platform, conversationId, convKey,
      text: payload.askDummy || !payload.askResponseId ? "(ask not logged)" : (payload.askText || "(ask not logged)"),
      ts: payload.askTs || payload.ts || Date.now(),
      responseId: parentId,
      source: payload.askDummy || !payload.askResponseId ? "seen-dummy" : "seen"
    });
    askKey = askMeta.recordKey || "";
    askLocalIndex = askMeta.localIndex || 0;
    if (askMeta.added) {
      const rec = await findByConvKey(convKey);
      if (rec) { rec.askCount = (rec.askCount || 0) + 1; await putRecord(rec); }
    }
  }
  const meta = await addAnswerOnce({
    platform, conversationId, convKey, text, ts: payload.ts || Date.now(),
    responseId, askKey, askLocalIndex, status: "finished", source: "seen"
  });
  if (meta.added) {
    const rec = await findByConvKey(convKey);
    if (rec) { rec.answerCount = (rec.answerCount || 0) + 1; await putRecord(rec); }
  }
 // await refreshCache();
  return { ok: true, added: meta.added, recordKey: meta.recordKey };
}

async function updateNodeText(payload) {
  const recordKey = String(payload.recordKey || "");
  const kind = String(payload.kind || "");
  const text = String(payload.text || "");
  if (!recordKey || (kind !== "ask" && kind !== "answer" && kind !== "onMsg")) return { ok: false, reason: "no-key" };
  const db = await openDb();
  const storeName = kind === "answer" ? ANSWER_STORE : ASK_STORE;
  const savedKind = recordKey.includes("|onMsg|") ? "onMsg" : kind;
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const getReq = store.get(recordKey);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) { resolve(false); return; }
      row.text = text;
      store.put(row);
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
  if (updated)// await refreshCache();
  return { ok: true, updated };
}


async function recycleOne(recordKey, kind) {
  const savedKind = recordKey.includes("|onMsg|") ? "onMsg" : kind;
  const storeName = savedKind === "answer" ? ANSWER_STORE : ASK_STORE;
  const db = await openDb();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const getReq = store.get(recordKey);
    getReq.onsuccess = () => {
      const found = getReq.result;
      if (!found) { resolve(null); return; }
      store.delete(recordKey);
      resolve(found);
    };
    tx.onerror = () => reject(tx.error);
  });
  if (!row) return null;
  const deletedAt = Date.now();
  const conv = await findByConvKey(row.convKey || makeConvKey(row.platform, row.conversationId));
  const copy = Object.assign({}, row, {
    deletedAt, kind: savedKind, originKey: recordKey,
    title: (conv && conv.title) || row.title || "",
    askLocalIndex: row.askLocalIndex || 0,
    localIndex: row.localIndex || 0
  });
  delete copy.recordKey;
  const id = await new Promise((resolve, reject) => {
    const tx = db.transaction(RECYCLE_STORE, "readwrite");
    const req = tx.objectStore(RECYCLE_STORE).add(copy);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
  return { id, deletedAt };
}

async function recycleNode(payload) {
  const recordKey = String(payload.recordKey || "");
  const kind = String(payload.kind || "");
  if (!recordKey || (kind !== "ask" && kind !== "answer" && kind !== "onMsg")) return { ok: false, reason: "no-key" };
  const removed = [];
  if (kind !== "answer") {
    const db = await openDb();
    const kids = await new Promise((resolve, reject) => {
      const req = db.transaction(ANSWER_STORE, "readonly").objectStore(ANSWER_STORE).index("byAskKey").getAll(recordKey);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const kid of kids) {
      const done = await recycleOne(kid.recordKey, "answer");
      if (done) removed.push(kid.recordKey);
    }
  }
  const savedKind = recordKey.includes("|onMsg|") ? "onMsg" : kind;
  const one = await recycleOne(recordKey, savedKind);
  if (!one) return { ok: false, reason: "missing", removed };
 // await refreshCache();
  return { ok: true, id: one.id, deletedAt: one.deletedAt, removed };
}

async function getRecycle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(RECYCLE_STORE, "readonly").objectStore(RECYCLE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function updateRecycleText(payload) {
  const id = Number(payload.id);
  const text = String(payload.text || "");
  if (!id) return { ok: false, reason: "no-id" };
  const db = await openDb();
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction(RECYCLE_STORE, "readwrite");
    const store = tx.objectStore(RECYCLE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) { resolve(false); return; }
      row.text = text;
      store.put(row);
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
  return { ok: true, updated };
}


async function setLiked(payload) {
  const recordKey = String(payload.recordKey || "");
  const kind = String(payload.kind || "");
  const liked = !!payload.liked;
  if (!recordKey || (kind !== "ask" && kind !== "answer" && kind !== "onMsg")) return { ok: false, reason: "no-key" };
  const storeName = kind === "answer" ? ANSWER_STORE : ASK_STORE;
  const db = await openDb();
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const getReq = store.get(recordKey);
    let found = false;
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) return;
      found = true;
      row.liked = liked;
      store.put(row);
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = () => reject(tx.error);
  });
  return { ok: !!updated, updated, liked };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "set-liked") {
    setLiked(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (msg && msg.type === "log-ask") {
    upsertConversation(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "sync-title") {
    syncTitle(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "rebind-pending") {
    rebindPending(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "log-answer") {
    (async () => {
      const conv = await upsertConversation({ ...msg, text: "" });
      const convKey = makeConvKey(msg.platform, msg.conversationId);
      const meta = await addAnswerOnce({
        platform: msg.platform,
        conversationId: msg.conversationId,
        convKey,
        text: msg.text || "",
        ts: msg.ts || Date.now(),
        responseId: msg.responseId || "",
        askKey: msg.askKey || "",
        askLocalIndex: msg.askLocalIndex || 0,
        status: msg.status || "finished"
      });
      if (meta.added) {
        const rec = await findByConvKey(convKey);
        if (rec) {
          rec.answerCount = (rec.answerCount || 0) + 1;
          rec.updatedAt = Date.now();
          await putRecord(rec);
        }
      }
     // await refreshCache();
      sendResponse({ ok: true, added: meta.added, localIndex: meta.localIndex, convKey: conv.convKey });
    })().catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
    if (msg && msg.type === "log-seen") {
    logSeen(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "update-node-text") {
    updateNodeText(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "recycle-node") {
    recycleNode(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "get-recycle") {
    getRecycle().then((rows) => sendResponse({ ok: true, rows })).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "update-recycle-text") {
    updateRecycleText(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "import-turns") {
    importTurns(msg).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg && msg.type === "get-records") {
    (async () => {
      let rows = [];
      try { rows = await getAllRecords(); } catch (_) {}
      if (!rows.length) {
        const bag = await chrome.storage.local.get("recordsCache");
        rows = Array.isArray(bag.recordsCache) ? bag.recordsCache : [];
      }
      sendResponse({ rows });
    })();
    return true;
  }
  if (msg && msg.type === "get-asks") {
    (async () => {
      let rows = [];
      try { rows = await getAllAsks(); } catch (_) {}
      if (!rows.length) {
        const bag = await chrome.storage.local.get("asksCache");
        rows = Array.isArray(bag.asksCache) ? bag.asksCache : [];
      }
      if (msg.platform) rows = rows.filter((r) => r.platform === msg.platform);
      if (msg.conversationId) rows = rows.filter((r) => r.conversationId === msg.conversationId);
      sendResponse({ rows });
    })();
    return true;
  }
  if (msg && msg.type === "get-answers") {
    (async () => {
      let rows = [];
      try { rows = await getAllAnswers(); } catch (_) {}
      if (!rows.length) {
        const bag = await chrome.storage.local.get("answersCache");
        rows = Array.isArray(bag.answersCache) ? bag.answersCache : [];
      }
      if (msg.platform) rows = rows.filter((r) => r.platform === msg.platform);
      if (msg.conversationId) rows = rows.filter((r) => r.conversationId === msg.conversationId);
      sendResponse({ rows });
    })();
    return true;
  }
  if (msg && msg.type === "settings-changed") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "delete-record") {
    deleteRecord(msg.id).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
});
