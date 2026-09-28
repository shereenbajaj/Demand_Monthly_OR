/* GET /api/demand
 *
 * Returns demand_monthly_summary to a caller holding a valid MetaGO Central
 * Auth access token minted for THIS app.
 *
 * Verification is delegated to @metago-health/auth-node, which checks the token
 * against the auth service's published JWKS and enforces issuer, audience,
 * algorithm and expiry. There is no shared secret on this side.
 *
 * The `audience` check is the access control. A token minted for another app
 * ("coach", say) is rejected here, so entitlement is decided centrally by the
 * auth service rather than by a list living in this project. ALLOWED_EMAILS is
 * available as an optional extra narrowing on top of that — see below.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   METAGO_CLIENT_ID      this app's client id in the auth service, e.g. "demand"
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role key (Supabase → Settings → API)
 *
 * Optional:
 *   METAGO_AUTH_ISSUER    defaults to https://auth.metago.health
 *   ALLOWED_EMAILS        comma-separated. When set, a verified token must ALSO
 *                         match one of these addresses. Leave unset to accept
 *                         anyone the auth service has entitled to this client.
 */
import { createTokenVerifier } from "@metago-health/auth-node";

const ISSUER = process.env.METAGO_AUTH_ISSUER || "https://auth.metago.health";
const CLIENT_ID = process.env.METAGO_CLIENT_ID;

/* Built once per warm instance: the verifier caches JWKS keys and handles
 * rotation, so rebuilding it per request would refetch keys needlessly. */
let verifier = null;
function getVerifier() {
  if (!verifier) {
    verifier = createTokenVerifier({ issuer: ISSUER, audience: CLIENT_ID });
  }
  return verifier;
}

/* Column order is the page's contract — the page indexes into these arrays by
 * position, so reordering silently mislabels every chart. Append, never insert. */
const COLS = [
  "month_start", "category", "campaign_views", "uq_visitors", "total_donation",
  "total_orders", "unique_donors", "tipped_orders", "tip_amount", "contri_initiated",
  "cart_created", "order_created", "campaigns_live", "campaign_days_live",
  "campaigns_approved", "campaigns_raised", "offline_amount", "offline_count",
  "qr_order_amount", "bank_transfer_amount", "coupon_amount",
  "qr_order_count", "bank_transfer_count", "coupon_count"
];

function extraAllowList() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export default async function handler(req, res) {
  /* A protected response must never sit in a shared cache — the CDN cannot tell
   * one viewer's session from another's. */
  res.setHeader("Cache-Control", "private, no-store");

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!CLIENT_ID) {
    return res.status(500).json({
      error: "METAGO_CLIENT_ID is not set on this deployment, so no token can be accepted."
    });
  }
  if (!base || !key) {
    return res.status(500).json({
      error: "SUPABASE_URL and SUPABASE_SERVICE_KEY are not set on this deployment."
    });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "login_required" });
  }

  let user;
  try {
    user = await getVerifier()(token);
  } catch (err) {
    /* Covers expired, wrong audience, wrong issuer, bad signature and malformed
     * tokens alike. The client's move is the same in every case: get a fresh
     * token from the auth service. */
    return res.status(401).json({ error: "login_required", detail: String(err.message || err) });
  }

  const email = user && user.email ? String(user.email).toLowerCase() : "";
  const extra = extraAllowList();
  if (extra.length && !extra.includes(email)) {
    return res.status(403).json({
      error: (email || "This account") + " is not on the access list for this dashboard."
    });
  }

  const url = base.replace(/\/+$/, "") +
    "/rest/v1/demand_monthly_summary" +
    "?select=" + COLS.join(",") +
    "&order=month_start.asc,category.asc";

  try {
    const r = await fetch(url, { headers: { apikey: key, Authorization: "Bearer " + key } });

    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: "Supabase " + r.status, detail: body.slice(0, 400) });
    }

    const json = await r.json();
    if (!Array.isArray(json) || !json.length) {
      return res.status(502).json({ error: "Supabase returned no rows." });
    }

    const rows = json.map((d) =>
      COLS.map((c, i) => {
        if (i === 0) return String(d[c]).slice(0, 7);   // YYYY-MM
        if (i === 1) return d[c];
        return Number(d[c]) || 0;
      })
    );

    return res.status(200).json({ rows, at: new Date().toISOString(), viewer: email });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach Supabase", detail: String(err.message || err) });
  }
}
