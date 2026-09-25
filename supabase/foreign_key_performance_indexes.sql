-- BURGRS foreign-key performance indexes
-- Audited and applied against live Supabase project nboalhdybuzfxsrbrcwb on 2026-09-25.
-- After this set, the Supabase unindexed_foreign_keys advisor reports zero uncovered FKs.

create index if not exists rankd_matchup_votes_matchup_user_created_idx
  on public.rankd_matchup_votes (matchup_id, user_id, created_at desc);

create index if not exists rankd_matchup_votes_user_matchup_idx
  on public.rankd_matchup_votes (user_id, matchup_id);

create index if not exists rankd_matchup_votes_winner_show_idx
  on public.rankd_matchup_votes (winner_show_id);

create index if not exists rankd_matchup_votes_loser_show_idx
  on public.rankd_matchup_votes (loser_show_id);

create index if not exists rankd_matchups_created_by_idx
  on public.rankd_matchups (created_by);

create index if not exists user_shows_new_show_id_idx
  on public.user_shows_new (show_id);

create index if not exists user_show_rankings_show_id_idx
  on public.user_show_rankings (show_id);

create index if not exists rankd_matchup_comments_matchup_id_idx
  on public.rankd_matchup_comments (matchup_id);

create index if not exists user_follows_following_id_idx
  on public.user_follows (following_id);

create index if not exists creator_list_items_show_id_idx
  on public.creator_list_items (show_id);

create index if not exists creator_earnings_subscriber_id_fk_idx
  on public.creator_earnings (subscriber_id);

create index if not exists creator_earnings_subscription_id_fk_idx
  on public.creator_earnings (subscription_id);

create index if not exists creator_follows_creator_id_fk_idx
  on public.creator_follows (creator_id);

create index if not exists creator_follows_follower_id_fk_idx
  on public.creator_follows (follower_id);

create index if not exists creator_list_comments_user_id_fk_idx
  on public.creator_list_comments (user_id);

create index if not exists creator_post_comments_parent_comment_id_fk_idx
  on public.creator_post_comments (parent_comment_id);

create index if not exists creator_post_comments_post_id_fk_idx
  on public.creator_post_comments (post_id);

create index if not exists creator_post_comments_user_id_fk_idx
  on public.creator_post_comments (user_id);

create index if not exists creator_posts_user_id_fk_idx
  on public.creator_posts (user_id);

create index if not exists episode_review_votes_user_id_fk_idx
  on public.episode_review_votes (user_id);

create index if not exists episode_reviews_user_id_fk_idx
  on public.episode_reviews (user_id);

create index if not exists notifications_actor_user_id_fk_idx
  on public.notifications (actor_user_id);

create index if not exists post_comments_user_id_fk_idx
  on public.post_comments (user_id);

create index if not exists rankd_guest_matchup_votes_loser_show_id_fk_idx
  on public.rankd_guest_matchup_votes (loser_show_id);

create index if not exists rankd_guest_matchup_votes_winner_show_id_fk_idx
  on public.rankd_guest_matchup_votes (winner_show_id);

create index if not exists rankd_matchup_comments_parent_comment_id_fk_idx
  on public.rankd_matchup_comments (parent_comment_id);

create index if not exists rankd_matchup_comments_user_id_fk_idx
  on public.rankd_matchup_comments (user_id);

create index if not exists rankd_notifications_actor_user_id_fk_idx
  on public.rankd_notifications (actor_user_id);

create index if not exists rankd_notifications_comment_id_fk_idx
  on public.rankd_notifications (comment_id);

create index if not exists rankd_notifications_matchup_id_fk_idx
  on public.rankd_notifications (matchup_id);

create index if not exists rankd_notifications_user_id_fk_idx
  on public.rankd_notifications (user_id);

create index if not exists show_chat_message_votes_user_id_fk_idx
  on public.show_chat_message_votes (user_id);

create index if not exists show_chat_messages_user_id_fk_idx
  on public.show_chat_messages (user_id);

create index if not exists show_review_votes_user_id_fk_idx
  on public.show_review_votes (user_id);

create index if not exists show_reviews_user_id_fk_idx
  on public.show_reviews (user_id);
