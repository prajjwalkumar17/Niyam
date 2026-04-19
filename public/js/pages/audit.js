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
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Audit Trail</div>
                <p class="workspace-subtitle">Search governance events, exports, actor activity, and policy changes from one structured timeline.</p>
            </div>
            <div class="workspace-controls">
                <div class="audit-export-actions">
                    <button class="btn btn-secondary" id="audit-export-json">Export JSON</button>
                    <button class="btn btn-secondary" id="audit-export-csv">Export CSV</button>
                </div>
            </div>
        </section>
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Timeline Filters</div>
                    <div class="surface-section-copy">Narrow the timeline by event type, actor, or time window.</div>
                </div>
            </div>
            <div class="audit-filter-grid">
                <select class="filter-select" id="audit-event-filter">
                    <option value="">All Events</option>
                    <option value="command_submitted">Command Submitted</option>
                    <option value="command_approved">Command Approved</option>
                    <option value="command_rejected">Command Rejected</option>
                    <option value="command_executed">Command Executed</option>
                    <option value="command_failed">Command Failed</option>
                    <option value="command_blocked">Command Blocked</option>
                    <option value="command_timeout">Command Timeout</option>
                    <option value="cli_dispatch_created">CLI Dispatch Created</option>
                    <option value="cli_dispatch_blocked">CLI Dispatch Blocked</option>
                    <option value="cli_dispatch_linked_command">CLI Dispatch Linked</option>
                    <option value="cli_dispatch_local_completed">CLI Local Completed</option>
                    <option value="cli_dispatch_local_failed">CLI Local Failed</option>
                    <option value="approval_granted">Approval Granted</option>
                    <option value="rule_created">Rule Created</option>
                    <option value="rule_updated">Rule Updated</option>
                    <option value="rule_deleted">Rule Deleted</option>
                    <option value="rule_pack_installed">Rule Pack Installed</option>
                    <option value="rule_pack_upgrade_previewed">Rule Pack Upgrade Previewed</option>
                    <option value="rule_pack_upgraded">Rule Pack Upgraded</option>
                </select>
                <input type="text" class="form-input" id="audit-actor-filter" placeholder="Filter by actor">
                <input type="date" class="form-input" id="audit-start-date" title="Start date">
                <input type="date" class="form-input" id="audit-end-date" title="End date">
                <div class="audit-filter-actions">
                    <button class="btn btn-secondary" id="audit-apply-btn">Apply</button>
                    <button class="btn btn-secondary" id="audit-clear-btn">Clear</button>
                </div>
            </div>
        </section>
        <section class="surface-grid-2 fade-in audit-stats-grid">
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Event Distribution</div>
                        <div class="surface-section-copy">Most common audit events across the current instance.</div>
                    </div>
                </div>
                <div id="audit-event-stats" class="audit-chip-cloud"></div>
            </div>
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Top Actors</div>
                        <div class="surface-section-copy">Who is driving the most governance activity.</div>
                    </div>
                </div>
                <div id="audit-actor-stats" class="audit-actor-list"></div>
            </div>
        </section>
        <section class="surface-card fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Audit Timeline</div>
                    <div class="surface-section-copy">Chronological event stream with actor and entity context.</div>
                </div>
                <span id="audit-count" class="text-sm text-muted"></span>
            </div>
            <div id="audit-timeline" class="timeline"></div>
            <div id="audit-pagination" class="audit-pagination"></div>
        </section>
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
                <div class="audit-chip">
                    <span class="audit-chip-label">${formatEventType(et.event_type)}</span>
                    <span class="audit-chip-value">${et.count}</span>
                </div>
            `).join('');
        } else {
            eventStatsEl.innerHTML = '<div class="text-muted text-sm">No events recorded</div>';
        }
        
        // Top actors
        const actorStatsEl = document.getElementById('audit-actor-stats');
        if (stats.topActors && stats.topActors.length > 0) {
            actorStatsEl.innerHTML = stats.topActors.map((a, i) => `
                <div class="audit-actor-row ${i < stats.topActors.length - 1 ? 'is-divided' : ''}">
                    <span class="audit-actor-name">${escapeHtml(a.actor)}</span>
                    <span class="audit-actor-count">${a.count} events</span>
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
            timeline.innerHTML = renderEmptyState('No audit entries found', 'audit');
            countEl.textContent = '';
            document.getElementById('audit-pagination').innerHTML = '';
            return;
        }
        
        countEl.textContent = `Showing ${data.entries.length} entries`;
        
        // Event type icons and colors
        const eventConfig = {
            command_submitted: { icon: renderEventChip('SB'), class: '' },
            command_approved: { icon: renderEventChip('OK', 'approved'), class: 'event-approved' },
            command_rejected: { icon: renderEventChip('NO', 'rejected'), class: 'event-rejected' },
            command_executed: { icon: renderEventChip('EX'), class: '' },
            command_failed: { icon: renderEventChip('ER', 'error'), class: 'event-rejected' },
            command_blocked: { icon: renderEventChip('BL', 'warning'), class: 'event-command_blocked' },
            command_timeout: { icon: renderEventChip('TM', 'warning'), class: '' },
            cli_dispatch_created: { icon: renderEventChip('CD'), class: '' },
            cli_dispatch_blocked: { icon: renderEventChip('CB', 'warning'), class: 'event-command_blocked' },
            cli_dispatch_linked_command: { icon: renderEventChip('LK', 'approved'), class: 'event-approved' },
            cli_dispatch_local_completed: { icon: renderEventChip('LC', 'approved'), class: 'event-approved' },
            cli_dispatch_local_failed: { icon: renderEventChip('LF', 'error'), class: 'event-rejected' },
            approval_granted: { icon: renderEventChip('AP', 'approved'), class: 'event-approved' },
            rule_created: { icon: renderEventChip('RC'), class: '' },
            rule_updated: { icon: renderEventChip('RU'), class: '' },
            rule_deleted: { icon: renderEventChip('RD', 'rejected'), class: 'event-rejected' },
            rule_pack_installed: { icon: renderEventChip('PK'), class: '' },
            rule_pack_upgrade_previewed: { icon: renderEventChip('PV'), class: '' },
            rule_pack_upgraded: { icon: renderEventChip('UP'), class: '' },
            exec_key_rotated: { icon: renderEventChip('KR', 'warning'), class: '' }
        };
        
        timeline.innerHTML = data.entries.map(entry => {
            const config = eventConfig[entry.event_type] || { icon: renderEventChip('EV'), class: '' };
            const detailsHtml = formatAuditDetails(entry);
            
            return `
                <div class="timeline-item fade-in ${config.class}">
                    <div class="timeline-time">${formatTime(entry.created_at)}</div>
                    <div class="timeline-title">
                        ${config.icon} ${formatEventType(entry.event_type)}
                        ${entry.entity_type ? `<span class="timeline-entity">· ${entry.entity_type}</span>` : ''}
                        ${entry.redacted ? `<span class="status-badge rejected">Redacted</span>` : ''}
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
        timeline.innerHTML = renderEmptyState('Failed to load audit log', 'blocked');
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
    
    if (details.route) {
        html += `<div><strong>Route:</strong> ${escapeHtml(details.route)}</div>`;
    }

    if (details.shell) {
        html += `<div><strong>Shell:</strong> ${escapeHtml(details.shell)}</div>`;
    }

    if (details.commandId) {
        html += `<div><strong>Linked Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(details.commandId)}</code></div>`;
    }

    if (details.durationMs !== undefined) {
        html += `<div><strong>Duration:</strong> ${details.durationMs}ms</div>`;
    }

    if (details.exitCode !== undefined) {
        html += `<div><strong>Exit Code:</strong> ${details.exitCode}</div>`;
    }

    if (details.exit_code !== undefined) {
        html += `<div><strong>Exit Code:</strong> ${details.exit_code}</div>`;
    }

    if (entry.redacted) {
        html += `<div><strong>Redaction:</strong> Sensitive values were removed before storage.</div>`;
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
    html += `<span class="audit-pagination-range">Showing ${startItem}-${endItem}</span>`;
    
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
