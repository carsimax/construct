# Security triage for the risk lens

The hook appends this file after the patches. Use it to decide where to look, not what to report.

## How to use it

- Trust follows the writer. Data the change author controls is trusted; input from users, networks, files, environment, or other services is not.
- Every item below is triage. A finding needs a reachable path from untrusted input to impact, and proof: the enforcement point or its absence, quoted from the patches.
- A missing control in code the change did not touch is at most WARNING. A control the change removed or weakened on a reachable path may be CRITICAL.
- No exploit path, no finding. Do not list generic hardening.

## Where to look

- Authentication and authorization: new or changed endpoints, commands, or handlers; checks moved, loosened, or made optional; identity taken from the request instead of the session; privileges widened.
- Input reaching an interpreter: SQL, shell, template, path, URL, regex, deserialization, HTML. Look for string building around a sink, a path joined without containment, a fetch of a user-chosen URL.
- Secrets: credentials, tokens, or keys in code, tests, fixtures, logs, error text, or default config; a secret passed in a command line.
- Data exposure and loss: more fields returned or logged than needed, personal data in telemetry, a delete or overwrite without a guard or backup, a weakened retention rule.
- Cryptography and randomness: homemade schemes, weak or removed verification, predictable tokens, disabled certificate checks.
- Dependencies: a new or bumped package, an install script, an unpinned or untrusted source, a lockfile change that the manifest does not explain.
- Boundaries: CORS, cookies, redirects, file upload, rate limits, sandboxes, and permission or hook configuration that the change relaxes.

## Severity

- CRITICAL needs the reachable path and observable harm, and the change must have introduced, activated, or worsened it.
- WARNING covers a proven weakness that needs an unlikely precondition, or a gap outside the diff.
- Unproven or hypothetical issues are not findings. Say what you could not verify in `evidence`.
