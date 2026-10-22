# Security checklist for the Risk lens

Adapted from addyosmani/agent-skills (MIT), `security-and-hardening` and its security checklist. Used by `review-risk` as a triage list over the supplied patches. Each item is a question to ask of a changed hunk, never a finding by itself: a finding still needs a reachable impact, concrete proof, and causal disposition (see the agent's Candidate-Causal Admission rules).

## Trust boundaries

Trust follows who wrote a value, not which channel delivered it. Treat as untrusted: requests, uploads, webhooks, third-party responses, LLM output, and local values written by processes the code does not control (another process's argv or environment, shared filenames, paths in job payloads).

## Questions per changed hunk

### Secrets and configuration
- Does the hunk add a credential, token, key, or private URL to code, fixtures, logs, or examples?
- Do the ignore rules still cover environment files and private key files?

### Authentication
- Passwords hashed with bcrypt, scrypt, or argon2, never a fast hash?
- Session cookies `httpOnly`, `secure`, `sameSite`; sessions expire?
- Login and reset paths rate limited; reset tokens time limited and single use?

### Authorization
- Does every new or changed entry point enforce authentication on the backend?
- Does every resource access check ownership or role (IDOR)? Are admin actions role checked?
- Are API keys and tokens scoped to the minimum; JWT signature, expiry, and issuer validated?

### Input and output handling
- Validated at the boundary with an allowlist, with length and range limits?
- Queries parameterized, never built by string concatenation?
- Output encoded for its sink (HTML, shell, path, query); redirects validated (open redirect)?
- Uploads restricted by type and size, with content verified?
- Server-side fetches of a caller-supplied URL: allowlisted host, private and reserved addresses blocked, redirects re-checked (SSRF)?
- Destructive path operations (delete, move, overwrite): symlinks resolved before the check, an allowlisted root, a minimum depth, ownership proven from authenticated state? A marker file inside the root is self-attestation, and a check/use gap lets an ancestor be swapped.

### Data exposure
- Sensitive fields (hashes, tokens, PII) excluded from responses and logs?
- Errors generic outward, with no stack, query, or internal path?
- Personal data minimized, with a purpose, retention limit, deletion path, and consent for third-party sharing (including analytics and LLM vendors)?
- HTTPS for external calls; CORS never `*` with credentials; security headers kept?

### Dependencies and supply chain
- New dependency: owner, maintenance, release age, provenance, transitive graph, typosquat check?
- Exactly one lockfile per project root, changed only deliberately; lockfile diff matches the manifest diff?
- Lifecycle scripts blocked until reviewed; script-policy changes inspected?
- A known-advisory audit does not catch a newly malicious package, so absence of audit output is not clearance.

### AI and LLM features
- Model output treated as untrusted: never into `eval`, SQL, a shell, `innerHTML`, or a file path (LLM05)?
- Permissions enforced in code, not in the system prompt (LLM01, LLM07)?
- Credentials, other tenants' data, and the full system prompt kept out of the context window (LLM02)?
- Tool and agent permissions scoped, arguments validated, destructive actions confirmed (LLM06)?
- Token, rate, and recursion limits set (LLM10); RAG data partitioned per tenant and validated before indexing (LLM04, LLM08)?
- Models, datasets, and plugins vetted like dependencies (LLM03)?

## Severity reminders

- A missing control in untouched code is baseline: at most WARNING.
- A control removed, bypassed, or never added for a newly reachable path is a candidate for CRITICAL when the hunk shows the exploit path.
- Hypothetical weakness with no reachable impact is not reported.
