-- "Mark as reviewed" requires answering both POCUS questions for that finding.
-- Existing reviewed marks are kept. Run after 001 and 002. Safe to run more than once.
drop policy if exists "reviews_insert" on public.reviews;
create policy "reviews_insert" on public.reviews for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_reviewer()
    and (select count(distinct p.question) from public.pocus_ratings p
         where p.user_id = auth.uid() and p.qid = reviews.qid
           and p.question in ('visible', 'inferrable')) = 2
  );
