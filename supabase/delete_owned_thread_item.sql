-- Secure deletion for a user's own post/reply, plus moderation of replies made to their content.
-- Content authors can remove replies from their review/chat thread, post comments, and list comments.

create or replace function public.delete_owned_thread_item(
  p_table_name text,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  item_owner_id uuid;
  item_parent_id uuid;
  ancestor_id uuid;
  ancestor_parent_id uuid;
  ancestor_owner_id uuid;
  post_id_value uuid;
  list_key_value text;
  content_owner_id uuid;
  auto_owner_text text;
  allowed boolean := false;
  vote_table_name text;
  vote_item_column text;
begin
  if caller_id is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  if p_table_name in ('show_reviews', 'episode_reviews', 'show_chat_messages') then
    execute format(
      'select user_id, parent_id from public.%I where id = $1',
      p_table_name
    )
    into item_owner_id, item_parent_id
    using p_item_id;

    if item_owner_id is null then
      raise exception 'This post no longer exists.' using errcode = 'P0002';
    end if;

    if item_owner_id = caller_id then
      allowed := true;
    elsif item_parent_id is not null then
      ancestor_id := item_parent_id;
      while ancestor_id is not null loop
        execute format(
          'select user_id, parent_id from public.%I where id = $1',
          p_table_name
        )
        into ancestor_owner_id, ancestor_parent_id
        using ancestor_id;

        exit when ancestor_owner_id is null;
        if ancestor_owner_id = caller_id then
          allowed := true;
          exit;
        end if;
        ancestor_id := ancestor_parent_id;
      end loop;
    end if;

    if not allowed then
      raise exception 'You can only delete your own post or a reply to your post.' using errcode = '42501';
    end if;

    -- Preserve deeper replies by attaching them to the deleted item's parent.
    execute format(
      'update public.%I set parent_id = $2 where parent_id = $1',
      p_table_name
    )
    using p_item_id, item_parent_id;

    if p_table_name = 'show_reviews' then
      vote_table_name := 'show_review_votes';
      vote_item_column := 'review_id';
    elsif p_table_name = 'episode_reviews' then
      vote_table_name := 'episode_review_votes';
      vote_item_column := 'review_id';
    else
      vote_table_name := 'show_chat_message_votes';
      vote_item_column := 'message_id';
    end if;

    execute format(
      'delete from public.%I where %I = $1',
      vote_table_name,
      vote_item_column
    )
    using p_item_id;

    execute format('delete from public.%I where id = $1', p_table_name)
    using p_item_id;

  elsif p_table_name = 'post_comments' then
    select user_id, post_id
      into item_owner_id, post_id_value
    from public.post_comments
    where id = p_item_id;

    if item_owner_id is null then
      raise exception 'This comment no longer exists.' using errcode = 'P0002';
    end if;

    select user_id
      into content_owner_id
    from public.creator_posts
    where id = post_id_value;

    if item_owner_id <> caller_id and content_owner_id is distinct from caller_id then
      raise exception 'You can only delete your own comment or a comment on your post.' using errcode = '42501';
    end if;

    delete from public.post_comments where id = p_item_id;

  elsif p_table_name = 'creator_list_comments' then
    select user_id, list_key
      into item_owner_id, list_key_value
    from public.creator_list_comments
    where id = p_item_id;

    if item_owner_id is null then
      raise exception 'This comment no longer exists.' using errcode = 'P0002';
    end if;

    content_owner_id := null;

    if list_key_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select user_id
        into content_owner_id
      from public.creator_lists
      where id = list_key_value::uuid;
    elsif list_key_value like 'rankd-top-10-%' then
      auto_owner_text := substring(list_key_value from 14);
      if auto_owner_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        content_owner_id := auto_owner_text::uuid;
      end if;
    end if;

    if item_owner_id <> caller_id and content_owner_id is distinct from caller_id then
      raise exception 'You can only delete your own comment or a comment on your list.' using errcode = '42501';
    end if;

    delete from public.creator_list_comments where id = p_item_id;

  elsif p_table_name = 'creator_post_comments' then
    select user_id, post_id, parent_comment_id
      into item_owner_id, post_id_value, item_parent_id
    from public.creator_post_comments
    where id = p_item_id;

    if item_owner_id is null then
      raise exception 'This comment no longer exists.' using errcode = 'P0002';
    end if;

    select user_id
      into content_owner_id
    from public.creator_posts
    where id = post_id_value;

    if item_owner_id = caller_id or content_owner_id = caller_id then
      allowed := true;
    elsif item_parent_id is not null then
      ancestor_id := item_parent_id;
      while ancestor_id is not null loop
        select user_id, parent_comment_id
          into ancestor_owner_id, ancestor_parent_id
        from public.creator_post_comments
        where id = ancestor_id;

        exit when ancestor_owner_id is null;
        if ancestor_owner_id = caller_id then
          allowed := true;
          exit;
        end if;
        ancestor_id := ancestor_parent_id;
      end loop;
    end if;

    if not allowed then
      raise exception 'You can only delete your own comment or a reply to your content.' using errcode = '42501';
    end if;

    update public.creator_post_comments
    set parent_comment_id = item_parent_id
    where parent_comment_id = p_item_id;

    delete from public.creator_post_comments where id = p_item_id;

  else
    raise exception 'Unsupported content type.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.delete_owned_thread_item(text, uuid) from public;
revoke all on function public.delete_owned_thread_item(text, uuid) from anon;
grant execute on function public.delete_owned_thread_item(text, uuid) to authenticated;
grant execute on function public.delete_owned_thread_item(text, uuid) to service_role;
