/* Sign-in and live data for the Demand monthly dashboard.
 *
 * AUTH — Google, through Supabase Auth. The browser holds a session; every call
 * to /api/demand carries its access token. The server decides whether that
 * person may see the numbers. Nothing here is a security boundary: hiding the
 * dashboard in the browser is a courtesy, and /api/demand refuses unauthorised
 * requests whatever this file does.
 *
 * DATA — two mechanisms:
 *   1. FETCH — /api/demand returns the rows. Runs on load, on a timer, when the
 *      tab regains focus, and on demand.
 *   2. PUSH — a Supabase Realtime channel carrying a bare "the table changed"
 *      ping with no data in it. When one arrives we fetch. If Realtime is
 *      unreachable, or realtime-setup.sql was never run, the timer and the
 *      focus refetch still keep the page current.
 *
 * The page ships with no data of its own. If nothing loads it says so plainly
 * rather than showing figures that might be months out of date.
 */
(function () {
  "use strict";

  var SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

  var API = "/api/demand";

  /* Publishable key — safe to ship, and public in any browser-side page. It can
     start a sign-in and join a notification channel, nothing more:
     demand_monthly_summary has RLS on with no policies, so this key cannot read
     a single row of it. */
  var SUPABASE_URL = "https://njgctrmitailbvjtyeiz.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_rAYKIz4k6hXqg5H-QPiDSg_cUfMPZYH";
  var TOPIC = "demand-updates";

  var POLL_MS = 5 * 60 * 1000;   // background poll while the tab is visible
  var MIN_GAP_MS = 20 * 1000;    // don't refetch more often than this on focus
  var STALE_MS = 20 * 60 * 1000; // past this with no successful read, say so

  var el = {
    wrap: document.getElementById("dmStatus"),
    txt: document.getElementById("dmStatusTxt"),
    btn: document.getElementById("dmRefresh"),
    viewer: document.getElementById("dmViewer"),
    signOut: document.getElementById("dmSignOut"),
    signIn: document.getElementById("dmSignIn"),
    bootBtn: document.getElementById("dmBootBtn")
  };
  if (!el.wrap) return;

  var sb = null;
  var lastOk = 0, inFlight = false, timer = null, staleTimer = null;
  var session = null, channel = null;

  function clock(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function setState(state, text) {
    el.wrap.setAttribute("data-state", state);
    el.txt.textContent = text;
  }
  function boot(state, msg) {
    if (window.DEMAND_BOOT) window.DEMAND_BOOT(state, msg);
  }
  function setEmptyUI() {
    var root = document.querySelector(".dm-root");
    if (root) root.classList.add("is-empty");
  }

  /* --- sign in / out ---------------------------------------------------- */

  function signIn() {
    sb.auth.signInWithOAuth({
      provider: "google",
      /* Come back to this page, not the site root — the dashboard may not be
         served from "/" forever. */
      options: { redirectTo: window.location.origin + window.location.pathname }
    }).catch(function (err) {
      boot("error", "Could not start Google sign-in: " + (err.message || err));
    });
  }

  if (el.signIn) el.signIn.addEventListener("click", signIn);
  if (el.signOut) el.signOut.addEventListener("click", function () {
    sb.auth.signOut();
  });

  function showViewer(email) {
    if (el.viewer) { el.viewer.textContent = email || ""; el.viewer.hidden = !email; }
    if (el.signOut) el.signOut.hidden = !email;
  }

  /* --- data ------------------------------------------------------------- */

  function markStale() {
    if (!lastOk) return;
    setState("stale", "Last updated " + clock(new Date(lastOk)) + " — not refreshing");
  }
  function scheduleStale() {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

  function load(reason) {
    if (!session) return;                 // nothing to send; the gate would refuse
    if (inFlight) return;
    if (reason === "focus" && Date.now() - lastOk < MIN_GAP_MS) return;

    inFlight = true;
    el.btn.disabled = true;
    setState("loading", lastOk ? "Refreshing…" : "Loading live data…");
    if (!lastOk) boot("loading");

    fetch(API, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + session.access_token
      }
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var e = new Error(body && body.error ? body.error : "HTTP " + r.status);
            e.status = r.status;
            throw e;
          }
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
        showViewer(body.viewer || (session.user && session.user.email) || "");
        scheduleStale();
      })
      .catch(function (err) {
        console.warn("[demand] live read failed:", err.message);

        /* Turned away is a different problem from broken, and deserves a
           different screen: there is nothing to retry, only another account. */
        if (err.status === 403) {
          if (!lastOk) { setEmptyUI(); boot("denied", err.message); }
          setState("stale", "No access");
          return;
        }
        if (err.status === 401) {
          /* The session expired under us. Drop it and ask for a fresh sign-in. */
          session = null;
          lastOk = 0;
          showViewer("");
          setEmptyUI();
          boot("signin", "Your sign-in expired. Sign in again to continue.");
          setState("snapshot", "Not signed in");
          return;
        }
        if (lastOk) {
          setState("stale", "Last updated " + clock(new Date(lastOk)) + " — refresh failed");
        } else {
          setState("stale", "No data loaded");
          boot("error", err.message);
        }
      })
      .then(function () {
        inFlight = false;
        el.btn.disabled = false;
      });
  }

  /* --- triggers ---------------------------------------------------------- */

  el.btn.addEventListener("click", function () { load("manual"); });
  if (el.bootBtn) el.bootBtn.addEventListener("click", function () {
    /* With no session there is nothing to retry — the failure was earlier than
       the fetch (usually the library never loaded), so reload instead of
       calling load(), which would return immediately and do nothing. */
    if (session) load("manual"); else window.location.reload();
  });

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden) load("poll");
    }, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load("focus");
  });
  window.addEventListener("focus", function () { load("focus"); });
  window.addEventListener("online", function () { load("focus"); });

  /* --- push -------------------------------------------------------------- */

  function startPush() {
    if (channel) return;
    channel = sb.channel(TOPIC, { config: { private: true } })
      .on("broadcast", { event: "changed" }, function () { load("push"); })
      .subscribe(function (status, err) {
        if (status === "SUBSCRIBED") {
          console.info("[demand] live updates connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[demand] push unavailable (" + status + ") — polling instead",
            err && err.message ? err.message : "");
        }
      });
  }
  function stopPush() {
    if (!channel) return;
    sb.removeChannel(channel);
    channel = null;
  }

  /* --- session lifecycle -------------------------------------------------- */

  function applySession(next) {
    var had = !!session;
    session = next;

    if (!session) {
      stopPush();
      clearInterval(timer);
      lastOk = 0;
      showViewer("");
      el.btn.hidden = true;
      setEmptyUI();
      boot("signin");
      setState("snapshot", "Not signed in");
      return;
    }

    el.btn.hidden = false;
    showViewer(session.user && session.user.email);
    if (!had) {
      boot("loading");
      load("init");
      startPolling();
      startPush();
    }
  }

  /* Sign-in genuinely needs the Supabase library, so this import is not
     optional the way the old Realtime-only one was. Loading it dynamically
     means a blocked or unreachable CDN shows a message rather than killing the
     whole file and leaving a blank page with no way forward. */
  setState("loading", "Starting…");
  import(SB_LIB)
    .then(function (mod) {
      sb = mod.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
        realtime: { params: { eventsPerSecond: 2 } }
      });

      /* Fires on sign-in, sign-out, and silent token refresh. Keeping `session`
         current here means load() always sends a token that has not expired. */
      sb.auth.onAuthStateChange(function (event, next) {
        if (event === "TOKEN_REFRESHED" && next) { session = next; return; }
        applySession(next);
      });

      return sb.auth.getSession().then(function (r) { applySession(r.data.session); });
    })
    .catch(function (err) {
      console.warn("[demand] could not start sign-in:", err && err.message);
      setEmptyUI();
      setState("stale", "Sign-in unavailable");
      boot("error", "Couldn't load the sign-in library. Check your connection and reload.");
    });
})();
