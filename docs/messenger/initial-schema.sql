-- SONORA Messenger initial additive schema. REVIEW BEFORE APPLYING.
-- Does not alter legacy music tables or existing auth identities.
create table if not exists public.messenger_conversations (
 id uuid primary key default gen_random_uuid(),
 kind text not null default 'direct' check (kind in ('direct','group','channel')),
 title text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.messenger_members (
 conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 role text not null default 'member' check (role in ('owner','admin','member')),
 joined_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
create table if not exists public.messenger_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id),
 client_nonce uuid not null,
 body text not null check (char_length(body) between 1 and 4096),
 created_at timestamptz not null default now(),
 edited_at timestamptz,
 deleted_at timestamptz,
 unique(conversation_id,sender_id,client_nonce)
);
create index if not exists messenger_messages_page_idx on public.messenger_messages(conversation_id,created_at desc,id desc);
create index if not exists messenger_members_user_idx on public.messenger_members(user_id,conversation_id);
alter table public.messenger_conversations enable row level security;
alter table public.messenger_members enable row level security;
alter table public.messenger_messages enable row level security;
-- Membership self-reads do not recursively query the membership table.
create policy "messenger_members_self_read" on public.messenger_members
 for select to authenticated using (user_id = (select auth.uid()));
create policy "messenger_conversations_member_read" on public.messenger_conversations
 for select to authenticated using (exists (
 select 1 from public.messenger_members m
 where m.conversation_id=id and m.user_id=(select auth.uid())
 ));
create policy "messenger_messages_member_read" on public.messenger_messages
 for select to authenticated using (exists (
 select 1 from public.messenger_members m
 where m.conversation_id=messenger_messages.conversation_id and m.user_id=(select auth.uid())
 ));
create policy "messenger_messages_member_insert" on public.messenger_messages
 for insert to authenticated with check (
 sender_id=(select auth.uid()) and exists (
 select 1 from public.messenger_members m
 join public.messenger_conversations c on c.id=m.conversation_id
 where m.conversation_id=messenger_messages.conversation_id
 and m.user_id=(select auth.uid()) and c.kind <> 'channel'
 )
 );
-- No direct membership/conversation creation until atomic authenticated RPC is reviewed.
-- No direct update/delete permissions yet. Future endpoints require actor checks.
revoke all on public.messenger_conversations, public.messenger_members, public.messenger_messages from anon, authenticated;
grant select on public.messenger_conversations, public.messenger_members to authenticated;
grant select, insert on public.messenger_messages to authenticated;
-- Restrict writes to allowed columns; immutable identity and timestamps are server-controlled.
revoke insert on public.messenger_messages from authenticated;
grant insert (conversation_id, sender_id, client_nonce, body) on public.messenger_messages to authenticated;
-- Anonymous callers receive no table privileges.

