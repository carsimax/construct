// S3: overlap is decided per segment; a literal difference wins over a later opaque segment.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { surfacesOverlap } from '../../plugins/construct/hooks/scripts/delegation-admission.mjs'

const ROUTE = 'apps/web/src/app/(dashboard)/portafolios/[id]/_components/**'

describe('per-segment overlap', () => {
  test('the reported pair differs at the second segment and does not overlap', () => {
    const api = 'apps/api/src/main/java/com/saci/api/modules/portafolios/adapters/in/web/PortafolioController.java'
    assert.equal(surfacesOverlap(api, ROUTE), false)
    assert.equal(surfacesOverlap(ROUTE, api), false)
  })
  test('two writers on the same route folder overlap', () => {
    assert.equal(surfacesOverlap(ROUTE, ROUTE), true)
  })
  test('parentheses are literal: different route groups do not overlap', () => {
    assert.equal(surfacesOverlap('(dashboard)/a', '(marketing)/a'), false)
    assert.equal(surfacesOverlap('(dashboard)/a', '(dashboard)/a'), true)
  })
  test('an extglob still overlaps everything from its segment', () => {
    assert.equal(surfacesOverlap('@(a|b)/x', 'c/y'), true)
    assert.equal(surfacesOverlap('src/!(a)/x', 'src/b/y'), true)
    assert.equal(surfacesOverlap('src/!(a)/x', 'lib/b/y'), false)
  })
  test('a bracket segment matches only at its own position', () => {
    assert.equal(surfacesOverlap('[id]/a.ts', '[id]/b.ts'), false)
    assert.equal(surfacesOverlap('[id]/a.ts', '[id]/a.ts'), true)
    assert.equal(surfacesOverlap('src/[ab].js', 'src/c.js'), true)
    assert.equal(surfacesOverlap('src/[ab].js', 'docs/c.js'), false)
  })
  test('backslash and unbalanced braces stay conservative at their segment only', () => {
    assert.equal(surfacesOverlap('src/a\\b/x', 'src/z/x'), true)
    assert.equal(surfacesOverlap('src/{a/x', 'src/z/y'), false)
    assert.equal(surfacesOverlap('src/{a/x', 'src/z/x'), true)
    assert.equal(surfacesOverlap('src/{a/x', 'lib/z/x'), false)
  })
})
