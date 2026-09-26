-- Rank'd secured RPC privilege fix
-- Applied after production smoke testing on 2026-09-26.
-- Direct client writes to rankd_matchups remain revoked; only validated RPCs
-- run with definer rights.

alter function public.rankd_get_or_create_matchup(uuid, uuid) security definer;
alter function public.rankd_record_matchup_vote(uuid, uuid, uuid, uuid) security definer;

revoke execute on function public.rankd_get_or_create_matchup(uuid, uuid)
from public, anon;
grant execute on function public.rankd_get_or_create_matchup(uuid, uuid)
to authenticated;

revoke execute on function public.rankd_record_matchup_vote(uuid, uuid, uuid, uuid)
from public, anon;
grant execute on function public.rankd_record_matchup_vote(uuid, uuid, uuid, uuid)
to authenticated;
