import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileCsv, CheckCircle, XCircle, Spinner } from '@phosphor-icons/react'
import { importPreview, importConfirm, getImportLogs } from '../api'

export default function Import({ showToast, refresh, goView }) {
  const [previewRows, setPreviewRows] = useState([])
  const [dragover, setDragover] = useState(false)
  const [skipDupes, setSkipDupes] = useState(true)
  const [updateMode, setUpdateMode] = useState(false)
  const [checkWhatsApp, setCheckWhatsApp] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importLogs, setImportLogs] = useState([])
  const [fileName, setFileName] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    getImportLogs().then(setImportLogs).catch(() => {})
  }, [])

  const handleFile = async (file) => {
    if (!file) return
    setFileName(file.name)
    try {
      const result = await importPreview(file)
      if (result.error) { showToast(result.error, true); return }
      setPreviewRows(result.rows || [])
      showToast(`Preview: ${result.rows?.length || 0} rows detected.`)
    } catch { showToast('Failed to read file.', true) }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragover(false)
    handleFile(e.dataTransfer.files[0])
  }

  const onDragOver = (e) => { e.preventDefault(); setDragover(true) }
  const onDragLeave = () => setDragover(false)

  const handleImport = async () => {
    if (!previewRows.length) { showToast('No data to import.', true); return }
    setImporting(true)
    try {
      const result = await importConfirm(previewRows, skipDupes, updateMode, checkWhatsApp, fileName)
      showToast(`Imported ${result.added} leads.${result.waResults ? ' WhatsApp check complete.' : ''}`)
      setPreviewRows([])
      setFileName('')
      const logs = await getImportLogs()
      setImportLogs(logs)
      refresh()
      goView('leads')
    } catch { showToast('Import failed.', true) }
    setImporting(false)
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Import Leads</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Upload a CSV file exported from Google Maps scraper tools.</p>
      </div>

      <motion.div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={() => fileRef.current?.click()}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors mb-6 ${
          dragover
            ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/50 hover:border-zinc-400 dark:hover:border-zinc-600'
        }`}
      >
        <Upload size={36} className={`mx-auto mb-4 ${dragover ? 'text-emerald-500' : 'text-zinc-300 dark:text-zinc-600'}`} />
        <p className="text-zinc-900 dark:text-zinc-100 font-medium mb-1">Click or drag and drop to upload</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Supports .csv files</p>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]) }} />
      </motion.div>

      {previewRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        >
          <div className="overflow-x-auto mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">#</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Phone</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Links</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Email</th>
                  <th className="text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider">Review</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 300).map((r, i) => (
                  <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="py-2.5 px-4 text-zinc-400 dark:text-zinc-500 text-xs">{i + 1}</td>
                    <td className="py-2.5 px-4 text-zinc-900 dark:text-zinc-100 text-xs">{r.name || <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-2.5 px-4 text-zinc-500 dark:text-zinc-400 text-xs">{r.phone || <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-2.5 px-4">
                      {r.phone ? (
                        r.phone_valid
                          ? <CheckCircle size={12} weight="fill" className="text-emerald-500" />
                          : <XCircle size={12} weight="fill" className="text-red-500" />
                      ) : <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}
                    </td>
                    <td className="py-2.5 px-4 text-zinc-500 dark:text-zinc-400 text-xs">{r.hasLink ? 'Y' : <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-2.5 px-4 text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-[120px]">{r.email || <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-2.5 px-4">
                      {r.maybeClosed
                        ? <span className="inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">MC</span>
                        : <span className="text-zinc-400 dark:text-zinc-600">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewRows.length > 300 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 py-3 px-4">Showing first 300 rows. {previewRows.length - 300} more rows will be imported.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mb-6">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Import options</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={skipDupes} onChange={e => setSkipDupes(e.target.checked)} className="accent-emerald-500 w-4 h-4 rounded" />
                Skip duplicates (match by name + phone)
              </label>
              <label className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={updateMode} onChange={e => setUpdateMode(e.target.checked)} className="accent-emerald-500 w-4 h-4 rounded" />
                Update existing leads (overwrite fields)
              </label>
              <label className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={checkWhatsApp} onChange={e => setCheckWhatsApp(e.target.checked)} className="accent-emerald-500 w-4 h-4 rounded" />
                Check WhatsApp registration (slower import)
              </label>
            </div>
          </div>

          <button onClick={handleImport}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <FileCsv size={14} weight="bold" />
            Confirm import ({previewRows.length} rows)
          </button>
        </motion.div>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">How auto-sorting works</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-[65ch]">
          When you import, leads are automatically checked against existing contacts. If a lead has the same name and phone as one already in your database, it'll be skipped (or updated if you choose). Phone numbers are validated client-side. If you enable WhatsApp checking, each number will be verified against WhatsApp after import.
        </p>
      </div>

      {importLogs.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mt-6">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Import History</h2>
          <div className="space-y-2">
            {importLogs.map(log => (
              <div key={log.id} className="flex items-center justify-between py-2.5 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0">
                <div>
                  <span className="text-zinc-900 dark:text-zinc-100 text-xs font-medium">{log.filename || 'CSV import'}</span>
                  <span className="text-zinc-400 dark:text-zinc-500 text-[11px] ml-3">
                    {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{log.added} added</span>
                  {log.skipped > 0 && <span className="text-amber-600 dark:text-amber-400">{log.skipped} skipped</span>}
                  {log.updated > 0 && <span className="text-blue-600 dark:text-blue-400">{log.updated} updated</span>}
                  <span className="text-zinc-400 dark:text-zinc-500">{log.rows_total} rows</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {importing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 px-10 py-8 flex flex-col items-center gap-4 shadow-xl"
          >
            <Spinner size={32} className="text-emerald-500 animate-spin" />
            <p className="text-zinc-900 dark:text-zinc-100 font-semibold">Importing...</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking WhatsApp may take a while.</p>
          </motion.div>
        </div>
      )}
    </div>
  )
}
