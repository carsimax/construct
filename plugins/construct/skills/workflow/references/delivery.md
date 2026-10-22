# Delivery

## Work-unit commits

- Large authorized ODD work commits on a feature branch. Branch first when on the default branch.
- Each commit is a reviewable unit of about 400 authored changed lines (additions plus deletions, generated files excluded), with its tests and docs alongside the behavior, and a Conventional Commit message.
- A unit whose Risk line names a high-risk item gets its own commit, so it can be reviewed alone.
- Record the commit that holds each task in the feature document.
- Load the `construct:work-unit-commits` skill when planning the commits.
- Push, PR creation, and merge remain the user's decisions.

## Delivery strategy

Choose one strategy per feature when the feature document is created, and forecast the authored changed lines from the task list:

| Strategy | Behavior once the forecast or running count passes about 400 lines |
|---|---|
| `ask-on-risk` (default) | Ask once for the chain strategy before the next commit |
| `auto-chain` | Ask only for a missing chain strategy, then slice automatically |
| `single-pr` | Keep one PR |
| `exception-ok` | Keep one PR with a recorded `size:exception` rationale |

Chain strategies are `stacked-to-main` and `feature-branch-chain`. Cache both choices in the feature document. Record the slice boundaries (which commits each PR holds) in a delivery table. Load `construct:chained-pr` before planning or creating any pull request.

## Line budget

The 400-line budget shapes how work is sliced, never the code itself. Never delete comments, blank lines, docs, or tests, minify, or split artificially to fit. Make one honest slicing pass. If no cohesive split fits, keep the best split and report the overage with a `size:exception` recommendation for the user to decide.
