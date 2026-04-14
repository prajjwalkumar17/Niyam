/**
 * Audit Log Page - Timeline view with filters and export
 */

let auditState = {
    filters: {
        eventType: '',
        actor: '',
        startDate: '',
        endDate: ''
    },
    limit: 50,
    offset: 0,
    total: 0
};

function renderAudit(container) {
    container.innerHTML = `
        <div class="filters">
            <select class="filter-select" id="audit-event-filter">
                <option value="">All Events</option>
                <option value="command_submitted">Command Submitted</option>
                <option value="command_approved">Command Approved</option>
                <option value="command_rejected">Command Rejected</option>
                <option value="command_executed">Command Executed</option>
                <option value="command_failed">Command Failed</option>
                <option value="command_blocked">Command Blocked</option>
                <option value="command_timeout">Command Timeout</option>
                <option value="approval_granted">Approval Granted</option>
                <option value="rule_created">Rule Created</option>
                <option value="rule_updated">Rule Updated</option>
                <option value="rule_deleted">Rule Deleted</option>
            </select>
            <input type="text" class="form-input" id="audit-actor-filter" placeholder="Filter by actor..." style="width:180px">
            <input type="date" class="form-input" id="audit-start-date" title="Start date" style="width:150px">
            <input type="date" class="form-input" id="audit-end-date" title="End date" style="width:150px">
            <button class="btn btn-secondary" id="audit-apply-btn">Apply</button>
            <button class="btn btn-secondary" id="audit-clear-btn">Clear</button>
            <div style="margin-left:auto;display:flex;gap:8px">
                <button class="btn btn-secondary" id="audit-export-json">Export JSON</button>
                <button class="btn btn-secondary" id="audit-export-csv">Export CSV</button>
            </div>
        </div>
        <div class="grid-2" style="margin-bottom:20px">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Event Distribution</span>
                </div>
                <div id="audit-event-stats" style="display:flex;flex-wrap:wrap;gap:8px"></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Top Actors</span>
                </div>
                <div id="audit-actor-stats"></div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <span class="card-title">Audit Timeline</span>
                <span id="audit-count" class="text-sm text-muted"></span>
            </div>
            <div id="audit-timeline" class="timeline"></div>
            <div id="audit-pagination" style="display:flex;justify-content:center;gap:12px;margin-top:16px"></div>
        </div>
    `;
    
    // Initialize event listeners
    document.getElementById('audit-event-filter').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-actor-filter').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyAuditFilters();
    });
    document.getElementById('audit-start-date').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-end-date').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-apply-btn').addEventListener('click', applyAuditFilters);
    document.getElementById('audit-clear-btn').addEventListener('click', clearAuditFilters);
    document.getElementById('audit-export-json').addEventListener('click', () => exportAuditLog('json'));
    document.getElementById('audit-export-csv').addEventListener('click', () => exportAuditLog('csv'));
    
    // Load initial data
    loadAuditStats();
    loadAuditLog();
}

function applyAuditFilters() {
    auditState.filters = {
        eventType: document.getElementById('audit-event-filter').value,
        actor: document.getElementById('audit-actor-filter').value.trim(),
        startDate: document.getElementById('audit-start-date').value,
        endDate: document.getElementById('audit-end-date').value
    };
    auditState.offset = 0;
    loadAuditLog();
}

function clearAuditFilters() {
    document.getElementById('audit-event-filter').value = '';
    document.getElementById('audit-actor-filter').value = '';
    document.getElementById('audit-start-date').value = '';
    document.getElementById('audit-end-date').value = '';
    auditState.filters = { eventType: '', actor: '', startDate: '', endDate: '' };
    auditState.offset = 0;
    loadAuditLog();
}

async function loadAuditStats() {
    try {
        const response = await apiFetch('/audit/stats');
        const stats = await response.json();
        
        // Event distribution
        const eventStatsEl = document.getElementById('audit-event-stats');
        if (stats.eventTypes && stats.eventTypes.length > 0) {
            eventStatsEl.innerHTML = stats.eventTypes.map(et => `
                <div style="padding:6px 12px;background:rgba(56,189,248,0.08);border-radius:6px;border:1px solid var(--border-color)">
                    <span style="font-size:12px;color:var(--text-secondary)">${formatEventType(et.event_type)}</span>
                    <span style="font-size:14px;font-weight:600;color:var(--accent-cyan);margin-left:8px">${et.count}</span>
                </div>
            `).join('');
        } else {
            eventStatsEl.innerHTML = '<div class="text-muted text-sm">No events recorded</div>';
        }
        
        // Top actors
        const actorStatsEl = document.getElementById('audit-actor-stats');
        if (stats.topActors && stats.topActors.length > 0) {
            actorStatsEl.innerHTML = stats.topActors.map((a, i) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;${i < stats.topActors.length - 1 ? 'border-bottom:1px solid var(--border-color)' : ''}">
                    <span style="font-size:13px">${escapeHtml(a.actor)}</span>
                    <span class="text-muted text-sm">${a.count} events</span>
                </div>
            `).join('');
        } else {
            actorStatsEl.innerHTML = '<div class="text-muted text-sm">No actors recorded</div>';
        }
    } catch (e) {
        document.getElementById('audit-event-stats').innerHTML = '<div class="text-muted text-sm">Failed to load stats</div>';
        document.getElementById('audit-actor-stats').innerHTML = '<div class="text-muted text-sm">Failed to load stats</div>';
    }
}

async function loadAuditLog() {
    const timeline = document.getElementById('audit-timeline');
    const countEl = document.getElementById('audit-count');
    
    // Build query params
    const params = new URLSearchParams();
    params.set('limit', auditState.limit);
    params.set('offset', auditState.offset);
    
    if (auditState.filters.eventType) {
        params.set('eventType', auditState.filters.eventType);
    }
    if (auditState.filters.actor) {
        params.set('actor', auditState.filters.actor);
    }
    if (auditState.filters.startDate) {
        params.set('startDate', auditState.filters.startDate + 'T00:00:00');
    }
    if (auditState.filters.endDate) {
        params.set('endDate', auditState.filters.endDate + 'T23:59:59');
    }
    
    try {
        const response = await apiFetch(`/audit?${params.toString()}`);
        const data = await response.json();
        
        if (!data.entries || data.entries.length === 0) {
            timeline.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No audit entries found</div></div>';
            countEl.textContent = '';
            document.getElementById('audit-pagination').innerHTML = '';
            return;
        }
        
        countEl.textContent = `Showing ${data.entries.length} entries`;
        
        // Event type icons and colors
        const eventConfig = {
            command_submitted: { icon: '📤', class: '' },
            command_approved: { icon: '✅', class: 'event-approved' },
            command_rejected: { icon: '❌', class: 'event-rejected' },
            command_executed: { icon: '⚡', class: '' },
            command_failed: { icon: '💥', class: 'event-rejected' },
            command_blocked: { icon: '🚫', class: 'event-command_blocked' },
            command_timeout: { icon: '⏰', class: '' },
            approval_granted: { icon: '👍', class: 'event-approved' },
            rule_created: { icon: '📝', class: '' },
            rule_updated: { icon: '✏️', class: '' },
            rule_deleted: { icon: '🗑️', class: 'event-rejected' }
        };
        
        timeline.innerHTML = data.entries.map(entry => {
            const config = eventConfig[entry.event_type] || { icon: '📌', class: '' };
            const detailsHtml = formatAuditDetails(entry);
            
            return `
                <div class="timeline-item fade-in ${config.class}">
                    <div class="timeline-time">${formatTime(entry.created_at)}</div>
                    <div class="timeline-title">
                        ${config.icon} ${formatEventType(entry.event_type)}
                        ${entry.entity_type ? `<span class="text-muted" style="font-weight:400">· ${entry.entity_type}</span>` : ''}
                    </div>
                    <div class="timeline-details">
                        <div><strong>Actor:</strong> ${escapeHtml(entry.actor)}</div>
                        ${detailsHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        // Pagination
        renderAuditPagination(data.entries.length);
        
    } catch (e) {
        timeline.innerHTML = '<div class="empty-state"><div class="empty-state-text" style="color:var(--accent-red)">Failed to load audit log</div></div>';
        countEl.textContent = '';
    }
}

function formatAuditDetails(entry) {
    const details = entry.details || {};
    let html = '';
    
    if (entry.entity_id) {
        html += `<div><strong>Entity ID:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(entry.entity_id)}</code></div>`;
    }
    
    if (details.command) {
        html += `<div><strong>Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(details.command)}</code></div>`;
    }
    
    if (details.risk_level) {
        html += `<div><strong>Risk Level:</strong> <span class="risk-badge ${details.risk_level.toLowerCase()}">${details.risk_level}</span></div>`;
    }
    
    if (details.status) {
        html += `<div><strong>Status:</strong> <span class="status-badge ${details.status.toLowerCase()}">${details.status}</span></div>`;
    }
    
    if (details.approver) {
        html += `<div><strong>Approver:</strong> ${escapeHtml(details.approver)}</div>`;
    }
    
    if (details.rationale) {
        html += `<div><strong>Rationale:</strong> ${escapeHtml(details.rationale)}</div>`;
    }
    
    if (details.rule_name) {
        html += `<div><strong>Rule:</strong> ${escapeHtml(details.rule_name)}</div>`;
    }
    
    if (details.error) {
        html += `<div style="color:var(--accent-red)"><strong>Error:</strong> ${escapeHtml(details.error)}</div>`;
    }
    
    if (details.exit_code !== undefined) {
        html += `<div><strong>Exit Code:</strong> ${details.exit_code}</div>`;
    }
    
    return html;
}

function renderAuditPagination(currentCount) {
    const pagination = document.getElementById('audit-pagination');
    
    const hasPrev = auditState.offset > 0;
    const hasNext = currentCount === auditState.limit;
    
    let html = '';
    
    if (hasPrev) {
        html += `<button class="btn btn-secondary" onclick="auditPrevPage()">← Previous</button>`;
    }
    
    const startItem = auditState.offset + 1;
    const endItem = auditState.offset + currentCount;
    html += `<span class="text-muted" style="padding:8px 16px">Showing ${startItem}-${endItem}</span>`;
    
    if (hasNext) {
        html += `<button class="btn btn-secondary" onclick="auditNextPage()">Next →</button>`;
    }
    
    pagination.innerHTML = html;
}

function auditNextPage() {
    auditState.offset += auditState.limit;
    loadAuditLog();
}

function auditPrevPage() {
    auditState.offset = Math.max(0, auditState.offset - auditState.limit);
    loadAuditLog();
}

async function exportAuditLog(format) {
    const params = new URLSearchParams();
    params.set('format', format);
    
    if (auditState.filters.startDate) {
        params.set('startDate', auditState.filters.startDate + 'T00:00:00');
    }
    if (auditState.filters.endDate) {
        params.set('endDate', auditState.filters.endDate + 'T23:59:59');
    }
    
    try {
        showNotification(`Exporting audit log as ${format.toUpperCase()}...`, 'info');
        
        const response = await apiFetch(`/audit/export?${params.toString()}`);
        
        if (!response.ok) {
            throw new Error('Export failed');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `niyam-audit-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showNotification(`Audit log exported as ${format.toUpperCase()}`, 'success');
    } catch (e) {
        showNotification('Failed to export audit log', 'error');
    }
}
