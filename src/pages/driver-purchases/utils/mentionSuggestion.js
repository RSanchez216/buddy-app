import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { supabase } from '../../../lib/supabase'
import MentionList from '../components/MentionList'

// Tiptap suggestion config powering the @-mention popup.
// Pulls active BUDDY users from public.users and filters client-side.
let _userCache = null
async function fetchUsers() {
  if (_userCache) return _userCache
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, status')
    .eq('status', 'active')
    .order('full_name', { ascending: true, nullsFirst: false })
  _userCache = (data || []).filter(u => u.id)
  return _userCache
}

export const mentionSuggestion = {
  items: async ({ query }) => {
    const all = await fetchUsers()
    const q = (query || '').toLowerCase()
    const filtered = !q
      ? all
      : all.filter(u =>
          (u.full_name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q),
        )
    return filtered.slice(0, 8)
  },

  render: () => {
    let component, popup
    return {
      onStart: props => {
        component = new ReactRenderer(MentionList, { props, editor: props.editor })
        if (!props.clientRect) return
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },
      onUpdate(props) {
        component?.updateProps(props)
        if (!props.clientRect) return
        popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup?.[0]?.hide()
          return true
        }
        return component?.ref?.onKeyDown(props) || false
      },
      onExit() {
        popup?.[0]?.destroy()
        component?.destroy()
      },
    }
  },
}
