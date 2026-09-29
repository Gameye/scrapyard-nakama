# SQL Style Reference

## Casing

- Keywords **UPPERCASE** (`SELECT`, `FROM`, `WHERE`); identifiers as Nakama names them
  (`snake_case`, unquoted).
- Aliases short and meaningful (`users u`, `user_device d`), the same alias for a table
  everywhere; never `t1`, `t2`. `AS` for column aliases, always.

## SQL in a Lua module

- A one-clause query stays on one line in a plain string:

```lua
local rows = nk.sql_query("SELECT count(*) AS n FROM users WHERE email IS NOT NULL", {})
```

- Longer queries go in a long string, one clause per line, continuations indented, bound to a
  local named after what the query returns:

```lua
local GUESTS_SINCE = [[
SELECT count(DISTINCT d.user_id) AS n
FROM user_device d
JOIN users u ON u.id = d.user_id
WHERE u.email IS NULL
  AND u.create_time >= $1
]]
local rows = nk.sql_query(GUESTS_SINCE, { since })
```

- Each query lives in one place (a local at the top of the module or next to its one caller) —
  not concatenated from fragments.
- A comment above the query says *why* (what the count means, why it is cached), not what the
  SQL obviously does — as `stats.lua` does.

## Query-writing rules

- Values only through the params table (`$1`, `$2`, ...). The only text ever spliced into a
  query is an identifier picked from a fixed allowlist in the module — never from RPC input.
- Name columns in `SELECT`; `ORDER BY` column names, not ordinals.
- Any limited or listed query orders by a unique tiebreaker (`ORDER BY create_time DESC, id
  DESC`).
- Explicit `JOIN ... ON`, never comma joins.
- Casts explicit (`$1::timestamptz`, `$1::uuid`) where Lua's value type doesn't match the
  column's — implicit casts are where index use quietly dies (`pitfalls.md`).
