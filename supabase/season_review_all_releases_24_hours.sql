-- Both release modes become eligible 24 hours after the complete season releases.
alter table public.tv_season_review_settings
  drop constraint tv_season_review_settings_binge_delay_hours_check;
alter table public.tv_season_review_settings alter column binge_delay_hours set default 24;
update public.tv_season_review_settings set binge_delay_hours=24 where id;
alter table public.tv_season_review_settings
  add constraint tv_season_review_settings_binge_delay_hours_check check (binge_delay_hours=24);
-- Bring waiting full-season jobs forward while retaining research retry schedules.
update public.tv_season_reviews
set eligible_at=finale_at+interval '24 hours',updated_at=now()
where release_mode='binge' and status in ('queued','held')
  and eligible_at is distinct from finale_at+interval '24 hours';
