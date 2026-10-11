const DB_NAME = "aiChatAskLog";
const DB_VERSION = 3;
const STORE = "records";
const ASK_STORE = "asks";
const ANSWER_STORE = "answers";
const RECYCLE_STORE = "recycle";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
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

function onMsgRecordKey(platform, conversationId, nonce) {
  return `${platform}|${conversationId}|onMsg|${nonce}`;
}

function answerRecordKey(platform, conversationId, responseId, ts, text) {
  if (responseId) return `${platform}|${conversationId}|ans|${responseId}`;
  const slice = String(text || "").slice(0, 80);
  return `${platform}|${conversationId}|ans|${ts}|${slice}`;
}
