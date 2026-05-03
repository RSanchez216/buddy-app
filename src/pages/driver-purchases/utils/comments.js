// Helpers that bridge Tiptap's ProseMirror JSON ↔ what the DB stores.
//
// We keep three surfaces in sync at write time:
//   • body_json — the full Tiptap doc (rich text), stored verbatim
//   • body_text — denormalized plain string for search & feed fallback
//   • mentioned_user_ids — uuid[] extracted from mention nodes
//
// At read time, the renderer walks body_json directly so links, marks,
// and mention chips survive intact.

// Walk the Tiptap doc and concatenate all text, replacing mention nodes
// with @Name so the plain-text mirror reads naturally in notifications,
// search results, and bell previews.
export function extractText(doc) {
  if (!doc) return ''
  const parts = []
  walk(doc, node => {
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text)
    else if (node.type === 'mention') {
      const label = node.attrs?.label || node.attrs?.id || ''
      parts.push('@' + label)
    } else if (node.type === 'hardBreak') parts.push('\n')
  })
  // Join paragraphs/lists with newlines for legibility
  return parts.join('').replace(/ /g, ' ').trim()
}

// Pull every mention.attrs.id out of the doc, dedupe, drop falsy.
export function extractMentions(doc) {
  if (!doc) return []
  const ids = new Set()
  walk(doc, node => {
    if (node.type === 'mention' && node.attrs?.id) ids.add(node.attrs.id)
  })
  return Array.from(ids)
}

// Empty-content guard — the editor leaves a stub doc even when "empty".
export function isEmptyDoc(doc) {
  return !extractText(doc) && !extractMentions(doc).length
}

function walk(node, visit) {
  if (!node) return
  visit(node)
  if (Array.isArray(node.content)) for (const child of node.content) walk(child, visit)
}
