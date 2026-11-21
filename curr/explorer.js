const $ = (id) => document.getElementById(id);

const POSTFIX_HIST_KEY = "explorerPostfixHist";
const MAX_POSTFIX_HIST = 25;
let postfixHist = [];

chrome.storage.local.get(
  { explorerFromValue: "", explorerToValue: "", [POSTFIX_HIST_KEY]: [] },
  function (bag) {
    if ($("fromBox")) $("fromBox").value = bag.explorerFromValue || "";
    if ($("toBox")) $("toBox").value = bag.explorerToValue || "";
    postfixHist = Array.isArray(bag[POSTFIX_HIST_KEY]) ? bag[POSTFIX_HIST_KEY] : [];
    paintPostfixHist();
  }
);

function saveRange() {
  const rec = {
    explorerFromValue: ($("fromBox") && $("fromBox").value) || "",
    explorerToValue: ($("toBox") && $("toBox").value) || ""
  };
  chrome.storage.local.set(rec, function () {
    const status = $("rangeStatus");
    if (status) status.textContent = "Saved " + (rec.explorerFromValue || "…") + " → " + (rec.explorerToValue || "…");
  });
}

if ($("saveRange")) $("saveRange").addEventListener("click", saveRange);
["fromBox", "toBox"].forEach(function (id) {
  const el = $(id);
  if (el) el.addEventListener("change", saveRange);
});

function paintPostfixHist() {
  const box = $("postfixHist");
  if (!box) return;
  box.innerHTML = postfixHist.map(function (s) { return "<div>" + String(s).replace(/[&<>"']/g, function (c) {
    if (c === "&") return "&";
    if (c === "<") return "<";
    if (c === ">") return ">";
    if (c === '"') return "";
    return "&#39;";
  }) + "</div>"; }).join("");
}

function pushPostfixHist(s) {
  s = String(s || "").trim();
  if (!s) return;
  postfixHist = postfixHist.filter(function (x) { return x !== s; });
  postfixHist.unshift(s);
  postfixHist = postfixHist.slice(0, MAX_POSTFIX_HIST);
  try { chrome.storage.local.set({ [POSTFIX_HIST_KEY]: postfixHist }); } catch (_) {}
  paintPostfixHist();
}

function openPicked() {
  const raw = ($("explorerPostfix") && $("explorerPostfix").value) || "";
  const postfix = String(raw).trim();
  const status = $("rangeStatus");
  if (!postfix) {
    if (status) status.textContent = "Enter a postfix.";
    return;
  }
  pushPostfixHist(postfix);
  location.href = "explorer" + postfix + ".html";
}

if ($("openExplorer")) $("openExplorer").addEventListener("click", openPicked);

const postfixInput = $("explorerPostfix");
const postfixHistEl = $("postfixHist");
if (postfixInput) {
  postfixInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") openPicked();
  });
  postfixInput.addEventListener("focus", function () {
    if (postfixHist.length && postfixHistEl) postfixHistEl.style.display = "block";
  });
  postfixInput.addEventListener("input", function () {
    if (postfixHistEl) postfixHistEl.style.display = postfixHist.length ? "block" : "none";
  });
}
if (postfixHistEl) {
  postfixHistEl.addEventListener("mousedown", function (e) {
    const d = e.target.closest("div");
    if (!d) return;
    if (postfixInput) postfixInput.value = d.textContent;
    postfixHistEl.style.display = "none";
    openPicked();
  });
}
document.addEventListener("click", function (e) {
  if (postfixHistEl && !e.target.closest(".postfix-wrap")) postfixHistEl.style.display = "none";
});
