// The untestable-paths allowlist (S3 of .vault/tasks/autonomy.md): `.vault/exempt-paths` lines are `<glob> -- <command>` (`#`
// comments, blank lines ignored). It is read at the default-branch tip only, never the working tree or the published ref, so an
// entry needs a merged change (as the risk floor reads trusted commits).
import { defaultBranch, git } from './delivery-signals.mjs'

export const EXEMPT_FILE = '.vault/exempt-paths'

// readExemptPaths returns [{ glob, command }], [] when the default branch has no file, or null when no default branch resolves.
// A malformed line throws an Error naming the file and line.
export function readExemptPaths(root) {
  const ref = defaultBranch(root)
  if (!ref) return null
  const text = git(root, ['show', `${ref}:${EXEMPT_FILE}`])
  if (text === undefined) return []
  return text.split('\n').flatMap((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return []
    const at = line.indexOf(' -- ')
    const glob = at === -1 ? '' : line.slice(0, at).trim()
    const command = at === -1 ? '' : line.slice(at + 4).trim()
    if (!glob || !command) throw new Error(`${EXEMPT_FILE} line ${i + 1} is unreadable: ${JSON.stringify(line)} (expected "<glob> -- <command>")`)
    return [{ glob, command }]
  })
}
