// Evidence for high-risk items 1 (data or irreversible effects), 2 (security),
// and 5 (delivery or environment): database migrations, private keys and
// credential files, dependency manifests, container builds, and git hooks.
// Path rules live here; the content rules (PEM header, token lines in .npmrc,
// destructive SQL) are applied by content.mjs through the helpers below.
// Tests, fixtures, and docs directories are never evidence: they only exercise
// or describe these files. Binary files still count, since a key is often binary.
import { JS_TS_EXTENSIONS, asciiLower, goBase, goExt, hasExcludedRiskSegment, isTestRiskPath } from './signals.mjs'
import { isGeneratedGoldenPath } from './stats.mjs'

// item is the high-risk item number (the labels are HIGH_RISK_ITEMS in escalation.mjs).
const reason = (code, signal, item, path) => ({ code, signal, item, path })

const DOCUMENT_EXTENSIONS = ['.md', '.mdx', '.rst', '.adoc']

const MIGRATION_DIRECTORIES = ['migrations', 'migration']
// Inside a migration directory only code, SQL, and tool configs count; a text
// or document file there (upgrade notes, .txt, .rst, .adoc, .md) is prose.
const MIGRATION_EXTENSIONS = [
  '.sql', '.py', '.rb', ...JS_TS_EXTENSIONS, '.go', '.php', '.java', '.kt', '.kts', '.cs', '.ex', '.exs',
  '.yaml', '.yml', '.json', '.xml',
]
// Plain test directories are never evidence for these item rules. The wider
// isTestRiskPath is left alone because other classifier rules rely on it.
const TEST_DIRECTORIES = ['test', 'tests', 'spec']
// Flyway: V<version>__ and U<version>__ carry a version; repeatable R__ has none.
const FLYWAY_NAME = /^(?:[vu]\d+(?:[._]\d+)*|r)__.+\.sql$/

const KEY_BASENAME = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_.+)?$/
const PUBLIC_KEY_EXTENSION = '.pub'
const KEY_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk']
const CREDENTIAL_BASENAMES = ['credentials.json', 'service-account.json']

const DEPENDENCY_BASENAMES = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'pyproject.toml', 'poetry.lock', 'pipfile', 'pipfile.lock', 'go.mod', 'go.sum', 'cargo.toml', 'cargo.lock',
  'gemfile', 'gemfile.lock', 'composer.json', 'composer.lock',
]
const HOOK_DIRECTORIES = ['.githooks', '.husky']
const HOOK_BASENAMES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml', '.pre-commit-config.yaml']

// Added lines of these token-bearing dotfiles are the evidence, not the name.
export const TOKEN_DOTFILES = ['.npmrc', '.pypirc']
const TOKEN_LINE = /(?:_authToken|_auth|_password|password|token)\s*=/i
export const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/

const inTestDirectory = (path) => asciiLower(path).split('/').slice(0, -1).some((segment) => TEST_DIRECTORIES.includes(segment))

// isItemEvidencePath: tests, test directories, docs, fixtures, and goldens never count.
export const isItemEvidencePath = (path) =>
  !isGeneratedGoldenPath(path) && !isTestRiskPath(path) && !hasExcludedRiskSegment(path) && !inTestDirectory(path)

export function isMigrationPath(path) {
  const segments = asciiLower(path).split('/')
  const base = segments[segments.length - 1]
  if (DOCUMENT_EXTENSIONS.includes(goExt(base))) return false
  if (FLYWAY_NAME.test(base)) return true
  // An extensionless file in a migration directory counts (fail toward high).
  const ext = goExt(base)
  if (ext !== '' && !MIGRATION_EXTENSIONS.includes(ext)) return false
  const dirs = segments.slice(0, -1)
  if (dirs.some((segment) => MIGRATION_DIRECTORIES.includes(segment))) return true
  if (ext === '') return false
  // Rails keeps migrations in db/migrate; a bare migrate directory is a CLI command.
  if (dirs.some((segment, index) => segment === 'db' && dirs[index + 1] === 'migrate')) return true
  // Alembic keeps revisions in <env>/versions next to env.py.
  return dirs.some((segment, index) => segment === 'alembic' && dirs[index + 1] === 'versions')
}

// keyOrCredentialCode names a private key or credential file by path alone.
export function keyOrCredentialCode(path) {
  const base = asciiLower(goBase(path))
  if (goExt(base) === PUBLIC_KEY_EXTENSION) return null
  if (KEY_BASENAME.test(base) || KEY_EXTENSIONS.includes(goExt(base))) return 'private_key'
  if (CREDENTIAL_BASENAMES.includes(base)) return 'credential_file'
  if (base === 'credentials' && asciiLower(path).split('/').includes('.aws')) return 'credential_file'
  return null
}

export function isDependencyOrBuildPath(path) {
  const base = asciiLower(goBase(path))
  if (DEPENDENCY_BASENAMES.includes(base)) return true
  if (base.startsWith('requirements') && base.endsWith('.txt')) return true
  return base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')
}

export function isGitHookPath(path) {
  const lower = asciiLower(path)
  const base = goBase(lower)
  if (DOCUMENT_EXTENSIONS.includes(goExt(base))) return false
  if (HOOK_BASENAMES.includes(base)) return true
  const segments = lower.split('/')
  if (segments.slice(0, -1).some((segment) => HOOK_DIRECTORIES.includes(segment))) return true
  return segments.some((segment, index) => segment === '.git' && segments[index + 1] === 'hooks' && index + 2 < segments.length)
}

// pathRiskItemReasons: one reason per matching rule for one changed path.
export function pathRiskItemReasons(path) {
  if (!isItemEvidencePath(path)) return []
  const reasons = []
  if (isMigrationPath(path)) reasons.push(reason('database_migration', 'data_loss', 1, path))
  const keyCode = keyOrCredentialCode(path)
  if (keyCode) reasons.push(reason(keyCode, 'security', 2, path))
  if (isDependencyOrBuildPath(path)) reasons.push(reason('dependency_manifest', 'delivery', 5, path))
  if (isGitHookPath(path)) reasons.push(reason('git_hook', 'delivery', 5, path))
  return reasons
}

// Content rules, for the added lines of one eligible path.
export const isSqlPath = (path) => asciiLower(goExt(path)) === '.sql'
export const isTokenDotfilePath = (path) => TOKEN_DOTFILES.includes(asciiLower(goBase(path)))
export const isRiskItemContentPath = (path) => isSqlPath(path) || isTokenDotfilePath(path)

// Destructive statements: DROP of an object, TRUNCATE, ALTER ... DROP, and a
// DELETE FROM with no WHERE in its statement. Comments are removed first; text
// inside string literals is not parsed, so such a match fails toward high.
export function hasDestructiveSql(addedLines) {
  const text = addedLines.join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  for (const statement of text.split(';')) {
    if (/\bdrop\s+(?:table|database|schema|column|index|view|constraint|trigger|function|procedure|type|sequence|user|role)\b/i.test(statement)) return true
    if (/\btruncate\b/i.test(statement)) return true
    if (/\balter\s[\s\S]*\bdrop\b/i.test(statement)) return true
    if (/\bdelete\s+from\b/i.test(statement) && !/\bwhere\b/i.test(statement)) return true
  }
  return false
}

export const hasTokenLine = (line) => TOKEN_LINE.test(line)

export const contentRiskItemReason = (kind, path) => {
  if (kind === 'destructive_sql') return reason('destructive_sql', 'data_loss', 1, path)
  return reason(kind, 'security', 2, path)
}
