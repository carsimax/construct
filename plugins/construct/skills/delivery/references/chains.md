# Sub-branches

Use when large work has a feature document. One feature branch, local sub-branches, one final PR.

## Flow

1. From `feat/<feature>`: `git switch -c feat/<feature>-t<n>`, named for the task (or `-t<n>-t<m>` for a cohesive group).
2. Commit the work unit there. A Risk-named unit has its own commit, reviewed by the lenses before the merge.
3. Back on the feature branch: `git merge --no-ff feat/<feature>-t<n>`. The merge commit is the rollback boundary of the unit.
4. Record the unit's commit in the Tasks table. Never push the sub-branch or open a PR from it.

## Final PR

`feat/<feature>` to the default branch, with the body rules of the skill. The publication gate reviews the whole feature diff against the default branch, not each sub-branch.

When that diff passes the 400 KB review-context budget, the gate cannot review it and nothing publishes in one PR. Keep the feature scoped, or finish and merge part of it first and start a new feature for the rest.
