-- Second blinded POCUS question. Each reviewer now answers two questions per finding:
--   visible    "Visible on abdominal POCUS (from FAST exam)?"
--   inferrable "Inferrable from abdominal POCUS (from FAST exam)?"
-- Existing answers are kept and become "visible" answers. Same blinding as before.
-- Run after 001. Safe to run more than once. SQL Editor > New query > paste > Run.
alter table public.pocus_ratings add column if not exists question text not null default 'visible';
alter table public.pocus_ratings drop constraint if exists pocus_ratings_question_check;
alter table public.pocus_ratings add constraint pocus_ratings_question_check check (question in ('visible', 'inferrable'));
alter table public.pocus_ratings drop constraint if exists pocus_ratings_pkey;
alter table public.pocus_ratings add primary key (user_id, qid, question);
