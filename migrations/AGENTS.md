# Migration rules

- Applied migration files are immutable. Never edit an existing numbered SQL file after it has been merged.
- Add a new zero-padded migration and make it safe inside one transaction.
- Do not put secrets or environment-specific paths in SQL.
- Prefer additive changes. Destructive changes require a documented backup and rollback plan.
- Run `npm run migrate` against a temporary data directory and `npm test` before committing.
