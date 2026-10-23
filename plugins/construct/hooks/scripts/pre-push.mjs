// Git pre-push hook (installed by bin/construct-gate): judges every ref being pushed with the
// publication gate's verdict, so a push from any host or tool is checked, not only a Claude Code Bash call.
// stdin: one `<local ref> <local sha> <remote ref> <remote sha>` line per ref. A delete (all-zero local sha)
// publishes no work. The first denial goes to stderr and the push exits 1; an error while judging denies.
// Usage: node pre-push.mjs <remote> <url>   (run by git inside the repository)
import { readFileSync } from 'node:fs'
import { repositoryRoot } from './git-tree.mjs'
import { verdict } from './publication-gate.mjs'

try {
  const lines = readFileSync(0, 'utf8').split('\n').filter((line) => line.trim() !== '')
  for (const line of lines) {
    const [localRef, localSha] = line.trim().split(/\s+/)
    if (/^0+$/.test(localSha)) continue
    // A branch is judged by name so the default branch is recognized; anything else by its sha.
    const ref = localRef.startsWith('refs/heads/') ? localRef : localSha
    const reason = verdict({ gate: 'pre-push', dir: repositoryRoot(process.cwd()), base: null, refs: [ref] })
    if (reason) {
      process.stderr.write(`${reason}\n`)
      process.exitCode = 1
      break
    }
  }
} catch (error) {
  process.stderr.write(`construct pre-push: the push could not be checked (${error.message}), so it is denied.\n`)
  process.exitCode = 1
}
