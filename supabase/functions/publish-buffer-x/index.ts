import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { formatPost } from './format.mjs';
import { imageAssets } from './artwork.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const CREATE = `mutation BurgrsPost($input: CreatePostInput!) {
  createPost(input: $input) { __typename ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } }
}`;

class BufferFailure extends Error {
  constructor(message: string, public ambiguous = false, public retryable = false) { super(message); }
}
async function checked(operation: any) {
  const { data, error } = await operation;
  if (error) throw new Error('Database operation failed: ' + error.code);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = req.headers.get('x-burgrs-cron-secret') || '';
  const auth = await db.rpc('validate_tv_news_cron_secret', { p_secret: secret });
  if (!secret || auth.error || auth.data !== true) return new Response('Unauthorized', { status: 401 });
  const key = Deno.env.get('BUFFER_API_KEY');
  if (!key) return Response.json({ ok: true, status: 'waiting_for_buffer_api_key' });
  const run = crypto.randomUUID();
  if (!await checked(db.rpc('buffer_x_acquire', { p_run: run }))) return Response.json({ ok: true, status: 'busy_or_backoff' });
  let submitted = 0;
  let current: any = null;
  let nextRun = new Date().toISOString();
  let lastError: string | null = null;
  const after = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

  async function buffer(query: string, variables = {}, mutation = false) {
    if (!await checked(db.rpc('buffer_x_reserve_call', { p_run: run }))) throw new BufferFailure('Free-plan request budget reached', false, true);
    let response;
    try {
      response = await fetch('https://api.buffer.com', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000),
      });
    } catch { throw new BufferFailure('Buffer request outcome unknown; check Buffer before retrying', mutation, !mutation); }
    if (!response.ok) {
      throw new BufferFailure('Buffer HTTP ' + response.status, mutation && response.status >= 500, response.status === 429 || (!mutation && response.status >= 500));
    }
    let payload;
    try { payload = await response.json(); } catch { throw new BufferFailure('Invalid Buffer response; check Buffer before retrying', mutation, !mutation); }
    if (payload.errors?.length) throw new BufferFailure('Buffer GraphQL error; check API configuration', mutation, false);
    return payload.data;
  }

  try {
    let settings = await checked(db.from('buffer_x_settings').select('*').eq('id', true).single());
    if (!settings.initialized_at) {
      const account = await buffer('query { account { organizations { id } } }');
      const channels: any[] = [];
      for (const org of account.account.organizations) {
        const result = await buffer('query ($org: OrganizationId!) { channels(input: {organizationId: $org}) { id name service externalLink isDisconnected isLocked isQueuePaused } }', { org: org.id });
        channels.push(...result.channels.filter((c: any) => c.service === 'twitter'));
      }
      const chosen = Deno.env.get('BUFFER_X_CHANNEL_ID');
      const matches = chosen ? channels.filter(c => c.id === chosen) : channels;
      if (matches.length !== 1) throw new Error('Expected one X channel; set BUFFER_X_CHANNEL_ID if there are several');
      const channel = matches[0];
      if (channel.isDisconnected || channel.isLocked) throw new Error('Reconnect or unlock the X channel in Buffer');
      settings = await checked(db.from('buffer_x_settings').update({
        initialized_at: new Date().toISOString(), enabled: true, channel_id: channel.id,
        channel_name: channel.name, channel_url: channel.externalLink, last_error: null,
      }).eq('id', true).eq('run_id', run).select('*').single());
      return Response.json({ ok: true, status: 'connected', channel: channel.name, new_posts_only: true });
    }
    if (!settings.enabled) return Response.json({ ok: true, status: 'paused' });
    const pending = await checked(db.from('buffer_x_outbox').select('post_id').eq('status', 'pending').lte('next_attempt_at', new Date().toISOString()).limit(1));
    if (!pending.length) return Response.json({ ok: true, status: 'idle' });
    const channelData = await buffer('query ($id: ChannelId!) { channel(input: { id: $id }) { service isDisconnected isLocked isQueuePaused } }', { id: settings.channel_id });
    const channel = channelData.channel;
    if (channel.service !== 'twitter' || channel.isDisconnected || channel.isLocked) throw new Error('Reconnect or unlock the X channel in Buffer');
    if (channel.isQueuePaused) throw new BufferFailure('X queue is paused in Buffer', false, true);
    const profile = await checked(db.from('profiles').select('username,is_system_admin').eq('id', settings.author_id).single());
    if (!profile.is_system_admin) throw new Error('Burgrs TV is no longer a system profile');

    for (let i = 0; i < 4; i++) {
      const jobs = await checked(db.rpc('buffer_x_claim', { p_run: run }));
      current = jobs?.[0];
      if (!current) break;
      const post = await checked(db.from('creator_posts').select('*').eq('id', current.post_id).maybeSingle());
      if (!post || post.visibility !== 'public' || post.user_id !== settings.author_id || Date.parse(post.created_at) < Date.parse(settings.initialized_at) || !(post.title?.trim() || post.body?.trim())) {
        await checked(db.from('buffer_x_outbox').update({ status: 'skipped' }).eq('post_id', current.post_id));
        current = null;
        continue;
      }
      let artwork = imageAssets(post);
      if (!artwork.length && post.related_show_id) {
        const show = await checked(db.from('shows').select('name,poster_url').eq('id',post.related_show_id).maybeSingle());
        artwork = imageAssets(post, show);
      }
      const data = await buffer(CREATE, { input: {
        channelId: settings.channel_id, text: formatPost(post, profile.username),
        schedulingType: 'automatic', mode: 'addToQueue', assets: artwork, needsApproval: false,
        aiAssisted: Boolean(post.is_auto_news || post.is_auto_season_review),
      } }, true);
      const result = data?.createPost;
      if (!result?.post?.id) {
        // Known rejection has no post ID. Keep queued items when a free queue is full.
        const message = String(result?.message || 'Buffer did not confirm acceptance');
        const retryable = /limit|queue|rate|capacity|paused/i.test(message);
        throw new BufferFailure(message.slice(0,300), !result?.message, retryable);
      }
      await checked(db.from('buffer_x_outbox').update({ status: 'accepted', buffer_post_id: result.post.id, due_at: result.post.dueAt, last_error: null }).eq('post_id', current.post_id));
      submitted++;
      current = null;
    }
    return Response.json({ ok: true, submitted_to_buffer: submitted });
  } catch (error) {
    // Never echo a token, HTTP response body or request headers into logs.
    const failure = error instanceof BufferFailure ? error : new BufferFailure(error instanceof Error ? error.message : 'Worker failed');
    lastError = failure.message.slice(0,300);
    nextRun = after(30);
    if (current) {
      await checked(db.from('buffer_x_outbox').update({
        status: failure.retryable && !failure.ambiguous ? 'pending' : 'review',
        next_attempt_at: after(30), last_error: lastError,
      }).eq('post_id', current.post_id).eq('status','sending'));
    }
    return Response.json({ ok: false, submitted_to_buffer: submitted, error: lastError }, { status: 503 });
  } finally {
    await checked(db.from('buffer_x_settings').update({ run_id: null, locked_until: null, next_run_at: nextRun, last_error: lastError }).eq('id',true).eq('run_id',run));
  }
});
