/* Live data for the Demand monthly dashboard.
 *
 * Two mechanisms, deliberately layered:
 *
 *   1. FETCH — /api/demand returns the rows. This is the only path that ever
 *      carries the actual numbers, and it runs server-side with the service key.
 *      Runs on load, on a timer, when the tab regains focus, and on demand.
 *
 *   2. PUSH — a Supabase Realtime channel that carries a bare "the table
 *      changed" ping with no data in it. When one arrives we fetch. If Realtime
 *      is unreachable, or the SQL in realtime-setup.sql was never run, nothing
 *      breaks: the timer and the focus refetch still keep the page current.
 *
 * Push is the optimisation. Fetch is the guarantee. The inlined snapshot in
 * demand-data.js is the floor — if everything above fails the page still renders
 * and says plainly that it is showing a snapshot.
 */
(function () {
  "use strict";

  var API = "/api/demand";

  /* Publishable key — safe to ship. It can join the notification channel and
     nothing else: demand_monthly_summary has RLS on with no policies, so this
     key cannot read a single row of it. See realtime-setup.sql. */
  var SUPABASE_URL = "https://njgctrmitailbvjtyeiz.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_rAYKIz4k6hXqg5H-QPiDSg_cUfMPZYH";
  var TOPIC = "demand-updates";

  var POLL_MS = 5 * 60 * 1000;   // background poll while the tab is visible
  var MIN_GAP_MS = 20 * 1000;    // don't refetch more often than this on focus
  var STALE_MS = 20 * 60 * 1000; // past this with no successful read, say so

  var el = {
    wrap: document.getElementById("dmStatus"),
    txt: document.getElementById("dmStatusTxt"),
    btn: document.getElementById("dmRefresh")
  };
  if (!el.wrap) return;
  /* live.js is present, so the page can refresh: reveal the control. Until this
     runs the status line reads "Saved snapshot" with no button, which is the
     honest state for a page with no live source. */
  el.btn.hidden = false;

  var lastOk = 0, inFlight = false, timer = null, staleTimer = null;

  function clock(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function setState(state, text) {
    el.wrap.setAttribute("data-state", state);
    el.txt.textContent = text;
  }

  function markStale() {
    if (!lastOk) return;
    setState("stale", "Last updated " + clock(new Date(lastOk)) + " — not refreshing");
  }

  function scheduleStale() {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

  function load(reason) {
    if (inFlight) return;
    if (reason === "focus" && Date.now() - lastOk < MIN_GAP_MS) return;

    inFlight = true;
    el.btn.disabled = true;
    setState("loading", lastOk ? "Refreshing…" : "Loading live data…");
    if (!lastOk && window.DEMAND_BOOT) window.DEMAND_BOOT("loading");

    fetch(API, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body && body.error ? body.error : "HTTP " + r.status);
          return body;
        });
      })
      .then(function (body) {
        if (!body || !Array.isArray(body.rows) || !body.rows.length) {
          throw new Error("no rows returned");
        }
        if (!window.DEMAND_REFRESH || !window.DEMAND_REFRESH(body.rows)) {
          throw new Error("page could not accept the rows");
        }
        lastOk = Date.now();
        setState("live", "Updated " + clock(new Date(lastOk)));
        scheduleStale();
      })
      .catch(function (err) {
        console.warn("[demand] live read failed:", err.message);
        if (lastOk) {
          /* Data is on screen and still correct as of lastOk — say so and keep it. */
          setState("stale", "Last updated " + clock(new Date(lastOk)) + " — refresh failed");
        } else {
          /* Nothing has ever loaded. The page has no data of its own to fall back
             on, so the boot panel carries the message rather than a bare page. */
          setState("stale", "No data loaded");
          if (window.DEMAND_BOOT) window.DEMAND_BOOT("error", err.message);
        }
      })
      .then(function () {
        inFlight = false;
        el.btn.disabled = false;
      });
  }

  /* --- triggers ------------------------------------------------------- */

  el.btn.addEventListener("click", function () { load("manual"); });
  var bootBtn = document.getElementById("dmBootBtn");
  if (bootBtn) bootBtn.addEventListener("click", function () { load("manual"); });

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden) load("poll");
    }, POLL_MS);
  }

  /* A tab left open overnight should not keep polling, and should be current
     the moment it is looked at again. */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load("focus");
  });
  window.addEventListener("focus", function () { load("focus"); });
  window.addEventListener("online", function () { load("focus"); });

  load("init");
  startPolling();

  /* --- push ------------------------------------------------------------ */

  /* Loaded lazily and failure-tolerant: if the CDN is blocked or Realtime is
     not set up, the page carries on with fetch alone. */
  import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
    .then(function (mod) {
      var sb = mod.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        realtime: { params: { eventsPerSecond: 2 } }
      });
      sb.channel(TOPIC, { config: { private: true } })
        .on("broadcast", { event: "changed" }, function () { load("push"); })
        .subscribe(function (status, err) {
          if (status === "SUBSCRIBED") {
            console.info("[demand] live updates connected");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[demand] push unavailable (" + status + ") — polling instead",
              err && err.message ? err.message : "");
          }
        });
    })
    .catch(function (err) {
      console.warn("[demand] realtime client unavailable — polling instead:", err.message);
    });
})();
