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
                        <div class="card-title">Recent Activity</div>
                        <div class="surface-section-copy">Latest policy decisions, approvals, and execution events.</div>
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
        const response = await apiFetch('/audit?limit=10');
        const data = await response.json();
        
        const feed = document.getElementById('recent-activity');
        
        if (!data.entries || data.entries.length === 0) {
            feed.innerHTML = renderEmptyState('No recent activity', 'activity');
            return;
        }
        
        const icons = {
            command_submitted: renderEventChip('SB'),
            command_approved: renderEventChip('OK', 'approved'),
            command_rejected: renderEventChip('NO', 'rejected'),
            command_executed: renderEventChip('EX'),
            command_failed: renderEventChip('ER', 'error'),
            command_blocked: renderEventChip('BL', 'warning'),
            command_timeout: renderEventChip('TM', 'warning'),
            approval_granted: renderEventChip('AP', 'approved'),
            rule_created: renderEventChip('RC'),
            rule_updated: renderEventChip('RU'),
            rule_deleted: renderEventChip('RD', 'rejected'),
            rule_pack_installed: renderEventChip('PK'),
            rule_pack_upgrade_previewed: renderEventChip('PV'),
            rule_pack_upgraded: renderEventChip('UP')
        };
        
        feed.innerHTML = data.entries.map(entry => `
            <div class="activity-item">
                <span class="activity-icon">${icons[entry.event_type] || renderEventChip('EV')}</span>
                <div class="activity-content">
                    <div class="activity-title">${formatEventType(entry.event_type)} ${entry.details?.command ? '→ <code>' + escapeHtml(entry.details.command) + '</code>' : ''}</div>
                    <div class="activity-time">${entry.actor} · ${timeAgo(entry.created_at)}</div>
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
                    <div class="pending-preview-meta">${cmd.requester} · ${timeAgo(cmd.created_at)} · ${cmd.approval_count}/${cmd.required_approvals} approvals</div>
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
