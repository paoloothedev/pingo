// Contact lifecycle stages (server: LIFECYCLES in routes/leads.js)
export const LIFECYCLE = {
  lead: { label: 'Lead', plural: 'Leads', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  qualified: { label: 'Qualified', plural: 'Qualified', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  customer: { label: 'Customer', plural: 'Customers', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  churned: { label: 'Churned', plural: 'Churned', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
}
