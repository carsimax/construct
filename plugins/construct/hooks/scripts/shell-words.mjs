// Shell-word tokenizer shared by the command hooks (secret-guard and publication-gate).
// Pure: no I/O.
// splitCommands is a small shell-word splitter: quotes and backslashes group a word,
// unquoted ; | & ( ) ` newline end a command, and < > are dropped as separators so
// `cat <.env` yields the word `.env`. Each returned word keeps whether it was quoted.
export function splitCommands(input) {
  const commands = []
  let words = []
  let cur = ''
  let has = false
  let redir = false
  let piped = false
  const endWord = () => {
    if (has) words.push({ t: cur, r: redir })
    if (has) redir = false
    cur = ''
    has = false
  }
  const endCommand = () => {
    endWord()
    redir = false
    if (words.length) {
      words.piped = piped
      commands.push(words)
    }
    words = []
    piped = false
  }
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === "'") {
      const end = input.indexOf("'", i + 1)
      const stop = end === -1 ? input.length : end
      cur += input.slice(i + 1, stop)
      has = true
      i = stop
    } else if (c === '"') {
      has = true
      for (i++; i < input.length && input[i] !== '"'; i++) {
        // Inside double quotes bash drops a backslash only before $ ` " \ or newline.
        if (input[i] === '\\' && input[i + 1] === '\n') { i++; continue }
        if (input[i] === '\\' && i + 1 < input.length && '$`"\\'.includes(input[i + 1])) i++
        cur += input[i]
      }
    } else if (c === '\\' && input[i + 1] === '\n') {
      i++ // a continuation line joins before tokenizing
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
    } else if (/\s/.test(c) && c !== '\n') {
      endWord()
    } else if (';|&()`\n'.includes(c)) {
      endCommand()
      // `|` and `|&` feed the next command; `||` does not.
      if (c === '|') {
        if (input[i + 1] === '|') i++
        else {
          // `|&` pipes stderr too: consume the `&` so it does not end a command.
          if (input[i + 1] === '&') i++
          piped = true
        }
      }
    } else if (c === '<' || c === '>') {
      endWord()
      // Operators: >> >| >&N <<EOF; a here-string (<<<) takes data, not a file.
      const op = /^(<<<|<<-?|>>|>\||>&[0-9-]*|<&[0-9-]*|[<>])/.exec(input.slice(i))[0]
      i += op.length - 1
      redir = op !== '<<<' && !/&[0-9-]*$/.test(op) || /^[<>]&$/.test(op)
    } else {
      cur += c
      has = true
    }
  }
  endCommand()
  return commands
}
