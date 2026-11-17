-- Blinded POCUS ratings: "How likely is it that this finding is visible on
-- abdominal point-of-care ultrasound?" 1 = very unlikely ... 5 = very likely
-- Each reviewer sees only their own answers; admins see everyone's.
-- Safe to run more than once. Supabase dashboard: SQL Editor > New query > paste > Run.
create table if not exists public.pocus_ratings (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  qid        text not null check (char_length(qid) <= 120),
  rating     smallint not null check (rating between 1 and 5),  -- 1 very unlikely, 2 unlikely, 3 unsure, 4 likely, 5 very likely
  comment    text check (char_length(comment) <= 1000),          -- optional reason, e.g. "only if severe"; blinded like the rating
  updated_at timestamptz not null default now(),
  primary key (user_id, qid)
);

alter table public.pocus_ratings enable row level security;

drop policy if exists "pocus_select" on public.pocus_ratings;
drop policy if exists "pocus_insert" on public.pocus_ratings;
drop policy if exists "pocus_update" on public.pocus_ratings;
create policy "pocus_select" on public.pocus_ratings for select to authenticated
  using (public.is_reviewer() and (user_id = auth.uid() or public.is_admin()));
create policy "pocus_insert" on public.pocus_ratings for insert to authenticated
  with check (user_id = auth.uid() and public.is_reviewer());
create policy "pocus_update" on public.pocus_ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_reviewer());

-- No delete: an answer can be changed but not cleared. (Live-update delete events are not
-- filtered by access rules, so allowing deletes would reveal who cleared which rating.)
revoke all on public.pocus_ratings from anon;
grant select, insert, update on public.pocus_ratings to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.pocus_ratings; exception when duplicate_object then null; end;
end $$;
