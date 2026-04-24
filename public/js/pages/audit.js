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
    actorOptions: [],
    limit: 50,
    offset: 0,
    total: 0,
    legendCollapsed: true
};

const AUDIT_EVENT_CONFIG = {
    command_submitted: { code: 'SB', tone: '', class: '', label: 'Command Submitted' },
    command_approved: { code: 'OK', tone: 'approved', class: 'event-approved', label: 'Command Approved' },
    command_rejected: { code: 'NO', tone: 'rejected', class: 'event-rejected', label: 'Command Rejected' },
    command_executed: { code: 'EX', tone: '', class: '', label: 'Command Executed' },
    command_failed: { code: 'ER', tone: 'error', class: 'event-rejected', label: 'Command Failed' },
    command_blocked: { code: 'BL', tone: 'warning', class: 'event-command_blocked', label: 'Command Blocked' },
    command_timeout: { code: 'TM', tone: 'warning', class: '', label: 'Command Timed Out' },
    cli_dispatch_created: { code: 'CD', tone: '', class: '', label: 'CLI Dispatch Created' },
    cli_dispatch_blocked: { code: 'CB', tone: 'warning', class: 'event-command_blocked', label: 'CLI Dispatch Blocked' },
    cli_dispatch_linked_command: { code: 'LK', tone: 'approved', class: 'event-approved', label: 'CLI Dispatch Linked Command' },
    cli_dispatch_local_completed: { code: 'LC', tone: 'approved', class: 'event-approved', label: 'CLI Dispatch Local Completed' },
    cli_dispatch_local_failed: { code: 'LF', tone: 'error', class: 'event-rejected', label: 'CLI Dispatch Local Failed' },
    approval_granted: { code: 'AP', tone: 'approved', class: 'event-approved', label: 'Approval Granted' },
    auto_approval_preference_changed: { code: 'AA', tone: '', class: '', label: 'Auto Approval Preference Changed' },
    token_created: { code: 'TK', tone: 'approved', class: 'event-approved', label: 'Token Created' },
    token_blocked: { code: 'TB', tone: 'warning', class: 'event-command_blocked', label: 'Token Blocked' },
    rule_created: { code: 'RC', tone: '', class: '', label: 'Rule Created' },
    rule_updated: { code: 'RU', tone: '', class: '', label: 'Rule Updated' },
    rule_deleted: { code: 'RD', tone: 'rejected', class: 'event-rejected', label: 'Rule Deleted' },
    rule_pack_installed: { code: 'PK', tone: '', class: '', label: 'Rule Pack Installed' },
    rule_pack_upgrade_previewed: { code: 'PV', tone: '', class: '', label: 'Rule Pack Upgrade Previewed' },
    rule_pack_upgraded: { code: 'UP', tone: '', class: '', label: 'Rule Pack Upgraded' },
    signup_requested: { code: 'SR', tone: '', class: '', label: 'Signup Requested' },
    signup_approved: { code: 'SA', tone: 'approved', class: 'event-approved', label: 'Signup Approved' },
    signup_rejected: { code: 'SX', tone: 'rejected', class: 'event-rejected', label: 'Signup Rejected' },
    user_created: { code: 'UC', tone: 'approved', class: 'event-approved', label: 'User Created' },
    user_updated: { code: 'UU', tone: '', class: '', label: 'User Updated' },
    user_password_reset: { code: 'PR', tone: 'warning', class: '', label: 'User Password Reset' },
    password_changed: { code: 'PW', tone: '', class: '', label: 'Password Changed' },
    exec_key_rotated: { code: 'KR', tone: 'warning', class: '', label: 'Execution Key Rotated' }
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
                    <option value="auto_approval_preference_changed">Auto Approval Preference Changed</option>
                    <option value="token_created">Token Created</option>
                    <option value="token_blocked">Token Blocked</option>
                    <option value="rule_created">Rule Created</option>
                    <option value="rule_updated">Rule Updated</option>
                    <option value="rule_deleted">Rule Deleted</option>
                    <option value="rule_pack_installed">Rule Pack Installed</option>
                    <option value="rule_pack_upgrade_previewed">Rule Pack Upgrade Previewed</option>
                    <option value="rule_pack_upgraded">Rule Pack Upgraded</option>
                    <option value="signup_requested">Signup Requested</option>
                    <option value="signup_approved">Signup Approved</option>
                    <option value="signup_rejected">Signup Rejected</option>
                    <option value="user_created">User Created</option>
                    <option value="user_updated">User Updated</option>
                    <option value="user_password_reset">User Password Reset</option>
                    <option value="password_changed">Password Changed</option>
                </select>
                <select class="filter-select" id="audit-actor-filter">
                    <option value="">All Actors</option>
                </select>
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
        ${renderAuditLegend()}
    `;
    
    // Initialize event listeners
    document.getElementById('audit-event-filter').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-actor-filter').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-start-date').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-end-date').addEventListener('change', applyAuditFilters);
    document.getElementById('audit-apply-btn').addEventListener('click', applyAuditFilters);
    document.getElementById('audit-clear-btn').addEventListener('click', clearAuditFilters);
    document.getElementById('audit-export-json').addEventListener('click', () => exportAuditLog('json'));
    document.getElementById('audit-export-csv').addEventListener('click', () => exportAuditLog('csv'));
    initAuditLegend();
    
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

        auditState.actorOptions = Array.isArray(stats.allActors)
            ? stats.allActors.map(entry => String(entry.actor || '').trim()).filter(Boolean)
            : [];
        renderAuditActorOptions();
        
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
        renderAuditActorOptions();
        document.getElementById('audit-event-stats').innerHTML = '<div class="text-muted text-sm">Failed to load stats</div>';
        document.getElementById('audit-actor-stats').innerHTML = '<div class="text-muted text-sm">Failed to load stats</div>';
    }
}

function renderAuditActorOptions() {
    const actorSelect = document.getElementById('audit-actor-filter');
    if (!actorSelect) {
        return;
    }

    const selectedActor = auditState.filters.actor || '';
    const actorOptions = [...new Set([
        ...auditState.actorOptions,
        ...(selectedActor ? [selectedActor] : [])
    ])].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

    actorSelect.innerHTML = [
        '<option value="">All Actors</option>',
        ...actorOptions.map(actor => `
            <option value="${escapeHtmlAttribute(actor)}" ${actor === selectedActor ? 'selected' : ''}>${escapeHtml(actor)}</option>
        `)
    ].join('');
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
        
        timeline.innerHTML = data.entries.map(entry => {
            const config = getAuditEventConfig(entry.event_type);
            const detailsHtml = formatAuditDetails(entry);
            const commandLine = formatAuditCommandLine(entry.details || {});
            const actorLabel = describeAuditActor(entry);
            
            return `
                <div class="timeline-item fade-in ${config.class}">
                    <div class="timeline-time">${formatTime(entry.created_at)}</div>
                    <div class="timeline-title">
                        ${renderEventChip(config.code, config.tone)} ${config.label}
                        ${entry.entity_type ? `<span class="timeline-entity">· ${entry.entity_type}</span>` : ''}
                        ${commandLine ? ` <code style="color:var(--accent-cyan)">${escapeHtml(commandLine)}</code>` : ''}
                        ${entry.redacted ? `<span class="status-badge rejected">Redacted</span>` : ''}
                    </div>
                    <div class="timeline-details">
                        <div><strong>Actor:</strong> ${escapeHtml(actorLabel)}</div>
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

function getAuditEventConfig(eventType) {
    const config = AUDIT_EVENT_CONFIG[eventType];
    if (config) {
        return config;
    }

    return {
        code: 'EV',
        tone: '',
        class: '',
        label: formatEventType(eventType || 'event')
    };
}

function renderAuditLegend() {
    const entries = Object.values(AUDIT_EVENT_CONFIG).map((config) => `
        <div class="audit-legend-entry">
            ${renderEventChip(config.code, config.tone)}
            <div class="audit-legend-copy">
                <div class="audit-legend-label">${escapeHtml(config.label)}</div>
            </div>
        </div>
    `).join('');

    return `
        <div class="audit-legend ${auditState.legendCollapsed ? 'is-collapsed' : ''}" id="audit-legend">
            <button class="btn btn-secondary audit-legend-trigger" type="button" id="audit-legend-open">Event Key</button>
            <aside class="audit-legend-panel">
                <div class="audit-legend-head">
                    <div>
                        <div class="card-title">Event Key</div>
                        <div class="surface-section-copy">What the short audit chips mean.</div>
                    </div>
                    <button class="audit-legend-close" type="button" id="audit-legend-close">Hide</button>
                </div>
                <div class="audit-legend-grid">
                    ${entries}
                    <div class="audit-legend-entry">
                        ${renderEventChip('EV')}
                        <div class="audit-legend-copy">
                            <div class="audit-legend-label">Generic Audit Event</div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    `;
}

function initAuditLegend() {
    const openButton = document.getElementById('audit-legend-open');
    const closeButton = document.getElementById('audit-legend-close');

    if (openButton) {
        openButton.addEventListener('click', () => setAuditLegendCollapsed(false));
    }

    if (closeButton) {
        closeButton.addEventListener('click', () => setAuditLegendCollapsed(true));
    }
}

function setAuditLegendCollapsed(collapsed) {
    auditState.legendCollapsed = Boolean(collapsed);

    const legend = document.getElementById('audit-legend');
    if (!legend) {
        return;
    }

    legend.classList.toggle('is-collapsed', auditState.legendCollapsed);
}

function formatAuditDetails(entry) {
    const details = entry.details || {};
    let html = '';
    const commandLine = formatAuditCommandLine(details);
    
    if (entry.entity_id) {
        html += `<div><strong>Entity ID:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(entry.entity_id)}</code></div>`;
    }
    
    if (commandLine) {
        html += `<div><strong>Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(commandLine)}</code></div>`;
    }
    
    if (details.risk_level) {
        html += `<div><strong>Risk Level:</strong> <span class="risk-badge ${details.risk_level.toLowerCase()}">${details.risk_level}</span></div>`;
    }
    
    if (details.status) {
        html += `<div><strong>Status:</strong> <span class="status-badge ${details.status.toLowerCase()}">${details.status}</span></div>`;
    }
    
    if (details.approver) {
        html += `<div><strong>Approver:</strong> ${escapeHtml(isSystemAutoApprover(details.approver) ? 'Niyam Auto Approver' : details.approver)}</div>`;
    }

    if (details.authMode) {
        html += `<div><strong>Auth Mode:</strong> ${escapeHtml(details.authMode)}</div>`;
    }

    if (details.approvalMode) {
        html += `<div><strong>Approval Mode:</strong> ${escapeHtml(details.approvalMode)}</div>`;
    }

    if (details.autoApproval !== undefined) {
        html += `<div><strong>Auto Approval:</strong> ${details.autoApproval ? 'Enabled' : 'Disabled'}</div>`;
    }

    if (details.credentialLabel) {
        html += `<div><strong>Via:</strong> ${escapeHtml(details.credentialLabel)}</div>`;
    }

    if (details.subjectType) {
        html += `<div><strong>Subject Type:</strong> ${escapeHtml(details.subjectType)}</div>`;
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

    if (details.label) {
        html += `<div><strong>Token Label:</strong> ${escapeHtml(details.label)}</div>`;
    }

    if (details.scope) {
        html += `<div><strong>Scope:</strong> ${escapeHtml(details.scope)}</div>`;
    }

    if (details.subject) {
        html += `<div><strong>Subject:</strong> ${escapeHtml(details.subject)}</div>`;
    }

    if (details.principalIdentifier) {
        html += `<div><strong>Identity:</strong> ${escapeHtml(details.principalIdentifier)}</div>`;
    }

    if (details.userId) {
        html += `<div><strong>Linked User ID:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(details.userId)}</code></div>`;
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

function formatAuditCommandLine(details) {
    if (!details || !details.command) {
        return '';
    }

    const args = Array.isArray(details.args)
        ? details.args.map(arg => String(arg || '').trim()).filter(Boolean)
        : [];

    return [String(details.command).trim(), ...args].filter(Boolean).join(' ').trim();
}

function describeAuditActor(entry) {
    const details = entry.details || {};
    if (details.credentialLabel && details.credentialLabel !== entry.actor) {
        return `${entry.actor} via ${details.credentialLabel}`;
    }

    if (isSystemAutoApprover(entry.actor)) {
        return 'Niyam Auto Approver';
    }

    return entry.actor;
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
