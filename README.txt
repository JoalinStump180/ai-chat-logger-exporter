AI Chat Ask Logger — load unpacked
----------------------------------
1. chrome://extensions or edge://extensions
2. Developer mode on
3. Load unpacked → select this folder (ai-chat-logger)

What it does
------------
Content script on ChatGPT, Gemini, Grok:
  - overlay timestamp on each user ask
  - Ctrl+Up / Ctrl+Down recall (extension IndexedDB)
  - on send, logs the ask to the extension background

Explorer (popup → Open explorer):
  - same layout as Visit URL Logger
  - ONE row per conversation (not per ask)
  - fold (+) to see asks, same place comments occupied
  - sidebar: All / ChatGPT / Gemini / Grok
  - search can include ask text

How a chat is identified
------------------------
NOT the per-ask rid= query param (that changes every send).
Uses the stable path id and strips rid:

  ChatGPT  /c/<id>
  Gemini   /app/<id>
  Grok     /c/<id> or /chat/<id>

Merge key = platform + conversationId.
Same thread, many asks → one row + many ask children.

Storage
-------
Extension origin IndexedDB: aiChatAskLog
  records  = chats
  asks     = individual prompts

This is NOT the Tampermonkey page-origin DB, and NOT visitCommentLog.
Disable the userscript on these sites if both run, or you will double-stamp.

Settings (popup)
----------------
  Show ask-bubble timestamp stick-text  — hide/show on-page stamps
  Log each ask (prompt text)            — when off, still logs session
                                          date/time, title, URL/chat id,
                                          and account name/email

Account prefix
--------------
Best-effort detect signed-in name and/or email on ChatGPT / Gemini / Grok
and prefix the session title:  [Name / email] Chat title

Per-chat isolation
------------------
Ask-bubble timestamps and Ctrl+Up/Down history are scoped to the current
conversation id (not all chats on the platform). Switching threads clears
stamps and reloads that chat's own history.

First ask before the session id exists
--------------------------------------
A new chat has no id in the URL at send time. That ask is held in the tab
until the create response or the URL yields an id, then written on the real
session. If neither appears within 20s, it is stored under pending:<nonce>
and moved onto the real session when that chat is opened.

Title / auto-rename without another ask
----------------------------------------
A committed rename, including Grok's auto-rename, updates the same row.
Shorter names replace longer ones. A generic tab title does not overwrite
a real name. Title-only sync does not add an ask and does not move the
row's ask time.

Usage:

use the  'import side pane' button to import    'ai-chat-logger-side-pane-example.json' ,
and have a try , 

TODO:  
1.  in the title pane , when there are too many unfolded and long chat session ,  navigating them need to be :
     in the empty blank space of the top banner , just above the mode/from/to-calendar line , add an tab-button for each unfolded chat session 
      add "fold curr tab " "fold other tab" "fold other tab to the right"  , on each tab 's right-click menu



Known issue/s:

1.0  datetime pane 's prev/next hit feature is not ready --- but I have no time to fix , this is because in the jumpHit() , it is passing h.urlid to renderSlice() , but renderSlice() need is h.id format, not h.urlid format.  


1.1'  chatgpt 's webpage is sending "message" too often,  some message ' s 'title' field, is not meaningful , like  "Introduction to GPT-5"  ---and u do not want a title like this . 
I think a fix for this  ,is to : in content.js :  comment out this line: " if (e.data.title) syncTitle(id, e.data.title);"   , and in  "function logAsk(text, source)" 's  "if (id)"  block , just before the 'return'  clause , add this : "syncTitle(id);"   . This might fix . 












2.  also explain :why if in case not touching any meta- node , the selectedNid will no be changed ?

 
------ Why selectedNid does not change for an ordinary message hit
After inspecting the actual control flow in your ZIP, I need to correct one detail from my previous explanation: the code does not automatically change selectedNid for every search hit.
The decisive difference is this code in renderSlice(true):
if (selectedId &&
    !$("dateTimeView").querySelector(
      '[data-nid="' + CSS.escape(selectedId) + '"]'
    )) {
  renderDateTimeWindow(selectedId, true);
}
There are two cases.
Case A — the hit is a metadata hit (meta-...)
jumpHit() assigns selectedId = h.nid.
The DateTime pane has no message with that meta-... ID.
The condition is true, so renderDateTimeWindow(selectedId, true) runs.
Its target lookup fails, but it still schedules selectItemByNid(nid, ...).
That function assigns selectedNid = nid before checking whether the DOM element exists.
Case B — the hit is an ordinary message (ask-..., ans-..., sei-..., seo-..., or onMsg-...)
jumpHit() assigns selectedId = h.nid.
If that message is already present in the DateTime pane, the selector finds it.
The condition in renderSlice(true) is false.
renderDateTimeWindow() is not called, so its deferred selectItemByNid() call does not occur.
jumpHit() only applies the temporary ptt-jump visual effect. It never assigns selectedNid itself.
That is why selectedNid can remain unchanged for an ordinary hit, even though the hit navigation moves to another result.
One important qualification
If an ordinary message hit is not currently in the DateTime pane, the condition becomes true and the selection path can run for that hit too. So the actual dividing line is whether the hit's data-nid already exists in the DateTime pane, not simply whether the hit is metadata or a message.
This is also why your observation is plausible: a metadata hit cannot match a message data-nid, while an ordinary hit often can.
The key lines to keep in mind are:
jumpHit() — assigns selectedId, not selectedNid.
renderSlice(true) — decides whether to rebuild the DateTime window.
renderDateTimeWindow() — schedules the selection callback when given a nonempty nid.
selectItemByNid() — changes selectedNid before checking whether a matching DOM element exists.
These four functions together explain the difference in behavior.