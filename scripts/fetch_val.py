#!/usr/bin/env python3
"""Fetch Swedish riksdag election results from resultat.val.se and build the
compact JSON the GitHub Pages site reads.

val.se sends no CORS header and rate-limits hard (HTTP 429 after a burst), so
all fetching happens here - never from the visitor's browser. Requests are
serial, paced, conditional (ETag), and back off on 429.

Usage:
    python3 scripts/fetch_val.py              # incremental update
    python3 scripts/fetch_val.py --full       # ignore cached state, refetch all
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

VALTILLFALLE = "val2026"
BASE = f"https://resultat.val.se/data/resultat/{VALTILLFALLE}"
GEO_URL = f"https://resultat.val.se/data/valgeografi/valgeografi_{VALTILLFALLE}.json"
VALTYP = "RD"

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
CACHE = ROOT / ".cache"

USER_AGENT = (
    "election-stats/1.0 (+https://github.com/magnuslundstedt/election-stats) "
    "polite serial fetcher"
)
DELAY = float(os.environ.get("VAL_DELAY", "1.0"))       # seconds between requests
MAX_429 = int(os.environ.get("VAL_MAX_429", "5"))       # consecutive 429s before giving up
UPPSAMLING_RE = re.compile(r"^Uppsamlingsdistrikt\b", re.I)


class RateLimited(Exception):
    """val.se returned 429 too many times; stop the run and keep existing data."""


class Fetcher:
    def __init__(self, etags: dict):
        self.etags = etags
        self.consecutive_429 = 0
        self.stats = {"200": 0, "304": 0, "404": 0, "429": 0, "error": 0}

    def get(self, url: str, use_etag: bool = True):
        """Return (status, parsed_json_or_None). 304 and 404 both yield None."""
        for attempt in range(MAX_429):
            headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
            tag = self.etags.get(url) if use_etag else None
            if tag:
                headers["If-None-Match"] = tag
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    body = resp.read()
                    if resp.headers.get("ETag"):
                        self.etags[url] = resp.headers["ETag"]
                    self.consecutive_429 = 0
                    self.stats["200"] += 1
                    time.sleep(DELAY + random.uniform(0, 0.3))
                    return 200, json.loads(body)
            except urllib.error.HTTPError as e:
                if e.code == 304:
                    self.consecutive_429 = 0
                    self.stats["304"] += 1
                    time.sleep(DELAY + random.uniform(0, 0.3))
                    return 304, None
                if e.code == 404:
                    # Expected: an _S file does not exist until that area is
                    # finally counted. Not an error.
                    self.consecutive_429 = 0
                    self.stats["404"] += 1
                    time.sleep(DELAY + random.uniform(0, 0.3))
                    return 404, None
                if e.code == 429:
                    self.stats["429"] += 1
                    self.consecutive_429 += 1
                    if self.consecutive_429 >= MAX_429:
                        raise RateLimited(f"{MAX_429} consecutive 429s; backing off")
                    wait = float(e.headers.get("Retry-After") or 0) or min(
                        60 * (2 ** attempt), 300
                    )
                    print(f"  429 - sleeping {wait:.0f}s", flush=True)
                    time.sleep(wait)
                    continue
                self.stats["error"] += 1
                print(f"  HTTP {e.code} for {url}", file=sys.stderr)
                return e.code, None
            except Exception as e:  # network hiccup - one retry, then skip
                self.stats["error"] += 1
                print(f"  {type(e).__name__} for {url}", file=sys.stderr)
                time.sleep(2)
                return 0, None
        raise RateLimited("exhausted 429 retries")


def leaf_parents(geo: dict) -> list[dict]:
    """Nodes whose children are all VALDISTRIKT - one fetch yields every child's
    full party breakdown. 314 of these cover all 6626 riksdag districts."""
    rd = next(t for t in geo["valgeografi"] if t["kod"] == VALTYP)
    out = []

    def walk(node, path, valkrets):
        p = path + [node["kod"]]
        children = node.get("valgeografi") or []
        if not children:
            return
        if node["typ"] == "RIKSDAGSVALKRETS":
            valkrets = {"kod": node["kod"], "namn": node["namn"]}
        if all(c["typ"] == "VALDISTRIKT" for c in children):
            out.append(
                {
                    "path": "_".join(p),
                    "namn": node["namn"],
                    "typ": node["typ"],
                    "valkrets": valkrets,
                    "antal": len(children),
                }
            )
        else:
            for c in children:
                walk(c, p, valkrets)

    for c in rd["valgeografi"]:
        walk(c, [VALTYP], None)
    return out


def parse_leaf(doc: dict, leaf: dict, parties: list[str]) -> dict:
    """Extract one compact record per *counted* district in a leaf-parent file."""
    out = {}
    for child in doc.get("valkretsar") or []:
        block = child.get("rosterPaverkaMandat") or {}
        rows = block.get("partiroster") or []
        if not rows:
            continue  # district not counted yet
        by_party = {r["partiforkortning"]: r["antalRoster"] for r in rows if r.get("partiforkortning")}
        total = block.get("antalRoster") or 0
        votes = [by_party.get(p, 0) for p in parties]
        out[child["namn"]] = {
            "v": votes,
            "t": total,
            "o": total - sum(votes),          # Övriga, comparable across P and S
            "e": _num(child.get("antalRostberattigade")),
            "u": bool(UPPSAMLING_RE.match(child["namn"])),
        }
    return out


def _num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return int(s)
    s = str(s).replace("\xa0", "").replace(" ", "")
    return int(s) if s.isdigit() else None


def headline(doc: dict) -> dict:
    return {
        "raknade": doc.get("antalValdistriktRaknade"),
        "ska_raknas": doc.get("antalValdistriktSomSkaRaknas"),
        "roster": _num(doc.get("totaltAntalRoster")),
        "rostberattigade": _num(doc.get("antalRostberattigade")),
        "valdeltagande": doc.get("valdeltagande"),
        "uppdaterad": doc.get("senasteUppdateringstid"),
        "rapporterad": doc.get("senasteRapporteringstid"),
    }


def load(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    return default


def save(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="refetch everything")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    etags = {} if args.full else load(CACHE / "etags.json", {})
    prelim = {} if args.full else load(DATA / "prelim.json", {})
    final = {} if args.full else load(DATA / "final.json", {})
    fetcher = Fetcher(etags)

    try:
        run(fetcher, prelim, final, args.full)
    except RateLimited as e:
        print(f"\n!! rate limited: {e}\n   keeping existing data, will resume next run",
              file=sys.stderr)
    finally:
        save(CACHE / "etags.json", fetcher.etags)
        print(f"\nrequests: {fetcher.stats}")


def run(fetcher: Fetcher, prelim: dict, final: dict, full: bool):
    geo_path = CACHE / "geo.json"
    geo = load(geo_path, None)
    if geo is None:
        status, geo = fetcher.get(GEO_URL, use_etag=False)
        if geo is None:
            raise SystemExit("could not fetch valgeografi")
        save(geo_path, geo)
    leaves = leaf_parents(geo)
    print(f"{len(leaves)} leaf-parent areas covering "
          f"{sum(l['antal'] for l in leaves)} valdistrikt")

    # National headline for both counts, and the canonical party order.
    _, nat_p = fetcher.get(f"{BASE}/{VALTYP}_P.json", use_etag=False)
    _, nat_s = fetcher.get(f"{BASE}/{VALTYP}_S.json", use_etag=False)
    if nat_p is None:
        raise SystemExit("could not fetch national preliminary result")
    parties = [
        r["partiforkortning"]
        for r in nat_p["rosterPaverkaMandat"]["partiroster"]
        if r.get("partikod") and r.get("deltaMandatfordelning")
    ]
    print(f"parties tracked individually: {', '.join(parties)} (+ Övriga)")

    meta = {
        "valtillfalle": VALTILLFALLE,
        "valtyp": VALTYP,
        "valdatum": nat_p.get("valdatum"),
        "parties": parties,
        "partyColors": {
            r["partiforkortning"]: r.get("fargkod")
            for r in nat_p["rosterPaverkaMandat"]["partiroster"]
            if r.get("partiforkortning")
        },
        "preliminar": headline(nat_p),
        "slutlig": headline(nat_s) if nat_s else None,
        "hamtad": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # --- preliminary: only chase leaves we don't yet have complete ---
    todo_p = [l for l in leaves
              if full or len(prelim.get(l["path"], {})) < l["antal"]]
    print(f"\npreliminary: {len(todo_p)} of {len(leaves)} areas incomplete")
    for i, leaf in enumerate(todo_p, 1):
        status, doc = fetcher.get(f"{BASE}/{leaf['path']}_P.json")
        if doc is not None:
            prelim[leaf["path"]] = parse_leaf(doc, leaf, parties)
        if i % 25 == 0:
            print(f"  ...{i}/{len(todo_p)}", flush=True)
    save(DATA / "prelim.json", prelim)

    # --- final: skip whole valkretsar that have not started counting ---
    valkretsar = sorted({l["valkrets"]["kod"]: l["valkrets"] for l in leaves if l["valkrets"]}.values(),
                        key=lambda v: v["kod"])
    active = set()
    print(f"\nfinal: probing {len(valkretsar)} riksdagsvalkretsar")
    for vk in valkretsar:
        status, doc = fetcher.get(f"{BASE}/{VALTYP}_{vk['kod']}_S.json", use_etag=False)
        if status == 200 and doc is not None:
            active.add(vk["kod"])
    print(f"  {len(active)} valkretsar have final results")

    todo_s = [l for l in leaves
              if l["valkrets"] and l["valkrets"]["kod"] in active
              and (full or len(final.get(l["path"], {})) < l["antal"])]
    print(f"final: {len(todo_s)} areas to check")
    for i, leaf in enumerate(todo_s, 1):
        status, doc = fetcher.get(f"{BASE}/{leaf['path']}_S.json")
        if doc is not None:
            final[leaf["path"]] = parse_leaf(doc, leaf, parties)
        if i % 25 == 0:
            print(f"  ...{i}/{len(todo_s)}", flush=True)
    save(DATA / "final.json", final)

    # --- area index the frontend needs to label things ---
    save(DATA / "areas.json", {
        l["path"]: {"n": l["namn"], "vk": l["valkrets"]["kod"] if l["valkrets"] else None,
                    "vkn": l["valkrets"]["namn"] if l["valkrets"] else None,
                    "a": l["antal"]}
        for l in leaves
    })
    meta["counts"] = {
        "prelim_districts": sum(len(v) for v in prelim.values()),
        "final_districts": sum(len(v) for v in final.values()),
        "uppsamling_total": sum(
            1 for v in prelim.values() for d in v.values() if d["u"]
        ),
    }
    save(DATA / "meta.json", meta)
    print(f"\nprelim districts: {meta['counts']['prelim_districts']}, "
          f"final districts: {meta['counts']['final_districts']}")


if __name__ == "__main__":
    main()
