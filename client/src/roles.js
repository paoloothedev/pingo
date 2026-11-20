// Ready-made permission sets for team accounts. The server only knows permissions; a role is a shortcut for picking them,
// and an account whose permissions don't match one shows as Custom. None include projects.manage, so nobody can leave
// the workspaces they were given.
const VIEWER = ['dashboard.view', 'leads.view', 'deals.view', 'campaigns.view', 'broadcast.view', 'templates.view', 'stages.view', 'tags.view', 'whatsapp.view']
const SALES = [...VIEWER, 'leads.edit', 'leads.verify', 'leads.import', 'deals.edit', 'campaigns.edit', 'campaigns.send', 'templates.edit']
const MANAGER = [...SALES, 'leads.delete', 'deals.delete', 'campaigns.delete', 'broadcast.manage', 'stages.edit', 'tags.edit', 'whatsapp.control', 'settings.view', 'settings.edit']
const OWNER = [...MANAGER, 'accounts.view', 'accounts.manage']

export const ROLES = [
  { id: 'viewer', label: 'Viewer', desc: 'Sees everything in the workspace, changes nothing.', perms: VIEWER },
  { id: 'sales', label: 'Sales', desc: "Works contacts and deals, scrapes, and sends WhatsApp. Can't delete or change settings.", perms: SALES },
  { id: 'manager', label: 'Manager', desc: 'Sales, plus delete, connect WhatsApp, control broadcasts and change settings.', perms: MANAGER },
  { id: 'owner', label: 'Workspace owner', desc: 'Manager, plus adding team members to their own workspaces.', perms: OWNER },
]

export function roleOf(permissions = []) {
  const set = new Set(permissions)
  return ROLES.find(r => r.perms.length === set.size && r.perms.every(p => set.has(p))) || null
}
