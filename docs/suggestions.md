# Reader suggestions — owner runbook

Visitors can suggest new labels/highlights or corrections to existing ones
directly from the page (the ✏️ icon on label/highlight buttons, and the
"+ Suggest a new label/highlight" links at the end of each sidebar list).
Everything requires sign-in (shared Gospel Go Supabase account, magic-link
email, no password) and nothing goes live until you approve it here.

## One-time setup

1. **Fill in the client config.** Edit `js/bp-supabase.js` and set
   `BP_SUPABASE_URL` / `BP_SUPABASE_ANON_KEY` to your project's values
   (Supabase dashboard → Project Settings → API — the anon/publishable key
   is safe to commit, it has no special access on its own).
2. **Apply the schema.** Run `supabase/schema.sql` against the project
   (via the Supabase MCP tool's `apply_migration`, or the SQL editor).
3. **Seed yourself as admin.** Find your `auth.users` id (e.g.
   `select id from auth.users where email = 'you@example.com'`) and run:
   ```sql
   insert into public.bp_admins (user_id, note) values ('<your-uid>', 'site owner');
   ```
4. **Set up the local apply script.** Copy `.env.example` to `.env` and
   fill in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (the *service role*
   key, from the same API settings page — never put this one in any
   client-side file). `.env` is already git-ignored.

## Reviewing suggestions (`admin.html`)

Sign in the same way visitors do. The Pending tab is the review queue —
each card shows who submitted it, where it applies, a live comparison of
the current on-disk value vs. what's proposed (fetched fresh from the
actual `data/...json` file, so it's never stale), and any warning if the
targeted entry can no longer be confidently located (renamed, removed, or
already changed by hand since the suggestion was submitted).

- **Approve**: you can edit the proposed field values right there before
  approving — useful for fixing a typo or tightening the wording without
  bouncing it back to the submitter. Approving only marks the row ready;
  it does **not** touch any file yet.
- **Reject**: requires a short reason, which the submitter sees in their
  own "My Suggestions" list.
- **Ban submitter**: available on any pending row. This is enforced
  server-side (the database trigger blocks new inserts from a banned
  account) — hiding the buttons in their browser is just a courtesy on
  top, not the real block.
- **Re-queue**: available on `applied`/`unmatched` rows, in case you
  want to try applying one again (e.g. after fixing a stale-match issue
  by hand).
- **⏸ Pause suggestions**: the kill switch, in the header. Also enforced
  server-side — flipping it off immediately blocks new submissions and
  hides the suggestion UI for everyone, no deploy needed.

## Publishing approved suggestions

Nothing reaches `data/topics/` or `data/bookwide/` until you run, locally:

```
node scripts/apply-approved-suggestions.js --dry-run   # preview first
node scripts/apply-approved-suggestions.js              # then for real
```

This edits only the specific lines each approved suggestion touches (never
a full-file reformat), so `git diff data/` shows exactly what changed —
review it like any other edit, then commit and push as usual. The script
never runs git itself and never touches
`js/usfm-outline-extractor.js`. If a row can't be safely applied (the
target entry was renamed, removed, or changed since submission), it's
marked `unmatched` with a reason instead of guessing — check the
Unmatched tab and either hand-fix the JSON or fix the suggestion's target
in the database, then Re-queue it.

**Safety note**: the script independently recomputes the expected result
in memory and compares it against the actual text-edited output before
writing anything. If those two ever disagree, it aborts the *entire* run
without writing any file — that means a bug in the script, not bad data,
so please report it rather than re-running.

## Adding another moderator

```sql
insert into public.bp_admins (user_id, note) values ('<their-uid>', 'why they're an admin');
```

## Hazard: `js/usfm-outline-extractor.js`

This script regenerates a book's topic file from source `.sfm` text, but
it only ever writes the `outline` field — rerunning it **overwrites the
entire chapter topic file**, destroying every hand-authored and
suggestion-derived label, highlight, note, reference, and link in that
book. This was true before this feature existed; it's called out here
because the suggestion pipeline raises the cost of forgetting it. Never
rerun the extractor against a book with real content without diffing the
result first.
