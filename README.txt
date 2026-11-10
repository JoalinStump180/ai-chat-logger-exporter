AI Chat Explorer — sidebar Tab 2 settings/tools layout

Based on the CSS-only side-bag tabs prototype.

- Tab 1 (Current) is unchanged and still contains the existing bags.
- Tab 2 now contains the requested settings and management controls:
  storage path, line filters, foldM/foldN, source checkboxes, sort selector,
  title-lock button, delete/export/import, side-pane export/import, display mode,
  and imported ask/answer fold controls.
- Existing controls were moved, not cloned. Their original element IDs are
  preserved so the existing JavaScript listeners continue to target them.
- The visible labels for controls in Tab 2 use their element IDs.
- The four navigation buttons now display their existing element IDs:
  goNextGlobalBtn, goPrevGlobalBtn, goNextNBtn, goPrevMBtn.
- The lock-all button keeps its ID as its visible text; its current state is
  conveyed by its title and internal data attribute.
- Tab switching remains CSS-only. No JavaScript tab-switching logic was added.

Files: explorer.html, explorer.js


Additional toolbar layout update:
- Moved the existing Invalidate lower pane checkbox into sidebar Tab 2.
- Moved Goto, Go All, Fold all chats, and Refresh onto the From/To calendar row.
- Moved tokenBar beside the search input in the top toolbar so search keywords share that row.
- Existing element IDs and JavaScript handlers are preserved; explorer.js is unchanged.

Additional PTT node layout toggle:
- Added `pttSingleLine` checkbox to sidebar Tab 2.
- When enabled, each PTT node places chat metadata, item metadata, and message text
  in one inline flow; long content wraps naturally as needed.
- The setting is persisted in `chrome.storage.local` as `pttSingleLine`.
- The change is presentation-only; node markup, navigation, selection, and event
  handlers are unchanged.


Additional global PTT chat-info visibility toggle:
- Added `pttShowChatInfo` checkbox to Tab 2 beside `pttSingleLine`.
- Checked by default: every PTT node shows chat update time and chat title.
- Unchecked: chat metadata is hidden globally across all PTT nodes.
- Independent of `pttSingleLine`; either setting can be changed without affecting the other.
- Persisted in `chrome.storage.local` as `pttShowChatInfo`.
- Implemented with a body CSS class only; no PTT node reconstruction or pane redraw.


Additional PT/NT existing-items slider
--------------------------------------
A second horizontal slider sits immediately below the global sorted-items slider.
It uses the exact logical range used by the “pt exist” / “nt exist” controls: NIDs
that are already present in the active middle pane and also occur in the global
chronological index, ordered by that index. Folded/hidden DOM items remain eligible,
matching the PT/NT buttons. Dragging updates the position readout; releasing selects,
reveals, and scrolls to that existing item. The thumb follows selection changes and
updates when switching between the title and date-time panes. The original global
slider is retained independently.
