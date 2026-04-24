/**
 * Dashboard Page - Overview with stats and recent activity
 */

function renderDashboard(container) {
    container.innerHTML = `
        <section class="dashboard-hero fade-in">
            <div class="dashboard-hero-copy">
                <div class="workspace-kicker">Command Surface</div>
                <h2 class="dashboard-hero-title">Approval-first control for live command traffic.</h2>
                <p class="workspace-subtitle">Monitor queue pressure, approvals, and risk posture from a single operator surface without losing execution context.</p>
            </div>
            <div class="dashboard-hero-rail">
                <div class="dashboard-hero-note">Live snapshot of what is moving, what is blocked, and what needs review next.</div>
                <div class="workspace-controls">
                    <span class="workspace-chip">Live snapshot</span>
                    <span class="workspace-chip">Auto-refresh aware</span>
                </div>
            </div>
        </section>
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Live Command Metrics</div>
                    <div class="surface-section-copy">Queue pressure, total volume, and current risk distribution.</div>
                </div>
            </div>
            <div class="stats-grid" id="stats-grid">
                <div class="stat-card total"><div class="stat-label">Total Commands</div><div class="stat-value total" id="stat-total">-</div></div>
                <div class="stat-card pending"><div class="stat-label">Pending</div><div class="stat-value pending" id="stat-pending">-</div></div>
                <div class="stat-card high"><div class="stat-label">High Risk</div><div class="stat-value high" id="stat-high">-</div></div>
                <div class="stat-card medium"><div class="stat-label">Medium Risk</div><div class="stat-value medium" id="stat-medium">-</div></div>
                <div class="stat-card low"><div class="stat-label">Low Risk</div><div class="stat-value low" id="stat-low">-</div></div>
            </div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Commands Vs Dispatches</div>
                        <div class="surface-section-copy">Commands are governed executions. Dispatches are the raw shell lines Niyam intercepted before it decided whether to create a governed command, let the shell line stay local, or block it.</div>
                    </div>
                </div>
                <div class="surface-section-copy">That means every remote governed command starts as a dispatch, but local passthroughs only appear in the Dispatches view.</div>
            </div>
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Dispatch Routes</div>
                        <div class="surface-section-copy">Use the Dispatches page to understand how Niyam handled intercepted shell traffic.</div>
                    </div>
                </div>
                <div style="display:grid;gap:12px">
                    <div>
                        <span class="status-badge approved">Remote Exec</span>
                        <div class="surface-section-copy">Turned into a governed command.</div>
                    </div>
                    <div>
                        <span class="status-badge pending">Local Passthrough</span>
                        <div class="surface-section-copy">Stayed in the local shell.</div>
                    </div>
                    <div>
                        <span class="status-badge rejected">Blocked</span>
                        <div class="surface-section-copy">Stopped before execution.</div>
                    </div>
                </div>
                <div style="margin-top:16px">
                    <a class="btn btn-secondary btn-sm" href="#history">Open Activity</a>
                </div>
            </div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Recent Commands</div>
                        <div class="surface-section-copy">Latest command submissions and their current approval or execution state.</div>
                    </div>
                </div>
                <div class="activity-feed" id="recent-activity"></div>
            </div>
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Pending Queue</div>
                        <div class="surface-section-copy">Commands waiting for approval, ordered by recency.</div>
                    </div>
                </div>
                <div id="pending-preview"></div>
            </div>
        </section>
    `;
    
    loadDashboardStats();
    loadRecentActivity();
    loadPendingPreview();
    updatePendingBadge();
}

async function loadDashboardStats() {
    try {
        const response = await apiFetch('/commands/stats/summary');
        const stats = await response.json();
        
        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-pending').textContent = stats.pending || 0;
        document.getElementById('stat-high').textContent = stats.byRiskLevel?.HIGH || 0;
        document.getElementById('stat-medium').textContent = stats.byRiskLevel?.MEDIUM || 0;
        document.getElementById('stat-low').textContent = stats.byRiskLevel?.LOW || 0;
    } catch (e) {
        document.getElementById('stat-total').textContent = '?';
    }
}

async function loadRecentActivity() {
    try {
        const response = await apiFetch('/commands?limit=10');
        const data = await response.json();
        
        const feed = document.getElementById('recent-activity');
        
        if (!data.commands || data.commands.length === 0) {
            feed.innerHTML = renderEmptyState('No recent activity', 'activity');
            return;
        }

        feed.innerHTML = data.commands.map(command => `
            <div class="activity-item">
                <span class="activity-icon">${renderCommandStatusChip(command)}</span>
                <div class="activity-content">
                    <div class="activity-title"><code>${escapeHtml(buildCommandLineDisplay(command))}</code></div>
                    <div class="activity-time">${escapeHtml(describeActorWithAuth(command.requester, command.authenticationContext))} · ${escapeHtml(command.status)}${hasAutoApprovalAssist(command) ? ' · auto approval' : ''} · ${timeAgo(command.created_at)}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('recent-activity').innerHTML = renderEmptyState('Failed to load activity', 'blocked');
    }
}

async function loadPendingPreview() {
    try {
        const response = await apiFetch('/commands?status=pending&limit=5');
        const data = await response.json();
        
        const container = document.getElementById('pending-preview');
        
        if (!data.commands || data.commands.length === 0) {
            container.innerHTML = renderEmptyState('No pending commands', 'done');
            return;
        }
        
        container.innerHTML = `<div class="pending-preview-list">${
            data.commands.map(cmd => `
            <div class="pending-preview-item review-preview-btn"
                data-id="${cmd.id}"
                data-risk="${cmd.risk_level}"
                data-command="${encodeURIComponent(buildCommandLineDisplay(cmd))}">
                <div class="pending-preview-main">
                    <div class="pending-preview-head">
                        <span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span>
                        <code class="pending-preview-command">${escapeHtml(buildCommandLineDisplay(cmd))}</code>
                    </div>
                    <div class="pending-preview-meta">${escapeHtml(describeActorWithAuth(cmd.requester, cmd.authenticationContext))} · ${timeAgo(cmd.created_at)} · ${formatApprovalProgress(cmd)}${hasAutoApprovalAssist(cmd) ? ' · auto approval active' : ''}</div>
                </div>
                <div class="pending-preview-timer">
                    ${renderTimer(cmd.timeout_at, cmd.created_at, 'bar')}
                </div>
            </div>
        `).join('')
        }</div>`;

        container.querySelectorAll('.review-preview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                openApprovalModal(
                    btn.dataset.id,
                    decodeURIComponent(btn.dataset.command || ''),
                    btn.dataset.risk
                );
            });
        });
    } catch (e) {
        document.getElementById('pending-preview').innerHTML = renderEmptyState('Failed to load pending preview', 'blocked');
    }
}

function formatEventType(type) {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function renderCommandStatusChip(command) {
    const status = String(command.status || 'pending').toLowerCase();
    if (status === 'completed') return renderEventChip('OK', 'approved');
    if (status === 'failed' || status === 'rejected') return renderEventChip('ER', 'error');
    if (status === 'pending') return renderEventChip('PD', 'warning');
    if (status === 'executing') return renderEventChip('EX');
    return renderEventChip('CM');
}
