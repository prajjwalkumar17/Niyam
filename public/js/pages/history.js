/**
 * Command History Page
 */

function renderHistory(container) {
    container.innerHTML = `
        <div class="filters">
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
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>Risk</th>
                        <th>Status</th>
                        <th>Requester</th>
                        <th>Approvals</th>
                        <th>Exit Code</th>
                        <th>Time</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="history-table-body">
                    <tr><td colspan="8" style="text-align:center;padding:40px">Loading...</td></tr>
                </tbody>
            </table>
        </div>
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
        
        const tbody = document.getElementById('history-table-body');
        
        if (!data.commands || data.commands.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📜</div><div class="empty-state-text">No commands in history</div></div></td></tr>';
            return;
        }
        
        tbody.innerHTML = data.commands.map(cmd => `
            <tr class="fade-in">
                <td>
                    <code style="color:var(--accent-cyan);font-size:12px">${escapeHtml(cmd.command)}</code>
                    ${cmd.redacted ? '<span class="status-badge rejected" style="margin-left:8px">Redacted</span>' : ''}
                </td>
                <td><span class="risk-badge ${cmd.risk_level.toLowerCase()}">${cmd.risk_level}</span></td>
                <td><span class="status-badge ${cmd.status}">${cmd.status}</span></td>
                <td>${escapeHtml(cmd.requester)}</td>
                <td>${cmd.approval_count}/${cmd.required_approvals}</td>
                <td>${cmd.exit_code !== null ? cmd.exit_code : '-'}</td>
                <td>${cmd.status === 'pending' ? renderTimer(cmd.timeout_at, cmd.created_at, 'bar') : `<span class="text-sm text-muted">${timeAgo(cmd.created_at)}</span>`}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="showCommandDetail('${cmd.id}')">View</button></td>
            </tr>
        `).join('');
    } catch (e) {
        document.getElementById('history-table-body').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--accent-red)">Failed to load</td></tr>';
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
                <div style="margin-bottom:8px"><strong>Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(cmd.command)}</code></div>
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
