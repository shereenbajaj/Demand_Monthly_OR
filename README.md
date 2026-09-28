# Demand — monthly dashboard

A single-page dashboard over `public.demand_monthly_summary` in Supabase, built to deploy
on Vercel as static files. No build step, no framework, no chart library — the charts are
hand-rolled inline SVG.

## What it shows

15 months of demand data, filterable to any one of the four categories by clicking a tile
(click the selected tile again, or the header, to clear the filter).

| Section | Scope | Contents |
| --- | --- | --- |
| Header + category tiles | online **+** offline | Money raised in the latest month, all categories and each category |
| Online performance | online only | Donation, orders, unique donors, avg ticket, tip revenue, tip attach — vs previous month, 12-month average and the same month last year |
| Offline payments | offline only | QR / bank transfer / coupon amounts and counts, and average value per mode |
| Order economics | online only | Avg order value, orders vs unique donors, tip attach rate, average tip — 15-month trends |
| Funnel | online only | Views → visitors → contri initiated → cart → order created → orders placed, plus the three checkout step conversions |
| Campaigns | n/a | Live, approved, raised, and average days live |

## The one thing to know about the data

**Online and offline are two separate pools, not a split of one total.**

- `total_donation` and `total_orders` count **online only**.
- `offline_amount` and `offline_count` sit alongside them and are added to nothing.
- Money raised in a month is `total_donation + offline_amount`.

The header and the four category tiles show that sum. Every other figure outside the
Offline payments section is online only. Getting this backwards understates or
double-counts by roughly 15% of the Personal medical number.

Two further caveats, also stated in the note at the bottom of the page:

- Offline is almost entirely Personal medical (~21% of that category's money raised, vs
  0.1–0.3% for the other three). Near-zero offline elsewhere is real, not missing data.
- `unique_donors` and `uq_visitors` do **not** add across categories — anyone who gave to
  two categories is counted in both. All-categories figures for those two are upper
  bounds; per-category figures are exact.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The deployable page. Contains all markup, CSS and chart code. |
| `src-dashboard-body.html` | The source fragment `index.html` is assembled from. Edit this, not `index.html`. |
| `api/demand.js` | Serverless function that reads Supabase and returns the rows. |
| `live.js` | Browser side: fetches `/api/demand`, listens for change pings, redraws. |
| `realtime-setup.sql` | One-time setup for push notifications. Optional. |

## Access — MetaGO Central Auth

Sign-in goes through `auth.metago.health`. The page exchanges the SSO cookie for
a short-lived access token scoped to this app, and sends it with every call to
`/api/demand`. The function verifies it with `@metago-health/auth-node` against
the service's published JWKS — issuer, audience, algorithm and expiry all
enforced, no shared secret on this side.

**The audience check is the access control.** A token minted for another app is
rejected here, so entitlement is decided centrally rather than by a list in this
repo. `ALLOWED_EMAILS` is available as an optional extra narrowing on top; leave
it unset to accept anyone the auth service has entitled to this client.

Flow:

1. `POST ${ISSUER}/v1/auth/authorize` with `credentials: "include"` → access token
2. `401` → redirect to `${ISSUER}/login?client_id=…&return_to=…`, user returns warm
3. A `401` from `/api/demand` means the token aged out: mint a new one and retry
   once, silently. Only a failed re-authorize sends the user back to login.

### Environment variables

| Name | Value |
| --- | --- |
| `METAGO_CLIENT_ID` | this app's client id in the auth service — must match `CLIENT_ID` in `live.js` |
| `NPM_TOKEN` | read token for the private registry, needed at build time |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the `service_role` key |
| `METAGO_AUTH_ISSUER` | optional, defaults to `https://auth.metago.health` |
| `ALLOWED_EMAILS` | optional extra narrowing, comma-separated |

### Before this works

- **Register a client id** for this dashboard in the auth service. `live.js` and
  `METAGO_CLIENT_ID` both currently say `demand` — a placeholder, not a
  registered client.
- **Serve the dashboard from a `metago.health` subdomain.** The SSO cookie is
  host-only on `auth.metago.health`. From a `*.vercel.app` origin the browser
  treats it as third-party: Safari blocks it outright and Chrome is heading the
  same way, so warm SSO would fail. Point e.g. `demand.metago.health` at the
  Vercel project and the cookie is first-party again.
- **Allow this origin in the auth service's CORS config**, with credentials.

**No figures are stored in this repo.**

## Building

`.npmrc` routes installs through the MetaGO registry and reads `${NPM_TOKEN}` at
install time — the token is never committed. Set `NPM_TOKEN` in Vercel before
the first deploy or the build fails resolving `@metago-health/auth-node`.

`index.html` is generated. Edit `src-dashboard-body.html`, then:

```sh
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1">'
  echo '</head><body>'
  cat src-dashboard-body.html
  echo '<script type="module" src="./live.js"></script>'
  echo '</body></html>'
} > index.html
```

## The column contract

`api/demand.js` returns each row as a plain array and the page indexes into it by
position. The `COLS` list in that file is the contract — reordering it silently
mislabels every chart. Append new columns at the end.
