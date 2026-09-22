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
| `demand-data.js` | Snapshot of the table, so the page renders with no network call. |
| `src-dashboard-body.html` | The source fragment `index.html` is assembled from. Edit this, not `index.html`. |

No keys, URLs or credentials are in this repo. The page never talks to Supabase — it
renders entirely from `demand-data.js`.

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
  echo '<script src="./demand-data.js"></script>'
  cat src-dashboard-body.html
  echo '</body></html>'
} > index.html
```

## Refreshing the data

Re-export `demand_monthly_summary` into `demand-data.js`, keeping the existing column
order — it is documented in the comment at the top of that file. Rows are
`[month, category, ...]`, one per category per month, oldest first.

For live data instead of a snapshot, the page exposes `window.DEMAND_REFRESH(rows)`: hand
it rows in that same shape and it redraws. Feed it from a server-side route holding the
service key. Do **not** query Supabase directly from the browser — that needs the table
readable by the publishable key, which is public in any browser-side page, and these
numbers are not meant to be.
