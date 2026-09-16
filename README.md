# election-stats

A small GitHub Pages site over the Swedish 2026 riksdag election results, built to
answer two questions that val.se makes you click through hundreds of pages to answer:

1. **How is the preliminary count in the uppsamlingsdistrikt going?**
   Late-arriving early votes — postal and overseas ballots — are counted in 314
   *uppsamlingsdistrikt*, one per kommun or kommunvalkrets. The site aggregates them,
   shows which have reported, and shows how these votes differ from the rest of the country.

2. **What does the final count change, like for like?**
   The länsstyrelser recount every district over the following days. Comparing the
   running final total against the national preliminary total is misleading, because
   most districts have not been recounted yet. This site compares the final count
   **only against the preliminary count in those same districts**.

## Data source

Valmyndigheten publishes no documented results API, but `resultat.val.se` is a SPA
served by static JSON, which is stable and complete:

| URL | Contents |
| --- | --- |
| `https://resultat.val.se/data/valgeografi/valgeografi_val2026.json` | Geography tree: `VALTYP → RIKSDAGSVALKRETS → KOMMUN → [KOMMUNVALKRETS] → VALDISTRIKT` |
| `https://resultat.val.se/data/resultat/val2026/{PATH}_P.json` | Preliminär (election-night) count |
| `https://resultat.val.se/data/resultat/val2026/{PATH}_S.json` | Slutlig (final) count |

`{PATH}` is the chain of geography `kod` values joined with `_`, starting at the
valtyp — `RD_10_1082` is Karlshamn, `RD_10_1080_108003` is Karlskrona C.

Three things worth knowing before you build on this:

- **A node whose children are all `VALDISTRIKT` returns every child's full party
  breakdown in one response.** 314 such files cover all 6 626 riksdag districts, so a
  complete per-district snapshot costs 314 requests, not 6 626. A district whose
  `rosterPaverkaMandat.partiroster` is empty has not been counted yet.
- **`_S` returns 404 until that area has been finally counted.** The 404 is the signal,
  not an error — the fetcher uses it to skip whole valkretsar that have not started.
- **The preliminary count lumps small parties into one `ÖVR` bucket; the final count
  names them individually.** A naive party-by-party diff therefore shows a large fake
  collapse for `ÖVR`. Both counts here derive "Övriga" as *total minus the eight
  riksdag parties*, which is comparable.

### Why the page does not fetch val.se directly

`resultat.val.se` sends **no `Access-Control-Allow-Origin` header**, so a browser on
`github.io` cannot read it — and there is no way around that from page JavaScript.
It also **rate-limits aggressively**: roughly 130 requests in a burst returns HTTP 429
across the whole val.se domain, and the block persists for minutes.

So all fetching happens in one scheduled job, serially and paced, and the site reads
the mirrored result same-origin. Please keep it that way if you fork this.

## Layout

```
scripts/fetch_val.py           polite fetcher + aggregator
docs/                          GitHub Pages root
  index.html  app.js  styles.css
  data/
    meta.json                  party list, colours, national headline for both counts
    areas.json                 the 314 leaf areas and their valkrets
    prelim.json                per-district preliminary records
    final.json                 per-district final records
.github/workflows/update-data.yml
```

Vote records are compact: `{v: [votes per tracked party], t: total, o: övriga,
e: eligible voters, u: is an uppsamlingsdistrikt}`. Everything shown on the page is
derived in the browser from those records.

## Running it yourself

```sh
python3 scripts/fetch_val.py          # incremental; skips areas already complete
python3 scripts/fetch_val.py --full   # ignore cached state, refetch everything
VAL_DELAY=1.5 python3 scripts/fetch_val.py   # slow it down further
```

No dependencies beyond the Python standard library. A full run is about 650 requests
at roughly one per second, so budget ~12 minutes.

Then serve the site locally:

```sh
python3 -m http.server -d docs 8000   # http://localhost:8000
```

## The scheduled job

`.github/workflows/update-data.yml` runs every 30 minutes, commits `docs/data/` only
when something changed, and **switches itself off** once `COUNTING_UNTIL` passes — so
it does not keep polling val.se for weeks after the result is settled. Bump that date
in the workflow to extend the window, and re-enable with:

```sh
gh workflow enable update-data.yml
```

## Source and licence

Data © Valmyndigheten, free to use with attribution. Code here is MIT.
