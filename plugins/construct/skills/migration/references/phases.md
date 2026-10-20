# Migration phases

## Expand, migrate, contract

```
EXPAND -> MIGRATE -> CONTRACT
add new shape beside old; backfill and dual-write; drop the old shape later, alone
```

Example, renaming `name` to `full_name`:

1. Expand: add `full_name` as nullable. Old code ignores it. Verify: schema check, existing tests pass.
2. Dual-write: write both on every insert and update. Verify: test asserting both are set.
3. Backfill: copy `name` to `full_name` in throttled batches. Verify: count of rows where they differ is zero.
4. Switch reads to `full_name`, keep dual-writing, let it bake. Rollback: revert the code; data is still complete.
5. Contract: stop writing `name`; in a separate later unit drop it. Verify: no reference remains (grep, query logs).

Rules:
- Every migration has a down path that was run, not just written.
- Backfills are idempotent, batched, off the hot path; back up or keep the source column until contraction.
- Large indexes are built without blocking writes where the database supports it.
- Decouple a risky cutover with a flag.

## Patterns for code and APIs

- Adapter: old interface, new implementation; consumers migrate later.
- Flag migration: switch consumers one at a time.
- Strangler: run both, shift traffic in steps, remove the old at zero.

## Deprecation notice

```
Deprecated: <name>
Replacement: <name and migration steps>
Reason: <why it goes>
Removal condition: <zero usage observed | date>
Type: advisory | compulsory (compulsory needs tooling and a deadline)
```

The owner of the thing being removed migrates its consumers or ships a compatible bridge; announcing is not migrating.

## Removal checklist

- Replacement covers every critical use and is proven.
- Zero active use confirmed by evidence, not assumption.
- Code, tests, docs, config, and the notice removed; no reference to the old name remains.

## Rationalizations

| Excuse | Reality |
|---|---|
| "Just rename the column" | During rollout old and new code run together; one fails. |
| "Add and drop in one migration" | Couples a safe add to a destructive drop. |
| "Write the rollback if needed" | An unwritten down path is a deploy you cannot reverse. |
| "Users will migrate on their own" | They will not; supply tooling or do it. |
