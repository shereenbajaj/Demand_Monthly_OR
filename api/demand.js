/* GET /api/demand
 *
 * Reads demand_monthly_summary and returns it in the compact array shape the
 * dashboard expects. The service key lives in a Vercel environment variable and
 * never reaches the browser, so the table itself stays locked — RLS is on with
 * no policies, and the service key is what bypasses it.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role key (Supabase → Settings → API)
 */

/* Column order is the page's contract. demand-data.js documents it and
 * src-dashboard-body.html indexes into it by position — do not reorder. */
const COLS = [
  "month_start", "category", "campaign_views", "uq_visitors", "total_donation",
  "total_orders", "unique_donors", "tipped_orders", "tip_amount", "contri_initiated",
  "cart_created", "order_created", "campaigns_live", "campaign_days_live",
  "campaigns_approved", "campaigns_raised", "offline_amount", "offline_count",
  "qr_order_amount", "bank_transfer_amount", "coupon_amount",
  "qr_order_count", "bank_transfer_count", "coupon_count"
];

export default async function handler(req, res) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!base || !key) {
    return res.status(500).json({
      error: "SUPABASE_URL and SUPABASE_SERVICE_KEY are not set on this deployment."
    });
  }

  const url = base.replace(/\/+$/, "") +
    "/rest/v1/demand_monthly_summary" +
    "?select=" + COLS.join(",") +
    "&order=month_start.asc,category.asc";

  try {
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: "Bearer " + key }
    });

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

    /* Cached at the edge for a minute: a burst of viewers costs one read, and a
     * push notification still gets through within the minute. */
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ rows, at: new Date().toISOString() });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach Supabase", detail: String(err.message || err) });
  }
}
