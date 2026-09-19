# election-stats

A small GitHub Pages site over the Swedish 2026 riksdag election results, built to
answer two questions that val.se makes you click through hundreds of pages to answer:

> **Status: complete and archived (19 September 2026).**
> Both counts finished — all 6 626 valdistrikt are finally counted — so the automatic
> updates have been switched off and the site now stands as a fixed record of the
> result. See [Final result](#final-result) below.

1. **How is the preliminary count in the uppsamlingsdistrikt going?**
   Late-arriving early votes — postal and overseas ballots — are counted in 314
   *uppsamlingsdistrikt*, one per kommun or kommunvalkrets. The site aggregates them,
   shows which have reported, and shows how these votes differ from the rest of the country.

2. **What does the final count change, like for like?**
   The länsstyrelser recount every district over the following days. Comparing the
   running final total against the national preliminary total is misleading, because
   most districts have not been recounted yet. This site compares the final count
   **only against the preliminary count in those same districts**.

## Final result

The election was held on 13 September 2026. The preliminary count completed on
17 September; the final count by the länsstyrelser completed on 19 September.

**Uppsamlingsdistrikten** — all 314 reported. Late-arriving postal and overseas votes
leaned noticeably more to SD than the rest of the country, and away from S:

| parti | andel här | andel i övriga landet | diff |
| --- | ---: | ---: | ---: |
| SD | 22.38 % | 17.53 % | **+4.85** |
| S | 26.56 % | 28.06 % | −1.50 |
| MP | 4.95 % | 6.11 % | −1.15 |
| L | 4.22 % | 5.37 % | −1.15 |
| C | 6.05 % | 7.06 % | −1.02 |
| M | 18.85 % | 19.85 % | −1.00 |

**Preliminär → slutlig**, compared like for like across all 6 626 valdistrikt:

| parti | preliminär | slutlig | diff | p.e. |
| --- | ---: | ---: | ---: | ---: |
| S | 1 886 613 | 1 896 076 | +9 463 | +0.006 |
| M | 1 336 632 | 1 343 513 | +6 881 | +0.007 |
| SD | 1 176 807 | 1 183 305 | +6 498 | +0.012 |
| V | 565 710 | 568 821 | +3 111 | +0.006 |
| C | 474 468 | 475 795 | +1 327 | −0.014 |
| KD | 415 826 | 417 508 | +1 682 | −0.005 |
| MP | 413 018 | 414 342 | +1 324 | −0.010 |
| L | 359 798 | 361 214 | +1 416 | −0.005 |
| Övriga | 106 556 | 107 204 | +648 | +0.002 |
| **Totalt** | **6 735 428** | **6 767 778** | **+32 350** | **+0.480 %** |

The final count added 32 350 votes (+0.480 %) and moved no party by more than
0.014 percentage points. Every party gained votes; the vote shares barely changed.

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

## The scheduled job (now disabled)

`.github/workflows/update-data.yml` polled every 30 minutes while counting was under
way, committing `docs/data/` only when something changed. It is **disabled** now that
the count is complete. To run it again — for a future election, after changing
`VALTILLFALLE` in the fetcher and `COUNTING_UNTIL` in the workflow:

```sh
gh workflow enable update-data.yml
```

Two things worth knowing if you reuse this:

- **GitHub's `schedule:` trigger is unreliable.** It stayed silent for about three
  hours after first being added, then fired roughly 11 times in 41 hours against a
  `*/30 * * * *` expression — gaps of 2 to 5.5 hours. An external trigger calling
  `gh workflow run` did the real work. Treat the cron as a fallback, not a guarantee.
- **Two triggers can race.** One run checked out the repo, another pushed while the
  first was still fetching, and the first push was rejected. `concurrency` did not
  serialise them. The commit step now rebases onto `origin/main` and retries.

## Source and licence

Data © Valmyndigheten, free to use with attribution. Code here is MIT.
