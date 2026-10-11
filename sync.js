const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId") || 0);
const from = Math.max(1, parseInt(params.get("from") || "1", 10));
const to = Math.max(from, parseInt(params.get("to") || "10", 10));

const $ = (id) => document.getElementById(id);
$("closeBtn").onclick = () => window.close();

let sessions = [];
let platform = "";
let token = "";
let account = "";

function sendTab(msg) {
  return new Promise((resolve, reject) => {
    if (!tabId) return reject(new Error("no tabId — open Sync from the popup while an AI tab is active"));
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function sendBg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function paint() {
  $("rows").innerHTML = sessions.map((s, i) => `
    <div class="item" data-i="${i}">
      <label title="log asks"><input type="checkbox" class="ck-ask" ${s.logAsk ? "checked" : ""} /> ask</label>
      <label title="log answers"><input type="checkbox" class="ck-ans" ${s.logAnswer ? "checked" : ""} /> answer</label>
      <div>
        <div class="title">${esc(s.n + ". " + (s.title || s.id))}</div>
        <div class="url">${esc(s.url || s.id)}</div>
      </div>
      <div class="st ${s.cls || ""}" id="st-${i}">${esc(s.status || "")}</div>
    </div>`).join("") || "<div class='item'>No sessions in this range.</div>";
  $("rows").querySelectorAll(".item").forEach((el) => {
    const i = Number(el.dataset.i);
    el.querySelector(".ck-ask")?.addEventListener("change", (e) => { sessions[i].logAsk = e.target.checked; });
    el.querySelector(".ck-ans")?.addEventListener("change", (e) => { sessions[i].logAnswer = e.target.checked; });
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(i, text, cls) {
  sessions[i].status = text;
  sessions[i].cls = cls || "";
  const el = document.getElementById("st-" + i);
  if (el) {
    el.textContent = text;
    el.className = "st " + (cls || "");
  }
}

(async () => {
  try {
    const res = await sendTab({ type: "list-sessions", to });
    if (!res || !res.ok) throw new Error((res && res.error) || "list failed");
    platform = res.platform;
    token = res.token || "";
    account = res.account || "";
    const sliced = (res.rows || []).slice(from - 1, to);
    sessions = sliced.map((row, idx) => ({
      ...row,
      n: from + idx,
      logAsk: true,
      logAnswer: true,
      status: "ready",
      cls: ""
    }));
    $("meta").textContent = `${platform} · range ${from}:${to} · ${sessions.length} chat(s)` + (account ? " · " + account : "");
    paint();
  } catch (err) {
    $("meta").textContent = "Detect failed: " + err.message +
      " — keep the AI tab (Grok / ChatGPT) focused, reload that tab after loading the extension, then Sync again.";
  }
})();

$("logBtn").onclick = async () => {
  $("logBtn").disabled = true;
  $("foot").textContent = "logging…";
  let done = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (!s.logAsk && !s.logAnswer) {
      setStatus(i, "skipped", "");
      done++;
      continue;
    }
    setStatus(i, "fetching…", "run");
    try {
      const pack = await sendTab({ type: "fetch-session", id: s.id, token });
      if (!pack || !pack.ok) throw new Error((pack && pack.error) || "fetch failed");
      setStatus(i, "writing…", "run");
      const saved = await sendBg({
        type: "import-turns",
        platform,
        conversationId: s.id,
        url: pack.url || s.url,
        title: pack.title || s.title,
        account,
        logAsk: s.logAsk,
        logAnswer: s.logAnswer,
        overwriteText: !!document.getElementById("overwriteText")?.checked,
        turns: pack.turns || []
      });
      if (!saved || saved.error) throw new Error(saved && saved.error || "db write failed");
      setStatus(i, `ok  +${saved.asksAdded || 0} ask / +${saved.answersAdded || 0} ans  (total ${saved.askTotal}/${saved.answerTotal})`, "ok");
    } catch (err) {
      setStatus(i, "error: " + err.message, "err");
    }
    done++;
    $("foot").textContent = done + " / " + sessions.length;
  }
  $("foot").textContent = "all items finished — window stays open";
  $("logBtn").disabled = false;
};
