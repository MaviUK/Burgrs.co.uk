-- Enable once the worker has been deployed and database tests have passed.
-- Missing AI credentials are reported as a blocked readiness check; no content
-- is generated. Processing resumes automatically after the secret is added.
update public.tv_season_review_settings set enabled=true where id;
select cron.schedule('publish-season-reviews','*/5 * * * *',$job$
  select net.http_post(
    url:='https://nboalhdybuzfxsrbrcwb.supabase.co/functions/v1/publish-season-reviews',
    headers:=jsonb_build_object('Content-Type','application/json',
      'x-burgrs-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='tv_news_cron_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  ) where exists(select 1 from public.tv_season_review_settings where id and enabled);
$job$);
