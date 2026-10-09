# Burgrs TV public baseline — 9 October 2026

Run started: 2026-10-09T10:44:07.947326+00:00 (UTC). Target: https://burgrs.co.uk.

**54/54 requests succeeded; 0 failures.** Elapsed: 98.05 seconds. All responses were checked for expected content as well as HTTP 200.

## Traffic and scope

Three successive stages of 1, 3 and 5 virtual visitors; each makes six GET requests. Traffic was capped at one request per second overall. No login, watch history, rating or notification actions were performed. Normal cache behaviour was retained; misses were not forced.

| Visitors | Requests | Failures | Median | p95 | Cache hits |
|---:|---:|---:|---:|---:|---:|
| 1 | 6 | 0 | 5.56 s | 7.58 s | 0 |
| 3 | 18 | 0 | 3.90 s | 5.32 s | 16 |
| 5 | 30 | 0 | 3.13 s | 7.81 s | 27 |

## Endpoint results

| Endpoint | Requests | Failures | Median | p95 | Cache hits |
|---|---:|---:|---:|---:|---:|
| homepage | 9 | 0 | 3.71 s | 6.66 s | 3 |
| trending | 9 | 0 | 3.65 s | 5.96 s | 8 |
| show_details | 9 | 0 | 3.54 s | 5.48 s | 8 |
| providers_gb | 9 | 0 | 3.45 s | 5.10 s | 8 |
| providers_us | 9 | 0 | 2.98 s | 4.45 s | 8 |
| title_search | 9 | 0 | 5.42 s | 9.04 s | 8 |

## Interpretation

The six public routes returned valid responses throughout this small run. 43 requests had a confirmed CDN cache hit. These observations establish a repeatable starting benchmark, not a maximum throughput or 100,000-daily-user capacity.

The overall client-observed median was 3.73 seconds and p95 was 7.45 seconds. Homepage requests also experienced multi-second delays. The runner includes network/proxy, TLS, CDN, function and provider time; these values cannot be attributed solely to database or application execution. Cache hits continued to have client-visible network delay. With only nine samples per endpoint, the endpoint p95 estimates are noisy.

The five-visitor stage had no failed requests, but this test deliberately caps request rate. It is not a stress or saturation test. API response checks do not measure browser rendering or Android responsiveness.

## Next capacity checks

Use an isolated test database with realistic synthetic user histories to test authenticated My Shows/Rank’d reads, watch/rating writes and notification queues. Then model peak request arrival rates, fresh lookups, bursts and sustained activity with database telemetry. A preview connected to the live Supabase project does not provide that isolation.

## Reproduce

```sh
python3 scripts/load-test-public.py
```

The reusable runner and guide are in `scripts/`. Full per-request measurements are in `public-baseline-2026-10-09.json`.
