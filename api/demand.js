/* GET /api/demand
 *
 * Returns demand_monthly_summary in the compact array shape the dashboard
 * expects — but only to a signed-in, allow-listed person.
 *
 * This is the real access control. The page's sign-in screen is a convenience;
 * this check is what stops someone curling the endpoint directly. Every path
 * that is not a verified, allow-listed user returns before Supabase is queried.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role key (Supabase → Settings → API)
 *   ALLOWED_EMAILS        comma-separated list of Google addresses that may
 *                         read this dashboard, e.g. "a@x.com, b@x.com"
 */

/* Publishable key — public by design, and required as the `apikey` header when
 * asking Supabase to identify the bearer of a user token. It grants nothing on
 * its own: demand_monthly_summary has RLS on with no policies. */
const PUBLISHABLE_KEY = "sb_publishable_rAYKIz4k6hXqg5H-QPiDSg_cUfMPZYH";

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

function allowList() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/* Ask Supabase who this token belongs to. Verifying by round-trip rather than
 * by checking the signature locally: it is a line of code instead of a JWT
 * library, and it honours revoked sessions, which a signature check does not. */
async function identify(base, token) {
  const r = await fetch(base.replace(/\/+$/, "") + "/auth/v1/user", {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user && user.email ? String(user.email).toLowerCase() : null;
}

export default async function handler(req, res) {
  /* A protected response must never sit in a shared cache — the CDN cannot tell
   * one viewer's session from another's. */
  res.setHeader("Cache-Control", "private, no-store");

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const allowed = allowList();

  if (!base || !key) {
    return res.status(500).json({
      error: "SUPABASE_URL and SUPABASE_SERVICE_KEY are not set on this deployment."
    });
  }
  /* Fail closed. An empty allow-list locks everyone out rather than letting
   * everyone in, so a missing env var can never silently open the dashboard. */
  if (!allowed.length) {
    return res.status(500).json({
      error: "ALLOWED_EMAILS is not set on this deployment, so no one can be let in."
    });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Sign in to view this dashboard." });
  }

  let email;
  try {
    email = await identify(base, token);
  } catch (err) {
    return res.status(502).json({ error: "Could not verify your sign-in", detail: String(err.message || err) });
  }
  if (!email) {
    return res.status(401).json({ error: "Your sign-in has expired. Sign in again." });
  }
  if (!allowed.includes(email)) {
    return res.status(403).json({ error: email + " is not on the access list for this dashboard." });
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
