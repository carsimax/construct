// Pure-function tables translated from the original classifier's tests: the
// sink catalog, passive nomination, MDX analysis, and passive content proof.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PROCESS_SPAWN_LINE } from '../../plugins/construct/lib/assess/content.mjs'
import { isPassiveContentCandidatePath, isPassiveContentCandidateStat, isPassiveDocumentContent, isStaticMDXDocument } from '../../plugins/construct/lib/assess/passive.mjs'
import { DANGEROUS_SINK_CATALOG, dangerousSinkLine, isCommentOnlySourceLine } from '../../plugins/construct/lib/assess/sinks.mjs'
import { executableModeChanged, hotPathRiskSignals, isConfigurationReviewPath, isServiceTokenReviewPath, isTestRiskPath } from '../../plugins/construct/lib/assess/signals.mjs'
import { countChangedLines, isGeneratedGoldenPath } from '../../plugins/construct/lib/assess/stats.mjs'

describe('dangerous sink catalog', () => {
  test('keeps every catalog entry of the original (45)', () => {
    assert.equal(DANGEROUS_SINK_CATALOG.length, 45)
  })

  const SINK_CASES = [
    ['TLS Go', 'src/client.go', 'tls.Config{InsecureSkipVerify: true}', true],
    ['TLS Rust', 'src/client.rs', 'builder.danger_accept_invalid_certs(true);', true],
    ['TLS safe', 'src/client.py', 'requests.get(url, verify=True)', false],
    ['Java empty unrelated verify method', 'src/Policy.java', 'void verify() {}', false],
    ['Java trust all hostname', 'src/TLS.java', 'HostnameVerifier verifier = (hostname, session) -> true;', true],
    ['deserialization Python', 'src/load.py', 'value = pickle.loads(payload)', true],
    ['deserialization Java', 'src/Load.java', 'new ObjectInputStream(stream)', true],
    ['deserialization safe', 'src/load.py', 'yaml.load(payload, Loader=yaml.SafeLoader)', false],
    ['safe loader beside unsafe load', 'src/load.py', 'safe = yaml.load(a, Loader=yaml.SafeLoader); unsafe = yaml.load(payload)', true],
    ['unrelated SafeLoader beside unsafe load', 'src/load.py', 'loader = yaml.SafeLoader; unsafe = yaml.load(payload)', true],
    ['safe load', 'src/load.py', 'yaml.safe_load(payload)', false],
    ['yaml.unsafe_load', 'src/load.py', 'yaml.unsafe_load(payload)', true],
    ['CSafeLoader', 'src/load.py', 'yaml.load(payload, Loader=yaml.CSafeLoader)', false],
    ['evaluation JS', 'src/run.ts', 'result = eval(input)', true],
    ['evaluation PHP', 'src/run.php', 'eval($expression);', true],
    ['PHP boolean assertion', 'src/run.php', 'assert($valid);', false],
    ['evaluation safe', 'src/run.ts', 'result = evaluate(input)', false],
    ['evaluation member', 'src/run.ts', 'result = object.eval(input)', false],
    ['shell Python', 'src/run.py', 'subprocess.run(command, shell=True)', true],
    ['shell Ruby', 'src/run.rb', 'result = `echo #{name}`', true],
    ['shell literal', 'src/run.py', 'subprocess.run(["sh", "-c", "ls"])', false],
    ['literal command with shell', 'src/run.py', 'subprocess.run("ls", shell=True)', false],
    ['literal-only system concatenation', 'src/run.py', 'os.system("echo" + " hi")', false],
    ['unrelated Python shell flag', 'src/run.py', 'options = dict(shell=True)', false],
    ['Python system arithmetic argument', 'src/run.py', 'os.system("exit " + str(code))', true],
    ['weak hash Python', 'src/auth.py', 'digest = hashlib.md5(password).hexdigest()', true],
    ['weak hash JS', 'src/auth.ts', "const hashedPassword = crypto.createHash('sha1').update(password).digest('hex')", true],
    ['weak hash checksum', 'src/hash.py', 'digest = hashlib.md5(file_bytes).hexdigest()', false],
    ['weak hash unrelated token variable', 'src/hash.py', 'token = hashlib.md5(file_bytes).hexdigest()', false],
    ['weak hash nearby secret log', 'src/hash.py', 'digest = hashlib.md5(file_bytes).hexdigest(); log(secret)', false],
    ['weak hash Go credential', 'src/auth.go', 'digest := sha1.Sum(password)', true],
    ['weak hash PHP credential', 'src/auth.php', '$digest = md5($secret);', true],
    ['CORS JS', 'src/server.js', "res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Credentials', 'true')", true],
    ['CORS PHP', 'src/server.php', "header('Access-Control-Allow-Origin: *'); header('Access-Control-Allow-Credentials: true');", true],
    ['CORS without credentials', 'src/server.js', "res.setHeader('Access-Control-Allow-Origin', '*')", false],
    ['permissions Go', 'src/files.go', 'os.Chmod(name, 0o777)', true],
    ['permissions shell', 'src/setup.sh', 'chmod -R 777 /data', true],
    ['permissions safe', 'src/files.go', 'os.Chmod(name, 0755)', false],
    ['JWT Python', 'src/auth.py', 'jwt.decode(token, options={"verify_signature": False})', true],
    ['JWT Go', 'src/auth.go', 'parser.ParseUnverified(token, claims)', true],
    ['JWT JS decode', 'src/auth.js', 'jwt.decode(token)', false],
    ['CSRF Python', 'src/views.py', '@csrf_exempt', true],
    ['CSRF Java', 'src/Web.java', 'http.csrf().disable();', true],
    ['CSRF safe', 'src/views.py', 'WTF_CSRF_ENABLED = True', false],
    ['XXE Python', 'src/xml.py', 'etree.XMLParser(resolve_entities=True)', true],
    ['XXE C sharp', 'src/Xml.cs', 'reader.DtdProcessing = DtdProcessing.Parse;', true],
    ['XXE safe', 'src/xml.py', 'etree.XMLParser(resolve_entities=False)', false],
    ['TLS shell curl -k', 'src/run.sh', 'curl -k https://example.com', true],
    ['TLS JS env', 'src/run.js', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'", true],
    ['PHP unserialize', 'src/x.php', '$a = unserialize($data);', true],
    ['Ruby YAML', 'src/x.rb', 'YAML.load(data)', true],
    ['Function constructor', 'src/x.js', 'const f = new Function("a", body)', true],
    ['sink pattern in the wrong language', 'src/x.go', 'result = eval(input)', false],
    ['comment', 'src/run.ts', '  // eval(input)', false],
    ['test path', 'src/run_test.go', 'tls.Config{InsecureSkipVerify: true}', false],
    ['python test path', 'src/test_auth.py', 'jwt.decode(token, verify=False)', false],
  ]
  for (const [name, path, line, want] of SINK_CASES) {
    test(`${name}: ${want}`, () => assert.equal(dangerousSinkLine(path, line), want))
  }
})

describe('comment-only lines use the file language', () => {
  const CASES = [
    ['a.py', '# c', true], ['a.py', '// c', false], ['a.go', '// c', true], ['a.go', '# c', false],
    ['a.go', '/* c */', true], ['a.go', '/* c */ code()', false], ['a.go', '/* open', true], ['a.go', ' * body', true],
    ['a.go', '*ptr = 1', false], ['a.go', '*/', true], ['a.sql', '-- c', true], ['a.sql', '# c', false],
    ['Dockerfile', '# c', true], ['a.unknown', '# c', false], ['a.rs', '#[derive(Debug)]', false],
  ]
  for (const [path, line, want] of CASES) test(`${path} ${JSON.stringify(line)} -> ${want}`, () => assert.equal(isCommentOnlySourceLine(path, line), want))
})

describe('process spawn pattern', () => {
  const CASES = [
    ['exec(command)', true], ['db.Exec("x")', false], ['stmt.Exec(a)', false], ['/re/.exec(s)', false], ['exec "$@"', true],
    ['import "os/exec"', true], ['subprocess.run(a)', true], ['subprocessing.run(a)', false], ['executor.run(c)', false],
    ['execute_process(COMMAND x)', true], ['child_process', true], ['Runtime.getRuntime().exec("ls")', true],
    ['new ProcessBuilder(cmd)', true], ['os.system("ls")', true], ['popen(cmd)', true], ['Process.Start(x)', true],
    ['Exec(command);', true], ['execSync("ls")', true], ['os.execvp(a)', true],
  ]
  for (const [line, want] of CASES) test(`${line} -> ${want}`, () => assert.equal(PROCESS_SPAWN_LINE.test(line), want))
})

describe('passive nomination', () => {
  const PATHS = [
    ['docs/guide.md', true], ['README.md', true], ['book/chapter.mdx', true], ['docs/agents.md', false], ['prompts/system.md', false],
    ['docs/system-prompt.md', false], ['docs/agent-rules.md', false], ['docs/workflow.md', false], ['docs/runtime.md', false],
    ['internal/assets/claude/agents/review-risk.md', false], ['AGENTS.md', false], ['claude.md', false], ['Gemini.md', false],
    ['tools.md', false], ['.github/workflows/release.md', false], ['runtime/README.md', false], ['docs/diagram.svg', false],
    ['config/settings.yaml', false], ['internal/app.go', false],
  ]
  for (const [path, want] of PATHS) test(`path ${path} -> ${want}`, () => assert.equal(isPassiveContentCandidatePath(path), want))

  const stat = (path, extra = {}) => ({ path, additions: 1, deletions: 0, binary: false, modeOnly: false, oldMode: '000000', newMode: '100644', ...extra })
  const STATS = [
    ['ordinary Markdown', stat('docs/guide.md'), true], ['active SVG', stat('docs/diagram.svg'), false], ['AGENTS', stat('AGENTS.md'), false],
    ['nested CLAUDE', stat('docs/CLAUDE.md'), false], ['SKILL', stat('skills/go/SKILL.md'), false], ['copilot', stat('.github/copilot-instructions.md'), false],
    ['agent name', stat('docs/review-agent.md'), false], ['skill path', stat('skills/review/guide.md'), false], ['prompt path', stat('prompts/review.md'), false],
    ['instruction name', stat('docs/review-instructions.md'), false], ['orchestrator name', stat('docs/review-orchestrator.md'), false],
    ['workflow path', stat('workflows/release.md'), false], ['dot agent', stat('.agent/rules.md'), false], ['dot codex', stat('.codex/instructions.md'), false],
    ['Claude command', stat('.claude/commands/deploy.md'), false], ['GitHub agents', stat('.github/agents/reviewer.md'), false],
    ['internal runtime', stat('internal/runtime/prompt.md'), false], ['internal templates', stat('internal/templates/review.md'), false],
    ['OpenSpec', stat('openspec/changes/example/proposal.md'), false], ['MDX', stat('docs/guide.mdx'), true], ['source file', stat('internal/view.go'), false],
    ['binary Markdown', stat('docs/guide.md', { binary: true }), false], ['binary image', stat('assets/logo.png', { binary: true }), true],
    ['binary image under agents', stat('.claude/agents/logo.png', { binary: true }), false], ['executable image', stat('assets/logo.png', { binary: true, newMode: '100755' }), false],
    ['symlink Markdown', stat('docs/guide.md', { newMode: '120000' }), false], ['gitlink Markdown', stat('docs/guide.md', { newMode: '160000' }), false],
    ['executable Markdown', stat('docs/guide.md', { newMode: '100755' }), false], ['mode-only', stat('docs/guide.md', { modeOnly: true }), false],
    ['regular to regular', stat('docs/guide.md', { oldMode: '100644' }), true],
  ]
  for (const [name, s, want] of STATS) test(`stat ${name} -> ${want}`, () => assert.equal(isPassiveContentCandidateStat(s), want))
})

describe('static MDX analysis', () => {
  const CASES = [
    ['plain prose', '# Chapter\n\nStatic prose.\n', true],
    ['fenced example', '```tsx\nexport const Example = <Widget />\n```\n', true],
    ['inline code example', 'Use `<Widget value={1} />` here.\n', true],
    ['double-backtick inline code', 'Use ``<Widget value={1} />`` here.\n', true],
    ['mismatched code span', 'Use `<Widget />`` here.\n', false],
    ['escaped opening backtick', 'Use \\`<Widget />` here.\n', false],
    ['escaped closing backtick', 'Use `<Widget />\\` here.\n', false],
    ['ESM import', "import Widget from './widget'\n", false],
    ['comment-separated ESM import', "import/* runtime */Widget from './widget'\n", false],
    ['comment-prefixed ESM import', "/* runtime */ import Widget from './widget'\n", false],
    ['BOM-prefixed ESM import', "﻿import Widget from './widget'\n", false],
    ['multiline ESM import', "import\nWidget from './widget'\n", false],
    ['ESM export', 'export const value = 1\n', false],
    ['JSX component', 'Read <Widget /> next.\n', false],
    ['expression', 'Current value: {value}\n', false],
    ['comment delimiter prose', 'C comments begin with /* and end with */.\n', true],
    ['importance is not an import', 'Important note.\n', true],
  ]
  for (const [name, content, want] of CASES) test(`${name} -> ${want}`, () => assert.equal(isStaticMDXDocument(Buffer.from(content)), want))
})

describe('passive content proof fails closed upward', () => {
  const CASES = [
    ['ordinary prose', 'docs/guide.md', '# Title\n\nProse.\n', true],
    ['static MDX', 'book/chapter.mdx', '# Title\n\nProse.\n', true],
    ['executable MDX', 'book/chapter.mdx', 'export const value = 1\n', false],
    ['interpreter directive', 'docs/guide.md', '#!/bin/sh\necho hi\n', false],
    ['BOM then interpreter directive', 'docs/guide.md', '﻿#!/bin/sh\n', false],
    ['embedded NUL byte', 'docs/guide.md', 'prose\x00more\n', false],
    ['binary image bytes', 'assets/logo.png', '\x89PNG\r\n\x1a\n\x00\x00', true],
    ['image wearing a shebang', 'assets/logo.png', '#!/bin/sh\necho hi\n', false],
    ['text wearing an image extension', 'assets/logo.png', 'prose\n', false],
    ['archive wearing an image extension', 'assets/logo.jpg', 'PK\x03\x04payload', false],
    ['jpeg signature', 'assets/a.jpg', '\xff\xd8\xff\xe0', true],
    ['gif signature', 'assets/a.gif', 'GIF89a....', true],
  ]
  for (const [name, path, content, want] of CASES) {
    test(`${name} -> ${want}`, () => assert.equal(isPassiveDocumentContent(path, Buffer.from(content, 'latin1')), want))
  }
  test('invalid UTF-8 text', () => assert.equal(isPassiveDocumentContent('docs/guide.md', Buffer.from([0x70, 0xff, 0xfe])), false))
})

describe('path predicates', () => {
  test('configuration review paths', () => {
    for (const path of ['.env', '.env.local', 'a/.env.production', 'go.mod', 'package.json', 'Dockerfile', 'Makefile', 'x/config.json', 'a.yml', 'a.toml', 'a.ini', 'yarn.lock']) {
      assert.equal(isConfigurationReviewPath(path), true, path)
    }
    for (const path of ['src/a.go', 'docs/a.md', 'environment.txt']) assert.equal(isConfigurationReviewPath(path), false, path)
  })
  test('test paths', () => {
    for (const path of ['a_test.go', 'a.test.ts', 'a.spec.js', 'test_a.py', 'a_test.py', '__tests__/a.js', 'x/testdata/a.go']) assert.equal(isTestRiskPath(path), true, path)
    for (const path of ['test/a.go', 'spec/a.rb', 'src/contest.go', 'tests/a.go']) assert.equal(isTestRiskPath(path), false, path)
  })
  test('hot path tokens', () => {
    assert.deepEqual(hotPathRiskSignals('src/auth/webhook.go'), ['auth', 'security'])
    assert.deepEqual(hotPathRiskSignals('src/Auth-Payments.go'), ['auth', 'payments'])
    assert.deepEqual(hotPathRiskSignals('src/authority.go'), [])
    assert.deepEqual(hotPathRiskSignals('src/auth_test.go'), [])
  })
  test('service-token names need adjacent tokens', () => {
    for (const path of ['src/service-token.go', 'service_token/x.go', 'a/Service-Token.json']) assert.equal(isServiceTokenReviewPath(path), true, path)
    for (const path of ['src/service-api-token.go', 'src/servicetoken.go', 'src/token-service.go']) assert.equal(isServiceTokenReviewPath(path), false, path)
  })
  test('executable-mode changes compare only the exec bits', () => {
    assert.equal(executableModeChanged('100644', '100755'), true)
    assert.equal(executableModeChanged('000000', '100755'), true)
    assert.equal(executableModeChanged('100755', '100644'), true)
    assert.equal(executableModeChanged('100644', '120000'), false)
    assert.equal(executableModeChanged('100755', '100755'), false)
  })
})

describe('changed-line counting', () => {
  const stat = (path, extra = {}) => ({ path, additions: 0, deletions: 0, binary: false, modeOnly: false, ...extra })
  test('counts additions plus deletions and skips binary, mode-only, and generated goldens', () => {
    const total = countChangedLines([
      stat('a.go', { additions: 3, deletions: 2 }),
      stat('b.bin', { binary: true }),
      stat('c.sh', { additions: 9, modeOnly: true }),
      stat('x/testdata/golden/a.golden', { additions: 50 }),
    ])
    assert.equal(total, 5)
  })
  test('rejects duplicate, negative, and non-canonical paths', () => {
    assert.throws(() => countChangedLines([stat('a'), stat('a')]), /duplicate/)
    assert.throws(() => countChangedLines([stat('a', { additions: -1 })]), /negative/)
    for (const path of ['', '/a', 'a//b', './a', 'a/../b', 'a\\b']) assert.throws(() => countChangedLines([stat(path)]), undefined, path)
  })
  test('golden path detection', () => {
    assert.equal(isGeneratedGoldenPath('pkg/testdata/golden/a.golden'), true)
    assert.equal(isGeneratedGoldenPath('testdata/golden/a.golden'), true)
    assert.equal(isGeneratedGoldenPath('pkg/testdata/a.golden'), false)
    assert.equal(isGeneratedGoldenPath('pkg/testdata/golden/a.txt'), false)
  })
})
