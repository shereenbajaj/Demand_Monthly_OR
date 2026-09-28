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

**No figures are stored in this repo.** The page ships with no data at all — every
number it shows is fetched at runtime through `/api/demand`. Nothing in these files
reveals donation volumes.

No service key is here either. The only Supabase credential in the source is the
**publishable** key in `live.js`, which can do exactly one thing: join a notification
channel. It cannot read `demand_monthly_summary` — that table has RLS on with no
policies, and only the serverless function, holding the service key, can read it.

## Live data

Two mechanisms. There is no bundled fallback — if the fetch fails the page says so
plainly and offers a retry, rather than showing figures that may be months out of date:

1. **Push.** A Postgres trigger broadcasts a bare "the table changed" ping on a Realtime
   channel. The page hears it and re-fetches. The ping carries a timestamp and no row
   data. Needs `realtime-setup.sql` to have been run.
2. **Fetch.** The page calls `/api/demand` on load, every 5 minutes while the tab is
   visible, whenever the tab regains focus, and when the Refresh button is clicked. This
   is the only path that carries actual numbers.
If nothing has loaded yet, the page shows "Couldn't load demand data" with the actual
error and a **Try again** button. If data is already on screen and a later refresh
fails, it keeps that data and the status line says when it was last current.

The status line under the title always says which of these you are looking at.

### Setup

**1. Environment variables** (Vercel → Settings → Environment Variables):

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the `service_role` key, Supabase → Settings → API |

The service key bypasses RLS, which is why the table needs no read policy. It is a
full-access credential: it belongs in Vercel's environment variables and nowhere else —
not in this repo, not in the page.

Redeploy after adding them. Functions only pick up env vars on a new deployment.

**2. Push notifications** (optional). Run `realtime-setup.sql` in the Supabase SQL editor.
Without it everything still works; updates arrive on the 5-minute poll instead of
instantly.

### Checking it works

- Open the dashboard. The status line should read "Updated HH:MM" with a green dot.
- Change a row in Supabase. With push set up the page should update within a second or
  two; without it, within five minutes, or immediately if you click Refresh.
- `/api/demand` in a browser tab returns the raw JSON — useful for telling apart "the
  function is broken" from "the page is broken".

## Deploying

Static hosting, nothing to build. On Vercel: import the repo, framework preset **Other**,
leave build command and output directory empty.

## Editing

`index.html` is generated. Edit `src-dashboard-body.html`, then reassemble:

```sh
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1">'
  echo '<title>Demand — monthly</title></head><body>'
  cat src-dashboard-body.html
  echo '<script type="module" src="./live.js"></script>'
  echo '</body></html>'
} > index.html
```

## The column contract

`api/demand.js` returns each row as a plain array, and the page indexes into it by
position. The `COLS` list in that file is the contract — reordering it silently
mislabels every chart. Add new columns at the end.
