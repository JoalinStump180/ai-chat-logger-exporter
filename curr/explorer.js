const $ = (id) => document.getElementById(id);

chrome.storage.local.get(
  { explorerFromValue: "", explorerToValue: "" },
  function (bag) {
    if ($("fromBox")) $("fromBox").value = bag.explorerFromValue || "";
    if ($("toBox")) $("toBox").value = bag.explorerToValue || "";
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

function openPicked() {
  const n = parseInt($("explorerPick") && $("explorerPick").value, 10);
  const status = $("rangeStatus");
  if (!Number.isInteger(n) || n < 1) {
    if (status) status.textContent = "Enter a positive integer.";
    return;
  }
  location.href = "explorer" + n + ".html";
}

if ($("openExplorer")) $("openExplorer").addEventListener("click", openPicked);
if ($("explorerPick")) {
  $("explorerPick").addEventListener("keydown", function (e) {
    if (e.key === "Enter") openPicked();
  });
}
