
function parseRange(s) {
  const m = String(s || "1:10").trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return { from: 1, to: 10 };
  let a = Math.max(1, parseInt(m[1], 10));
  let b = Math.max(a, parseInt(m[2], 10));
  return { from: a, to: b };
}

document.getElementById("syncBtn")?.addEventListener("click", async () => {
  const range = parseRange(document.getElementById("syncRange")?.value);
  await chrome.storage.local.set({ syncRange: range.from + ":" + range.to });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = chrome.runtime.getURL("sync.html") +
    "?tabId=" + encodeURIComponent(tab ? tab.id : "") +
    "&from=" + range.from + "&to=" + range.to;
  chrome.windows.create({ url, type: "popup", width: 640, height: 520 });
});

document.getElementById("openExplorer")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("explorer.html") });
});

async function loadOpts() {
  const bag = await chrome.storage.local.get(["showStamps", "logAsks", "logSeenAsks", "logSeenAnswers", "showSeenDebug"]);
  const showStamps = bag.showStamps !== false;
  const logAsks = bag.logAsks !== false;
  const elShow = document.getElementById("optShowStamps");
  const elLog = document.getElementById("optLogAsks");
  const elSeenAsk = document.getElementById("optSeenAsks");
  const elSeenAns = document.getElementById("optSeenAnswers");
  if (elShow) elShow.checked = showStamps;
  if (elLog) elLog.checked = logAsks;
  if (elSeenAsk) elSeenAsk.checked = bag.logSeenAsks !== false;
  if (elSeenAns) elSeenAns.checked = bag.logSeenAnswers !== false;
  const elDbg = document.getElementById("optSeenDebug");
  if (elDbg) elDbg.checked = bag.showSeenDebug !== false;
}

async function saveOpts() {
  const showStamps = !!document.getElementById("optShowStamps")?.checked;
  const logAsks = !!document.getElementById("optLogAsks")?.checked;
  const logSeenAsks = !!document.getElementById("optSeenAsks")?.checked;
  const logSeenAnswers = !!document.getElementById("optSeenAnswers")?.checked;
  const showSeenDebug = !!document.getElementById("optSeenDebug")?.checked;
  await chrome.storage.local.set({ showStamps, logAsks, logSeenAsks, logSeenAnswers, showSeenDebug });
  chrome.runtime.sendMessage({ type: "settings-changed", showStamps, logAsks, logSeenAsks, logSeenAnswers, showSeenDebug }, () => void chrome.runtime.lastError);
}

document.getElementById("optShowStamps")?.addEventListener("change", saveOpts);
document.getElementById("optLogAsks")?.addEventListener("change", saveOpts);
document.getElementById("optSeenAsks")?.addEventListener("change", saveOpts);
document.getElementById("optSeenAnswers")?.addEventListener("change", saveOpts);
document.getElementById("optSeenDebug")?.addEventListener("change", saveOpts);
loadOpts();

(async () => {
  const box = document.getElementById("list");
  try {
    let rows = [];
    try {
      const db = await openDb();
      rows = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        req.onerror = () => reject(req.error);
      });
    } catch (_) {}
    if (!rows.length) {
      const bag = await chrome.storage.local.get("recordsCache");
      rows = Array.isArray(bag.recordsCache) ? bag.recordsCache : [];
    }
    if (!rows.length) {
      box.textContent = "No chats yet. Open ChatGPT, Gemini, or Grok and send an ask.";
      return;
    }
    box.innerHTML = rows.slice(0, 40).map((r) => {
      const who = r.account ? ` · ${escapeHtml(r.account)}` : "";
      return `<div class="row"><div class="meta">${escapeHtml(r.date || "")} ${escapeHtml(r.time || "")} · ${escapeHtml(r.platform || "")}${who} · ${r.askCount || 0} asks</div><b>${escapeHtml(r.title || r.conversationId || "")}</b><br>${escapeHtml(r.url || r.conversationId || "")}</div>`;
    }).join("");
  } catch (err) {
    box.textContent = "DB error: " + err;
  }
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
