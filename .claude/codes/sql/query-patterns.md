# Query Patterns Reference

Reads only — writes go through the `nk` API (`README.md`).

## Counts and conditional aggregates

One pass, several counts, with `FILTER`:

```sql
SELECT count(*) FILTER (WHERE email IS NOT NULL) AS registered,
       count(*) FILTER (WHERE email IS NULL)     AS other
FROM users
WHERE id <> '00000000-0000-0000-0000-000000000000'   -- Nakama's system user (pitfalls.md)
```

`count(*)` scans the table in Postgres. For anything a page polls, cache the result
(`nk.localcache_put(key, value, seconds)`) so the database is asked at most once per period,
however many pages poll.

## Aggregate, then join

Joining one-to-many and then counting counts each parent once per child. Aggregate in a
subquery, then join:

```sql
SELECT u.id, u.username, d.device_count
FROM users u
JOIN (
  SELECT user_id, count(*) AS device_count
  FROM user_device
  GROUP BY user_id
) d ON d.user_id = u.id
```

## Lists

Prefer the `nk` list calls (`nk.storage_list`, `nk.leaderboard_records_list`, ...) — they
page for you. When SQL must list rows, use keyset pagination on a unique, indexed order
(`users_username_key` here), stable under inserts:

```sql
SELECT id, username
FROM users
WHERE username > $1                  -- the previous page's last username
ORDER BY username
LIMIT $2
```

Keyset on a column without an index (`users.create_time` has none) still scans the table —
check `indexing.md` first. `OFFSET` scans and discards, and drifts under concurrent sign-ups.
