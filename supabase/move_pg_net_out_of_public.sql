-- Move pg_net extension registration out of public schema.
-- Applied live on 2026-09-26 after confirming the request queue was empty.
-- pg_net is non-relocatable, so the supported approach is drop + recreate.

begin;
drop extension pg_net;
create extension pg_net with schema extensions;
commit;

-- The extension continues to expose its HTTP API in the net schema,
-- e.g. net.http_post(), and the notification trigger continues to use it.
