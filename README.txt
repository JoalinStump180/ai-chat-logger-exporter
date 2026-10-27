AI Chat Logger  

1. What this extension does

AI Chat Logger records AI conversation sessions and messages in its own extension storage. It currently supports:

ChatGPT

Google Gemini

Grok

Custom websites, through configurable site-matching rules

It provides timestamp overlays, prompt history, conversation browsing, searching, manual synchronization, editing, and data import/export.

2. Install and open

Extract the ZIP into a folder.

Open edge://extensions or chrome://extensions.

Enable Developer mode.

Choose Load unpacked and select the extracted extension folder.

Open an AI website. If you installed or reloaded the extension, reload the website tab as well.

Click the extension icon to open its popup. Choose Open explorer to browse saved conversations.

3. Popup settings

Setting

Function

Show ask-bubble timestamp stick-text

Show or hide timestamp overlays on user prompts

Log each ask (prompt text)

Save prompt text; when disabled, session metadata is still recorded

Auto-log seen ask bubbles

Attempt to capture user-message bubbles discovered on the page

Auto-log seen answer bubbles

Attempt to capture answer bubbles discovered on the page

Show seen-route debug box

Show or hide the on-page debugging display

Sync

Open the manual synchronization window for the active AI tab

The extension also provides a recent-chat list.

Manual sync

Open ChatGPT or Grok and keep that tab available.

Open the extension popup.

Enter a range such as 1:10 and click Sync.

Select which conversations' asks and answers to import.

Click Log selected.

The Overwrite ask# / ans# text for the same uid option allows existing matching records' text to be overwritten. Manual sync is separate from ordinary live logging.

4. Explorer: browse conversations

The Explorer displays conversations as rows, rather than creating a separate top-level row for every prompt.

Expand/collapse a conversation: show or hide its message records.

Answers: use the answer controls to expand or collapse imported answers.

Edit: change a saved conversation title.

Lock: prevent later platform title synchronization from replacing that conversation's title.

Lock All Chat Titles: lock all saved conversation titles. The button changes to Unlock All Chat Titles when all are locked.

Refresh: reload saved data into the Explorer.

Delete: delete the selected conversation and its associated records. Use this carefully.

The left sidebar provides filters for All chats, ChatGPT, Gemini, Grok, favorites, and recycle.

Individual message controls also provide actions such as editing text, marking items as favorites, and moving items to the recycle area.

5. Search and display controls

Enter search terms in the top search box.

Or: match when any search term is present.

And: require all search terms.

Raw literal: treat the entire search box as one literal, case-insensitive string.

Fst / Lst: restrict message-text searching to the first or last specified lines.

MinL / MaxL: restrict results by message line count.

Fold lines: choose how many beginning and ending lines remain visible in long messages.

Invalidate lower pane: hide the lower hit-results pane during searching.

Search terms can match message text, and the Explorer can display matching lines with highlights.

Additional navigation controls include Prev hit, Next hit, Prev item, and Next item.

The date-time filters restrict results to a chosen date range. Calendar controls and previously used date/search values help with repeated searches.

The ptt / flat selector changes the message display layout. The live-ask sorting control changes the ordering of live asks.

Message-source filters

The five source checkboxes control which kinds of records are displayed:

Filter

Meaning

onMsg

Live-captured asks and legacy/unclassified records

sei

Automatically observed asks

seo

Automatically observed answers

ask

Manually synchronized/imported asks

ans

Manually synchronized/imported answers

These filters are initially off in the Explorer. A record hidden by a source filter is not necessarily missing from storage.

6. Import and export

Export / Import: back up or restore conversation data through JSON.

Export Side Pane / Import Side Pane: back up or replace the custom items in the left sidebar.

Recycle: browse records moved to the recycle area and use the available recovery controls.

The side-pane backup is separate from the normal conversation-data backup.

7. Custom website rules

The left sidebar's Configure function lets you define custom site-matching rules.

Rules can match URLs and optionally specify DOM whitelist or blacklist terms, such as wldiv: and bldiv:. Blacklist rules take precedence over whitelist rules.

This provides a way to configure capture for additional websites without relying exclusively on the built-in AI-site handling.

8. Storage and data cautions

Data is stored in the extension's own IndexedDB database, aiChatAskLog; it is separate from a webpage's own database.

Live capture and manual sync are different mechanisms, so their records and coverage can differ.

Automatic observation depends on finding compatible message elements and identifiers on the page.

If both this extension and another logger are recording the same site, duplicate timestamps or records may result.

Known limitation: the included README flags the DateTime-pane Prev/Next Hit navigation as unfinished. If hit navigation behaves unexpectedly in that view, use the title/session view or search results to locate the conversation.

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
