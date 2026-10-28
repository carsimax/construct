# Security policy

## Supported versions

Only the latest release (the newest `vX.Y.Z` tag) gets security fixes. Upgrade with `claude plugin marketplace update construct` and `claude plugin update construct@construct`.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/carsimax/construct/security/advisories/new). Do not open a public issue for a vulnerability.

Include the Construct version (`claude plugin list`), the Claude Code and Node.js versions, the output of `/construct doctor`, and the smallest steps that reproduce the problem. You get a first reply within 7 days. Once a fix is released, the advisory is published with credit unless you ask otherwise.

## Scope

In scope:

- `install.sh`: what it writes to `~/.claude/settings.json`.
- The memory store and its MCP server: reading or writing memory of another repository, or a pre-approved command reaching a destructive one.
- Hooks that leak data, run commands they should not, or write outside the repository and `~/.claude`.

Guards and gates are a discipline layer, not a security boundary. `publication-gate`, `pre-push`, `command-guard`, `surface-guard`, and `delegation-admission` keep an agent on the workflow inside Claude Code; they do not stop a user, another tool, or an indirect command, and `git push --no-verify` skips the pre-push hook by design (see the README). A way to get past a guard is a welcome bug report, as a public issue, unless it also reaches one of the in-scope items above.
