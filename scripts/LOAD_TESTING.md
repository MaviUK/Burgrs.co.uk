# Burgrs TV load testing

## Public baseline

Run with Python 3.10 or newer; no packages, accounts or API keys are needed:

```sh
python3 scripts/load-test-public.py
```

The default run makes 54 GET requests: six routes per visitor in stages of
1, 3 and 5 simultaneous visitors. A shared rate limiter permits at most one
request per second overall. It checks the homepage, trending, Breaking Bad
details, separate GB/US streaming availability, and a sorted title search.
Responses must have the expected content as well as HTTP 200.

The script retains normal CDN cache behaviour. It does not send cache-busting
queries. Trending cache misses may invoke the existing discovery-show sync,
as normal app requests do. It never logs in, writes watch histories or ratings,
creates test accounts, or triggers notifications.

Results are written to `load-test-results/public-baseline.json`. Each endpoint
and stage reports successful requests, failures, response sizes, median and
95th-percentile client-observed response time, and confirmed cache hits.
Per-request results retain no response bodies or credentials.

The runner stops after two consecutive failed responses, an error rate above
20% after ten responses, or its request/time budget. Five concurrent visitors,
one request/second, and 100 total requests are hard limits. Stop with Ctrl+C
if the live app is affected. In-flight requests can finish after a stop.
This is a baseline, not a production stress test or a 100k-user certification.

For a quicker single-visitor check:

```sh
python3 scripts/load-test-public.py --users 1 --output load-test-results/single-visitor.json
```

Use `--base-url` for another owned test deployment. A Netlify preview using the
production Supabase URL still uses the production database.

## Reading the results

Response times include the runner's network and any execution-environment proxy,
TLS, CDN, function and upstream-provider delay. Compare the homepage timing with
API timing before attributing slow results to the app. A high success rate at
this small load proves only that these public routes worked in this run.
With few samples, p95 is an estimate. Cache hits validate response reuse but
do not exercise authenticated database queries or prove fresh-lookup capacity.

## Full capacity testing later

Use a separate database with synthetic users and realistic show/watch histories,
matching production compute before drawing capacity conclusions. Disable external
push/email delivery. Test login/session refresh, My Shows, Rank'd, episode writes,
ratings and notification queues, including concurrent updates and duplicate events.

Use an arrival-rate workload derived from daily sessions and backend requests,
then test normal traffic, expected peaks, spikes and sustained traffic. Add
genuine varied show/search inputs to measure misses as well as hits. Record
database CPU, memory, connections, query latency, locks and queue backlog.
Apply response-time/error targets and stop limits before starting larger tests.
100,000 daily users is a traffic model, not 100,000 simultaneous visitors.
