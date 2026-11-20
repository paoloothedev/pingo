// 003 — indexes for list filters and the batched lookups in lib/paginate.js.
export const id = '003-list-indexes';

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_project_status ON leads(project_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_project_phone ON leads(project_id, phone);
    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);
    CREATE INDEX IF NOT EXISTS idx_lead_tags_tag ON lead_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_stage_history_lead ON stage_history(lead_id);
    CREATE INDEX IF NOT EXISTS idx_job_leads_job ON job_leads(job_id);
    CREATE INDEX IF NOT EXISTS idx_client_tags_tag ON client_tags(tag_id);
  `);
}
