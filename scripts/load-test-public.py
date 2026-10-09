#!/usr/bin/env python3
"""Small, capped HTTP baseline for Burgrs TV. Python 3.10+, no dependencies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CASES = [
    ("homepage", "/", "html"),
    ("trending", "/.netlify/functions/getTrendingShows", "shows"),
    ("show_details", "/.netlify/functions/getTmdbShowDetails?tmdbId=1396", "show"),
    ("providers_gb", "/.netlify/functions/getTmdbWatchProviders?tmdbId=1396&country=GB", "providers"),
    ("providers_us", "/.netlify/functions/getTmdbWatchProviders?tmdbId=1396&country=US", "providers"),
    ("title_search", "/.netlify/functions/advancedSearchShows?title=Breaking%20Bad&sort=highest-rated&region=GB&page=1", "search"),
]


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 2)


def validate(kind, body):
    if kind == "html":
        return b"<html" in body.lower() and b'id="root"' in body
    data = json.loads(body)
    if kind == "shows":
        return isinstance(data, dict) and isinstance(data.get("shows"), list) and len(data["shows"]) > 0
    if kind == "show":
        return isinstance(data, dict) and data.get("tmdb_id") == 1396 and bool(data.get("name"))
    if kind == "providers":
        return isinstance(data, dict) and any(isinstance(data.get(key), list) and data[key] for key in ("flatrate", "free", "ads", "rent", "buy"))
    if kind == "search":
        return isinstance(data, dict) and isinstance(data.get("results"), list) and any(item.get("tmdb_id") == 1396 for item in data["results"])
    return False


def configuration(args):
    parsed = urllib.parse.urlsplit(args.base_url)
    local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Use a site URL without credentials, a query or a fragment")
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise ValueError("HTTPS is required except for a local fixture server")
    users = [int(value) for value in args.users.split(",")]
    if not users or any(value < 1 or value > 5 for value in users):
        raise ValueError("This public baseline is capped at 5 concurrent visitors")
    if users != sorted(set(users)):
        raise ValueError("Visitor stages must be unique and increasing")
    if not 0.1 <= args.rps <= 1:
        raise ValueError("The total request rate must be between 0.1 and 1 per second")
    requests = sum(users) * len(CASES) * args.loops
    if args.loops < 1 or requests > 100:
        raise ValueError("The complete run is capped at 100 requests")
    if not 1 <= args.timeout <= 20 or not 10 <= args.max_seconds <= 300:
        raise ValueError("Timeout must be 1–20 seconds; total budget 10–300 seconds")
    return users, requests


def summarize(rows):
    successful = [row for row in rows if row["ok"]]
    durations = [row["duration_ms"] for row in successful]
    hits = [row for row in successful if "; hit" in row["cache_status"]]
    return {
        "requests": len(rows), "successful": len(successful),
        "failed": len(rows) - len(successful),
        "failure_percent": round(100 * (len(rows) - len(successful)) / len(rows), 2) if rows else None,
        "median_ms": percentile(durations, 0.5), "p95_ms": percentile(durations, 0.95),
        "max_ms": round(max(durations), 2) if durations else None,
        "cache_hits": len(hits), "response_bytes": sum(row["bytes"] for row in rows),
    }


def run(args):
    users, planned = configuration(args)
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    lock = threading.Lock()
    stopped = threading.Event()
    rows, stages = [], []
    next_request = started
    consecutive_errors = 0
    reason = None

    def reserve_request():
        nonlocal next_request, reason
        with lock:
            now = time.monotonic()
            scheduled = max(now, next_request)
            if stopped.is_set():
                return False
            if scheduled - started >= args.max_seconds:
                reason = "time_budget"
                stopped.set()
                return False
            next_request = scheduled + 1 / args.rps
        return not stopped.wait(max(0, scheduled - time.monotonic()))

    def visit(stage, visitor):
        nonlocal consecutive_errors, reason
        for loop in range(args.loops):
            for name, path, kind in CASES:
                if not reserve_request():
                    return
                began = time.monotonic()
                request = urllib.request.Request(args.base_url.rstrip("/") + path, headers={
                    "User-Agent": "BurgrsTV-PublicBaseline/1.0", "Accept": "text/html" if kind == "html" else "application/json",
                }, method="GET")
                row = {"stage_users": stage, "visitor": visitor, "loop": loop + 1, "endpoint": name,
                       "status": 0, "ok": False, "bytes": 0, "cache_status": "", "error": None}
                try:
                    try:
                        response = urllib.request.urlopen(request, timeout=args.timeout)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        body = response.read(2 * 1024 * 1024 + 1)
                        row.update(status=response.status, bytes=len(body),
                                   cache_status=", ".join(response.headers.get_all("Cache-Status") or []),
                                   request_id=response.headers.get("x-nf-request-id"))
                        row["ok"] = response.status == 200 and len(body) <= 2 * 1024 * 1024 and validate(kind, body)
                        if not row["ok"]:
                            row["error"] = "unexpected_status_or_content"
                except Exception as error:
                    # Never retain bodies, cookies or authorization headers in reports.
                    row["error"] = type(error).__name__
                row["duration_ms"] = round((time.monotonic() - began) * 1000, 2)
                with lock:
                    rows.append(row)
                    consecutive_errors = 0 if row["ok"] else consecutive_errors + 1
                    failures = sum(not item["ok"] for item in rows)
                    if consecutive_errors >= 2 or (len(rows) >= 10 and failures / len(rows) > 0.2):
                        reason = "error_threshold"
                        stopped.set()

    print(f"Public baseline: {planned} GET requests, at most {args.rps:g}/second overall, stages {users}", flush=True)
    for stage in users:
        if stopped.is_set():
            break
        stage_started = time.monotonic()
        print(f"Starting {stage}-visitor stage", flush=True)
        with ThreadPoolExecutor(max_workers=stage) as executor:
            futures = [executor.submit(visit, stage, index + 1) for index in range(stage)]
            for future in futures:
                future.result()
        stage_rows = [row for row in rows if row["stage_users"] == stage]
        summary = summarize(stage_rows)
        stages.append({"users": stage, "elapsed_seconds": round(time.monotonic() - stage_started, 2), **summary})
        print(json.dumps(stages[-1]), flush=True)
    report = {
        "started_at_utc": started_at, "base_url": args.base_url, "planned_requests": planned,
        "users": users, "max_requests_per_second": args.rps,
        "elapsed_seconds": round(time.monotonic() - started, 2), "stop_reason": reason,
        "summary": summarize(rows), "stages": stages,
        "endpoints": {name: summarize([row for row in rows if row["endpoint"] == name]) for name, _, _ in CASES},
        "requests": rows,
        "scope": "Public HTTP/API baseline only; no login, browser rendering, watch writes, ratings, push delivery or database saturation test.",
        "timing_note": "Client-observed timings include network/proxy overhead and provider lookups; they are not database or server execution times.",
        "capacity_note": "This small run does not establish capacity for 100,000 daily users. Existing cache state is retained; no forced cache misses.",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Saved {output}: {json.dumps(report['summary'])}", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://burgrs.co.uk")
    parser.add_argument("--users", default="1,3,5")
    parser.add_argument("--loops", type=int, default=1)
    parser.add_argument("--rps", type=float, default=1)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--max-seconds", type=float, default=180)
    parser.add_argument("--output", default="load-test-results/public-baseline.json")
    args = parser.parse_args()
    try:
        report = run(args)
    except ValueError as error:
        parser.error(str(error))
    return 0 if report["stop_reason"] is None and report["summary"]["failed"] == 0 and report["summary"]["requests"] == report["planned_requests"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
