// Git pre-push hook (installed by bin/construct-gate): judges every ref being pushed with the
// publication gate's verdict, so a push from any host or tool is checked, not only a Claude Code Bash call.
// stdin: one `<local ref> <local sha> <remote ref> <remote sha>` line per ref. A delete (all-zero local sha)
// publishes no work; when no default branch resolves, neither does a commit with no feature document. The first
// denial goes to stderr and the push exits 1; a malformed line or an error while judging denies.
// Usage: node pre-push.mjs <remote> <url>   (run by git inside the repository)
import { readFileSync } from 'node:fs'
import { git, repositoryRoot } from './git-tree.mjs'
import { verdict } from './publication-gate.mjs'

const remote = process.argv[2] || 'origin'
const WAYS_OUT = 'To skip the check once use `git push --no-verify`; to remove the hook run `construct-gate uninstall`.'

try {
  const lines = readFileSync(0, 'utf8').split('\n').filter((line) => line.trim() !== '')
  for (const line of lines) {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4 || !/^[0-9a-f]+$/i.test(fields[1])) throw new Error(`malformed pre-push line ${JSON.stringify(line)}`)
    const [localRef, localSha] = fields
    if (/^0+$/.test(localSha)) continue
    const dir = repositoryRoot(process.cwd())
    // A branch is judged by name so the default branch is recognized; anything else by its sha.
    const ref = localRef.startsWith('refs/heads/') ? localRef : localSha
    let reason = verdict({ gate: 'pre-push', dir, base: null, refs: [ref] })
    if (reason?.includes('default branch cannot be resolved')) {
      // Without a default branch nothing can be compared; a commit with no feature document at all publishes no tracked work.
      // shortcut: a document moved out of .vault/tasks/ is not seen here, upgrade if repositories without a default branch track work.
      const tree = git(dir, ['ls-tree', '-r', '--name-only', localSha, '--', '.vault/tasks/']).toString('utf8')
      if (!/\.md$/m.test(tree)) continue
      reason += ` Run \`git remote set-head ${remote} --auto\` to record the remote's default branch. ${WAYS_OUT}`
    } else if (reason?.includes('could not be checked (git merge-base ')) {
      reason = `construct pre-push: ${localRef} shares no history with the default branch, so its review state cannot be checked. ${WAYS_OUT}`
    } else if (reason?.includes('no remote-tracking default branch exists')) {
      reason += ` ${WAYS_OUT}`
    }
    if (reason) {
      process.stderr.write(`${reason}\n`)
      process.exitCode = 1
      break
    }
  }
} catch (error) {
  process.stderr.write(`construct pre-push: the push could not be checked (${error.message}), so it is denied. ${WAYS_OUT}\n`)
  process.exitCode = 1
}
