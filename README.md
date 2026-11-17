# Findings definition review (Supabase edition)

A static web page where reviewers browse every finding's question, variants, definition and terms, flag any part of it, and write notes. Notes, replies and "reviewed" marks are stored in your Supabase project and appear live for every reviewer. Only email addresses on your reviewer list can see or add notes; anyone with the link can read the definitions themselves.

## What is in this folder

| File | What it is |
|---|---|
| `index.html`, `app.js` | The page. You should not need to edit these. |
| `config.js` | Your settings: Supabase URL and key, title, sign-in options, issue types. |
| `findings.json` | The findings, built from your YAML. |
| `build_findings.py` | Rebuilds `findings.json` when your YAML changes. |
| `schema.sql` | The database tables and access rules. Run once in Supabase. |

## Setup (about 30 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is enough).
2. Open **SQL Editor → New query**, paste all of `schema.sql`, and change the last line to your own email address. Click **Run**. This creates the tables, the access rules, and makes you the first admin.
3. Open **Project Settings → API** (or the **Connect** button) and copy the **Project URL** and the **anon / publishable key**. Paste both into `config.js`. The anon key is designed to be public; the access rules in `schema.sql` are what protect the notes. Never put the `service_role` / secret key in this folder.

### 2. Put the page online
Any static host works. With GitHub Pages:
1. Create a new GitHub repository and upload every file in this folder.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the page is live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

Netlify, Cloudflare Pages and Vercel also work: drag the folder onto their deploy page.

A public repository makes the definitions public. That is fine for the page itself (notes stay protected), but use a private repository with a paid GitHub plan, or Netlify/Cloudflare, if the definitions should not be public.

### 3. Tell Supabase where the page lives
In Supabase, open **Authentication → URL Configuration**:
- **Site URL**: your page address, for example `https://YOUR-USERNAME.github.io/REPO-NAME/`
- **Redirect URLs**: add the same address. Add `http://localhost:8000/` too if you will test on your own computer.

### 4. Turn on Google sign-in (recommended)
Supabase's built-in email service only sends to members of your Supabase team, at most 2 emails an hour, so Google sign-in is the simplest way to admit outside reviewers. Any Google account works, including Berkeley (bConnected) accounts.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Go to **Google Auth Platform** (formerly **APIs & Services → OAuth consent screen**). Set up the app name and your support email; choose audience **External**.
3. Under **Clients**, create an **OAuth client ID** of type **Web application**:
   - **Authorized JavaScript origins**: your page origin, for example `https://YOUR-USERNAME.github.io`
   - **Authorized redirect URIs**: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (Supabase shows this exact URL on its Google provider page)
4. Copy the client ID and secret into Supabase: **Authentication → Sign In / Providers → Google**, turn it on, paste both, save.
5. Back in Google, under **Audience**, click **Publish app** so that it is **In production**. While the app is in **Testing**, only Google accounts you list as test users can sign in. The page asks Google only for name and email, which normally does not require Google's app review.

### 5. (Optional) Email sign-in links
To let reviewers sign in with an emailed link instead of Google:
1. Set up a custom SMTP provider in Supabase (**Authentication → Emails → SMTP Settings**). Resend, Brevo, SendGrid and Postmark all have free tiers. This lifts the 2-per-hour limit to 30 per hour by default, adjustable under **Authentication → Rate Limits**.
2. In `config.js`, set `SIGN_IN_METHODS: ["google", "email"]` (or just `["email"]`).

Reviewers must open the emailed link in the same browser where they asked for it.

### 6. Add reviewers
Open the page, sign in, go to **All notes**, and scroll to **Reviewers**. Add each reviewer's email address (the one they will sign in with). Then send them the page link. On first sign-in, each person chooses the name others will see beside their notes.

You can also manage the list in Supabase under **Table Editor → reviewers**.

## Updating the findings
When your YAML changes:
```bash
pip install pyyaml
python3 build_findings.py path/to/fast_abdomen_ct.yaml
```
Upload the new `findings.json`. Existing notes stay attached to their finding as long as its `id` is unchanged. Each note also stores the exact text it was written about, so reviewers can still read the original wording after you revise it. Notes point to fields by position (for example, the second definition sentence), so after large rewrites a note's "refers to" label may name a different sentence than the quoted text; the quoted text is the reliable record.

Add `--plain-labels` to label definition sentences "Sentence 2, 3…" instead of inferring "Includes" or "Excludes" from their wording.

## Testing on your own computer
```bash
cd this-folder
python3 -m http.server 8000
```
Open `http://localhost:8000/`. Opening `index.html` directly from disk will not work, because the browser blocks it from loading `findings.json`.

## Blinded POCUS rating
Each finding asks reviewers "How likely is it that this finding is visible on abdominal point-of-care ultrasound?" on a 1–5 scale (1 Very unlikely, 2 Unlikely, 3 Unsure, 4 Likely, 5 Very likely). Reviewers see only their own answers; admins see everyone's counts and mean (names on hover) and get them in **Download review progress**. The database enforces the blinding. An answer can be changed but not cleared.

Projects set up before this feature need `upgrades/001_pocus_ratings.sql` run once in the SQL Editor (it is already included in `schema.sql` for new projects).

## Getting the notes out
- **All notes → Download notes CSV** exports the notes and replies matching the current filters (set status to "Any status" to include resolved ones).
- **All notes → Download review progress** exports one row per finding: who marked it reviewed, when, and its open and resolved note counts, including findings reviewed with no notes.
- In Supabase, **Table Editor → notes** shows every row and can export CSV.

## Who can do what
| | Signed out | Signed in, not on list | Reviewer | Admin |
|---|---|---|---|---|
| Read definitions | ✓ | ✓ | ✓ | ✓ |
| Read notes | | | ✓ | ✓ |
| Add notes, replies, reviewed marks | | | ✓ | ✓ |
| Edit own notes | | | ✓ | ✓ |
| Rate POCUS visibility (blinded) | | | ✓ | ✓ |
| See everyone's POCUS ratings | | | own only | ✓ |
| Resolve or delete others' notes | | | | ✓ |
| Manage the reviewer list | | | | ✓ |

The database enforces these rules, so they hold even if someone edits the page code in their browser. Admins can change only the status of other people's notes, never their text.

## Things to know
- **Free Supabase projects pause after a period of inactivity** (currently about a week). If the page says notes cannot load, open the Supabase dashboard and restore the project. A paid plan avoids this.
- **Back up** occasionally with Download CSV or a Supabase export.
- Removing someone from the reviewer list stops their access immediately; their existing notes remain.
