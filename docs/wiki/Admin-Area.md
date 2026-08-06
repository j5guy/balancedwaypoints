# Admin Area

Available at `/admin` to any user with `isAdmin` set.

## Users

`/admin/users` lists every account in the household, lets you toggle admin
access on any user (except removing your own — that's blocked to avoid
locking yourself out), and delete accounts.

## Tags, categories, and payees

Each user's tags, categories, category groups, and payees are their own
private data (see each model's `owner` field) — nobody else, admin included,
can see or edit another user's. There's no cross-user moderation step for
any of these.
