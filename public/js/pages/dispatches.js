/**
 * CLI Dispatches Page
 */

function renderDispatches(container) {
    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Shell Dispatches</div>
                <p class="workspace-subtitle">Dispatches are the raw shell lines Niyam intercepted before it decided to run them as governed commands, allow them locally, or block them.</p>
            </div>
            <div class="workspace-controls">
                <select class="filter-select" id="dispatch-route-filter">
                    <option value="">All Routes</option>
                    <option value="REMOTE_EXEC">Remote Exec</option>
                    <option value="LOCAL_PASSTHROUGH">Local Passthrough</option>
                    <option value="BLOCKED">Blocked</option>
                </select>
                <select class="filter-select" id="dispatch-status-filter">
                    <option value="">All States</option>
                    <option value="linked_command">Linked Command</option>
                    <option value="created">Created</option>
                    <option value="blocked">Blocked</option>
                    <option value="local_completed">Local Completed</option>
                    <option value="local_failed">Local Failed</option>
                </select>
            </div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">What A Dispatch Is</div>
                        <div class="surface-section-copy">Every command typed in a wrapped shell creates a dispatch first. It is the interception record before Niyam decides what to do next.</div>
                    </div>
                </div>
                <div class="surface-section-copy">If Niyam turns that shell line into a governed command, you will also see it in Pending, History, and Audit. If Niyam lets it stay local, this page is the main record of that decision.</div>
            </div>
            <div class="surface-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">How To Read Routes</div>
                        <div class="surface-section-copy">The route tells you what Niyam decided to do with the intercepted shell line.</div>
                    </div>
                </div>
                <div style="display:grid;gap:12px">
                    <div>
                        <span class="status-badge approved">Remote Exec</span>
                        <div class="surface-section-copy">Niyam created a governed command and sent it through policy, approvals, and execution tracking.</div>
                    </div>
                    <div>
                        <span class="status-badge pending">Local Passthrough</span>
                        <div class="surface-section-copy">Niyam observed the shell line but allowed it to stay local in the user shell instead of creating a governed command.</div>
                    </div>
                    <div>
                        <span class="status-badge rejected">Blocked</span>
                        <div class="surface-section-copy">Niyam stopped the shell line before execution because a rule or policy denied it.</div>
                    </div>
                </div>
            </div>
        </section>
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Dispatch Stream</div>
                    <div class="surface-section-copy">Every intercepted shell line that entered Niyam before local or remote execution.</div>
                </div>
            </div>
            <div class="command-stream" id="dispatch-list">
                ${renderEmptyState('Loading shell dispatches...', 'activity')}
            </div>
        </section>
    `;

    document.getElementById('dispatch-route-filter').addEventListener('change', loadDispatchesPage);
    document.getElementById('dispatch-status-filter').addEventListener('change', loadDispatchesPage);
    loadDispatchesPage();
}

async function loadDispatchesPage() {
    const routeFilter = document.getElementById('dispatch-route-filter').value;
    const statusFilter = document.getElementById('dispatch-status-filter').value;

    try {
        let url = `${API_BASE}/cli/dispatches?limit=100`;
        if (routeFilter) url += `&route=${encodeURIComponent(routeFilter)}`;
        if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;

        const response = await apiFetch(url);
        const data = await response.json();
        const list = document.getElementById('dispatch-list');

        if (!data.dispatches || data.dispatches.length === 0) {
            list.innerHTML = renderEmptyState('No shell dispatches found', 'activity');
            return;
        }

        list.innerHTML = data.dispatches.map(dispatch => `
            <article class="command-stream-card fade-in">
                <div class="command-stream-head">
                    <div class="command-stream-main">
                        <div class="command-stream-badges">
                            <span class="risk-badge ${dispatch.risk_level.toLowerCase()}">${dispatch.risk_level}</span>
                            <span class="status-badge ${dispatchBadgeTone(dispatch.route)}">${formatDispatchRoute(dispatch.route)}</span>
                            <span class="status-badge ${dispatchStatusTone(dispatch.status)}">${escapeHtml(dispatch.status)}</span>
                            ${dispatch.redacted ? '<span class="status-badge rejected">Redacted</span>' : ''}
                        </div>
                        <div class="command-stream-title"><code>${escapeHtml(dispatch.command)}</code></div>
                        <div class="command-stream-subtitle">${escapeHtml(describeActorWithAuth(dispatch.requester, dispatch.authenticationContext))} · ${timeAgo(dispatch.created_at)} · ${escapeHtml(dispatch.shell || 'unknown shell')}</div>
                    </div>
                    <div class="command-stream-side">
                        <div class="history-exit-code">${renderDispatchOutcome(dispatch)}</div>
                    </div>
                </div>
                <div class="command-stream-meta-row">
                    ${renderAuthenticationMetaPill(dispatch.requester, dispatch.authenticationContext)}
                    <span class="command-stream-meta-pill">First shell token · ${escapeHtml(dispatch.first_token || 'n/a')}</span>
                    <span class="command-stream-meta-pill">First shell token type · ${escapeHtml(dispatch.first_token_type || 'unknown')}</span>
                    ${dispatch.command_id ? `<span class="command-stream-meta-pill">Command · ${escapeHtml(dispatch.command_id)}</span>` : ''}
                    ${dispatch.working_dir ? `<span class="command-stream-meta-pill">Dir · ${escapeHtml(dispatch.working_dir)}</span>` : ''}
                    ${dispatch.execution_mode ? `<span class="command-stream-meta-pill">Mode · ${escapeHtml(dispatch.execution_mode)}</span>` : ''}
                </div>
                <div class="command-stream-actions">
                    <button class="btn btn-secondary btn-sm" onclick="showDispatchDetail('${dispatch.id}')">View Details</button>
                    ${dispatch.command_id ? `<button class="btn btn-secondary btn-sm" onclick="showCommandDetail('${dispatch.command_id}')">Linked Command</button>` : ''}
                </div>
            </article>
        `).join('');
    } catch (error) {
        document.getElementById('dispatch-list').innerHTML = renderEmptyState('Failed to load shell dispatches', 'blocked');
    }
}

async function showDispatchDetail(dispatchId) {
    try {
        const response = await apiFetch(`/cli/dispatches/${dispatchId}`);
        const dispatch = await response.json();
        const detailHtml = `
            <div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px">
                <div style="margin-bottom:8px"><strong>Command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(dispatch.command)}</code></div>
                <div style="margin-bottom:8px"><strong>Route:</strong> <span class="status-badge ${dispatchBadgeTone(dispatch.route)}">${formatDispatchRoute(dispatch.route)}</span></div>
                <div style="margin-bottom:8px"><strong>Status:</strong> <span class="status-badge ${dispatchStatusTone(dispatch.status)}">${escapeHtml(dispatch.status)}</span></div>
                <div style="margin-bottom:8px"><strong>Shell:</strong> ${escapeHtml(dispatch.shell || 'unknown')}</div>
                <div style="margin-bottom:8px"><strong>Requester:</strong> ${escapeHtml(describeActorWithAuth(dispatch.requester, dispatch.authenticationContext))}</div>
                <div style="margin-bottom:8px"><strong>First shell token:</strong> ${escapeHtml(dispatch.first_token || 'n/a')} · ${escapeHtml(dispatch.first_token_type || 'unknown')}</div>
                ${dispatch.reason ? `<div style="margin-bottom:8px"><strong>Reason:</strong> ${escapeHtml(dispatch.reason)}</div>` : ''}
                ${dispatch.working_dir ? `<div style="margin-bottom:8px"><strong>Working dir:</strong> ${escapeHtml(dispatch.working_dir)}</div>` : ''}
                ${dispatch.command_id ? `<div style="margin-bottom:8px"><strong>Linked command:</strong> <code style="color:var(--accent-cyan)">${escapeHtml(dispatch.command_id)}</code></div>` : ''}
                ${dispatch.local_exit_code !== null && dispatch.local_exit_code !== undefined ? `<div style="margin-bottom:8px"><strong>Local exit:</strong> ${dispatch.local_exit_code}</div>` : ''}
                ${dispatch.duration_ms !== null && dispatch.duration_ms !== undefined ? `<div style="margin-bottom:8px"><strong>Duration:</strong> ${dispatch.duration_ms}ms</div>` : ''}
                ${dispatch.redacted ? '<div style="margin-bottom:8px"><span class="status-badge rejected">Redacted</span> <span class="text-sm text-muted">Sensitive values were removed before storage.</span></div>' : ''}
                <div style="margin-top:12px"><strong>Metadata:</strong><pre style="margin-top:8px;padding:12px;background:rgba(0,0,0,0.3);border-radius:6px;overflow-x:auto;font-size:12px;color:var(--text-secondary);white-space:pre-wrap">${escapeHtml(JSON.stringify(dispatch.metadata || {}, null, 2))}</pre></div>
            </div>
        `;

        document.getElementById('approval-modal-title').textContent = 'CLI Dispatch Detail';
        document.getElementById('approval-command-detail').innerHTML = detailHtml;
        document.getElementById('approval-rationale').parentElement.style.display = 'none';
        document.getElementById('approve-btn').style.display = 'none';
        document.getElementById('reject-btn').textContent = 'Close';
        document.getElementById('approval-modal').style.display = 'flex';

        document.getElementById('reject-btn').onclick = () => {
            document.getElementById('approval-modal').style.display = 'none';
            document.getElementById('approval-rationale').parentElement.style.display = '';
            document.getElementById('approve-btn').style.display = '';
            document.getElementById('reject-btn').textContent = 'Reject';
            document.getElementById('reject-btn').onclick = () => processApproval('reject');
        };
    } catch (error) {
        showNotification('Failed to load CLI dispatch detail', 'error');
    }
}

function formatDispatchRoute(route) {
    return String(route || '')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function dispatchBadgeTone(route) {
    if (route === 'REMOTE_EXEC') return 'approved';
    if (route === 'BLOCKED') return 'rejected';
    return 'pending';
}

function dispatchStatusTone(status) {
    if (status === 'blocked' || status === 'local_failed') return 'rejected';
    if (status === 'local_completed' || status === 'linked_command') return 'approved';
    return 'pending';
}

function renderDispatchOutcome(dispatch) {
    if (dispatch.command_id) {
        return 'Linked';
    }
    if (dispatch.local_exit_code !== null && dispatch.local_exit_code !== undefined) {
        return `Exit ${dispatch.local_exit_code}`;
    }
    return escapeHtml(dispatch.status || 'Pending');
}
