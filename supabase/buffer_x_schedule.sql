-- Use the existing deployment URL and Vault cron authentication; never copy secrets.
do $$
declare base_url text;
begin
  select substring(command from 'https://[a-z]+\.supabase\.co') into base_url
    from cron.job where jobname='tv-news-deadline';
  if base_url is null then raise exception 'Cannot resolve project URL from the TV news cron job'; end if;
  perform cron.schedule('publish-buffer-x','*/5 * * * *',format($command$
    select net.http_post(
      url := %L || '/functions/v1/publish-buffer-x',
      headers := jsonb_build_object('Content-Type','application/json',
        'x-burgrs-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='tv_news_cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    ) where exists(select 1 from public.buffer_x_settings where id and (initialized_at is null or enabled));
  $command$,base_url));
end $$;
