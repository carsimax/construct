// Dangerous-sink catalog and comment syntax. Each entry identifies a concrete
// sink, not a suspicious word, and is gated by file extension so identical API
// names in unrelated runtimes do not become lexical false positives.
import { asciiLower, goBase, goExt, isTestRiskPath } from './signals.mjs'
import { goTrimSpace } from './text.mjs'

const sink = (name, extensions, expression) => ({ name, extensions: ` ${extensions} `, expression })

export const DANGEROUS_SINK_CATALOG = [
  // CWE-295: disabled certificate validation.
  sink('TLS Go', '.go', /\bInsecureSkipVerify\s*:\s*true\b/),
  sink('TLS JS', '.js .jsx .mjs .cjs .ts .tsx .mts .cts', /\brejectUnauthorized\s*:\s*false\b|\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0\b/),
  sink('TLS Python', '.py', /\bverify\s*=\s*False\b|\bCERT_NONE\b|\bcheck_hostname\s*=\s*False\b/),
  sink('TLS Rust', '.rs', /\.danger_accept_invalid_certs\s*\(\s*true\s*\)/),
  sink('TLS Ruby', '.rb', /OpenSSL::SSL::VERIFY_NONE\b/),
  sink('TLS PHP', '.php', /\bCURLOPT_SSL_VERIFYPEER\s*=>\s*(?:false|0)\b/),
  sink('TLS C sharp', '.cs', /ServerCertificateValidationCallback\s*\+=?\s*(?:\([^)]*\)|\w+)\s*=>\s*true\b/),
  sink('TLS shell', '.sh .bash .zsh', /\bcurl\s+(?:[^;|]*\s)?(?:--insecure|-k)(?:\s|$)/),
  sink('TLS Java trust all', '.java .kt .kts', /\bcheckServerTrusted\s*\([^)]*\)\s*\{\s*\}|\bHostnameVerifier\b[^;\n]*\([^)]*\)\s*->\s*true\b/),
  // CWE-502: deserializing untrusted object graphs.
  sink('pickle', '.py', /\bpickle\.loads?\s*\(/),
  sink('unsafe YAML Python', '.py', /\byaml\.(?:unsafe_load|load)\s*\(/),
  sink('marshal Python', '.py', /\bmarshal\.loads?\s*\(/),
  sink('Java object stream', '.java .kt .kts', /\bObjectInputStream\s*\(/),
  sink('C sharp formatter', '.cs', /\bBinaryFormatter\s*\(/),
  sink('PHP unserialize', '.php', /(?:^|[^\w.])unserialize\s*\(/),
  sink('Ruby marshal', '.rb', /\bMarshal\.load\s*\(/),
  sink('Ruby YAML', '.rb', /\bYAML\.load\s*\(/),
  sink('C sharp type names', '.cs', /\bTypeNameHandling\s*(?:=|:)\s*TypeNameHandling\.(?:All|Auto)\b/),
  sink('node serialize', '.js .jsx .mjs .cjs .ts .tsx .mts .cts', /\b(?:serialize|nodeSerialize)\.unserialize\s*\(/),
  // CWE-94: runtime evaluation of supplied code.
  sink('eval', '.js .jsx .mjs .cjs .ts .tsx .mts .cts .py .php .rb', /(?:^|[^\w.])eval\s*\(/),
  sink('Function constructor', '.js .jsx .mjs .cjs .ts .tsx .mts .cts', /\bnew\s+Function\s*\(/),
  sink('node VM', '.js .jsx .mjs .cjs .ts .tsx .mts .cts', /\bvm\.runInNewContext\s*\(/),
  sink('PHP create_function', '.php', /\bcreate_function\s*\(/),
  sink('Ruby string eval', '.rb', /\b(?:instance_eval|class_eval)\s*\(\s*["'`]/),
  // CWE-78: shell interpretation of composed commands.
  sink('Python shell', '.py', /\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\(\s*(?:[A-Za-z_]\w*|f["']|["'][^"']*["']\s*\+)[^;\n]*\bshell\s*=\s*True\b/),
  sink('Python system composition', '.py', /\bos\.system\s*\(\s*(?:f["']|[^)\n]*(?:\+\s*[A-Za-z_]\w*|[A-Za-z_]\w*\s*\+|%\s*[A-Za-z_]\w*|\.format\s*\(\s*[A-Za-z_]\w*))/),
  sink('PHP shell variable', '.php', /\b(?:system|exec|shell_exec|passthru)\s*\(\s*\$\w+|`[^`]*\$\w+[^`]*`/),
  sink('Ruby interpolated shell', '.rb', /`[^`]*#\{[^}]+\}[^`]*`|%x[({][^)}]*#\{[^}]+\}/),
  sink('composed sh -c', '.go .java .kt .kts .js .jsx .mjs .cjs .ts .tsx .mts .cts .py .rb .rs .cs', /(?:["'](?:sh|bash)["']\s*,\s*["']-c["']\s*,\s*(?:\w+|["'][^"']*["']\s*\+|f["']|`))/),
  // CWE-327: weak digest specifically for a credential, not a file checksum.
  sink('weak credential hash', '.go .java .kt .kts .js .jsx .mjs .cjs .ts .tsx .mts .cts .py .php .rb .rs .cs', /\b(?:hashlib\.)?(?:md5|sha1)(?:\.Sum)?\s*\(\s*\$?\w*(?:password|passwd|secret|token)\w*\b|\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)\s*\.update\s*\(\s*\w*(?:password|passwd|secret|token)\w*\b|\bMessageDigest\.getInstance\s*\(\s*['"](?:MD5|SHA-1)['"]\s*\)\.digest\s*\(\s*\w*(?:password|passwd|secret|token)\w*\b/i),
  // CWE-942: wildcard origin combined with credential sharing (same line).
  sink('credentialed wildcard CORS', '.go .java .kt .kts .js .jsx .mjs .cjs .ts .tsx .mts .cts .py .php .rb .rs .cs', /Access-Control-Allow-Origin[^;\n]*\*[^;\n]*;[^\n]*Access-Control-Allow-Credentials[^\n]*true/i),
  // CWE-732: world-writable modes.
  sink('world writable API', '.go .js .jsx .mjs .cjs .ts .tsx .mts .cts .py .php .rb .rs .cs', /\b(?:chmod|Chmod|mkdir|WriteFile)\s*\([^\n]*\b(?:0o777|0777|0666)\b|\bumask\s*\(\s*0\s*\)/i),
  sink('world writable shell', '.sh .bash .zsh', /\bchmod\s+(?:-R\s+)?(?:777\b|o\+w\b)/),
  // CWE-347: decoded tokens are not verified signatures.
  sink('JWT Python bypass', '.py', /\bjwt\.decode\s*\([^\n]*(?:\bverify\s*=\s*False\b|["']verify_signature["']\s*:\s*False\b|\balgorithms\s*=\s*\[\s*["']none["']\s*\])/),
  sink('JWT Go unverified', '.go', /\b(?:jwt|\w+)\.ParseUnverified\s*\(/),
  sink('JWT Java unsecured', '.java .kt .kts', /\.parseUnsecuredClaims\s*\(/),
  // CWE-352: explicit CSRF opt-outs.
  sink('CSRF Python', '.py', /@csrf_exempt\b|\bWTF_CSRF_ENABLED\s*=\s*False\b/),
  sink('CSRF Spring', '.java .kt .kts', /\.csrf\s*\(\s*\)\.disable\s*\(/),
  sink('CSRF Rails', '.rb', /\bskip_before_action\s+:verify_authenticity_token\b/),
  sink('CSRF config', '.js .jsx .mjs .cjs .ts .tsx .mts .cts .php .rb', /\bcsrf\s*:\s*false\b|\bcsrf\s*=>\s*false\b/),
  sink('CSRF C sharp', '.cs', /\[IgnoreAntiforgeryToken\]/),
  // CWE-611: external entities and DTD expansion.
  sink('XXE Python', '.py', /\bresolve_entities\s*=\s*True\b/),
  sink('XXE Java', '.java .kt .kts', /\bXMLInputFactory\.IS_SUPPORTING_EXTERNAL_ENTITIES\s*,\s*true\b|\.setExpandEntityReferences\s*\(\s*true\s*\)/),
  sink('XXE PHP', '.php', /\bLIBXML_NOENT\b/),
  sink('XXE C sharp', '.cs', /\bDtdProcessing\.Parse\b/),
]

// Comment syntax by language. A marker counts only where that language uses it
// (`#` opens a C directive, a Rust attribute, and a TypeScript private field).
const HASH = 'hash'
const DASH = 'dash'
const SLASH = 'slash'

function commentSyntaxFor(logicalPath) {
  const base = asciiLower(goBase(logicalPath))
  if (
    base === 'dockerfile' || base === 'makefile' || base === 'cmakelists.txt' || base === '.env' ||
    base.startsWith('.env.') || (base.startsWith('requirements') && base.endsWith('.txt'))
  ) {
    return HASH
  }
  const extension = asciiLower(goExt(logicalPath))
  if (['.sh', '.bash', '.zsh', '.py', '.rb', '.pl', '.pm', '.r', '.ps1', '.psm1', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.cmake', '.mk', '.tf', '.nix'].includes(extension)) return HASH
  if (['.sql', '.lua', '.hs', '.adb', '.ads'].includes(extension)) return DASH
  if (['.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.go', '.java', '.js', '.jsx', '.mjs', '.cjs', '.kt', '.kts', '.php', '.rs', '.swift', '.ts', '.tsx', '.mts', '.cts', '.scala', '.dart'].includes(extension)) return SLASH
  return null
}

// isCommentOnlySourceLine reports an added line that is only a comment in its
// own language. Code after a closed block comment is code, and an unrecognized
// language is never skipped, so the scan fails toward high.
export function isCommentOnlySourceLine(logicalPath, line) {
  const trimmed = goTrimSpace(line)
  switch (commentSyntaxFor(logicalPath)) {
    case HASH:
      return trimmed.startsWith('#')
    case DASH:
      return trimmed.startsWith('--')
    case SLASH: {
      if (trimmed.startsWith('//')) return true
      if (trimmed.startsWith('/*')) {
        const closing = trimmed.indexOf('*/', 2)
        return closing < 0 || goTrimSpace(trimmed.slice(closing + 2)) === ''
      }
      if (trimmed.startsWith('*/')) return goTrimSpace(trimmed.slice(2)) === ''
      // A block comment continuation is a lone `*` followed by whitespace or
      // nothing; `*cmd` is a dereference, not a comment.
      return trimmed === '*' || trimmed.startsWith('* ') || trimmed.startsWith('*\t')
    }
    default:
      return false
  }
}

const YAML_LOAD_CALL = /\byaml\.load\s*\(/g
const SAFE_YAML_LOADER_ARG = /\bLoader\s*=\s*(?:yaml\.)?C?SafeLoader\b/

// A SafeLoader protects its own yaml.load call, not a different call or an
// unrelated assignment elsewhere on the line. Unbalanced calls stay unsafe.
export function hasUnsafeYAMLLoad(line) {
  for (const match of line.matchAll(YAML_LOAD_CALL)) {
    const start = match.index + match[0].length
    let depth = 1
    let end = line.length
    for (let i = start; i < line.length; i++) {
      if (line[i] === '(') depth++
      else if (line[i] === ')' && --depth === 0) {
        end = i
        break
      }
    }
    if (!SAFE_YAML_LOADER_ARG.test(line.slice(start, end))) return true
  }
  return false
}

export function dangerousSinkLine(logicalPath, line) {
  if (isTestRiskPath(logicalPath) || isCommentOnlySourceLine(logicalPath, line)) return false
  const extension = ` ${goExt(logicalPath).toLowerCase()} `
  for (const entry of DANGEROUS_SINK_CATALOG) {
    if (!entry.extensions.includes(extension) || !entry.expression.test(line)) continue
    if (entry.name === 'unsafe YAML Python') {
      if (line.includes('yaml.unsafe_load(') || hasUnsafeYAMLLoad(line)) return true
      continue
    }
    return true
  }
  return false
}
