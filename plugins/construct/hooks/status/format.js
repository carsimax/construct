// Pure formatting shared with the panel: the element-tree text leaf and the
// review-state colors. No `$` calls live here, so these run (and test) in isolation.

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

// A Text leaf; props with no value are left out, since a prop must be plain data.
export function text(content, { color, dim, bold } = {}) {
  const props = {}
  if (color) props.color = color
  if (dim) props.dimColor = true
  if (bold) props.bold = true
  return { type: 'Text', props, children: [content] }
}

export const STATE_COLOR = { 'review due': 'error', reviewed: 'success', clear: undefined }
