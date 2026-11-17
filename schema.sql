-- Findings definition review: Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Then add yourself as an admin (see the last statement in this file).

-- ---------------------------------------------------------------
-- Reviewer allowlist. Only emails listed here can read or write notes.
-- ---------------------------------------------------------------
create table if not exists public.reviewers (
  email      text primary key check (email = lower(email)),
  is_admin   boolean not null default false,
  added_at   timestamptz not null default now()
);

create or replace function public.is_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reviewers where email = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reviewers where email = lower(auth.jwt() ->> 'email') and is_admin);
$$;

-- ---------------------------------------------------------------
-- Display names shown beside notes.
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Notes and replies. A reply has parent_id set and no issue type.
-- ---------------------------------------------------------------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  qid         text not null check (char_length(qid) <= 120),
  target      text not null default 'overall' check (char_length(target) <= 40),
  target_text text check (char_length(target_text) <= 2000),
  issue_type  text check (char_length(issue_type) <= 60),
  body        text not null check (char_length(body) between 1 and 5000),
  parent_id   uuid references public.notes (id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  author_id   uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  status_by   uuid references auth.users on delete set null,
  status_at   timestamptz
);
create index if not exists notes_qid_idx on public.notes (qid);
create index if not exists notes_parent_idx on public.notes (parent_id);

-- "Reviewed" marks: one row per reviewer per finding.
create table if not exists public.reviews (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  qid         text not null check (char_length(qid) <= 120),
  reviewed_at timestamptz not null default now(),
  primary key (user_id, qid)
);

-- ---------------------------------------------------------------
-- Guard: the server, not the page, decides who wrote a note and when.
-- An admin acting on someone else's note can change only its status.
-- ---------------------------------------------------------------
create or replace function public.notes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    new.author_id  := auth.uid();
    new.created_at := now();
    new.status     := 'open';
    new.status_by  := null;
    new.status_at  := null;
    new.edited_at  := null;
    if new.parent_id is not null then
      select id, qid, parent_id into p from public.notes where id = new.parent_id;
      if p.id is null then raise exception 'Parent note not found'; end if;
      if p.parent_id is not null then new.parent_id := p.parent_id; end if; -- replies stay one level deep
      new.qid := p.qid;
      new.issue_type  := null;
      new.target      := 'reply';
      new.target_text := null;
    end if;
    return new;
  end if;

  -- UPDATE
  new.id         := old.id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  new.qid        := old.qid;
  new.parent_id  := old.parent_id;
  if old.author_id is distinct from auth.uid() then
    new.body        := old.body;
    new.issue_type  := old.issue_type;
    new.target      := old.target;
    new.target_text := old.target_text;
    new.edited_at   := old.edited_at;
  end if;
  if new.status is distinct from old.status then
    new.status_by := auth.uid();
    new.status_at := now();
  else
    new.status_by := old.status_by;
    new.status_at := old.status_at;
  end if;
  return new;
end $$;

drop trigger if exists notes_guard on public.notes;
create trigger notes_guard before insert or update on public.notes
  for each row execute function public.notes_guard();

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------
alter table public.reviewers enable row level security;
alter table public.profiles  enable row level security;
alter table public.notes     enable row level security;
alter table public.reviews   enable row level security;

drop policy if exists "reviewers_select" on public.reviewers;
drop policy if exists "reviewers_insert" on public.reviewers;
drop policy if exists "reviewers_update" on public.reviewers;
drop policy if exists "reviewers_delete" on public.reviewers;
create policy "reviewers_select" on public.reviewers for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin());
create policy "reviewers_insert" on public.reviewers for insert to authenticated
  with check (public.is_admin());
create policy "reviewers_update" on public.reviewers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "reviewers_delete" on public.reviewers for delete to authenticated
  using (public.is_admin() and email <> lower(auth.jwt() ->> 'email'));  -- admins cannot remove themselves

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (public.is_reviewer());
create policy "profiles_insert" on public.profiles for insert to authenticated
  with check (id = auth.uid() and public.is_reviewer());
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and public.is_reviewer());

drop policy if exists "notes_select" on public.notes;
drop policy if exists "notes_insert" on public.notes;
drop policy if exists "notes_update" on public.notes;
drop policy if exists "notes_delete" on public.notes;
create policy "notes_select" on public.notes for select to authenticated
  using (public.is_reviewer());
create policy "notes_insert" on public.notes for insert to authenticated
  with check (public.is_reviewer());
create policy "notes_update" on public.notes for update to authenticated
  using (public.is_reviewer() and (author_id = auth.uid() or public.is_admin()))
  with check (public.is_reviewer());
create policy "notes_delete" on public.notes for delete to authenticated
  using (public.is_reviewer() and (author_id = auth.uid() or public.is_admin()));

drop policy if exists "reviews_select" on public.reviews;
drop policy if exists "reviews_insert" on public.reviews;
drop policy if exists "reviews_delete" on public.reviews;
create policy "reviews_select" on public.reviews for select to authenticated
  using (public.is_reviewer());
create policy "reviews_insert" on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and public.is_reviewer());
create policy "reviews_delete" on public.reviews for delete to authenticated
  using (user_id = auth.uid());

-- Signed-out visitors get nothing; signed-in users go through the policies above.
revoke all on public.reviewers, public.profiles, public.notes, public.reviews from anon;
grant select, insert, update, delete on public.reviewers to authenticated;
grant select, insert, update          on public.profiles  to authenticated;
grant select, insert, update, delete on public.notes     to authenticated;
grant select, insert, delete          on public.reviews   to authenticated;
revoke execute on function public.is_reviewer(), public.is_admin() from public, anon;
grant execute on function public.is_reviewer(), public.is_admin() to authenticated;

-- ---------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.notes;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reviews;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------
-- Blinded POCUS ratings (also in upgrades/001 and 002).
-- Each reviewer sees only their own answers; admins see everyone's.
-- ---------------------------------------------------------------
create table if not exists public.pocus_ratings (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  qid        text not null check (char_length(qid) <= 120),
  question   text not null default 'visible' constraint pocus_ratings_question_check
               check (question in ('visible', 'inferrable')),  -- which POCUS question (from FAST exam)
  rating     smallint not null check (rating between 1 and 5),  -- 1 very unlikely, 2 unlikely, 3 unsure, 4 likely, 5 very likely
  comment    text check (char_length(comment) <= 1000),          -- optional reason, e.g. "only if severe"; blinded like the rating
  updated_at timestamptz not null default now(),
  primary key (user_id, qid, question)
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

-- "Mark as reviewed" requires both POCUS answers (also in upgrades/003).
drop policy if exists "reviews_insert" on public.reviews;
create policy "reviews_insert" on public.reviews for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_reviewer()
    and (select count(distinct p.question) from public.pocus_ratings p
         where p.user_id = auth.uid() and p.qid = reviews.qid
           and p.question in ('visible', 'inferrable')) = 2
  );

-- ---------------------------------------------------------------
-- Make yourself the first admin. Replace the address, then run this line.
-- ---------------------------------------------------------------
insert into public.reviewers (email, is_admin) values ('you@example.edu', true)
  on conflict (email) do update set is_admin = true;
