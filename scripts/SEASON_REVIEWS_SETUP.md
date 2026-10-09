# Burgrs TV automated season reviews

Apply `supabase/season_review_automation.sql`, then
`supabase/season_reviews_show_tab.sql` once, and deploy
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
Research returns `preview_run_id`. Continue with the same season using
`{"mode":"preview","stage":"draft","season_id":"...","preview_run_id":"..."}`,
then `stage="verify"` with the returned draft run ID. Verification returns the
checked, rendered review and an audit ID; preview stages never publish posts.
Every stage requires the cron secret and checks the prior audit status and season.
Source research verifies release completion in the show's original broadcast
market so a US weekly rollout does not invalidate a confirmed UK binge release.
Manual test publication is a separately authorised action after verification.

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

The writing is original, witty, sarcastic and blunt British English with one strong
argument, a clear verdict and a short question that invites disagreement. Aim for
110–130 words (hard limit 90–140), exactly two short paragraphs and a headline
under 70 characters. Criticism follows the evidence; praise is equally pointed.
Do not publish press-release filler, invented viewing, scores or test labels.
Use at most three source URLs in one compact footer with publisher-name links.
Keep the AI-generated disclosure at the end, below the review and question. It does not fabricate personal
viewing or numerical scores. The public post includes an AI-generated label,
clickable publisher-name sources, show link, artwork and the standard comment/share
controls. `is_auto_season_review=true`, `is_auto_news=false` keeps reviews out of
news alerts. A database trigger also creates a linked, interactive `show_reviews`
row, so each season review appears in the show's Reviews tab. Updates stay in
sync and deletions follow the existing review-thread deletion behaviour. Existing
published season reviews are backfilled. Only server roles can attach post links;
ordinary members retain one main review per show. Profile and following feeds
omit linked review rows because the original creator post already appears there.
Landscape show artwork is preferred, with the show's poster as fallback. The
show's Reviews tab also displays the linked artwork and hides numerical ratings
on generated editorial reviews. Ordinary member ratings remain unchanged.
The existing Buffer queue forwards public posts and artwork; its
worker marks these as AI-assisted. Six reviews per rolling 24 hours maximum.

Publication and the queue's published state commit in one transaction. A unique
show/season key and leases prevent duplicate publication. Deleting a post does not
automatically regenerate it. Disable the settings flag to pause the pipeline.

Validation: `node --test scripts/test-season-reviews.mjs`. Live transaction tests
should roll back their changes, including Buffer outbox inserts, so test posts
never reach the live feed or X.
