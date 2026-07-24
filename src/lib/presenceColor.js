// Deterministic per-user avatar color so a person is always the same color
// everywhere in BUDDY. No DB column — derived from the user id.

// 8 stops chosen to read on white AND to carry dark initials.
const AVATAR_COLORS = [
  { bg: '#CECBF6', fg: '#26215C' }, // purple
  { bg: '#9FE1CB', fg: '#04342C' }, // teal
  { bg: '#FAC775', fg: '#412402' }, // amber
  { bg: '#B5D4F4', fg: '#042C53' }, // blue
  { bg: '#F4C0D1', fg: '#4B1528' }, // pink
  { bg: '#F5C4B3', fg: '#4A1B0C' }, // coral
  { bg: '#C0DD97', fg: '#173404' }, // green
  { bg: '#D3D1C7', fg: '#2C2C2A' }, // gray
]

export function avatarColor(userId = '') {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function initials(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
