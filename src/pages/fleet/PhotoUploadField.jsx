import { useState, useRef, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import { useToast } from '../../contexts/ToastContext'

// Photo upload with crop for driver avatars.
// On confirm: crop → downscale to 800px max → JPEG 0.85 → upload → update photo_path
export default function PhotoUploadField({ driverId, currentPhotoPath, onPhotoUpdated }) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [sourceImage, setSourceImage] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null)

  // Load current photo if it exists
  useEffect(() => {
    if (currentPhotoPath) {
      const { data } = supabase.storage.from('driver-avatars').getPublicUrl(currentPhotoPath)
      setCurrentPhotoUrl(data?.publicUrl)
    }
  }, [currentPhotoPath])

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setSourceImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const onCropComplete = (croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }

  const createImage = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.addEventListener('load', () => resolve(image))
      image.addEventListener('error', (err) => reject(err))
      image.setAttribute('crossOrigin', 'anonymous')
      image.src = url
    })

  const getCroppedImg = async () => {
    if (!sourceImage || !croppedAreaPixels) return null

    const image = await createImage(sourceImage)
    const canvas = document.createElement('canvas')
    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height

    canvas.width = croppedAreaPixels.width
    canvas.height = croppedAreaPixels.height

    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      image,
      croppedAreaPixels.x * scaleX,
      croppedAreaPixels.y * scaleY,
      croppedAreaPixels.width * scaleX,
      croppedAreaPixels.height * scaleY,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height
    )

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
    })
  }

  const handleConfirmCrop = async () => {
    setUploading(true)
    try {
      const croppedBlob = await getCroppedImg()
      if (!croppedBlob) throw new Error('Failed to crop image')

      // Downscale if needed (longest side ≤ 800px)
      let finalBlob = croppedBlob
      if (croppedAreaPixels.width > 800 || croppedAreaPixels.height > 800) {
        const image = await createImage(URL.createObjectURL(croppedBlob))
        const canvas = document.createElement('canvas')
        const scale = Math.min(800 / image.width, 800 / image.height)
        canvas.width = image.width * scale
        canvas.height = image.height * scale
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        finalBlob = await new Promise((resolve) => {
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
        })
      }

      // Upload to storage
      const path = `${driverId}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('driver-avatars')
        .upload(path, finalBlob, { upsert: true, contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      // Update drivers.photo_path
      const { error: updateError } = await supabase
        .from('drivers')
        .update({ photo_path: path })
        .eq('id', driverId)

      if (updateError) throw updateError

      toast.success('Photo uploaded successfully')
      setSourceImage(null)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCurrentPhotoUrl(supabase.storage.from('driver-avatars').getPublicUrl(path).data?.publicUrl)
      onPhotoUpdated?.(path)
    } catch (err) {
      console.error('Photo upload failed:', err)
      toast.error('Failed to upload photo', err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleRemovePhoto = async () => {
    if (!currentPhotoPath) return
    setUploading(true)
    try {
      // Delete from storage
      const { error: deleteError } = await supabase.storage
        .from('driver-avatars')
        .remove([currentPhotoPath])
      if (deleteError) throw deleteError

      // Clear photo_path in DB
      const { error: updateError } = await supabase
        .from('drivers')
        .update({ photo_path: null })
        .eq('id', driverId)
      if (updateError) throw updateError

      toast.success('Photo removed')
      setCurrentPhotoUrl(null)
      onPhotoUpdated?.(null)
    } catch (err) {
      console.error('Photo removal failed:', err)
      toast.error('Failed to remove photo', err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-gray-900 dark:text-white">Photo</label>

      {/* Current photo with Replace/Remove actions */}
      {currentPhotoUrl && !sourceImage && (
        <div className="space-y-2">
          <div className="w-24 h-32 rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-700">
            <img src={currentPhotoUrl} alt="Current" className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-orange-600 dark:text-orange-400 hover:underline"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={uploading}
              className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Crop UI */}
      {sourceImage && (
        <div className="space-y-3">
          <div className="relative w-full h-80 bg-gray-900 rounded-lg overflow-hidden">
            <Cropper
              image={sourceImage}
              crop={crop}
              zoom={zoom}
              aspect={3 / 4}
              cropShape="rect"
              showGrid={false}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-gray-600 dark:text-slate-400">Zoom</label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSourceImage(null)}
              disabled={uploading}
              className={`flex-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmCrop}
              disabled={uploading}
              className={`flex-1 px-3 py-2 bg-orange-500 text-white rounded text-sm font-medium hover:bg-orange-600 disabled:opacity-50`}
            >
              {uploading ? 'Uploading…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {/* Initial upload button */}
      {!sourceImage && !currentPhotoUrl && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={`w-full px-3 py-2 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-slate-400 hover:border-orange-500 hover:text-orange-600 disabled:opacity-50 transition-colors`}
        >
          Upload photo
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
