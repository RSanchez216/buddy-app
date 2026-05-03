// Minimal renderer for our Tiptap doc shape — paragraphs, lists, marks
// (bold/italic/link), and mention chips. We render a small subset of
// nodes/marks intentionally, so unexpected content from a future editor
// version is rendered as plain text rather than crashing.

export default function CommentBody({ doc, fallbackText, currentUserId }) {
  if (!doc || doc.type !== 'doc') {
    return <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{fallbackText || ''}</p>
  }
  return <div className="comment-body text-sm text-gray-700 dark:text-slate-300 break-words">{renderChildren(doc.content, currentUserId)}</div>
}

function renderChildren(nodes, currentUserId) {
  if (!Array.isArray(nodes)) return null
  return nodes.map((n, i) => renderNode(n, i, currentUserId))
}

function renderNode(node, key, currentUserId) {
  switch (node.type) {
    case 'paragraph':
      return <p key={key} className="my-1 first:mt-0 last:mb-0">{renderChildren(node.content, currentUserId)}</p>
    case 'bulletList':
      return <ul key={key} className="list-disc pl-5 my-1">{renderChildren(node.content, currentUserId)}</ul>
    case 'orderedList':
      return <ol key={key} className="list-decimal pl-5 my-1">{renderChildren(node.content, currentUserId)}</ol>
    case 'listItem':
      return <li key={key}>{renderChildren(node.content, currentUserId)}</li>
    case 'hardBreak':
      return <br key={key} />
    case 'mention': {
      const isMe = node.attrs?.id && node.attrs.id === currentUserId
      const cls = isMe
        ? 'inline-flex items-center px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 text-xs font-medium'
        : 'inline-flex items-center px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-xs font-medium'
      return <span key={key} className={cls}>@{node.attrs?.label || node.attrs?.id}</span>
    }
    case 'text':
      return renderText(node, key)
    default:
      // Unknown node — render its inline text content if any
      return <span key={key}>{renderChildren(node.content, currentUserId)}</span>
  }
}

function renderText(node, key) {
  let el = node.text
  for (const mark of (node.marks || [])) {
    if (mark.type === 'bold') el = <strong key={`b${key}`}>{el}</strong>
    else if (mark.type === 'italic') el = <em key={`i${key}`}>{el}</em>
    else if (mark.type === 'code') el = <code key={`c${key}`} className="px-1 rounded bg-gray-100 dark:bg-white/10 font-mono text-[12px]">{el}</code>
    else if (mark.type === 'link' && mark.attrs?.href) {
      el = <a key={`l${key}`} href={mark.attrs.href} target="_blank" rel="noreferrer" className="text-cyan-600 dark:text-cyan-400 underline">{el}</a>
    }
  }
  return <span key={key}>{el}</span>
}
