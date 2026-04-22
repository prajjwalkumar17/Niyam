/**
 * Pending Approvals Page
 */

function renderPending(container) {
    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Approval Queue</div>
                <p class="workspace-subtitle">Review pending commands with time windows, requester identity, and approval state visible up front.</p>
            </div>
            <div class="workspace-controls">
                <select class="filter-select" id="pending-risk-filter">
                    <option value="">All Risk Levels</option>
                    <option value="HIGH">High Risk</option>
                    <option value="MEDIUM">Medium Risk</option>
                    <option value="LOW">Low Risk</option>
                </select>
            </div>
        </section>
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Pending Commands</div>
                    <div class="surface-section-copy">Commands still waiting for human approval or multi-step consensus.</div>
                </div>
            </div>
            <div class="command-stream" id="pending-list">
                ${renderEmptyState('Loading pending commands...', 'pending')}
            </div>
        </section>
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
        
        const response = await apiFetch(url);
        const data = await response.json();
        
        const list = document.getElementById('pending-list');
        
        if (!data.commands || data.commands.length === 0) {
            list.innerHTML = renderEmptyState('No pending commands', 'done');
            return;
        }
        
        list.innerHTML = data.commands.map(cmd => `
            <article class="command-stream-card fade-in">
                <div class="command-stream-head">
                    <div class="command-stream-main">
                        <div class="command-stream-badges">
                            <span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span>
                            <span class="status-badge pending">Pending</span>
                        </div>
                        <div class="command-stream-title"><code>${escapeHtml(buildCommandLineDisplay(cmd))}</code></div>
                        <div class="command-stream-subtitle">${escapeHtml(cmd.requester)} · ${timeAgo(cmd.created_at)} · ${escapeHtml(formatApprovalProgress(cmd))}</div>
                    </div>
                    <div class="command-stream-timer">${renderTimer(cmd.timeout_at, cmd.created_at, 'ring')}</div>
                </div>
                <div class="command-stream-meta-row">
                    <span class="command-stream-meta-pill">Requester · ${escapeHtml(cmd.requester)}</span>
                    <span class="command-stream-meta-pill">Approvals · ${escapeHtml(formatApprovalProgress(cmd))}</span>
                    <span class="command-stream-meta-pill">Approved By · ${escapeHtml((cmd.approvedBy || []).join(', ') || 'No approvals yet')}</span>
                    <span class="command-stream-meta-pill">Window · ${formatTimeout(cmd.timeout_at)}</span>
                    ${cmd.rationale_required ? '<span class="command-stream-meta-pill">Rationale required</span>' : ''}
                </div>
                <div class="command-stream-actions">
                    <button class="btn btn-success btn-sm review-btn"
                        data-id="${cmd.id}"
                        data-risk="${cmd.risk_level}"
                        data-command="${encodeURIComponent(buildCommandLineDisplay(cmd))}">Review Command</button>
                </div>
            </article>
        `).join('');

        // Attach click handlers safely (avoids inline onclick escaping issues)
        list.querySelectorAll('.review-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const risk = btn.dataset.risk;
                const command = decodeURIComponent(btn.dataset.command || '');
                openApprovalModal(id, command, risk);
            });
        });
    } catch (e) {
        document.getElementById('pending-list').innerHTML = renderEmptyState('Failed to load pending commands', 'blocked');
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
