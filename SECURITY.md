# Security

Report a vulnerability privately through this repository's **Security → Report a
vulnerability** (GitHub private vulnerability reporting), not in a public issue.

Please include what is affected (the game server, the site, the Nakama setup or the deploy),
how to reproduce it, and what an attacker gains.

The game server trusts nothing a client reports: it runs every match and validates every
input. A way to make it accept a forged outcome (damage, kills, positions, another player's
seat) is in scope, as is anything that leaks a key or a session.
