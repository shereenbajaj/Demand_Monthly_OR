/* Sign-in and live data for the Demand monthly dashboard.
 *
 * AUTH — MetaGO Central Auth (auth.metago.health).
 *
 *   1. POST ${ISSUER}/v1/auth/authorize with credentials:"include". If the SSO
 *      cookie is present, the service mints a short-lived access token scoped
 *      to CLIENT_ID and we are signed in without the user doing anything.
 *   2. On 401 login_required, send the user to the hosted login page with
 *      return_to set to this page. They come back warm and step 1 succeeds.
 *   3. Every /api/demand call carries that token. The function verifies it
 *      against the service's JWKS — that check, not anything here, is what
 *      protects the data.
 *   4. Tokens are short-lived, so a 401 from /api/demand means "mint a new one
 *      and retry", which happens silently. Only a failed re-authorize sends the
 *      user back to the login page.
 *
 * DATA — fetch on load, on a timer while the tab is visible, on focus, and on
 * demand. The page ships with no data of its own: if nothing loads it says so
 * rather than showing figures that might be months out of date.
 */
(function () {
  "use strict";

  var API = "/api/demand";

  /* The auth service and this app's client id. Client ids are not secrets —
     they identify the app, they don't authorise it. This must match
     METAGO_CLIENT_ID on the serverless function, which uses it as the expected
     token audience; a mismatch rejects every token. */
  var ISSUER = "https://auth.metago.health";
  var CLIENT_ID = "demand";

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

  var token = null, viewerEmail = "";
  var lastOk = 0, inFlight = false, timer = null, staleTimer = null;

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
  function showViewer(email) {
    viewerEmail = email || "";
    if (el.viewer) { el.viewer.textContent = viewerEmail; el.viewer.hidden = !viewerEmail; }
    if (el.signOut) el.signOut.hidden = !viewerEmail;
  }

  /* --- auth --------------------------------------------------------------- */

  function loginUrl() {
    return ISSUER + "/login?client_id=" + encodeURIComponent(CLIENT_ID) +
           "&return_to=" + encodeURIComponent(window.location.href);
  }
  function goToLogin() { window.location.href = loginUrl(); }

  /* The authorize response shape is not pinned down in the package README, so
     accept the usual spellings rather than guessing one and failing silently on
     a field name. */
  function readToken(body) {
    if (!body) return null;
    return body.access_token || body.accessToken || body.token || null;
  }

  /* Exchange the SSO cookie for an access token for this app. Resolves with a
     token, or null when the user needs to sign in. */
  function authorize() {
    return fetch(ISSUER + "/v1/auth/authorize", {
      method: "POST",
      credentials: "include",          // sends the SSO cookie to the auth host
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID })
    })
      .then(function (r) {
        if (r.status === 401) return null;     // login_required
        if (!r.ok) throw new Error("authorize failed: HTTP " + r.status);
        return r.json().then(function (body) {
          var t = readToken(body);
          if (!t) throw new Error("authorize returned no access token");
          return t;
        });
      });
  }

  if (el.signIn) el.signIn.addEventListener("click", goToLogin);
  if (el.signOut) el.signOut.addEventListener("click", function () {
    /* Ending the SSO session is the auth service's job — it owns the cookie and
       the session family. Clearing only our local token would leave the user
       signed straight back in on the next authorize call. */
    fetch(ISSUER + "/v1/auth/logout", { method: "POST", credentials: "include" })
      .catch(function () { /* log out locally regardless */ })
      .then(function () {
        token = null;
        lastOk = 0;
        showViewer("");
        clearInterval(timer);
        el.btn.hidden = true;
        setEmptyUI();
        boot("signin");
        setState("snapshot", "Signed out");
      });
  });

  /* --- data --------------------------------------------------------------- */

  function markStale() {
    if (!lastOk) return;
    setState("stale", "Last updated " + clock(new Date(lastOk)) + " — not refreshing");
  }
  function scheduleStale() {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

  function fetchRows() {
    return fetch(API, {
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: "Bearer " + token }
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) {
          var e = new Error(body && body.error ? body.error : "HTTP " + r.status);
          e.status = r.status;
          throw e;
        }
        return body;
      });
    });
  }

  function load(reason) {
    if (inFlight) return;
    if (reason === "focus" && Date.now() - lastOk < MIN_GAP_MS) return;

    inFlight = true;
    el.btn.disabled = true;
    setState("loading", lastOk ? "Refreshing…" : "Loading live data…");
    if (!lastOk) boot("loading");

    /* Get a token first if we have none — the first load and the load after a
       token expires both land here. */
    (token ? Promise.resolve(token) : authorize())
      .then(function (t) {
        if (!t) { goToLogin(); return null; }
        token = t;
        return fetchRows().catch(function (err) {
          /* A short-lived token expiring mid-session is routine, not an error:
             mint a fresh one and retry once before bothering the user. */
          if (err.status !== 401) throw err;
          token = null;
          return authorize().then(function (t2) {
            if (!t2) { goToLogin(); return null; }
            token = t2;
            return fetchRows();
          });
        });
      })
      .then(function (body) {
        if (!body) return;                       // redirecting to login
        if (!Array.isArray(body.rows) || !body.rows.length) {
          throw new Error("no rows returned");
        }
        if (!window.DEMAND_REFRESH || !window.DEMAND_REFRESH(body.rows)) {
          throw new Error("page could not accept the rows");
        }
        lastOk = Date.now();
        el.btn.hidden = false;
        setState("live", "Updated " + clock(new Date(lastOk)));
        showViewer(body.viewer || viewerEmail);
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
        if (lastOk) {
          setState("stale", "Last updated " + clock(new Date(lastOk)) + " — refresh failed");
        } else {
          setEmptyUI();
          setState("stale", "No data loaded");
          boot("error", err.message);
        }
      })
      .then(function () {
        inFlight = false;
        el.btn.disabled = false;
      });
  }

  /* --- triggers ------------------------------------------------------------ */

  el.btn.addEventListener("click", function () { load("manual"); });
  if (el.bootBtn) el.bootBtn.addEventListener("click", function () { load("manual"); });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load("focus");
  });
  window.addEventListener("focus", function () { load("focus"); });
  window.addEventListener("online", function () { load("focus"); });

  boot("loading", "Signing you in…");
  load("init");
  timer = setInterval(function () {
    if (!document.hidden) load("poll");
  }, POLL_MS);
})();
