import { useState, useEffect } from 'react'
import { PencilSimple, Plus, LinkSimple, X } from '@phosphor-icons/react'
import { getCompany, getCustomFields, getProjectMembers, getPipelines, getContacts, linkCompanyContacts, updateLead } from '../api'
import { LIFECYCLE } from '../lifecycle'
import { formatDate } from '../format'
import { can } from '../permissions'
import DealModal from './DealModal'
import CompanyModal from './CompanyModal'
import RecordPicker from './RecordPicker'
import { BackLink, Panel, FieldRow, CustomFieldRows, ExternalLink, DealList } from './RecordParts'

const btn = 'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'

const searchContacts = async (q) => {
  const r = await getContacts({ search: q, page: 1, limit: 8 })
  return r.items.map(c => ({ id: c.id, name: c.name, sub: [c.phone, c.company?.name && `at ${c.company.name}`].filter(Boolean).join(' · ') }))
}

export default function CompanyPage({ id, user, refreshId, showToast, goView }) {
  const [co, setCo] = useState(null)
  const [missing, setMissing] = useState(false)
  const [defs, setDefs] = useState([])
  const [members, setMembers] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [dealModal, setDealModal] = useState(null)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [reload, setReload] = useState(0)
  const canEdit = can(user, 'leads.edit')

  useEffect(() => {
    getCustomFields('company').then(setDefs).catch(() => {})
    getProjectMembers().then(setMembers).catch(() => {})
    getPipelines().then(setPipelines).catch(() => {})
  }, [])
  useEffect(() => {
    getCompany(id).then(x => { setCo(x); setMissing(false) }).catch(() => setMissing(true))
  }, [id, refreshId, reload])

  if (missing) {
    return (
      <div className="max-w-5xl mx-auto">
        <BackLink onClick={() => goView('companies')}>Companies</BackLink>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This company doesn't exist anymore.</p>
      </div>
    )
  }
  if (!co) return null

  const owner = members.find(m => m.id === co.owner_id)
  const allStages = pipelines.flatMap(p => p.stages)
  const stageName = (sid) => allStages.find(s => s.id === sid)?.name || ''
  const link = async (contact) => {
    if (!contact) return
    try { await linkCompanyContacts(co.id, [contact.id]); showToast(`${contact.name} linked.`); setLinking(false); setReload(r => r + 1) }
    catch (err) { showToast(err.message || 'Failed to link.', true) }
  }
  const unlink = async (contact) => {
    try { await updateLead(contact.id, { company_id: null }); showToast(`${contact.name} unlinked.`); setReload(r => r + 1) }
    catch (err) { showToast(err.message || 'Failed to unlink.', true) }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <BackLink onClick={() => goView('companies')}>Companies</BackLink>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 break-words">{co.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {co.industry && <span>{co.industry}</span>}
            {co.city && <span>{co.city}</span>}
            {co.website && <ExternalLink href={co.website}>{co.domain || co.website}</ExternalLink>}
            <span>Owner: {owner ? (owner.display_name || owner.username) : 'nobody'}</span>
          </div>
        </div>
        {canEdit && <button onClick={() => setEditing(true)} className={btn}><PencilSimple size={13} /> Edit</button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-4">
          <Panel title="Details">
            <dl>
              <FieldRow label="Phone">{co.phone}</FieldRow>
              <FieldRow label="Email">{co.email}</FieldRow>
              <FieldRow label="Website">{co.website && <ExternalLink href={co.website} />}</FieldRow>
              <FieldRow label="Address">{co.address}</FieldRow>
              <FieldRow label="City">{co.city}</FieldRow>
              <FieldRow label="Country">{co.country}</FieldRow>
              <FieldRow label="Size">{co.size}</FieldRow>
              <FieldRow label="Source">{co.source}</FieldRow>
              <FieldRow label="Created">{formatDate(co.created_at)}</FieldRow>
              <CustomFieldRows defs={defs} values={co.custom} members={members} />
            </dl>
          </Panel>
          {co.notes && <Panel title="Notes"><p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{co.notes}</p></Panel>}
        </div>

        <div className="space-y-4">
          <Panel title={`Contacts (${co.contacts.length})`}
            action={canEdit && (
              <button onClick={() => setLinking(l => !l)} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                <LinkSimple size={11} weight="bold" /> Link contact
              </button>
            )}>
            {linking && <div className="mb-3"><RecordPicker value={null} onChange={link} search={searchContacts} placeholder="Find a contact to link…" /></div>}
            {co.contacts.length ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {co.contacts.map(c => {
                  const lc = LIFECYCLE[c.lifecycle] || LIFECYCLE.lead
                  return (
                    <li key={c.id} className="flex items-center gap-2 py-2">
                      <button onClick={() => goView(`contact/${c.id}`)} className="min-w-0 flex-1 text-left">
                        <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate hover:text-emerald-600 dark:hover:text-emerald-400">{c.name}</span>
                        <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{c.phone || c.email || '—'}</span>
                      </button>
                      <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${lc.cls}`}>{lc.label}</span>
                      {canEdit && (
                        <button onClick={() => unlink(c)} title="Unlink from company" aria-label={`Unlink ${c.name}`}
                          className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-500"><X size={12} /></button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : <p className="text-xs text-zinc-500 dark:text-zinc-400">No contacts linked yet.</p>}
          </Panel>
          <Panel title={`Deals (${co.deals.length})`}
            action={can(user, 'deals.edit') && (
              <button onClick={() => setDealModal({ defaults: { company: { id: co.id, name: co.name } } })}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                <Plus size={11} weight="bold" /> New deal
              </button>
            )}>
            <DealList deals={co.deals} stageName={stageName} onOpen={(dealId) => setDealModal({ dealId })} />
          </Panel>
        </div>
      </div>

      {editing && (
        <CompanyModal companyId={co.id} close={() => setEditing(false)} showToast={showToast} canDelete={can(user, 'leads.delete')}
          onSaved={(saved) => (saved ? setReload(r => r + 1) : goView('companies'))} />
      )}
      {dealModal && (
        <DealModal dealId={dealModal.dealId || null} defaults={dealModal.defaults} pipelines={pipelines} close={() => setDealModal(null)}
          showToast={showToast} onSaved={() => setReload(r => r + 1)} canDelete={can(user, 'deals.delete')} />
      )}
    </div>
  )
}
