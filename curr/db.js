const DB_NAME = "aiChatAskLog";
const DB_VERSION = 4;
const STORE = "records";
const ASK_STORE = "asks";
const ANSWER_STORE = "answers";
const RECYCLE_STORE = "recycle";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("byConv", "convKey", { unique: true });
        store.createIndex("byPlatform", "platform");
        store.createIndex("byCreatedAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(ASK_STORE)) {
        const asks = db.createObjectStore(ASK_STORE, { keyPath: "recordKey" });
        asks.createIndex("byConvKey", "convKey");
        asks.createIndex("byTs", "ts");
        asks.createIndex("byResponseId", "responseId");
      }
      if (!db.objectStoreNames.contains(ANSWER_STORE)) {
        const answers = db.createObjectStore(ANSWER_STORE, { keyPath: "recordKey" });
        answers.createIndex("byConvKey", "convKey");
        answers.createIndex("byTs", "ts");
        answers.createIndex("byResponseId", "responseId");
        answers.createIndex("byAskKey", "askKey");
      }

      if (!db.objectStoreNames.contains(RECYCLE_STORE)) {
        const bin = db.createObjectStore(RECYCLE_STORE, { keyPath: "id", autoIncrement: true });
        bin.createIndex("byDeletedAt", "deletedAt");
        bin.createIndex("byResponseId", "responseId");
        bin.createIndex("byConvKey", "convKey");
      }
      // Version 4 separates existing seen-online keys from import/live keys.
      if (event.oldVersion < 4) migrateSeenCompositeKeys(req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeConvKey(platform, conversationId) {
  return `${platform}|${conversationId}`;
}

function askRecordKey(platform, conversationId, ts, text, responseId) {
  if (responseId) return `${platform}|${conversationId}|ask|${responseId}`;
  const slice = String(text || "").slice(0, 80);
  return `${platform}|${conversationId}|${ts}|${slice}`;
}

function seenAskRecordKey(platform, conversationId, ts, text, responseId) {
  if (responseId) return `${platform}|${conversationId}|sei|${responseId}`;
  const slice = String(text || "").slice(0, 80);
  return `${platform}|${conversationId}|sei|${ts}|${slice}`;
}

function onMsgRecordKey(platform, conversationId, nonce) {
  return `${platform}|${conversationId}|onMsg|${nonce}`;
}

function answerRecordKey(platform, conversationId, responseId, ts, text) {
  if (responseId) return `${platform}|${conversationId}|ans|${responseId}`;
  const slice = String(text || "").slice(0, 80);
  return `${platform}|${conversationId}|ans|${ts}|${slice}`;
}

function seenAnswerRecordKey(platform, conversationId, responseId, ts, text) {
  if (responseId) return `${platform}|${conversationId}|seo|${responseId}`;
  const slice = String(text || "").slice(0, 80);
  return `${platform}|${conversationId}|seo|${ts}|${slice}`;
}


function migrateSeenCompositeKeys(tx) {
  const askStore = tx.objectStore(ASK_STORE);
  const answerStore = tx.objectStore(ANSWER_STORE);
  const recycleStore = tx.objectStore(RECYCLE_STORE);
  const askKeyMap = new Map();

  function migrateRecycle() {
    const req = recycleStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const row = cursor.value;
      if (row && (row.source === "seen" || row.source === "seen-dummy")) {
        let changed = false;
        if (typeof row.originKey === "string" && row.originKey.includes("|ask|")) {
          row.originKey = row.originKey.replace("|ask|", "|sei|");
          changed = true;
        }
        if (typeof row.originKey === "string" && row.originKey.includes("|ans|")) {
          row.originKey = row.originKey.replace("|ans|", "|seo|");
          changed = true;
        }
        if (typeof row.askKey === "string" && row.askKey.includes("|ask|")) {
          row.askKey = row.askKey.replace("|ask|", "|sei|");
          changed = true;
        }
        if (changed) cursor.update(row);
      }
      cursor.continue();
    };
  }

  function migrateAnswers() {
    const req = answerStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { migrateRecycle(); return; }
      const row = cursor.value;
      if (row && row.source === "seen") {
        const oldKey = String(row.recordKey || "");
        const newKey = oldKey.includes("|ans|")
          ? seenAnswerRecordKey(row.platform, row.conversationId, row.responseId, row.ts, row.text)
          : oldKey;
        const oldAskKey = String(row.askKey || "");
        const newAskKey = askKeyMap.get(oldAskKey) || oldAskKey.replace("|ask|", "|sei|");
        if (newKey !== oldKey || newAskKey !== oldAskKey) {
          const updated = Object.assign({}, row, { recordKey: newKey, askKey: newAskKey });
          cursor.delete();
          answerStore.put(updated);
        }
      }
      cursor.continue();
    };
  }

  const req = askStore.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) { migrateAnswers(); return; }
    const row = cursor.value;
    if (row && (row.source === "seen" || row.source === "seen-dummy")) {
      const oldKey = String(row.recordKey || "");
      if (oldKey.includes("|ask|")) {
        const newKey = seenAskRecordKey(row.platform, row.conversationId, row.ts, row.text, row.responseId);
        if (newKey !== oldKey) {
          askKeyMap.set(oldKey, newKey);
          const updated = Object.assign({}, row, { recordKey: newKey });
          cursor.delete();
          askStore.put(updated);
        }
      }
    }
    cursor.continue();
  };
}
