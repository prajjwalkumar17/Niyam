/**
 * Command History Page
 */

function renderHistory(container) {
    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Execution History</div>
                <p class="workspace-subtitle">Browse completed, failed, rejected, and timed-out commands with redaction and execution context preserved.</p>
            </div>
            <div class="workspace-controls">
                <select class="filter-select" id="history-status-filter">
                    <option value="">All Statuses</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="rejected">Rejected</option>
                    <option value="approved">Approved</option>
                    <option value="timeout">Timed Out</option>
                </select>
                <select class="filter-select" id="history-risk-filter">
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
                    <div class="card-title">Command Archive</div>
                    <div class="surface-section-copy">Completed, failed, rejected, and timed-out commands from the current instance.</div>
                </div>
            </div>
            <div class="command-stream" id="history-list">
                ${renderEmptyState('Loading command history...', 'history')}
            </div>
        </section>
    `;
    
    document.getElementById('history-status-filter').addEventListener('change', loadHistoryPage);
    document.getElementById('history-risk-filter').addEventListener('change', loadHistoryPage);
    loadHistoryPage();
}

async function loadHistoryPage() {
    const statusFilter = document.getElementById('history-status-filter').value;
    const riskFilter = document.getElementById('history-risk-filter').value;
    
    try {
        let url = `${API_BASE}/commands?limit=100`;
        if (statusFilter) url += `&status=${statusFilter}`;
        if (riskFilter) url += `&riskLevel=${riskFilter}`;
        
        const response = await apiFetch(url);
        const data = await response.json();
        
        const list = document.getElementById('history-list');
        
        if (!data.commands || data.commands.length === 0) {
            list.innerHTML = renderEmptyState('No commands in history', 'history');
            return;
        }
        
        list.innerHTML = data.commands.map(cmd => `
            <article class="command-stream-card fade-in">
                <div class="command-stream-head">
                    <div class="command-stream-main">
                        <div class="command-stream-badges">
                            <span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span>
                            <span class="status-badge ${cmd.status}">${cmd.status}</span>
                            ${cmd.redacted ? '<span class="status-badge rejected">Redacted</span>' : ''}
                        </div>
                        <div class="command-stream-title"><code>${escapeHtml(buildCommandLineDisplay(cmd))}</code></div>
                        <div class="command-stream-subtitle">${escapeHtml(cmd.requester)} · ${timeAgo(cmd.created_at)} · ${cmd.approval_count}/${cmd.required_approvals} approvals</div>
                    </div>
                    <div class="command-stream-side">
                        <div class="history-exit-code">${cmd.exit_code !== null ? `Exit ${cmd.exit_code}` : 'No exit code'}</div>
                    </div>
                </div>
                <div class="command-stream-meta-row">
                    <span class="command-stream-meta-pill">Requester · ${escapeHtml(cmd.requester)}</span>
                    <span class="command-stream-meta-pill">Approvals · ${cmd.approval_count}/${cmd.required_approvals}</span>
                    <span class="command-stream-meta-pill">${cmd.executed_at ? `Executed · ${formatTime(cmd.executed_at)}` : `Created · ${formatTime(cmd.created_at)}`}</span>
                    ${cmd.execution_mode ? `<span class="command-stream-meta-pill">Mode · ${escapeHtml(cmd.execution_mode)}</span>` : ''}
                </div>
                <div class="command-stream-actions">
                    <button class="btn btn-secondary btn-sm" onclick="showCommandDetail('${cmd.id}')">View Details</button>
                </div>
            </article>
        `).join('');
    } catch (e) {
        document.getElementById('history-list').innerHTML = renderEmptyState('Failed to load history', 'blocked');
    }
}

async function showCommandDetail(commandId) {
    try {
        const response = await apiFetch(`/commands/${commandId}`);
        const cmd = await response.json();
        
        const output = cmd.output ? escapeHtml(cmd.output.substring(0, 500)) : 'No output';
        const error = cmd.error ? escapeHtml(cmd.error) : '';
        
        const detailHtml = `
            <div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px">
                <div style="margin-bottom:8px"><strong>Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(buildCommandLineDisplay(cmd))}</code></div>
                ${cmd.redacted ? '<div style="margin-bottom:8px"><span class="status-badge rejected">Redacted</span> <span class="text-sm text-muted">Sensitive values were removed before storage.</span></div>' : ''}
                <div style="margin-bottom:8px"><strong>Risk:</strong> <span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span></div>
                <div style="margin-bottom:8px"><strong>Status:</strong> <span class="status-badge ${cmd.status}">${cmd.status}</span></div>
                <div style="margin-bottom:8px"><strong>Requester:</strong> ${escapeHtml(cmd.requester)}</div>
                ${cmd.executed_at ? `<div style="margin-bottom:8px"><strong>Executed:</strong> ${formatTime(cmd.executed_at)}</div>` : ''}
                ${error ? `<div style="margin-bottom:8px;color:var(--accent-red)"><strong>Error:</strong> ${error}</div>` : ''}
                <div style="margin-top:12px"><strong>Output:</strong><pre style="margin-top:8px;padding:12px;background:rgba(0,0,0,0.3);border-radius:6px;overflow-x:auto;font-size:12px;color:var(--text-secondary);white-space:pre-wrap">${output}</pre></div>
            </div>
        `;
        
        // Show in approval modal structure
        document.getElementById('approval-modal-title').textContent = 'Command Detail';
        document.getElementById('approval-command-detail').innerHTML = detailHtml;
        document.getElementById('approval-rationale').parentElement.style.display = 'none';
        document.getElementById('approve-btn').style.display = 'none';
        document.getElementById('reject-btn').textContent = 'Close';
        document.getElementById('approval-modal').style.display = 'flex';
        
        // Override reject button to just close
        document.getElementById('reject-btn').onclick = () => {
            document.getElementById('approval-modal').style.display = 'none';
            document.getElementById('approval-rationale').parentElement.style.display = '';
            document.getElementById('approve-btn').style.display = '';
            document.getElementById('reject-btn').textContent = 'Reject';
            document.getElementById('reject-btn').onclick = () => processApproval('reject');
        };
    } catch (e) {
        showNotification('Failed to load command detail', 'error');
    }
}
