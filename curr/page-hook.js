(function () {
  "use strict";
  if (window.__aiChatLoggerHook) return;
  window.__aiChatLoggerHook = true;

  function emit(payload) {
    try {
      window.postMessage(Object.assign({ source: "ai-chat-logger", kind: "conv" }, payload), "*");
    } catch (_) {}
  }

  function pick(obj, depth) {
    const out = { id: "", title: "" };
    const seen = new Set();
    function walk(node, d) {
      if (!node || d > 5 || typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item, d + 1);
        return;
      }
      for (const key of Object.keys(node)) {
        const val = node[key];
        const k = key.toLowerCase();
        if (!out.id && (k === "conversationid" || k === "conversation_id") && typeof val === "string" && val.length > 4) out.id = val;
        if (!out.title && k === "title" && typeof val === "string" && val.trim()) out.title = val.trim();
        if (val && typeof val === "object") walk(val, d + 1);
      }
    }
    walk(obj, 0);
    return out;
  }

  function geminiId(text) {
    const m = String(text || "").match(/\b(c_[a-f0-9]{8,})\b/i);
    return m ? m[1] : "";
  }

  function geminiTitle(node) {
    if (!node || typeof node !== "object") return "";
    if (Array.isArray(node)) {
      for (const item of node) {
        const t = geminiTitle(item);
        if (t) return t;
      }
      return "";
    }
    for (const key of Object.keys(node)) {
      if (key.toLowerCase() === "title" && typeof node[key] === "string" && node[key].trim()) return node[key].trim();
    }
    return "";
  }

  function considerGemini(url, text) {
    let raw = String(text || "").replace(/^\)\]\}'\s*/, "");
    let id = geminiId(raw);
    let title = "";
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("[")) continue;
      let chunks;
      try { chunks = JSON.parse(s); } catch (_) { continue; }
      const list = Array.isArray(chunks) ? chunks : [chunks];
      for (const chunk of list) {
        if (!Array.isArray(chunk)) continue;
        const inner = chunk[0] === "wrb.fr" ? chunk[2] : null;
        if (typeof inner !== "string") continue;
        let payload;
        try { payload = JSON.parse(inner); } catch (_) { continue; }
        const pair = payload && payload[1];
        if (Array.isArray(pair) && typeof pair[0] === "string" && /^c_[a-f0-9]{8,}$/i.test(pair[0])) id = pair[0];
        if (!id) id = geminiId(inner);
        if (!title) title = geminiTitle(payload);
      }
    }
    if (!id && !title) return;
    emit({ url: url, id: id, title: title });
  }

  function consider(url, text) {
    const u = String(url || "");
    if (!text || text.length > 2000000) return;
    if (/BardChatUi|batchexecute|StreamGenerate/i.test(u)) {
      considerGemini(u, text);
      return;
    }
    if (!/conversation|\/c\/|app-chat|backend-api/i.test(u)) return;
    let data;
    try { data = JSON.parse(text); } catch (_) { return; }
    const found = pick(data);
    if (!found.id && !found.title) return;
    emit({ url: u, id: found.id, title: found.title });
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      const args = arguments;
      const input = args[0];
      const url = (input && input.url) || String(input || "");
      return origFetch.apply(this, args).then(function (res) {
        try {
          res.clone().text().then(function (t) { consider(url, t); }).catch(function () {});
        } catch (_) {}
        return res;
      });
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aiChatUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        if (typeof this.responseText === "string") consider(this.__aiChatUrl || "", this.responseText);
      } catch (_) {}
    });
    return origSend.apply(this, arguments);
  };
})();
