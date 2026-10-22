# Sources

## Version files

| Ecosystem | Read |
|---|---|
| JavaScript, TypeScript | `package.json`, and the lockfile for the resolved version |
| Python | `pyproject.toml`, `requirements.txt`, or the lockfile |
| Go | `go.mod` |
| Rust | `Cargo.toml`, `Cargo.lock` |
| PHP | `composer.json`, `composer.lock` |
| Ruby | `Gemfile`, `Gemfile.lock` |

Prefer the lockfile: a manifest range names what may install, the lockfile names what did.

## Priority

1. Official documentation for the detected version.
2. The official blog or changelog (release notes, migration guides).
3. Web standards (MDN, WHATWG, W3C, IETF).
4. Compatibility data (browser or runtime support tables).

Blog posts and forum answers only suggest where to look.

## Fetching

Fetch the one API page for the detected version. A deep link with an anchor beats a top-level or landing page. If the docs only cover a newer version, say so and mark the result `UNVERIFIED`.

## Citation

Give the full URL, the version, and a short quote:

```
Source: https://example.dev/docs/v5/api#options (v5.2.1)
"The `retry` option accepts a number or a function."
```

With no official source: `UNVERIFIED: <what>, because <reason no official page was found or reachable>`.
