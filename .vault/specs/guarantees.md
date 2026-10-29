# Guarantees

- **S1 — README installs the current release.** "README a v15 + test que compare su versión con plugin.json" (L1). Assumption: the README version badge, the two `install.sh` URLs, and the "Current version" line name the `plugin.json` version; a repository test fails when any of them differs. The "Changes in X" line describes 15.0.0.
- **S2 — A worker is never left unconfined by its start.** "Marcar iniciado antes de la foto, timeout 30 s, y si falta baseTree con envolvente el stop bloquea" (L1).
  - Given a construct:worker SubagentStart When the hook runs Then the admission record is written `started: true` with the `agent_id` before any snapshot is taken, so surface-guard confines the worker even if the snapshot then fails or the host kills the hook.
  - The SubagentStart hook entry that runs delegation-admission `start` has a timeout of 30 s.
  - Given a worker whose task has an envelope and no recorded baseline (neither its own nor the task's) When it stops Then oracle-stop blocks the stop naming the missing start snapshot and spends one attempt (so a spent budget still ends it), instead of skipping the diff check.
- **S3 — Unreadable state denies.** "Estado, lock o envolvente ilegibles → denegar nombrando el archivo" (L1).
  - A missing file keeps today's meaning (no envelope, no state, no lock). A file that exists but cannot be read or parsed, or has the wrong shape, is unreadable.
  - Unreadable envelope or task state: delegation-admission denies the worker launch and surface-guard denies the worker's writes, each naming the file; oracle-stop allows the stop with a message naming the file (a blocked stop could never end, since no attempt can be recorded) (L5).
  - Unreadable oracle lock record: surface-guard denies every subagent write and the publication gate denies publishing, naming the file.
  - Unreadable writer record in the session's admission directory: surface-guard denies the writes of a subagent that has no readable record, naming the file.
