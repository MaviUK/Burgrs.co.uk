-- The existing cron worker checks preferences without bypassing table access.
grant execute on function burgrs_private.notification_type_enabled(uuid,text) to service_role;
