// S2 drift guard: a sink or extension list in lib/assess that names some
// JavaScript/TypeScript extensions must name all of them.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DANGEROUS_SINK_CATALOG, isCommentOnlySourceLine } from '../../plugins/construct/lib/assess/sinks.mjs'
import { JS_TS_EXTENSIONS, SEMANTIC_SOURCE_EXTENSIONS } from '../../plugins/construct/lib/assess/signals.mjs'

const present = (has) => JS_TS_EXTENSIONS.filter(has)

describe('JS/TS extension family', () => {
  test('the shared constant holds the eight extensions', () => {
    assert.deepEqual([...JS_TS_EXTENSIONS].sort(), ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
  })

  test('every sink names all of the family or none of it', () => {
    for (const entry of DANGEROUS_SINK_CATALOG) {
      const named = present((ext) => entry.extensions.includes(` ${ext} `))
      assert.ok(named.length === 0 || named.length === JS_TS_EXTENSIONS.length, `${entry.name} names only ${named.join(' ')}`)
    }
  })

  test('the semantic source set names all of the family', () => {
    assert.deepEqual(present((ext) => SEMANTIC_SOURCE_EXTENSIONS.has(ext)), [...JS_TS_EXTENSIONS])
  })

  test('slash comment syntax covers all of the family', () => {
    assert.deepEqual(present((ext) => isCommentOnlySourceLine(`src/a${ext}`, '// note')), [...JS_TS_EXTENSIONS])
  })
})
