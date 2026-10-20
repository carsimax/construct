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
// A running agent's clock, ticking on the surface's frame clock so the pane need not redraw.
// `since` and `now` come from the hooks module's $.clock; between redraws it adds its own ticks.
import type { ClientModule } from 'claude-code'

type Props = { since: number; now: number; endAt: number | null; color: string }
type Ref = { base: number; ticks: number; lastNow: number; isRunning: boolean }
type State = { ref: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

const Elapsed: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: -1, isRunning: true }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: restart the local count from it.
    ref.lastNow = props.now
    ref.base = (props.endAt ?? props.now) - props.since
    ref.ticks = 0
  }
  ref.isRunning = props.endAt === null
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      if (ref.isRunning) {
        ref.ticks += 1
        surface.setState({ ref })
      }
    })
  }
  return <Text color={props.color}>{fmt(ref.base + ref.ticks * 1000)}</Text>
}

export default Elapsed
