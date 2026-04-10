/**
 * Dashboard Page - Overview with stats and recent activity
 */

function renderDashboard(container) {
    container.innerHTML = `
        <div class="stats-grid" id="stats-grid">
            <div class="stat-card total"><div class="stat-label">Total Commands</div><div class="stat-value total" id="stat-total">-</div></div>
            <div class="stat-card pending"><div class="stat-label">Pending</div><div class="stat-value pending" id="stat-pending">-</div></div>
            <div class="stat-card high"><div class="stat-label">High Risk</div><div class="stat-value high" id="stat-high">-</div></div>
            <div class="stat-card medium"><div class="stat-label">Medium Risk</div><div class="stat-value medium" id="stat-medium">-</div></div>
            <div class="stat-card low"><div class="stat-label">Low Risk</div><div class="stat-value low" id="stat-low">-</div></div>
        </div>
        <div class="grid-2">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Recent Activity</span>
                </div>
                <div class="activity-feed" id="recent-activity"></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Pending Commands</span>
                </div>
                <div id="pending-preview"></div>
            </div>
        </div>
    `;
    
    loadDashboardStats();
    loadRecentActivity();
    loadPendingPreview();
    updatePendingBadge();
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/commands/stats/summary`);
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
        const response = await fetch(`${API_BASE}/audit?limit=10`);
        const data = await response.json();
        
        const feed = document.getElementById('recent-activity');
        
        if (!data.entries || data.entries.length === 0) {
            feed.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No recent activity</div></div>';
            return;
        }
        
        const icons = {
            command_submitted: '📤',
            command_approved: '✅',
            command_rejected: '❌',
            command_executed: '⚡',
            command_failed: '💥',
            command_blocked: '🚫',
            command_timeout: '⏰',
            approval_granted: '👍',
            rule_created: '📝',
            rule_updated: '✏️',
            rule_deleted: '🗑️'
        };
        
        feed.innerHTML = data.entries.map(entry => `
            <div class="activity-item">
                <span class="activity-icon">${icons[entry.event_type] || '📌'}</span>
                <div class="activity-content">
                    <div class="activity-title">${formatEventType(entry.event_type)} ${entry.details?.command ? '→ <code>' + escapeHtml(entry.details.command) + '</code>' : ''}</div>
                    <div class="activity-time">${entry.actor} · ${timeAgo(entry.created_at)}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('recent-activity').innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load activity</div></div>';
    }
}

async function loadPendingPreview() {
    try {
        const response = await fetch(`${API_BASE}/commands?status=pending&limit=5`);
        const data = await response.json();
        
        const container = document.getElementById('pending-preview');
        
        if (!data.commands || data.commands.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-text">No pending commands</div></div>';
            return;
        }
        
        container.innerHTML = data.commands.map(cmd => `
            <div class="activity-item" style="cursor:pointer" onclick="openApprovalModal('${cmd.id}', '${escapeHtml(cmd.command)}', '${cmd.risk_level}')">
                <span class="activity-icon"><span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span></span>
                <div class="activity-content" style="flex:1">
                    <div class="activity-title"><code>${escapeHtml(cmd.command)}</code></div>
                    <div class="activity-time">${cmd.requester} · ${timeAgo(cmd.created_at)} · ${cmd.approval_count}/${cmd.required_approvals} approvals</div>
                </div>
                ${renderTimer(cmd.timeout_at, cmd.created_at, 'bar')}
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('pending-preview').innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load</div></div>';
    }
}

function formatEventType(type) {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
