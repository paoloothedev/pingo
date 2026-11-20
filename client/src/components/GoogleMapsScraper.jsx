import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MagnifyingGlass, Trash, Check, ArrowClockwise, DownloadSimple, MapPin, CaretDown, CaretUp, FileCsv, Plus } from '@phosphor-icons/react'
import { scrapeGmaps, getGmapsJobs, getGmapsJob, deleteGmapsJob, importGmapsJob, downloadGmapsCSV } from '../api'

const PRESET_LOCATIONS = [
  { name: 'United Kingdom', geo: '51.5074,-0.1278', zoom: 6, lang: 'en' },
  { name: 'London, UK', geo: '51.5074,-0.1278', zoom: 12, lang: 'en' },
  { name: 'Manchester, UK', geo: '53.4808,-2.2426', zoom: 12, lang: 'en' },
  { name: 'Birmingham, UK', geo: '52.4862,-1.8904', zoom: 12, lang: 'en' },
  { name: 'Edinburgh, UK', geo: '55.9533,-3.1883', zoom: 12, lang: 'en' },
  { name: 'New York, USA', geo: '40.7128,-74.0060', zoom: 12, lang: 'en' },
  { name: 'Los Angeles, USA', geo: '34.0522,-118.2437', zoom: 12, lang: 'en' },
  { name: 'Berlin, Germany', geo: '52.5200,13.4050', zoom: 12, lang: 'de' },
  { name: 'Munich, Germany', geo: '48.1351,11.5820', zoom: 12, lang: 'de' },
  { name: 'Paris, France', geo: '48.8566,2.3522', zoom: 12, lang: 'fr' },
  { name: 'Dubai, UAE', geo: '25.2048,55.2708', zoom: 12, lang: 'en' },
  { name: 'Cairo, Egypt', geo: '30.0444,31.2357', zoom: 12, lang: 'ar' },
  { name: 'Alexandria, Egypt', geo: '31.2001,29.9187', zoom: 12, lang: 'ar' },
  { name: 'Istanbul, Turkey', geo: '41.0082,28.9784', zoom: 12, lang: 'tr' },
  { name: 'Riyadh, Saudi Arabia', geo: '24.7136,46.6753', zoom: 12, lang: 'ar' },
  { name: 'Jeddah, Saudi Arabia', geo: '21.4858,39.1925', zoom: 12, lang: 'ar' },
  { name: 'Toronto, Canada', geo: '43.6532,-79.3832', zoom: 12, lang: 'en' },
  { name: 'Sydney, Australia', geo: '-33.8688,151.2093', zoom: 12, lang: 'en' },
  { name: 'No Location (Auto)', geo: '', zoom: 0, lang: 'en' },
]

const QUICK_KEYWORDS = [
  'restaurants', 'dentists', 'gyms', 'hotels', 'cafes', 'bakeries',
  'beauty salons', 'auto repair', 'plumbers', 'electricians',
  'lawyers', 'real estate agents', 'fitness centers', 'spas',
]

export default function GoogleMapsScraper({ showToast, refresh, goView }) {
  const [jobName, setJobName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [geoInput, setGeoInput] = useState('51.5074,-0.1278')
  const [zoom, setZoom] = useState(12)
  const [depth, setDepth] = useState(10)
  const [lang, setLang] = useState('en')
  const [scraping, setScraping] = useState(false)
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobDetail, setJobDetail] = useState(null)
  const [selectedResults, setSelectedResults] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [checkWA, setCheckWA] = useState(false)
  const [autoImport, setAutoImport] = useState(true)

  const loadJobs = useCallback(async () => {
    try {
      const data = await getGmapsJobs()
      setJobs(data)
    } catch {}
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  useEffect(() => {
    if (!selectedJob) return
    const interval = setInterval(async () => {
      try {
        const detail = await getGmapsJob(selectedJob)
        setJobDetail(detail)
        // An auto-import runs right after the scrape finishes: keep polling until it's in
        const importing = detail.options?.autoImport && detail.result_count > 0 && !detail.imported && !detail.import_error
        if (detail.status === 'failed' || (detail.status === 'completed' && !importing)) {
          clearInterval(interval)
          loadJobs()
          if (detail.imported && refresh) refresh()
        }
      } catch {}
    }, 2000)
    return () => clearInterval(interval)
  }, [selectedJob, loadJobs])

  const handleScrape = async () => {
    const rawLines = keywords.split('\n').map(q => q.trim()).filter(Boolean)
    if (!rawLines.length) { showToast('Enter at least one keyword.', true); return }

    const queryList = rawLines

    setScraping(true)
    try {
      const data = {
        name: jobName.trim() || queryList[0],
        queries: queryList,
        depth,
        lang,
        geo: geoInput.trim(),
        zoom,
        autoImport,
        checkWhatsApp: autoImport && checkWA,
      }
      const res = await scrapeGmaps(data)
      setSelectedJob(res.job_id)
      setJobDetail({ id: res.job_id, status: 'pending', name: data.name, queries: data.queries })
      setJobName('')
      showToast(`Scrape job started: ${data.name}`)
      loadJobs()
    } catch (err) {
      showToast(err.message || 'Failed to start scrape.', true)
    }
    setScraping(false)
  }

  const addQuickKeyword = (kw) => {
    setKeywords(k => k ? k.trim() + '\n' + kw : kw)
  }

  const handleDownload = async (id) => {
    try {
      await downloadGmapsCSV(id)
      showToast('CSV downloaded.')
    } catch (err) {
      showToast(err.message || 'Failed to download.', true)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteGmapsJob(id)
      if (selectedJob === id) { setSelectedJob(null); setJobDetail(null) }
      showToast('Job deleted.')
      loadJobs()
    } catch (err) {
      showToast(err.message || 'Failed to delete.', true)
    }
  }

  const handleImport = async () => {
    if (!jobDetail || !jobDetail.results?.length) return
    setImporting(true)
    try {
      const indices = selectedResults.size > 0 ? [...selectedResults] : undefined
      const res = await importGmapsJob(selectedJob, { skipDupes: true, selectedIndices: indices, checkWhatsApp: checkWA })
      let msg = `Imported ${res.added} leads (${res.skipped} skipped).`
      if (res.waResults) {
        const notWA = res.waResults.filter(r => !r.exists).length
        if (notWA > 0) msg += ` ${notWA} not on WhatsApp.`
      }
      showToast(msg)
      if (refresh) refresh()
      setSelectedResults(new Set())
      setJobDetail(await getGmapsJob(selectedJob))
    } catch (err) {
      showToast(err.message || 'Failed to import.', true)
    }
    setImporting(false)
  }

  const toggleResult = (idx) => {
    const next = new Set(selectedResults)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedResults(next)
  }

  const toggleAllResults = () => {
    if (!jobDetail?.results) return
    if (selectedResults.size === jobDetail.results.length) {
      setSelectedResults(new Set())
    } else {
      setSelectedResults(new Set(jobDetail.results.map((_, i) => i)))
    }
  }

  const results = jobDetail?.results || []
  const queryCount = keywords.split('\n').filter(q => q.trim()).length

  return (
    <div className="max-w-[1400px] mx-auto">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-1">Google Maps Scraper</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Search Google Maps by keywords and import businesses as leads.</p>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mb-6">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">New Scrape Job</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Job Name</label>
            <input type="text" value={jobName} onChange={e => setJobName(e.target.value)}
              placeholder="e.g. London Restaurants, Dubai Hotels..."
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
                <MapPin size={10} className="inline mr-1" /> Coordinates (lat,lon)
              </label>
              <input type="text" value={geoInput} onChange={e => setGeoInput(e.target.value)}
                placeholder="51.5074,-0.1278"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 font-mono placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40" />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {PRESET_LOCATIONS.map(p => (
                  <button key={p.name} onClick={() => { setGeoInput(p.geo); setZoom(p.zoom); if (p.lang) setLang(p.lang) }}
                    className={`px-2 h-5 rounded text-[9px] font-medium transition-colors ${
                      geoInput === p.geo
                        ? 'bg-emerald-500 text-white'
                        : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                    }`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Zoom</label>
              <div className="flex items-center gap-2">
                <input type="range" min="1" max="21" value={zoom} onChange={e => setZoom(parseInt(e.target.value))}
                  className="flex-1 accent-emerald-500" />
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 w-6 text-right">{zoom}</span>
              </div>
              <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-1">1=world, 6=country, 12=city, 15=street</p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Quick Keywords</label>
              <div className="flex flex-wrap gap-1">
                {QUICK_KEYWORDS.map(kw => (
                  <button key={kw} onClick={() => addQuickKeyword(kw)}
                    className="px-2 h-6 rounded text-[10px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors whitespace-nowrap">
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Keywords (one per line)</label>
            <textarea value={keywords} onChange={e => setKeywords(e.target.value)} rows={4}
              placeholder={"restaurants\ndentists\ngyms\nhotels"}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors font-mono" />
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
              {queryCount > 0 ? `${queryCount} keyword${queryCount > 1 ? 's' : ''} will be scraped` : 'Enter keywords to search'}
              {geoInput.trim() && <span className="text-emerald-600 dark:text-emerald-400 ml-1">@ {geoInput} zoom:{zoom}</span>}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <label className="flex items-center gap-1.5">
              Depth:
              <input type="range" min="3" max="20" value={depth} onChange={e => setDepth(parseInt(e.target.value))}
                className="w-24 accent-emerald-500" />
              <span className="font-mono text-zinc-700 dark:text-zinc-300 w-6 text-right">{depth}</span>
            </label>
            <label className="flex items-center gap-1.5">
              Language:
              <select value={lang} onChange={e => setLang(e.target.value)}
                className="h-7 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none">
                <option value="en">English</option>
                <option value="de">German</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="ar">Arabic</option>
                <option value="pt">Portuguese</option>
                <option value="tr">Turkish</option>
                <option value="it">Italian</option>
                <option value="nl">Dutch</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-700 dark:text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={autoImport} onChange={e => setAutoImport(e.target.checked)} className="accent-emerald-500" />
              Add results to Contacts automatically when done
            </label>
            {autoImport && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={checkWA} onChange={e => setCheckWA(e.target.checked)} className="accent-emerald-500" />
                Check who is on WhatsApp
              </label>
            )}
          </div>

          <button onClick={handleScrape} disabled={scraping || !keywords.trim()}
            className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
            {scraping ? <ArrowClockwise size={14} className="animate-spin" /> : <MagnifyingGlass size={14} weight="bold" />}
            {scraping ? 'Starting...' : `Scrape${queryCount > 0 ? ` ${queryCount} Keywords` : ''}`}
          </button>
        </div>
      </motion.div>

      {selectedJob && jobDetail && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {jobDetail.name || jobDetail.queries?.[0] || 'Scrape Results'}
              </h2>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                {jobDetail.status === 'pending' && 'Queued — runs after the jobs ahead of it.'}
                {jobDetail.status === 'running' && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {jobDetail.progress?.message || jobDetail.current_query || 'Scraping...'}
                  </span>
                )}
                {jobDetail.status === 'completed' && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {jobDetail.result_count} records found
                    {jobDetail.queries?.length > 1 && ` from ${jobDetail.queries.length} keywords`}
                  </span>
                )}
                {jobDetail.status === 'failed' && <span className="text-red-500">Failed: {jobDetail.error}</span>}
                {jobDetail.imported && (
                  <span className="text-zinc-600 dark:text-zinc-300"> · {jobDetail.imported.added} added to Contacts ({jobDetail.imported.skipped} duplicates skipped)</span>
                )}
                {jobDetail.import_error && <span className="text-red-500"> · Import failed: {jobDetail.import_error}</span>}
              </p>
              {jobDetail.query_errors?.length > 0 && jobDetail.status === 'completed' && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                  {jobDetail.query_errors.length} keyword{jobDetail.query_errors.length > 1 ? 's' : ''} failed: {jobDetail.query_errors.map(q => q.query).join(', ')}
                </p>
              )}
              {jobDetail.queries?.length > 1 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {jobDetail.queries.map((q, i) => (
                    <span key={i} className="inline-block px-2 py-0.5 rounded text-[9px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">{q}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {jobDetail.status === 'completed' && jobDetail.result_count > 0 && (
                <>
                  <button onClick={() => handleDownload(selectedJob)}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
                    <FileCsv size={12} />
                    Download CSV
                  </button>
                  {jobDetail.imported && goView && (
                    <button onClick={() => goView('leads')}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                      Open Contacts
                    </button>
                  )}
                  <button onClick={handleImport} disabled={importing}
                    className="inline-flex items-center gap-1.5 px-4 h-8 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
                    <DownloadSimple size={12} />
                    {importing ? 'Importing...' : `${jobDetail.imported ? 'Import again' : 'Import'}${selectedResults.size > 0 ? ` (${selectedResults.size})` : ' All'}`}
                  </button>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
                    <input type="checkbox" checked={checkWA} onChange={e => setCheckWA(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-emerald-500 focus:ring-emerald-500/40" />
                    Check WhatsApp
                  </label>
                </>
              )}
              <button onClick={() => { setSelectedJob(null); setJobDetail(null) }}
                className="inline-flex items-center px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
                Close
              </button>
            </div>
          </div>

          {(jobDetail.status === 'pending' || jobDetail.status === 'running') && (
            <div className="p-8 flex flex-col items-center justify-center">
              <ArrowClockwise size={32} className="text-emerald-500 animate-spin mb-3" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{jobDetail.progress?.message || 'Starting...'}</p>
            </div>
          )}

          {jobDetail.status === 'completed' && results.length > 0 && (
            <div className="overflow-x-auto">
              <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
                <button onClick={toggleAllResults}
                  className="inline-flex items-center gap-1 px-2.5 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <Check size={10} />
                  {selectedResults.size === results.length ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{selectedResults.size} selected</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className="w-10 py-2.5 px-3"></th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Category</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Phone</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Website</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Rating</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      onClick={() => toggleResult(i)}>
                      <td className="py-2.5 px-3">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedResults.has(i) ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300 dark:border-zinc-600'
                        }`}>
                          {selectedResults.has(i) && <Check size={10} className="text-white" weight="bold" />}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{r.title || r.name || '-'}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        {r.category && <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{r.category}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-zinc-600 dark:text-zinc-400 font-mono">{r.phone || '-'}</td>
                      <td className="py-2.5 px-3 text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">{r.website || r.web_site || '-'}</td>
                      <td className="py-2.5 px-3">
                        {r.review_rating > 0 && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                            {r.review_rating.toFixed(1)} ({r.review_count})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[250px]">{r.address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scrape Jobs</h2>
          <button onClick={loadJobs}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
            <ArrowClockwise size={11} /> Refresh
          </button>
        </div>
        {jobs.length === 0 ? (
          <div className="p-8 text-center">
            <MagnifyingGlass size={32} className="text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">No scrape jobs yet. Search above to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {jobs.map(job => (
              <div key={job.id} className={`flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer ${
                selectedJob === job.id ? 'bg-emerald-50 dark:bg-emerald-900/10' : ''
              }`} onClick={() => { setSelectedJob(job.id); setJobDetail(null) }}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  job.status === 'completed' ? 'bg-emerald-500' :
                  job.status === 'running' ? 'bg-amber-500 animate-pulse' :
                  job.status === 'failed' ? 'bg-red-500' : 'bg-zinc-300 dark:bg-zinc-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate block">{job.name || job.queries?.[0]}</span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {job.status}
                    {job.result_count > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-medium"> · {job.result_count} records</span>}
                    {job.imported && <span> · {job.imported.added} in Contacts</span>}
                    {job.queries?.length > 1 && <span className="text-zinc-400"> · {job.queries.length} keywords</span>}
                    {job.status === 'failed' && job.error && <span className="text-red-500"> · {job.error}</span>}
                  </span>
                </div>
                {job.status === 'completed' && job.result_count > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); handleDownload(job.id) }}
                    className="p-1.5 rounded text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors shrink-0" title="Download CSV">
                    <FileCsv size={14} />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleDelete(job.id) }}
                  className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0">
                  <Trash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
