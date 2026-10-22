# Migration phases

## Expand, migrate, contract (schemas and stored data)

Each step: own unit, verifier, rollback.

1. **Expand.** Add the new column or field as nullable. Verify: old code runs. Rollback: drop it.
2. **Dual-write.** New code writes both shapes and reads the old one. Verify the shapes agree. Rollback: redeploy the previous code.
3. **Backfill.** Copy old data in throttled, bounded, re-runnable batches; keep the source backed up. Verify counts and a sample. Rollback: clear the new column or restore.
4. **Switch reads.** Move reads to the new shape, behind a flag if possible. Verify results match. Rollback: flip the flag.
5. **Contract.** Stop writing the old shape, then drop it, in a later unit, after nothing references it. Verify with the full tests and a reference search. Rollback: restore the pre-drop backup.

A down path counts once run on a copy.

## Code and API patterns

- **Adapter:** old interface wraps the new one; callers move one by one.
- **Flag migration:** ship the new path dark, ramp it up, delete the flag with the old path.
- **Strangler:** route one slice at a time to the replacement.

## Deprecation notice

Fields (notice and memory entry):

- **Deprecated:** the name, API, flag, or format.
- **Replacement:** what to use, already working.
- **Reason:** why it goes.
- **Removal condition:** an observable state, such as zero calls for 30 days.
- **Type:** advisory, or compulsory. Compulsory needs tooling and a deadline.

The owner of the removed thing migrates consumers or ships a bridge. Announcing is not migrating.

## Removal

Only with the replacement proven and zero use evidenced. Code, tests, docs, config, and the notice go together in one unit.

## Rejected

Renaming in place; adding and dropping in one step; planning rollback later; "users will migrate themselves".
