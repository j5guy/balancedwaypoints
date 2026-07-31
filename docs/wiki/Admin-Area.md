# Admin Area

Available at `/admin` to any user with `isAdmin` set.

## Users

`/admin/users` lists every account in the household, lets you toggle admin
access on any user (except removing your own — that's blocked to avoid
locking yourself out), and delete accounts.

## Tags, categories, and payees

Renaming/deleting a **tag** is admin-only (creating one is open to any user,
so a typeahead "create if missing" flow while tagging a transaction doesn't
need elevated access). Categories, category groups, and payees are editable
by any authenticated user — there's no separate moderation step for those,
since a single-household deployment doesn't need one.
