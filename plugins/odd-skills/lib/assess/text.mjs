// Go-compatible text helpers. Go's strings.TrimSpace trims unicode.IsSpace:
// ASCII whitespace, U+0085, U+00A0, and the Unicode Z categories. It keeps
// U+FEFF, which JavaScript's String.prototype.trim strips, and strips U+0085,
// which trim keeps. Ported rules must use this instead of trim.
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000'
const LEADING = new RegExp(`^[${GO_SPACE}]+`)
const TRAILING = new RegExp(`[${GO_SPACE}]+$`)

export function goTrimSpace(value) {
  return value.replace(LEADING, '').replace(TRAILING, '')
}
