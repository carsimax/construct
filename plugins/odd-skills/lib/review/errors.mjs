// Refusals are expected, typed outcomes of a command (exit 1). Usage errors
// (exit 2) reuse the UsageError class of odd-assess.
export class Refusal extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'Refusal'
    this.code = code
    this.extra = extra
  }
}
