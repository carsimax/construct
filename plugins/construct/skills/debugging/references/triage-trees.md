# Triage trees

Read-only diagnosis aids for `construct:debugging`. Substitute the repository's own commands for any runner shown.

## Non-reproducible failure

```
Cannot reproduce on demand:
├── Timing-dependent?
│   ├── Add timestamps to logs around the suspected area
│   ├── Widen race windows with artificial delays
│   └── Run under load or concurrency to raise collision odds
├── Environment-dependent?
│   ├── Compare runtime versions, OS, environment variables
│   ├── Compare data (empty vs populated store)
│   └── Try a clean environment such as CI
├── State-dependent?
│   ├── Look for leaked state between tests or requests
│   ├── Look for globals, singletons, shared caches
│   └── Run the scenario alone, then after other operations
└── Truly random?
    ├── Add logging at the suspected location
    ├── Alert on the specific error signature
    └── Record the observed conditions and report it as unreproduced
```

Never claim a fix for an unreproduced failure. Report it as unreproduced with the conditions tried.

## Localize by layer

```
Which layer fails?
├── UI / frontend     -> console, DOM, network
├── API / backend     -> server logs, request and response
├── Database          -> queries, schema, data integrity
├── Build tooling     -> config, dependencies, environment
├── External service  -> connectivity, API changes, rate limits
└── The test itself   -> is the assertion correct (false negative)?
```

## Bisect a regression

```bash
git bisect start
git bisect bad                     # current commit is broken
git bisect good <known-good-sha>
git bisect run <focused test command>
git bisect reset                   # always finish with this
```

The command must exit 0 on good and non-zero on bad (125 to skip an untestable commit). Bisect checks out commits, so run it only in a clean working tree or a scratch clone.

## Test failure

```
Test fails after a change:
├── Changed code the test covers?
│   ├── Test is outdated -> update the test, citing the spec
│   └── Code has a bug  -> fix the code
├── Changed unrelated code? -> side effect: shared state, imports, globals
└── Already flaky? -> timing, order dependence, external dependency
```

## Build failure

```
├── Type error        -> read the error, check types at the cited location
├── Import error      -> module exists, exports match, paths correct
├── Config error      -> syntax or schema of build config
├── Dependency error  -> manifest and lockfile, then install per repo docs
└── Environment error -> runtime version, OS compatibility
```

## Runtime error

```
├── Null or undefined access -> trace where the value originates
├── Network / CORS           -> URLs, headers, server config
├── Render error             -> error boundary, console, component tree
└── Wrong behavior, no error -> log at key points, verify data at each step
```

## Symptom versus root cause

```
Symptom: "The user list shows duplicate entries"
Symptom fix (bad): deduplicate in the UI
Root cause fix (good): the query joins twice; fix the query or data model
```
