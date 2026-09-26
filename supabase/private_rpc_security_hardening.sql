-- Move privileged BURGRS RPC implementations out of the exposed public schema.
-- Public RPC names remain as SECURITY INVOKER wrappers so frontend calls do not change.

create schema if not exists burgrs_private;
revoke all on schema burgrs_private from public;

-- The private implementations are cloned from the corresponding public RPCs,
-- retain their auth/validation checks, and run with a fixed search_path.
-- Public wrappers call these private functions and remain SECURITY INVOKER.

-- Current private SECURITY DEFINER implementations:
--   delete_owned_thread_item(text, uuid)
--   ensure_burgers_tv_defaults()
--   rankd_get_or_create_matchup(uuid, uuid)
--   rankd_record_matchup_vote(uuid, uuid, uuid, uuid)
--   register_push_device(text, text)
--   set_rankd_matchup_share(uuid, uuid, text)
--   rankd_record_guest_matchup_vote(text, uuid, uuid, uuid)
--
-- All use:
--   set search_path = pg_catalog, public
--
-- Public execute ACL:
--   authenticated:
--     delete_owned_thread_item
--     ensure_burgers_tv_defaults
--     rankd_get_or_create_matchup
--     rankd_record_matchup_vote
--     register_push_device
--     set_rankd_matchup_share
--   anon:
--     rankd_record_guest_matchup_vote
--
-- Direct PUBLIC execute is revoked.
