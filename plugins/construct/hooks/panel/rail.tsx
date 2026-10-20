// Portions adapted from claude-flightdeck (github.com/scasella/claude-flightdeck), MIT License.
//
// MIT License
//
// Copyright (c) 2026 Stephen Casella
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// A connector drawn on the surface's own frame clock: packets travel along it while `active`,
// and it rests as a plain dim line otherwise. Only this region redraws; the pane does not.
import type { ClientModule } from 'claude-code'

type Props = {
  active: boolean
  width: number
  color: string
  dim: string
  /** Cells where a branch drops (┬); the rest of the line is ─. */
  marks: number[]
  /** Draw ┴ instead of ┬ at the marks: a merge into what is below. */
  isMerge: boolean
}

type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 110

const Rail: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }

  const width = Math.max(1, surface.columns || props.width)
  const cells = Array.from({ length: width }, () => '─')
  for (const m of props.marks) if (m >= 0 && m < width) cells[m] = props.isMerge ? '┴' : '┬'

  if (!props.active) {
    return (
      <Box>
        <Text color={props.dim}>{cells.join('')}</Text>
      </Box>
    )
  }

  // Two packets per 24 cells, a bright head and a trailing dot, moving left to right.
  const lit = new Map<number, string>()
  for (let base = 0; base < width + 24; base += 24) {
    const head = (base + ref.phase) % (width + 24)
    if (head < width) lit.set(head, '●')
    if (head - 1 >= 0 && head - 1 < width) lit.set(head - 1, '•')
  }
  // Runs, not cells: consecutive cells of one kind share a Text, a handful of nodes per frame.
  const runs: { text: string; isLit: boolean }[] = []
  cells.forEach((ch, i) => {
    const isLit = lit.has(i)
    const last = runs[runs.length - 1]
    const glyph = lit.get(i) ?? ch
    if (last && last.isLit === isLit) last.text += glyph
    else runs.push({ text: glyph, isLit })
  })
  return (
    <Box>
      {runs.map(r => (
        <Text color={r.isLit ? props.color : props.dim} bold={r.isLit}>
          {r.text}
        </Text>
      ))}
    </Box>
  )
}

export default Rail
