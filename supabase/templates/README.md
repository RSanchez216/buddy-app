# Auth email templates

These are not deployed by anything. Supabase auth email templates live only in
the Dashboard, and there is no CLI or API that pushes them — so they are kept
here to be version controlled and reviewable, and pasted by hand.

| File | Paste into | Subject |
|---|---|---|
| `invite-user.html` | Authentication → Emails → **Invite user** | `Your BUDDY account is ready — set your password` |
| `reset-password.html` | Authentication → Emails → **Reset Password** | `Your BUDDY sign-in link` |

Replace the entire message body. `{{ .ConfirmationURL }}` is the only variable
either template needs.

**Do not add a link to the site.** The stock invite template renders
`{{ .SiteURL }}` as bare text and most mail clients auto-linkify it, so the
email went out with two links and the first was the site root — no token, so it
lands on the sign-in page with no way forward. That is the link Meerim clicked
and the reason these exist. One clickable thing per email.

Both templates carry a Russian block after the English one: the Bishkek and
Tashkent staff read Russian first. Drop it if you'd rather keep them
English-only — nothing depends on it.

## Both templates matter, not just the invite

`Resend invite` sends the **Reset Password** email, not the invite one. Invite
links are single use, so once someone opens theirs `inviteUserByEmail` returns
`422 email_exists` forever after. `invite-user` handles that by looking the
email up first and falling back to `resetPasswordForEmail` for anyone who
already exists — see `../functions/invite-user/index.ts`.

So a new employee who fumbles their first link gets the *reset* template as
their second email. Updating only the invite one leaves half the onboarding
path on the Supabase default.

## Two settings worth changing before onboarding more people

**1. The sender looks like spam.** Mail currently arrives from
`Supabase Auth <noreply@mail.app.supabase.io>`. Nothing says MANAS or BUDDY,
and an unfamiliar sender carrying a single link is close to a textbook phishing
shape — to spam filters and to a cautious new employee both.

Fix: Project Settings → Authentication → SMTP Settings. Point at a domain you
control (`noreply@manasexpress.com`) and set the sender name to `BUDDY`.

**2. The built-in email service is rate limited.** Supabase's default sender is
meant for development and is capped at a small number of messages per hour per
project. Invite several people in one sitting and the later ones can fail to
send while the Edge Function still returns 200, because the send is queued
downstream of it. Configuring your own SMTP removes the cap. Check the current
number under Authentication → Rate Limits before a batch — it changes.

## The onboarding sequence

1. Invite the user.
2. They click **Set my password**, choose one, and land in the app.
3. If the link was already used, **Resend invite** on their Settings page sends
   a fresh single-use link. Note the button only renders while the user's row is
   `status='pending'`; once someone has signed in they are `active`, and the
   equivalent action is **Reset password**, which sends the same email.
4. Give them page access **and** pin at least one page if they're on simple nav.

Step 4 matters: page access alone leaves a simple-nav user with an empty sidebar.
