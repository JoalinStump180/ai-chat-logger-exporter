 

  
  
   document.addEventListener("keydown", function (e) {
  if (e.key === "PageDown") {
    if (middleMode === "item") {
      const wrap = document.querySelector(".listwrap");
      //if (wrap && wrap.scrollTop <= 80) {
      if (1) {
        e.preventDefault();
        enforceSlidingWindow("down");
      }
    }
  }
});


 
 
const MAX_WINDOW = 200;
 
let isSlidingLocked = false;

function enforceSlidingWindow6(direction) {
  if (isSlidingLocked || middleMode !== "item" || !datetimeItems.length) return;
  
  const tb = $("dateTimeView");
  const wrap = document.querySelector(".listwrap");
  const tokens = parseSearch($("q").value).tokens;

  if (datetimeItems.length <= MAX_WINDOW) {
    if (dtStart !== 0 || dtEnd !== datetimeItems.length) {
      dtStart = 0;
      dtEnd = datetimeItems.length;
      tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
    }
    return;
  }

  isSlidingLocked = true;

  if (direction === "down") {
    if (dtEnd < datetimeItems.length) {
      dtEnd = Math.min(datetimeItems.length, dtEnd + DT_BATCH);
      if (dtEnd - dtStart > MAX_WINDOW) {
        dtStart = dtEnd - MAX_WINDOW;
      }
      
      const oldScrollHeight = wrap ? wrap.scrollHeight : 0;
      const oldScrollTop = wrap ? wrap.scrollTop : 0;

      // Defer heavy DOM string generation to the next animation frame
      requestAnimationFrame(() => {
        tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);

        if (wrap) {
          const heightDiff = wrap.scrollHeight - oldScrollHeight;
          if (oldScrollTop + wrap.clientHeight >= oldScrollHeight - 50) {
            wrap.scrollTop = wrap.scrollHeight - wrap.clientHeight - 10;
          } else {
            wrap.scrollTop = oldScrollTop + heightDiff;
          }
        }
      });
    }
  } else if (direction === "up") {
    if (dtStart > 0) {
      const beforeHeight = wrap ? wrap.scrollHeight : 0;
      dtStart = Math.max(0, dtStart - DT_BATCH);
      if (dtEnd - dtStart > MAX_WINDOW) {
        dtEnd = dtStart + MAX_WINDOW;
      }
      
      requestAnimationFrame(() => {
        tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
        if (wrap) wrap.scrollTop += wrap.scrollHeight - beforeHeight;
      });
    } else {
      refreshDateTimeHead();
      isSlidingLocked = false;
      return;
    }
  }

  $("status").textContent = `Showing items ${dtStart} to ${dtEnd} of ${datetimeItems.length} (Sliding window active)`;

  setTimeout(() => {
    isSlidingLocked = false;
  }, 300); // Slightly reduced lock time for snappier response
}




















function enforceSlidingWindow(direction) {
  if (isSlidingLocked || middleMode !== "item" || !datetimeItems.length) return;
  
  const tb = $("dateTimeView");
  const wrap = document.querySelector(".listwrap");
  const tokens = parseSearch($("q").value).tokens;

  if (datetimeItems.length <= MAX_WINDOW) {
    if (dtStart !== 0 || dtEnd !== datetimeItems.length) {
      dtStart = 0;
      dtEnd = datetimeItems.length;
      tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
    }
    return;
  }

  // Lock execution to prevent rapid-fire scroll loops
  isSlidingLocked = true;

  if (direction === "down") {
    if (dtEnd < datetimeItems.length) {
      dtEnd = Math.min(datetimeItems.length, dtEnd + DT_BATCH);
      if (dtEnd - dtStart > MAX_WINDOW) {
        dtStart = dtEnd - MAX_WINDOW;
      }
      tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
    }
  } else if (direction === "up") {
    if (dtStart > 0) {
      const beforeHeight = wrap ? wrap.scrollHeight : 0;
      dtStart = Math.max(0, dtStart - DT_BATCH);
      if (dtEnd - dtStart > MAX_WINDOW) {
        dtEnd = dtStart + MAX_WINDOW;
      }
      tb.innerHTML = datetimeRangeHtml(dtStart, dtEnd, tokens);
      if (wrap) wrap.scrollTop += wrap.scrollHeight - beforeHeight;
    } else {
      refreshDateTimeHead();
      isSlidingLocked = false;
      return;
    }
  }

  $("status").textContent = `Showing items ${dtStart} to ${dtEnd} of ${datetimeItems.length} (Sliding window active)`;

  // Release the lock after a brief 100ms cooldown
  setTimeout(() => {
    isSlidingLocked = false;
  }, 500);
}
  