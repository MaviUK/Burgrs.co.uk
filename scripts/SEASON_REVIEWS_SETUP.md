# Burgrs TV automated season reviews

Apply `supabase/season_review_automation.sql` once, deploy
`supabase/functions/publish-season-reviews/index.ts` with JWT verification disabled
because it authenticates every request with the existing server-only Vault cron
secret (`x-burgrs-cron-secret` via `validate_tv_news_cron_secret`). The settings,
queue, audit records and RPCs are service-role-only, with RLS enabled.

The function uses the existing `OPENAI_API_KEY` secret. It fails closed when absent;
news rewriting's generic fallback is deliberately not used for reviews.
`SEASON_REVIEW_MODEL` overrides `OPENAI_MODEL`, otherwise `gpt-5-mini` is used.
Live web research, writing and independent checking each use a separate worker
invocation, so the system stays within hosted execution limits. Every call is
bounded to 7,000 output tokens and research to four web tool calls.

Set `tv_season_review_settings.enabled=true` after tests succeed. With a missing
key, scheduled readiness checks run without generating or publishing; adding
the secret allows processing to begin on the next scheduled invocation.
Run the worker every five minutes with pg_cron/net.http_post, using the existing
Vault `tv_news_cron_secret` and a 120-second HTTP timeout. Normal body is `{}`.
An authenticated `{"mode":"status"}` request reports readiness without generation.
`{"mode":"preview","season_id":"..."}` researches an existing season without
creating a post; inspect `tv_season_review_runs` for its evidence gate outcome.

Only seasons ending on/after activation day and tracked by the Burgrs TV profile
are considered. No old-season backlog is published. Regular seasons wait 24
hours after the finale; all-at-once seasons wait 168 hours. Date-only or midnight
placeholder times use the end of the original country's broadcast day (US Eastern,
UK London, otherwise UTC), preventing premature publication. Worker polling and
the research/draft/verification stages add processing time beyond the delay.

A database finale flag alone cannot publish: all listed episodes must have dates,
none can remain unaired, the final number must match, and live retrieved sources
must confirm the exact full-season count, finale date and release pattern. Split
seasons and midseason breaks fail the completion gate. Four supported details
across two independent publishers, including three spoiler-free details, are
required. Unsupported, incomplete or spoiler-bearing drafts are held for daily
research retries (at most eight); transient errors retry at most three times per
stage. Monitor failed/held jobs and the settings `last_error`.

The writing is original, blunt, witty British English with one strong argument,
a clear verdict and specific closing question. It does not fabricate personal
viewing or numerical scores. The public post includes an AI-generated label,
clickable numbered sources, show link, artwork and the standard comment/share
controls. `is_auto_season_review=true`, `is_auto_news=false` keeps reviews out of
news alerts. The existing Buffer queue forwards public posts and artwork; its
worker marks these as AI-assisted. Six reviews per rolling 24 hours maximum.

Publication and the queue's published state commit in one transaction. A unique
show/season key and leases prevent duplicate publication. Deleting a post does not
automatically regenerate it. Disable the settings flag to pause the pipeline.

Validation: `node --test scripts/test-season-reviews.mjs`. Live transaction tests
should roll back their changes, including Buffer outbox inserts, so test posts
never reach the live feed or X.
