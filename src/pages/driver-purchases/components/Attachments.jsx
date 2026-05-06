import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import ImageLightbox from './ImageLightbox'

const BUCKET = 'comment-attachments'

// Module-scoped cache so signed URLs survive component remounts (e.g.
// when a comment edit toggles a CommentItem branch). Entries expire on
// their own (1h server-side) and we re-resolve if missing.
const URL_CACHE = new Map()              // file_path → { url, exp }

function isImage(att) {
  return typeof att.content_type === 'string' && att.content_type.startsWith('image/')
}

async function resolveUrl(file_path) {
  const cached = URL_CACHE.get(file_path)
  if (cached && cached.exp > Date.now()) return cached.url
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(file_path, 3600)
  if (!data?.signedUrl) return null
  URL_CACHE.set(file_path, { url: data.signedUrl, exp: Date.now() + 3300 * 1000 })
  return data.signedUrl
}

// Renders all attachments for a comment row. Images go in a tight grid
// of thumbnails (click → lightbox); non-images render as the existing
// downloadable pills below the images. If the image fails to load
// (broken URL, 403, missing object), falls back to the pill UI for
// just that one attachment.
export default function Attachments({ items = [] }) {
  const [lightboxSrc, setLightboxSrc] = useState(null)

  const { images, others } = useMemo(() => {
    const images = [], others = []
    for (const a of items) (isImage(a) ? images : others).push(a)
    return { images, others }
  }, [items])

  if (items.length === 0) return null

  const gridCols = images.length === 1 ? 1 : images.length === 2 ? 2 : 3

  return (
    <>
      {images.length > 0 && (
        <div
          className="mt-1.5 grid gap-2 max-w-md"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {images.map(att => (
            <ImageThumb key={att.id} att={att} onOpen={setLightboxSrc} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {others.map(att => <Pill key={att.id} att={att} />)}
        </div>
      )}

      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  )
}

function ImageThumb({ att, onOpen }) {
  const [url, setUrl] = useState(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    resolveUrl(att.file_path).then(u => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [att.file_path])

  if (errored) return <Pill att={att} />

  return (
    <button
      onClick={() => url && onOpen(url)}
      className="block relative aspect-[4/3] rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5 hover:ring-2 hover:ring-cyan-500/40 transition-all"
      title={att.file_name}
    >
      {url ? (
        <img
          src={url}
          alt={att.file_name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-cyan-500" />
        </div>
      )}
    </button>
  )
}

function Pill({ att }) {
  async function download() {
    const url = await resolveUrl(att.file_path)
    if (url) window.open(url, '_blank')
  }
  return (
    <button
      onClick={download}
      className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700/60 max-w-full"
      title="Download"
    >
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate">{att.file_name}</span>
    </button>
  )
}
