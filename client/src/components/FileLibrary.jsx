import { useState, useEffect, useRef, useCallback } from 'react'
import { PaperclipHorizontal, Trash, PaperPlaneTilt, UploadSimple, FilePdf, Image, File } from '@phosphor-icons/react'
import { getFiles, uploadFile, deleteFile, getCurrentProjectId } from '../api'

function fileIcon(mime) {
  if (!mime) return <File size={18} className="text-zinc-400" />
  if (mime.startsWith('image/')) return <Image size={18} className="text-blue-400" />
  if (mime === 'application/pdf') return <FilePdf size={18} className="text-red-400" />
  return <File size={18} className="text-zinc-400" />
}

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function SendModal({ file, onClose, showToast }) {
  const [phone, setPhone] = useState('')
  const [caption, setCaption] = useState('')
  const [sending, setSending] = useState(false)

  const sendByPhone = async () => {
    if (!phone.trim()) { showToast('Enter a phone number.', true); return }
    setSending(true)
    try {
      const projectId = getCurrentProjectId()
      const r = await fetch(`/api/files/${file.id}/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(projectId ? { 'X-Project-Id': projectId } : {}) },
        body: JSON.stringify({ phone: phone.trim().replace(/\D/g, ''), caption }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      showToast(`Sent "${file.name}" ✓`)
      onClose()
    } catch (e) {
      showToast(e.message || 'Send failed', true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 mb-4">Send "{file.name}"</h2>
        <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Phone number</label>
        <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 966501234567"
          className="w-full h-9 px-3 mb-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
        <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Caption (optional)</label>
        <input type="text" value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. Here's my CV"
          className="w-full h-9 px-3 mb-4 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
          <button onClick={sendByPhone} disabled={sending} className="flex-1 h-9 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
            <PaperPlaneTilt size={13} weight="bold" /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FileLibrary({ showToast, user }) {
  const [files, setFiles] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [sendTarget, setSendTarget] = useState(null)
  const inputRef = useRef()

  const load = useCallback(() => getFiles().then(d => setFiles(d.items)).catch(() => setFiles([])), [])
  useEffect(() => { load() }, [load])

  const onFileChange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { showToast('Max file size is 25 MB', true); return }
    setUploading(true)
    try {
      await uploadFile(f, f.name)
      showToast(`"${f.name}" uploaded ✓`)
      load()
    } catch (err) {
      showToast(err.message || 'Upload failed', true)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const remove = async (file) => {
    if (!confirm(`Delete "${file.name}"?`)) return
    try {
      await deleteFile(file.id)
      showToast('Deleted')
      setFiles(prev => prev.filter(f => f.id !== file.id))
    } catch (e) {
      showToast(e.message || 'Delete failed', true)
    }
  }

  return (
    <div className="p-5 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <PaperclipHorizontal size={20} className="text-zinc-500 dark:text-zinc-400" />
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">File Library</h1>
          {files && <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-1">{files.length} file{files.length !== 1 ? 's' : ''}</span>}
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
        >
          <UploadSimple size={13} weight="bold" /> {uploading ? 'Uploading…' : 'Upload file'}
        </button>
        <input ref={inputRef} type="file" accept="*/*" className="hidden" onChange={onFileChange} />
      </div>

      {files === null && (
        <div className="text-xs text-zinc-400 dark:text-zinc-500 py-8 text-center">Loading…</div>
      )}

      {files?.length === 0 && (
        <div className="text-xs text-zinc-400 dark:text-zinc-500 py-16 text-center flex flex-col items-center gap-3">
          <PaperclipHorizontal size={32} className="opacity-30" />
          <span>No files yet — upload a CV, price list or brochure to send directly via WhatsApp.</span>
        </div>
      )}

      {files?.length > 0 && (
        <div className="space-y-2">
          {files.map(file => (
            <div key={file.id} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
              <div className="shrink-0">{fileIcon(file.mime_type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{file.name}</p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{fmt(file.size)} · {file.mime_type}</p>
              </div>
              <button
                onClick={() => setSendTarget(file)}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-medium border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <PaperPlaneTilt size={12} weight="bold" /> Send
              </button>
              <button
                onClick={() => remove(file)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {sendTarget && <SendModal file={sendTarget} onClose={() => setSendTarget(null)} showToast={showToast} />}
    </div>
  )
}
