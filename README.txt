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








To let ,  in datetime pane, the mouse scrolling is more 'stable' , change this in explorer.js : 

    if (scrollPercentage >= 0.95) {
      if (dtEnd < datetimeItems.length) {
        isScrollFetching = true;
        enforceSlidingWindow("down");
        
        // --- BREAK THE LOOP: Nudge scroll position up to ~85% ---
        // This drops the percentage below 95%, so it won't auto-trigger again 
        // until the user actively scrolls down further.
        setTimeout(() => {
          el.scrollTop = el.scrollHeight * 0.85;
          isScrollFetching = false;
        }, 50);



into this:  

    if (scrollPercentage >= 0.99) {
      if (dtEnd < datetimeItems.length) {
        isScrollFetching = true;
        enforceSlidingWindow("down");
        
        // --- BREAK THE LOOP: Nudge scroll position up to ~85% ---
        // This drops the percentage below 95%, so it won't auto-trigger again 
        // until the user actively scrolls down further.
        setTimeout(() => {
          el.scrollTop -= 200;
          isScrollFetching = false;
        }, 0);