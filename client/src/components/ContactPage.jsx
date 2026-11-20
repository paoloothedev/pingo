import { useState, useEffect } from 'react'
import { PencilSimple, Plus, Phone, WhatsappLogo, EnvelopeSimple, Buildings, Copy, Check, CalendarBlank, Prohibit } from '@phosphor-icons/react'
import { getContact, getCustomFields, getProjectMembers, getPipelines, updateLead, openChat } from '../api'
import { copyText } from '../clipboard'
import { LIFECYCLE } from '../lifecycle'
import { formatDate } from '../format'
import { can, canI } from '../permissions'
import DealModal from './DealModal'
import WhatsAppSend from './WhatsAppSend'
import { BackLink, Panel, FieldRow, CustomFieldRows, ExternalLink, DealList } from './RecordParts'

const btn = 'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'

export default function ContactPage({ id, user, stages, refreshId, showToast, goView, openLeadModal }) {
  const [c, setC] = useState(null)
  const [missing, setMissing] = useState(false)
  const [defs, setDefs] = useState([])
  const [members, setMembers] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [dealModal, setDealModal] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    getCustomFields('contact').then(setDefs).catch(() => {})
    getProjectMembers().then(setMembers).catch(() => {})
    getPipelines().then(setPipelines).catch(() => {})
  }, [])
  useEffect(() => {
    getContact(id).then(x => { setC(x); setMissing(false) }).catch(() => setMissing(true))
  }, [id, refreshId, reload])

  if (missing) {
    return (
      <div className="max-w-5xl mx-auto">
        <BackLink onClick={() => goView('leads')}>Contacts</BackLink>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This contact doesn't exist anymore (it may have been merged or deleted).</p>
      </div>
    )
  }
  if (!c) return null

  const lc = LIFECYCLE[c.lifecycle] || LIFECYCLE.lead
  const owner = members.find(m => m.id === c.owner_id)
  const stage = stages.find(s => s.id === c.stage_id)
  const allStages = pipelines.flatMap(p => p.stages)
  const stageName = (sid) => allStages.find(s => s.id === sid)?.name || ''
  const digits = (c.phone || '').replace(/\D/g, '')

  return (
    <div className="max-w-5xl mx-auto">
      <BackLink onClick={() => goView('leads')}>Contacts</BackLink>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 break-words">{c.name}</h1>
            <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${lc.cls}`}>{lc.label}</span>
            {c.status === 'dead' && <span className="inline-flex items-center px-2 h-5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Dead</span>}
            {c.do_not_contact && <span className="inline-flex items-center gap-1 px-2 h-5 rounded text-[10px] font-medium bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"><Prohibit size={10} /> Do not contact</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {c.company && (
              <button onClick={() => goView(`company/${c.company.id}`)} className="inline-flex items-center gap-1 hover:text-emerald-600 dark:hover:text-emerald-400">
                <Buildings size={12} /> {c.company.name}
              </button>
            )}
            <span>Owner: {owner ? (owner.display_name || owner.username) : 'nobody'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {digits && <a href={`tel:+${digits}`} className={btn}><Phone size={13} /> Call</a>}
          {digits && (can(user, 'campaigns.send')
            ? <button onClick={async () => { try { goView(`inbox/${(await openChat({ lead_id: c.id })).id}`) } catch (err) { showToast(err.message, true) } }} className={btn}><WhatsappLogo size={13} /> Chat</button>
            : <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener" className={btn}><WhatsappLogo size={13} /> WhatsApp</a>)}
          {c.email && <a href={`mailto:${c.email}`} className={btn}><EnvelopeSimple size={13} /> Email</a>}
          {can(user, 'leads.edit') && <button onClick={() => openLeadModal(c.id)} className={btn}><PencilSimple size={13} /> Edit</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-4">
          <Panel title="Details">
            <dl>
              <FieldRow label="Phone">{c.phone}</FieldRow>
              <FieldRow label="Email">{c.email}</FieldRow>
              <FieldRow label="Business type">{c.category}</FieldRow>
              <FieldRow label="Outreach stage">{stage?.name}</FieldRow>
              <FieldRow label="Verified">{c.verified ? 'Yes, approved for outreach' : 'No, not reviewed yet'}</FieldRow>
              <FieldRow label="Source">{c.source}</FieldRow>
              <FieldRow label="Created">{formatDate(c.created_at)}</FieldRow>
              {/* Link rows only when set — most contacts have one or two */}
              {c.location && <FieldRow label="Google Maps"><ExternalLink href={c.location}>Open in Maps</ExternalLink></FieldRow>}
              {c.facebook && <FieldRow label="Facebook"><ExternalLink href={c.facebook} /></FieldRow>}
              {c.instagram && <FieldRow label="Instagram"><ExternalLink href={c.instagram} /></FieldRow>}
              {c.tiktok && <FieldRow label="TikTok"><ExternalLink href={c.tiktok} /></FieldRow>}
              {c.link && <FieldRow label="Website"><ExternalLink href={c.link} /></FieldRow>}
              <CustomFieldRows defs={defs} values={c.custom} members={members} />
            </dl>
          </Panel>
          <Panel title="Tags">
            {c.tags?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {c.tags.map(t => <span key={t.id} className="inline-flex items-center px-2 h-6 rounded text-[11px] font-medium text-white" style={{ background: t.color }}>{t.name}</span>)}
              </div>
            ) : <p className="text-xs text-zinc-500 dark:text-zinc-400">No tags.</p>}
          </Panel>
          {c.notes && (
            <Panel title="Notes"><p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{c.notes}</p></Panel>
          )}
        </div>

        <div className="space-y-4">
          <MessagePanel key={c.id} contact={c} digits={digits} canEdit={can(user, 'leads.edit')} showToast={showToast}
            canSchedule={can(user, 'campaigns.send') && !!digits && !c.do_not_contact}
            onSaved={(message) => setC(prev => ({ ...prev, message }))} onScheduled={() => setReload(r => r + 1)} />
          <Panel title={`Deals (${c.deals?.length || 0})`}
            action={can(user, 'deals.edit') && (
              <button onClick={() => setDealModal({ defaults: { contact: { id: c.id, name: c.name }, company: c.company || null } })}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                <Plus size={11} weight="bold" /> New deal
              </button>
            )}>
            <DealList deals={c.deals} stageName={stageName} onOpen={(dealId) => setDealModal({ dealId })} />
          </Panel>
          <WhatsAppHistory history={c.whatsapp} goView={goView} />
          <Panel title="Campaigns">
            {c.campaigns?.length
              ? <ul className="space-y-1">{c.campaigns.map(x => (
                  <li key={x.id}><button onClick={() => goView(`campaigns/${x.id}`)} dir="auto" className="text-xs text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-left">{x.name}</button></li>
                ))}</ul>
              : <p className="text-xs text-zinc-500 dark:text-zinc-400">Not in any WhatsApp campaign.</p>}
          </Panel>
          <Panel title="History">
            {/* Phase 2 (E2.1) replaces this with the full activity timeline */}
            {c.stageHistory?.length ? (
              <ol className="space-y-2">
                {c.stageHistory.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
                    <span className="text-zinc-700 dark:text-zinc-300">Outreach stage → {stages.find(s => s.id === h.stage_id)?.name || 'removed stage'}</span>
                    <span className="text-zinc-400 dark:text-zinc-500 ml-auto">{formatDate(h.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-xs text-zinc-500 dark:text-zinc-400">No history yet.</p>}
          </Panel>
        </div>
      </div>

      {dealModal && (
        <DealModal dealId={dealModal.dealId || null} defaults={dealModal.defaults} pipelines={pipelines} close={() => setDealModal(null)}
          showToast={showToast} onSaved={() => setReload(r => r + 1)} canDelete={can(user, 'deals.delete')} />
      )}
    </div>
  )
}

// Everything sent to this contact over WhatsApp, and what is still queued.
function WhatsAppHistory({ history, goView }) {
  const sends = history?.sends || [], upcoming = history?.upcoming || []
  return (
    <Panel title={`WhatsApp (${sends.length})`}>
      {!sends.length && !upcoming.length && <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing sent yet.</p>}
      <ul className="space-y-2.5">
        {upcoming.map(u => (
          <li key={u.job_id} className="text-xs">
            <button onClick={() => goView(`broadcast/${u.job_id}`)} className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline text-left">
              <CalendarBlank size={12} className="shrink-0" />
              {u.scheduled_at && u.status === 'scheduled' ? `Scheduled for ${formatDate(u.scheduled_at)}` : 'Waiting to be sent'}{u.job_name ? ` · ${u.job_name}` : ''}
            </button>
          </li>
        ))}
        {sends.map((s, i) => (
          <li key={i} className="text-xs">
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>{formatDate(s.sent_at)}</span>
              {s.replied_at ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Replied</span>
                : s.delivered_at ? <span className="text-sky-600 dark:text-sky-400">Delivered</span>
                : <span>{s.legacy ? 'Sent (delivery not tracked)' : 'Sent'}</span>}
              {s.job_id && canI('broadcast.view', 'campaigns.send') && (
                <button onClick={() => goView(`broadcast/${s.job_id}`)} className="ml-auto hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-[160px]">{s.job_name || 'Open broadcast'}</button>
              )}
            </div>
            {s.text && <p dir="auto" className="mt-1 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-1.5">{s.text}</p>}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// Draft outreach message (typed here or written by Claude over MCP) — copied and sent by hand.
function MessagePanel({ contact, digits, canEdit, canSchedule, showToast, onSaved, onScheduled }) {
  const [text, setText] = useState(contact.message || '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const saved = contact.message || ''

  const copy = async () => {
    if (await copyText(saved)) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
    else showToast('Could not copy — select the text and copy it manually.', true)
  }
  const save = async () => {
    setSaving(true)
    try {
      await updateLead(contact.id, { message: text })
      onSaved(text)
      setEditing(false)
      showToast('Message saved.')
    } catch (e) { showToast(e.message || 'Failed to save.', true) }
    setSaving(false)
  }

  return (
    <Panel title="Message"
      action={canEdit && !editing && (
        <button onClick={() => { setText(saved); setEditing(true) }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
          <PencilSimple size={11} /> {saved ? 'Edit' : 'Write'}
        </button>
      )}>
      {editing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} dir="auto" autoFocus
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className={btn}>Cancel</button>
            <button onClick={save} disabled={saving}
              className="inline-flex items-center px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : saved ? (
        <div className="space-y-3">
          <p dir="auto" className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">{saved}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className={btn}>
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
            {digits && (
              <a href={`https://wa.me/${digits}?text=${encodeURIComponent(saved)}`} target="_blank" rel="noopener" className={btn}>
                <WhatsappLogo size={13} /> Open in WhatsApp
              </a>
            )}
            {canSchedule && (
              <button onClick={() => setScheduling(true)} className={btn}><CalendarBlank size={13} /> Schedule</button>
            )}
          </div>
          {scheduling && (
            <WhatsAppSend leads={[contact]} initialMessages={['{{message}}']} title="Schedule message" defaultMode="schedule"
              close={() => setScheduling(false)} showToast={showToast} onCreated={onScheduled} />
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No message yet. Write one, or ask Claude to write it (Settings → Claude).</p>
      )}
    </Panel>
  )
}
