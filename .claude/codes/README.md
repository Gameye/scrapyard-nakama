# coding/ — language style guides

`ts/` and `tw/` are general-purpose, project-independent references, pulled from
`aasumitro/workspace` and gitignored here. Fix those upstream; a local edit is lost on the next
pull. `sql/` is written for this repo (Nakama's Postgres, read-only queries from runtime
modules) and tracked in git: edit it here, and don't pull `sql/` over it.
Which guide to read when, and how project rules override them: the routing table in the root
`AGENTS.md`.

Scrapyard keeps the languages it writes:

| Folder | Language |
|---|---|
| `ts/` | TypeScript |
| `tw/` | Tailwind CSS v4 |
| `sql/` | SQL (this repo's) |

`tw/` is Tailwind **v4** (CSS-first: `@theme`, `@utility`, `@custom-variant`, no config file).
`tw/pitfalls.md` catches the v3→v4 renames models hallucinate — read it before touching classes.
