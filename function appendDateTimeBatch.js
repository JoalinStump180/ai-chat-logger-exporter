

function appendDateTimeBatch(direction) {
  if (middleMode !== "item" || !datetimeItems.length) return;

  const tb = $("dateTimeView");
  const wrap = $(".listwrap");
  const tokens = parseSearch($("q").value).tokens;

  // Assumption: each direct child of #dateTimeView represents one item.
  function trimHead(count) {
    if (count <= 0) return;

    // Measure immediately before removing rows.
    const beforeHeight = wrap ? wrap.scrollHeight : 0;
    let removed = 0;

    while (removed < count && tb.firstElementChild) {
      tb.firstElementChild.remove();
      removed++;
    }

    dtStart += removed;

    // Preserve the viewport when removing content above it.
    if (wrap && removed > 0) {
      const heightDelta = wrap.scrollHeight - beforeHeight;
      wrap.scrollTop += heightDelta;
    }
  }

  function trimTail(count) {
    if (count <= 0) return;

    let removed = 0;

    while (removed < count && tb.lastElementChild) {
      tb.lastElementChild.remove();
      removed++;
    }

    dtEnd -= removed;
  }

  if (direction === "down" && dtEnd < datetimeItems.length) {
    const oldEnd = dtEnd;
    const newEnd = Math.min(
      datetimeItems.length,
      dtEnd + DT_BATCH
    );

    // 1. Append the next batch at the tail.
    tb.insertAdjacentHTML(
      "beforeend",
      datetimeRangeHtml(oldEnd, newEnd, tokens)
    );

    dtEnd = newEnd;

    // 2. Trim the head if the active window exceeds MAX_WINDOW.
    const excess = (dtEnd - dtStart) - MAX_WINDOW;

    if (excess > 0) {
      trimHead(excess);
    }

  } else if (direction === "up" && dtStart > 0) {
    const oldStart = dtStart;
    const newStart = Math.max(0, dtStart - DT_BATCH);

    // 1. Record the original content height.
    const beforeHeight = wrap ? wrap.scrollHeight : 0;

    // 2. Prepend older items.
    tb.insertAdjacentHTML(
      "afterbegin",
      datetimeRangeHtml(newStart, oldStart, tokens)
    );

    dtStart = newStart;

    // 3. Compensate for the prepended content.
    if (wrap) {
      wrap.scrollTop += wrap.scrollHeight - beforeHeight;
    }

    // 4. Trim the tail if the active window exceeds MAX_WINDOW.
    const excess = (dtEnd - dtStart) - MAX_WINDOW;

    if (excess > 0) {
      trimTail(excess);
    }

  } else if (direction === "up" && dtStart === 0) {
    refreshDateTimeHead();
  }

  $("status").textContent =
    (dtEnd - dtStart) +
    " of " +
    datetimeItems.length +
    " chronological items loaded";
}








        if  (el.scrollHeight >= 6000) {
            if (now - lastEnforceTime >= 1000) {
             lastEnforceTime = now;
              enforceSlidingWindow("down"); 
              }
          
       }  else enforceSlidingWindow("down");