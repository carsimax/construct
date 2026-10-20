// S9: high-risk items 1 (data or irreversible), 2 (security), and 5 (delivery)
// raise the tier to high with a reason that names the item.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isGitHookPath, isMigrationPath } from '../../plugins/construct/lib/assess/items.mjs'
import { applyFiles, assessJson, makeRepo, reasonKeys } from './helpers.mjs'

const DDL = 'ALTER TABLE users ADD COLUMN nick text;\n'
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOg\n-----END RSA PRIVATE KEY-----\n'

// [name, base files, change, reason keys]
const HIGH = [
  // item 1: migrations by path
  ['migrations/ directory', {}, { 'migrations/001_init.sql': DDL }, ['database_migration:migrations/001_init.sql']],
  ['db/migrate (Rails)', {}, { 'db/migrate/20240101_add_users.rb': 'class A; end\n' }, ['database_migration:db/migrate/20240101_add_users.rb']],
  ['Django migrations package', {}, { 'app/migrations/0002_auto.py': 'x = 1\n' }, ['database_migration:app/migrations/0002_auto.py']],
  ['Prisma migrations', {}, { 'prisma/migrations/2024_init/migration.sql': DDL }, ['database_migration:prisma/migrations/2024_init/migration.sql']],
  ['Knex migrations', {}, { 'knex/migrations/20240101_a.js': 'exports.up = () => {}\n' }, ['database_migration:knex/migrations/20240101_a.js']],
  ['Alembic versions', {}, { 'alembic/versions/abc123_add.py': 'revision = "abc"\n' }, ['database_migration:alembic/versions/abc123_add.py']],
  ['Flyway db/migration', {}, { 'db/migration/V1__init.sql': DDL }, ['database_migration:db/migration/V1__init.sql']],
  ['Flyway versioned name outside a migration dir', {}, { 'sql/V2_1__add_col.sql': DDL }, ['database_migration:sql/V2_1__add_col.sql']],
  // item 1: destructive SQL by content
  ['DROP TABLE in a .sql file', {}, { 'sql/cleanup.sql': 'DROP TABLE IF EXISTS sessions;\n' }, ['destructive_sql:sql/cleanup.sql']],
  ['TRUNCATE in a .sql file', {}, { 'sql/reset.sql': 'truncate table events;\n' }, ['destructive_sql:sql/reset.sql']],
  ['ALTER ... DROP in a .sql file', {}, { 'sql/alter.sql': 'ALTER TABLE users DROP COLUMN legacy;\n' }, ['destructive_sql:sql/alter.sql']],
  ['multi-line ALTER ... DROP', {}, { 'sql/alter.sql': 'ALTER TABLE users\n  DROP CONSTRAINT users_pk;\n' }, ['destructive_sql:sql/alter.sql']],
  ['DELETE FROM without WHERE', {}, { 'sql/purge.sql': 'DELETE FROM audit_log;\n' }, ['destructive_sql:sql/purge.sql']],
  ['a WHERE on a later line spares one DELETE, not the next', {}, { 'sql/mix.sql': 'DELETE FROM a\nWHERE id = 1;\nDELETE FROM b;\n' }, ['destructive_sql:sql/mix.sql']],
  // item 2: keys and credentials
  ['id_rsa', {}, { 'deploy/id_rsa': 'secret\n' }, ['private_key:deploy/id_rsa']],
  ['id_ed25519', {}, { 'keys/id_ed25519': 'secret\n' }, ['private_key:keys/id_ed25519']],
  ['.pem file', {}, { 'certs/server.pem': 'x\n' }, ['private_key:certs/server.pem']],
  ['.key file', {}, { 'certs/server.key': 'x\n' }, ['private_key:certs/server.key']],
  ['.p12 binary', {}, { 'certs/client.p12': Buffer.from([1, 2, 0, 3, 0, 0]) }, ['private_key:certs/client.p12']],
  ['.pfx file', {}, { 'certs/client.pfx': 'x\n' }, ['private_key:certs/client.pfx']],
  ['credentials.json', {}, { 'config/credentials.json': '{}\n' }, ['credential_file:config/credentials.json']],
  ['.npmrc with an auth token', {}, { '.npmrc': '//registry.npmjs.org/:_authToken=abc\n' }, ['credential_file:.npmrc']],
  ['.pypirc with a password', {}, { '.pypirc': '[pypi]\npassword = hunter2\n' }, ['credential_file:.pypirc']],
  ['PEM private key header in a source file', {}, { 'src/keys.py': `KEY = """${PEM}"""\n` }, ['private_key_content:src/keys.py']],
  ['PEM private key header in a text file', {}, { 'notes/key.txt': PEM }, ['private_key_content:notes/key.txt']],
  // item 5: dependencies, container builds, git hooks
  ...[
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml',
    'poetry.lock', 'Pipfile', 'Pipfile.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock',
    'composer.json', 'composer.lock', 'Dockerfile', 'Dockerfile.prod', 'web/Dockerfile',
  ].map((path) => [`dependency or build file ${path}`, {}, { [path]: 'x\n' }, [`dependency_manifest:${path}`]]),
  ['.githooks directory', {}, { '.githooks/pre-commit': '#!/bin/sh\ntrue\n' }, ['git_hook:.githooks/pre-commit']],
  ['.husky directory', {}, { '.husky/pre-push': 'npm test\n' }, ['git_hook:.husky/pre-push']],
  ['lefthook.yml', {}, { 'lefthook.yml': 'pre-commit:\n' }, ['git_hook:lefthook.yml']],
  ['.pre-commit-config.yaml', {}, { '.pre-commit-config.yaml': 'repos: []\n' }, ['git_hook:.pre-commit-config.yaml']],
  ['id_ed25519_work (suffix) is still a private key', {}, { 'deploy/id_ed25519_work': 'secret\n' }, ['private_key:deploy/id_ed25519_work']],
  ['plain migrations/ .sql', {}, { 'migrations/0001.sql': DDL }, ['database_migration:migrations/0001.sql']],
  ['migrations/ .py', {}, { 'migrations/0002_add.py': 'x = 1\n' }, ['database_migration:migrations/0002_add.py']],
  ['db/migrate .rb', {}, { 'db/migrate/001.rb': 'class A; end\n' }, ['database_migration:db/migrate/001.rb']],
  ['a deleted lockfile still counts', { 'yarn.lock': 'a\n' }, { 'yarn.lock': null }, ['dependency_manifest:yarn.lock']],
]

const ITEM = { database_migration: 1, destructive_sql: 1, private_key: 2, credential_file: 2, private_key_content: 2, dependency_manifest: 5, git_hook: 5 }
const SIGNAL = { 1: 'data_loss', 2: 'security', 5: 'delivery' }
const LABEL = { 1: 'data or irreversible effects', 2: 'security', 5: 'delivery or environment' }

describe('high-risk items 1, 2, 5 raise the tier (S9)', () => {
  for (const [name, base, change, keys] of HIGH) {
    test(name, () => {
      const repo = makeRepo(base)
      applyFiles(repo, change)
      const { json, stderr } = assessJson(repo)
      assert.equal(json.risk, 'high', stderr + JSON.stringify(json.reasons))
      assert.deepEqual(reasonKeys(json.reasons), keys)
      assert.equal(json.review_due, true)
      assert.equal(json.review_due_reason, 'high_risk')
      assert.equal(json.lenses.length, 4)
      for (const reason of json.reasons) {
        const item = ITEM[reason.code]
        assert.equal(reason.detail, `signal: ${SIGNAL[item]}; high-risk item ${item} (${LABEL[item]})`)
      }
    })
  }

  test('item reasons sit beside others and replace the fallback', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'package.json': '{}\n', 'src/auth/x.go': 'package a\n', 'src/x.go': 'package x\n' })
    const { json } = assessJson(repo)
    assert.deepEqual(reasonKeys(json.reasons), ['dependency_manifest:package.json', 'hot_path:src/auth/x.go'])
  })
})

describe('items 1, 2, 5 negatives keep their earlier tier', () => {
  const NEGATIVE = [
    ['README mentioning migration is passive', {}, { 'README.md': 'How to run a migration and rotate id_rsa.\n' }, 'passive', ['non_executable_only']],
    ['docs/keys.md is passive', {}, { 'docs/keys.md': 'Keys and DROP TABLE are explained here.\n' }, 'passive', ['non_executable_only']],
    ['docs under migrations are not migrations', {}, { 'migrations/README.md': 'Notes\n' }, 'passive', ['non_executable_only']],
    ['a migration word in a file name is not a directory', {}, { 'src/migration_notes.go': 'package a\n' }, 'medium', ['executable_change:src/migration_notes.go']],
    ['seed .sql with plain statements is medium', {}, { 'sql/seed.sql': 'INSERT INTO t VALUES (1);\nUPDATE t SET a = 1 WHERE id = 1;\nDELETE FROM t WHERE id = 2;\n' }, 'medium', ['executable_change:sql/seed.sql']],
    ['a SQL comment naming DROP TABLE is not a statement', {}, { 'sql/seed.sql': '-- never DROP TABLE here\nINSERT INTO t VALUES (1);\n' }, 'medium', ['executable_change:sql/seed.sql']],
    ['a .sql under docs is excluded', {}, { 'docs/sql/drop.sql': 'DROP TABLE a;\n' }, 'medium', ['executable_change:docs/sql/drop.sql']],
    ['a public key is not a private key', {}, { 'keys/id_rsa.pub': 'ssh-rsa AAAA\n' }, 'medium', ['executable_change:keys/id_rsa.pub']],
    ['a public key with a suffix is not a private key', {}, { 'deploy/id_ed25519_work.pub': 'ssh-ed25519 AAAA\n' }, 'medium', ['executable_change:deploy/id_ed25519_work.pub']],
    ['a migrate directory outside db/ is not a migration', {}, { 'src/commands/migrate/index.js': 'export const a = 1\n' }, 'medium', ['executable_change:src/commands/migrate/index.js']],
    ['a text file in a migrations directory is not a migration', {}, { 'guide/migrations/upgrade-v2.txt': 'Upgrade notes\n' }, 'medium', ['executable_change:guide/migrations/upgrade-v2.txt']],
    ['an .rst file in a migrations directory is not a migration', {}, { 'guide/migrations/notes.rst': 'Notes\n' }, 'passive', ['non_executable_only']],
    ['a test/ migration is test data', {}, { 'test/migrations/0001.sql': DDL }, 'medium', ['executable_change:test/migrations/0001.sql']],
    ['a spec/ destructive SQL is test data', {}, { 'spec/sql/drop.sql': 'DROP TABLE a;\n' }, 'medium', ['executable_change:spec/sql/drop.sql']],
    ['a tests/ PEM header is test data', {}, { 'tests/keys.py': `K = \"\"\"${PEM}\"\"\"\n` }, 'medium', ['executable_change:tests/keys.py']],
    ['a test/ key file is test data', {}, { 'test/server.key': 'x\n' }, 'medium', ['executable_change:test/server.key']],
    ['.npmrc without a token stays medium', {}, { '.npmrc': 'registry=https://registry.example.com/\n' }, 'medium', ['executable_change:.npmrc']],
    ['a PEM public key header is not private', {}, { 'src/pub.py': 'K = """-----BEGIN PUBLIC KEY-----"""\n' }, 'medium', ['executable_change:src/pub.py']],
    ['a key file in a fixtures directory is test data', {}, { 'tests/fixtures/server.key': 'x\n' }, 'medium', ['executable_change:tests/fixtures/server.key']],
    ['a package.json in a fixtures directory is test data', {}, { 'tests/fixtures/app/package.json': '{}\n' }, 'medium', ['configuration_change:tests/fixtures/app/package.json']],
    ['a package.json under docs is excluded', {}, { 'docs/example/package.json': '{}\n' }, 'medium', ['configuration_change:docs/example/package.json']],
    ['a hooks folder in application source is not a git hook', {}, { 'src/hooks/useThing.ts': 'export const a = 1\n' }, 'medium', ['executable_change:src/hooks/useThing.ts']],
    ['other configuration stays medium', {}, { 'config.toml': 'a = 1\n' }, 'medium', ['configuration_change:config.toml']],
  ]
  for (const [name, base, change, risk, keys] of NEGATIVE) {
    test(name, () => {
      const repo = makeRepo(base)
      applyFiles(repo, change)
      const { json } = assessJson(repo)
      assert.equal(json.risk, risk, JSON.stringify(json.reasons))
      assert.deepEqual(reasonKeys(json.reasons), keys)
    })
  }
})

describe('path predicates', () => {
  test('.git/hooks cannot be committed, so it is checked on the predicate', () => {
    assert.equal(isGitHookPath('.git/hooks/pre-commit'), true)
    assert.equal(isGitHookPath('.git/config'), false)
    assert.equal(isGitHookPath('src/.git'), false)
  })

  test('migration directories are whole path segments', () => {
    assert.equal(isMigrationPath('db/migrate/1.rb'), true)
    assert.equal(isMigrationPath('src/migrations/readme.md'), false)
    assert.equal(isMigrationPath('src/migrate.go'), false)
    assert.equal(isMigrationPath('src/commands/migrate/index.js'), false)
    assert.equal(isMigrationPath('guide/migrations/upgrade-v2.txt'), false)
    assert.equal(isMigrationPath('migrations/0001.sql'), true)
    assert.equal(isMigrationPath('migrations/0003.ts'), true)
    assert.equal(isMigrationPath('db/migrate/001.rb'), true)
    assert.equal(isMigrationPath('src/migrations_helper/a.go'), false)
  })
})
