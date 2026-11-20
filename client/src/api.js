const API = '/api';

// Current project id — set by ProjectShell when inside /p/:projectId/*
let currentProjectId = null;
export function setCurrentProjectId(id) { currentProjectId = id || null; }
export function getCurrentProjectId() { return currentProjectId; }

function projectHeaders(extra = {}) {
  const h = { ...extra };
  if (currentProjectId) h['X-Project-Id'] = currentProjectId;
  return h;
}

async function request(path, options = {}) {
  const res = await fetch(API + path, {
    credentials: 'include',
    headers: projectHeaders({ 'Content-Type': 'application/json', ...options.headers }),
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── Projects (no project header required) ───────────────────────
export function getProjects() {
  return request('/projects');
}
export function createProject(data) {
  return request('/projects', { method: 'POST', body: JSON.stringify(data) });
}
export function updateProject(id, data) {
  return request('/projects/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteProject(id) {
  return request('/projects/' + id, { method: 'DELETE' });
}

// ── Stats ───────────────────────────────────────────────────────
export function getStats() {
  return request('/stats');
}

// ── Leads ───────────────────────────────────────────────────────
export function getLeads(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/leads' + (qs ? '?' + qs : ''));
}

export function getLead(id) {
  return request('/leads/' + id);
}

export function createLead(data) {
  return request('/leads', { method: 'POST', body: JSON.stringify(data) });
}

export function updateLead(id, data) {
  return request('/leads/' + id, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteLead(id) {
  return request('/leads/' + id, { method: 'DELETE' });
}

export function bulkAction(ids, action, stageId, tagId, value) {
  return request('/leads/bulk', { method: 'POST', body: JSON.stringify({ ids, action, stageId, tagId, value }) });
}

export function importPreview(file) {
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  if (currentProjectId) headers['X-Project-Id'] = currentProjectId;
  return fetch(API + '/leads/import/preview', { method: 'POST', body: formData, credentials: 'include', headers }).then(r => r.json());
}

export function importConfirm(rows, skipDupes, updateMode, checkWhatsApp, filename) {
  return request('/leads/import/confirm', { method: 'POST', body: JSON.stringify({ rows, skipDupes, updateMode, checkWhatsApp, filename }) });
}

// ── Stages ──────────────────────────────────────────────────────
export function getStages() {
  return request('/stages');
}
export function createStage(data) {
  return request('/stages', { method: 'POST', body: JSON.stringify(data) });
}
export function updateStage(id, data) {
  return request('/stages/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteStage(id) {
  return request('/stages/' + id, { method: 'DELETE' });
}
export function reorderStages(orderedIds) {
  return request('/stages/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) });
}

// ── First-run setup ─────────────────────────────────────────────
export function getSetupStatus() {
  return request('/setup/status');
}
export function completeSetup(data) {
  return request('/setup', { method: 'POST', body: JSON.stringify(data) });
}

// ── Campaigns ───────────────────────────────────────────────────
export function getCampaigns() {
  return request('/campaigns');
}
export function getCampaign(id) {
  return request('/campaigns/' + id);
}
export function updateCampaign(id, data) {
  return request('/campaigns/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function createCampaign(data) {
  return request('/campaigns', { method: 'POST', body: JSON.stringify(data) });
}
export function deleteCampaign(id) {
  return request('/campaigns/' + id, { method: 'DELETE' });
}
export function addFilteredToCampaign(id, filters) {
  return request('/campaigns/' + id + '/leads', { method: 'POST', body: JSON.stringify(filters) });
}
export function getCategories() {
  return request('/contacts/categories');
}
export function getTagCleanup() {
  return request('/tags/cleanup');
}
export function runTagCleanup(options) {
  return request('/tags/cleanup', { method: 'POST', body: JSON.stringify(options) });
}
export function mergeTag(id, into) {
  return request('/tags/' + id + '/merge', { method: 'POST', body: JSON.stringify({ into }) });
}
export function removeLeadFromCampaign(id, leadId) {
  return request('/campaigns/' + id + '/leads/' + leadId, { method: 'DELETE' });
}
export function addLeadsToCampaign(id, leadIds, count, force) {
  const body = leadIds ? { leadIds, force } : { count, force };
  return request('/campaigns/' + id + '/leads', { method: 'POST', body: JSON.stringify(body) });
}

// ── Export / Import backup ──────────────────────────────────────
export function exportBackup() {
  return request('/export');
}
export function exportCSV() {
  const q = currentProjectId ? '?project=' + encodeURIComponent(currentProjectId) : '';
  window.open('/api/export/csv' + q, '_blank');
}
export function importBackup(data) {
  return request('/import/backup', { method: 'POST', body: JSON.stringify(data) });
}

// ── Tags ────────────────────────────────────────────────────────
export function getTags() {
  return request('/tags');
}
export function createTag(data) {
  return request('/tags', { method: 'POST', body: JSON.stringify(data) });
}
export function updateTag(id, data) {
  return request('/tags/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteTag(id) {
  return request('/tags/' + id, { method: 'DELETE' });
}

// ── Broadcast jobs ──────────────────────────────────────────────
export function createJob(data) {
  return request('/jobs', { method: 'POST', body: JSON.stringify(data) });
}
export function getJobs(campaignId) {
  return request('/jobs' + (campaignId ? '?campaign=' + encodeURIComponent(campaignId) : ''));
}
export function getDailyStatus() {
  return request('/jobs/daily-status');
}
export function estimateJob(data) {
  return request('/jobs/estimate', { method: 'POST', body: JSON.stringify(data) });
}
export function rescheduleJob(id, scheduledAt) {
  return request('/jobs/' + id + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduledAt }) });
}

// ── WhatsApp inbox ──────────────────────────────────────────────
export function getChats(params = {}) {
  return request('/inbox/chats?' + new URLSearchParams(params).toString());
}
export function getChat(id) {
  return request('/inbox/chats/' + id);
}
export function getChatMessages(id, params = {}) {
  return request('/inbox/chats/' + id + '/messages?' + new URLSearchParams(params).toString());
}
export function getInboxUnread() {
  return request('/inbox/unread');
}
export function openChat(data) {
  return request('/inbox/chats', { method: 'POST', body: JSON.stringify(data) });
}
export function markChatRead(id) {
  return request('/inbox/chats/' + id + '/read', { method: 'POST' });
}
export function sendChatMessage(id, text) {
  return request('/inbox/chats/' + id + '/messages', { method: 'POST', body: JSON.stringify({ text }) });
}
export function updateChat(id, data) {
  return request('/inbox/chats/' + id, { method: 'PATCH', body: JSON.stringify(data) });
}
export function createContactFromChat(id, name) {
  return request('/inbox/chats/' + id + '/contact', { method: 'POST', body: JSON.stringify({ name }) });
}
export async function getChatMedia(messageId) {
  const res = await fetch(API + '/inbox/media/' + messageId, { credentials: 'include', headers: projectHeaders() });
  if (!res.ok) throw new Error('File not available');
  return res.blob();
}

// ── WhatsApp safety (anti-ban limits + number health) ───────────
export function getWaHealth() {
  return request('/jobs/health');
}
export function getWaLimits() {
  return request('/jobs/limits');
}
export function saveWaLimits(limits) {
  return request('/jobs/limits', { method: 'PUT', body: JSON.stringify({ limits }) });
}
export function setWarmupDays(daysAgo) {
  return request('/jobs/health/warmup', { method: 'PUT', body: JSON.stringify({ days_ago: daysAgo }) });
}
export function getWaNumbers() {
  return request('/jobs/numbers');
}
export function dismissWaAlert() {
  return request('/jobs/health/dismiss-alert', { method: 'POST' });
}
export function getJob(id) {
  return request('/jobs/' + id);
}
export function pauseJob(id) {
  return request('/jobs/' + id + '/pause', { method: 'POST' });
}
export function resumeJob(id) {
  return request('/jobs/' + id + '/resume', { method: 'POST' });
}
export function stopJob(id) {
  return request('/jobs/' + id + '/stop', { method: 'POST' });
}
export function deleteJob(id) {
  return request('/jobs/' + id, { method: 'DELETE' });
}

// ── Message templates ───────────────────────────────────────────
export function getTemplates() {
  return request('/templates');
}
export function createTemplate(data) {
  return request('/templates', { method: 'POST', body: JSON.stringify(data) });
}
export function updateTemplate(id, data) {
  return request('/templates/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteTemplate(id) {
  return request('/templates/' + id, { method: 'DELETE' });
}

// ── Logs ────────────────────────────────────────────────────────
export function getImportLogs() {
  return request('/import-logs');
}
export function getAuditLog(limit) {
  return request('/audit-log' + (limit ? '?limit=' + limit : ''));
}

// ── Settings ────────────────────────────────────────────────────
export function getSettings() {
  return request('/settings');
}
export function saveSetting(key, value) {
  return request('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) });
}

// ── Clients ─────────────────────────────────────────────────────
export function getClients(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/clients' + (qs ? '?' + qs : ''));
}
export function getClient(id) {
  return request('/clients/' + id);
}
export function createClient(data) {
  return request('/clients', { method: 'POST', body: JSON.stringify(data) });
}
export function updateClient(id, data) {
  return request('/clients/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteClient(id) {
  return request('/clients/' + id, { method: 'DELETE' });
}
export function addClientActivity(id, action, details) {
  return request('/clients/' + id + '/activity', { method: 'POST', body: JSON.stringify({ action, details }) });
}

// ── Email Campaigns ─────────────────────────────────────────────
export function getEmailCampaigns() {
  return request('/email-campaigns');
}
export function createEmailCampaign(data) {
  return request('/email-campaigns', { method: 'POST', body: JSON.stringify(data) });
}
export function updateEmailCampaign(id, data) {
  return request('/email-campaigns/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteEmailCampaign(id) {
  return request('/email-campaigns/' + id, { method: 'DELETE' });
}
export function addLeadsToEmailCampaign(id, leadIds, count, force) {
  const body = leadIds ? { leadIds, force } : { count, force };
  return request('/email-campaigns/' + id + '/leads', { method: 'POST', body: JSON.stringify(body) });
}

// ── Google Maps Scraper ─────────────────────────────────────────
export function scrapeGmaps(data) {
  return request('/gmaps/scrape', { method: 'POST', body: JSON.stringify(data) });
}
export function getGmapsJobs() {
  return request('/gmaps/jobs');
}
export function getGmapsJob(id) {
  return request('/gmaps/jobs/' + id);
}
export function deleteGmapsJob(id) {
  return request('/gmaps/jobs/' + id, { method: 'DELETE' });
}
export function importGmapsJob(id, options = {}) {
  return request('/gmaps/jobs/' + id + '/import', { method: 'POST', body: JSON.stringify(options) });
}
export async function downloadGmapsCSV(id) {
  const headers = {};
  if (currentProjectId) headers['X-Project-Id'] = currentProjectId;
  const res = await fetch(`/api/gmaps/jobs/${id}/download`, { credentials: 'include', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'gmaps-results.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Contacts (same records as leads) ───────────────────────────
export function getContacts(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/contacts' + (qs ? '?' + qs : ''));
}
export function getContact(id) {
  return request('/contacts/' + id);
}

// ── Workspace members (owner pickers) ──────────────────────────
export function getProjectMembers(projectId = currentProjectId) {
  return request('/projects/' + projectId + '/members');
}

// ── Companies ───────────────────────────────────────────────────
export function getCompanies(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/companies' + (qs ? '?' + qs : ''));
}
export function getCompany(id) {
  return request('/companies/' + id);
}
export function createCompany(data) {
  return request('/companies', { method: 'POST', body: JSON.stringify(data) });
}
export function updateCompany(id, data) {
  return request('/companies/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteCompany(id) {
  return request('/companies/' + id, { method: 'DELETE' });
}
export function linkCompanyContacts(id, contactIds) {
  return request('/companies/' + id + '/contacts', { method: 'POST', body: JSON.stringify({ contactIds }) });
}

// ── Pipelines ───────────────────────────────────────────────────
export function getPipelines() {
  return request('/pipelines');
}
export function createPipeline(data) {
  return request('/pipelines', { method: 'POST', body: JSON.stringify(data) });
}
export function updatePipeline(id, data) {
  return request('/pipelines/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deletePipeline(id) {
  return request('/pipelines/' + id, { method: 'DELETE' });
}
export function createPipelineStage(pipelineId, data) {
  return request('/pipelines/' + pipelineId + '/stages', { method: 'POST', body: JSON.stringify(data) });
}
export function updatePipelineStage(stageId, data) {
  return request('/pipelines/stages/' + stageId, { method: 'PUT', body: JSON.stringify(data) });
}
export function deletePipelineStage(stageId, moveTo) {
  return request('/pipelines/stages/' + stageId + (moveTo ? '?moveTo=' + encodeURIComponent(moveTo) : ''), { method: 'DELETE' });
}
export function reorderPipelineStages(pipelineId, orderedIds) {
  return request('/pipelines/' + pipelineId + '/stages/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) });
}

// ── Deals ───────────────────────────────────────────────────────
export function getDeals(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/deals' + (qs ? '?' + qs : ''));
}
export function getDealsBoard(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('/deals/board' + (qs ? '?' + qs : ''));
}
export function getDeal(id) {
  return request('/deals/' + id);
}
export function createDeal(data) {
  return request('/deals', { method: 'POST', body: JSON.stringify(data) });
}
export function updateDeal(id, data) {
  return request('/deals/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function moveDeal(id, stageId, lostReason) {
  return request('/deals/' + id + '/move', { method: 'POST', body: JSON.stringify({ stage_id: stageId, lost_reason: lostReason }) });
}
export function deleteDeal(id) {
  return request('/deals/' + id, { method: 'DELETE' });
}

// ── Custom fields ───────────────────────────────────────────────
export function getCustomFields(entity) {
  return request('/custom-fields' + (entity ? '?entity=' + entity : ''));
}
export function createCustomField(data) {
  return request('/custom-fields', { method: 'POST', body: JSON.stringify(data) });
}
export function updateCustomField(id, data) {
  return request('/custom-fields/' + id, { method: 'PUT', body: JSON.stringify(data) });
}
export function deleteCustomField(id) {
  return request('/custom-fields/' + id, { method: 'DELETE' });
}

// ── Search & saved views ────────────────────────────────────────
export function globalSearch(q) {
  return request('/search?q=' + encodeURIComponent(q));
}
export function getViews(entity) {
  return request('/views' + (entity ? '?entity=' + entity : ''));
}
export function createView(data) {
  return request('/views', { method: 'POST', body: JSON.stringify(data) });
}
export function deleteView(id) {
  return request('/views/' + id, { method: 'DELETE' });
}

// ── Duplicates ──────────────────────────────────────────────────
export function getDuplicates() {
  return request('/contacts/duplicates');
}
export function mergeContacts(primaryId, duplicateIds) {
  return request('/contacts/merge', { method: 'POST', body: JSON.stringify({ primaryId, duplicateIds }) });
}
export function dismissDuplicate(reason, value) {
  return request('/contacts/duplicates/dismiss', { method: 'POST', body: JSON.stringify({ reason, value }) });
}

// ── Personal access tokens (Claude / MCP; no project header needed) ──
export function getApiTokens() {
  return request('/tokens');
}
export function createApiToken(name) {
  return request('/tokens', { method: 'POST', body: JSON.stringify({ name }) });
}
export function deleteApiToken(id) {
  return request('/tokens/' + id, { method: 'DELETE' });
}

// ── File library ────────────────────────────────────────────────
export function getFiles() {
  return request('/files');
}
export function uploadFile(file, name) {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  const headers = {};
  if (currentProjectId) headers['X-Project-Id'] = currentProjectId;
  return fetch(API + '/files/upload', { method: 'POST', credentials: 'include', headers, body: formData }).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }));
}
export function deleteFile(id) {
  return request('/files/' + id, { method: 'DELETE' });
}
export function sendFile(fileId, contactId, caption) {
  return request('/files/' + fileId + '/send', { method: 'POST', body: JSON.stringify({ contact_id: contactId, caption }) });
}
