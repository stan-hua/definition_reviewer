// Settings for the review page. Edit the two Supabase values, then upload the folder.
// The anon key is meant to be public: the database's access rules (schema.sql) protect the notes.
window.REVIEW_CONFIG = {
  // Supabase dashboard > Project Settings > API (or "Connect")
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",

  // Page title shown in the header and browser tab
  TITLE: "Abdominal CT findings · Definition review",

  // Sign-in options to show: "google", "email", or both.
  // "email" needs a custom SMTP provider in Supabase (see README); without one,
  // Supabase only emails members of your Supabase team, 2 emails an hour.
  SIGN_IN_METHODS: ["google"],

  // Optional: the sender reviewers should look for in their inbox when using email sign-in
  EMAIL_SENDER_HINT: "",

  // The issue types offered in the dropdown
  ISSUE_TYPES: [
    "Imprecise",
    "Unclear or ambiguous",
    "Overlaps another finding",
    "Missing inclusion or exclusion",
    "Contradiction",
    "Clinically inaccurate",
    "Wording or typo",
    "Other"
  ],

  // The findings file built from your YAML by build_findings.py
  FINDINGS_URL: "findings.json"
};
