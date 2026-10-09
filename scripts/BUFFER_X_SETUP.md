# Burgrs TV to Buffer/X

The deployed `publish-buffer-x` function waits for a `BUFFER_API_KEY` Edge Function secret.
Create a personal API key under Buffer Settings → API, then store it under Supabase
Edge Functions → Secrets as `BUFFER_API_KEY`. Do not put the key in GitHub, browser
code, VITE variables, or a chat message.

On its next scheduled run, the function finds the sole connected X channel and starts
sharing new public creator posts from the Burgrs TV system profile. Existing posts
are not backfilled. With multiple X channels, set `BUFFER_X_CHANNEL_ID` explicitly.
Posts use Buffer's automatic queue and posting schedule. Configure that schedule in
Buffer; its pause control is respected. Text is shortened to fit X and includes a
Burgrs show/profile link and source attribution for news. This first version shares
text and links; it does not upload images or videos.

Apply `supabase/buffer_x_publishing.sql` before deploying the function. Schedule it
every 5 minutes using pg_cron/net.http_post and the existing Vault
`tv_news_cron_secret` in the `x-burgrs-cron-secret` header. No Buffer API request is
made when no key exists or no posts need submission. The worker reserves at most
75 API requests per rolling day and 2,500 per rolling 30 days, leaving Free-plan
headroom. Queue-full/rate-limit errors delay submissions by 30 minutes.

`buffer_x_outbox.status='accepted'` means Buffer accepted the post; it does not
prove publication to X. Check Buffer's Sent/Failed view for final delivery. A
timeout or interrupted worker sets `review`, preventing automatic duplicate
submissions. Compare these records with Buffer before manually retrying. Deleting
or making a post private before submission skips it; changes after Buffer accepts
it need to be applied in Buffer as well.

Operational queries (SQL Editor or service_role only):

```sql
select enabled,initialized_at,channel_name,channel_url,last_error from public.buffer_x_settings;
select status,count(*) from public.buffer_x_outbox group by status;
select * from public.buffer_x_outbox where status='review';
-- Pause/resume: update public.buffer_x_settings set enabled=false/true where id;
```

Validate the connection read-only first, then check the first new real post in
Buffer and X. Do not create public dummy news for testing.
