/**
 * Pending Approvals Page
 */

function renderPending(container) {
    container.innerHTML = `
        <div class="filters">
            <select class="filter-select" id="pending-risk-filter">
                <option value="">All Risk Levels</option>
                <option value="HIGH">High Risk</option>
                <option value="MEDIUM">Medium Risk</option>
                <option value="LOW">Low Risk</option>
            </select>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>Risk</th>
                        <th>Requester</th>
                        <th>Approvals</th>
                        <th>Timeout</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="pending-table-body">
                    <tr><td colspan="7" style="text-align:center;padding:40px">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    `;
    
    document.getElementById('pending-risk-filter').addEventListener('change', loadPendingPage);
    loadPendingPage();
    updatePendingBadge();
}

async function loadPendingPage() {
    const riskFilter = document.getElementById('pending-risk-filter').value;
    
    try {
        let url = `${API_BASE}/commands?status=pending&limit=50`;
        if (riskFilter) url += `&riskLevel=${riskFilter}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        const tbody = document.getElementById('pending-table-body');
        
        if (!data.commands || data.commands.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-text">No pending commands</div></div></td></tr>';
            return;
        }
        
        tbody.innerHTML = data.commands.map(cmd => `
            <tr class="fade-in">
                <td><code style="color:var(--accent-cyan)">${escapeHtml(cmd.command)}</code></td>
                <td><span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span></td>
                <td>${escapeHtml(cmd.requester)}</td>
                <td>${cmd.approval_count}/${cmd.required_approvals}</td>
                <td>${renderTimer(cmd.timeout_at, cmd.created_at, 'ring')}</td>
                <td class="text-sm text-muted">${timeAgo(cmd.created_at)}</td>
                <td>
                    <button class="btn btn-success btn-sm review-btn"
                        data-id="${cmd.id}"
                        data-risk="${cmd.risk_level}"
                        data-command="${encodeURIComponent(cmd.command)}">Review</button>
                </td>
            </tr>
        `).join('');

        // Attach click handlers safely (avoids inline onclick escaping issues)
        tbody.querySelectorAll('.review-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const risk = btn.dataset.risk;
                const command = decodeURIComponent(btn.dataset.command || '');
                openApprovalModal(id, command, risk);
            });
        });
    } catch (e) {
        document.getElementById('pending-table-body').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--accent-red)">Failed to load</td></tr>';
    }
}

function formatTimeout(isoString) {
    if (!isoString) return '-';
    const diff = new Date(isoString) - new Date();
    if (diff < 0) return 'Expired';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function isExpiringSoon(isoString) {
    if (!isoString) return false;
    const diff = new Date(isoString) - new Date();
    return diff > 0 && diff < 3600000; // Less than 1 hour
}
