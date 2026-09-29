# Indexing Reference

Nakama owns every table and its indexes (`README.md`). Don't add, drop or change an index on
them: `nakama migrate up` doesn't know about it, and the next Nakama upgrade may collide with
it. The job here is the other way round — write queries the existing indexes can serve.

## Find what exists

The local database (`nakama/compose.yml`):

```sh
podman exec nakama_postgres_1 psql -U postgres -d nakama -c '\d users'
```

`\d <table>` lists its indexes. Composite indexes serve their leftmost prefix only:
`(a, b, c)` serves `a`, `a+b`, `a+b+c` — not `b` alone.

## Check the plan of any query on a hot path

```sh
podman exec nakama_postgres_1 psql -U postgres -d nakama -c "EXPLAIN (ANALYZE, BUFFERS) SELECT ..."
```

Red flags: `Seq Scan` on a big table (`users`, `storage`) in a query a page or poll triggers;
`Rows Removed by Filter` far above rows returned; estimated vs actual row counts wildly apart
(stale statistics, or a non-sargable predicate — `pitfalls.md`).

A scan you can't avoid (`count(*)` over `users`) is fine when its result is cached for a
period — that is what `get_stats` in `data/modules/stats.lua` does.

## Sargability

The predicate must expose the bare column: `WHERE lower(email) = $1` ignores an index on
`email`; `WHERE create_time + interval '1 day' > now()` ignores one on `create_time` (rewrite
as `create_time > now() - interval '1 day'`); a parameter of the wrong type casts every row.
