-- Personal chatboard pins: each account can pin or unpin top-level discussions.
-- The referenced account/message foreign keys clean up pins automatically on deletion.
create table if not exists public.chat_thread_pins (
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.show_chat_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists chat_thread_pins_message_id_idx
  on public.chat_thread_pins (message_id);

alter table public.chat_thread_pins enable row level security;

create policy "Read own chat thread pins"
  on public.chat_thread_pins for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Pin top-level chat threads for self"
  on public.chat_thread_pins for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.show_chat_messages message
      where message.id = message_id and message.parent_id is null
    )
  );

create policy "Unpin own chat threads"
  on public.chat_thread_pins for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.chat_thread_pins from anon;
grant select, insert, delete on public.chat_thread_pins to authenticated;
