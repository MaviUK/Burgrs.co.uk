-- Rank'd guest vote abuse protection
-- Browser clients no longer call a privileged guest-vote RPC directly.
-- Guest voting is routed through the rankd-guest-vote Edge Function, which
-- supplies a daily network hash to this server-only RPC.

alter table public.rankd_guest_matchup_votes
  add column if not exists network_hash text;

create index if not exists rankd_guest_votes_network_created_idx
  on public.rankd_guest_matchup_votes (network_hash, created_at desc)
  where network_hash is not null;

create index if not exists rankd_guest_votes_matchup_network_created_idx
  on public.rankd_guest_matchup_votes (matchup_id, network_hash, created_at desc)
  where network_hash is not null;

-- Live implementation limits:
--   5 guest votes per network per matchup per 24 hours
--   30 guest votes per network across all matchups per hour
-- The private implementation also validates matchup membership and prevents
-- duplicate browser tokens.
--
-- Public wrapper:
--   public.rankd_record_guest_matchup_vote_server(text, uuid, uuid, uuid, text)
-- is executable only by service_role.
--
-- The old direct guest RPC is revoked from anon/authenticated/service_role.
