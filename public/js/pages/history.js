/**
 * Activity Page - Merged governed commands + shell dispatches
 */

let historyPageState = {
    guideCollapsed: true
};

function renderHistory(container) {
    const isAdmin = isAdminPrincipal(state.principal);

    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Activity</div>
                <p class="workspace-subtitle">One timeline for governed commands and intercepted shell lines, so remote executions, local passthroughs, and blocked shell decisions all live in one place.</p>
            </div>
            <div class="workspace-controls">
                ${isAdmin ? `
                    <select class="filter-select" id="activity-type-filter">
                        <option value="">All Activity</option>
                        <option value="governed">Governed Commands</option>
                        <option value="local_passthrough">Local Passthroughs</option>
                        <option value="blocked">Blocked Shell Lines</option>
                    </select>
                ` : ''}
                <select class="filter-select" id="history-status-filter">
                    <option value="">All Outcomes</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="rejected">Rejected</option>
                    <option value="timeout">Timed Out</option>
                    ${isAdmin ? `
                        <option value="local_completed">Local Completed</option>
                        <option value="local_failed">Local Failed</option>
                        <option value="blocked">Blocked</option>
                    ` : ''}
                </select>
                <select class="filter-select" id="history-risk-filter">
                    <option value="">All Risk Levels</option>
                    <option value="HIGH">High Risk</option>
                    <option value="MEDIUM">Medium Risk</option>
                    <option value="LOW">Low Risk</option>
                </select>
            </div>
        </section>
        ${renderActivityGuide(isAdmin)}
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Activity Stream</div>
                    <div class="surface-section-copy">Merged timeline of governed commands and shell intake decisions.</div>
                </div>
            </div>
            <div class="command-stream" id="history-list">
                ${renderEmptyState('Loading activity...', 'history')}
            </div>
        </section>
    `;

    const statusFilter = document.getElementById('history-status-filter');
    const riskFilter = document.getElementById('history-risk-filter');
    statusFilter.addEventListener('change', loadHistoryPage);
    riskFilter.addEventListener('change', loadHistoryPage);

    const activityTypeFilter = document.getElementById('activity-type-filter');
    if (activityTypeFilter) {
        activityTypeFilter.addEventListener('change', loadHistoryPage);
    }

    initActivityGuide();
    loadHistoryPage();
}

function renderActivityGuide(isAdmin) {
    return `
        <section class="surface-card fade-in activity-guide ${historyPageState.guideCollapsed ? 'is-collapsed' : ''}" id="activity-guide">
            <div class="activity-guide-head">
                <div class="activity-guide-copy">
                    <div class="card-title">Activity Guide</div>
                    <div class="surface-section-copy">How governed commands, local passthroughs, and blocked shell lines show up in one merged stream.</div>
                </div>
                <div class="activity-guide-summary">
                    <span class="status-badge approved">Governed</span>
                    ${isAdmin ? '<span class="status-badge pending">Passthrough</span>' : ''}
                    ${isAdmin ? '<span class="status-badge rejected">Blocked</span>' : ''}
                </div>
                <button
                    class="btn btn-secondary activity-guide-toggle"
                    type="button"
                    id="activity-guide-toggle"
                    aria-controls="activity-guide-details"
                    aria-expanded="${historyPageState.guideCollapsed ? 'false' : 'true'}"
                >
                    ${historyPageState.guideCollapsed ? 'Show Guide' : 'Hide Guide'}
                </button>
            </div>
            <div class="activity-guide-details" id="activity-guide-details" aria-hidden="${historyPageState.guideCollapsed ? 'true' : 'false'}">
                <div class="activity-guide-panel">
                    <div class="activity-guide-panel-title">How Activity Works</div>
                    <div class="surface-section-copy">If a shell line became a governed command, it appears once here as a combined activity item. If it stayed local or got blocked before command creation, it still appears here as shell-only activity.</div>
                    <div class="surface-section-copy">That removes the old split between Command History and Shell Dispatches while keeping the shell-level trace when you need it.</div>
                </div>
                <div class="activity-guide-panel">
                    <div class="activity-guide-panel-title">What You Are Looking At</div>
                    <div class="surface-section-copy">${isAdmin
                        ? 'Admins see the full merged stream: governed commands plus shell-only passthrough and blocked intake decisions.'
                        : 'You are seeing governed command activity for your access scope. Shell-only intake decisions remain admin-only.'}
                    </div>
                    <div class="activity-guide-stack">
                        <div class="activity-guide-entry">
                            <span class="status-badge approved">Governed Command</span>
                            <div class="surface-section-copy">Niyam created a real command and tracked approvals, execution, and final outcome.</div>
                        </div>
                        ${isAdmin ? `
                            <div class="activity-guide-entry">
                                <span class="status-badge pending">Local Passthrough</span>
                                <div class="surface-section-copy">Niyam observed the shell line but left it in the local shell instead of creating a governed command.</div>
                            </div>
                            <div class="activity-guide-entry">
                                <span class="status-badge rejected">Blocked Shell Line</span>
                                <div class="surface-section-copy">Niyam stopped the shell line before execution based on rules or policy.</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </section>
    `;
}

function initActivityGuide() {
    const toggle = document.getElementById('activity-guide-toggle');
    if (!toggle) {
        return;
    }

    toggle.addEventListener('click', () => {
        historyPageState.guideCollapsed = !historyPageState.guideCollapsed;
        syncActivityGuideState();
    });
}

function syncActivityGuideState() {
    const guide = document.getElementById('activity-guide');
    const toggle = document.getElementById('activity-guide-toggle');
    const details = document.getElementById('activity-guide-details');
    if (!guide || !toggle || !details) {
        return;
    }

    guide.classList.toggle('is-collapsed', historyPageState.guideCollapsed);
    toggle.textContent = historyPageState.guideCollapsed ? 'Show Guide' : 'Hide Guide';
    toggle.setAttribute('aria-expanded', historyPageState.guideCollapsed ? 'false' : 'true');
    details.setAttribute('aria-hidden', historyPageState.guideCollapsed ? 'true' : 'false');
}

async function loadHistoryPage() {
    const isAdmin = isAdminPrincipal(state.principal);
    const statusFilter = document.getElementById('history-status-filter')?.value || '';
    const riskFilter = document.getElementById('history-risk-filter')?.value || '';
    const activityTypeFilter = document.getElementById('activity-type-filter')?.value || '';

    try {
        const commandStatuses = new Set(['pending', 'approved', 'completed', 'failed', 'rejected', 'timeout', 'executing']);
        let commandsUrl = `${API_BASE}/commands?limit=100`;
        if (statusFilter && commandStatuses.has(statusFilter)) {
            commandsUrl += `&status=${encodeURIComponent(statusFilter)}`;
        }
        if (riskFilter) {
            commandsUrl += `&riskLevel=${encodeURIComponent(riskFilter)}`;
        }

        const requests = [
            apiFetch(commandsUrl).then(response => response.json())
        ];

        if (isAdmin) {
            requests.push(apiFetch(`${API_BASE}/cli/dispatches?limit=100`).then(response => response.json()));
        }

        const [commandsData, dispatchesData] = await Promise.all(requests);
        const commands = Array.isArray(commandsData.commands) ? commandsData.commands : [];
        const dispatches = isAdmin && dispatchesData && Array.isArray(dispatchesData.dispatches)
            ? dispatchesData.dispatches
            : [];

        const activityItems = buildActivityItems(commands, dispatches, {
            isAdmin,
            statusFilter,
            riskFilter,
            activityTypeFilter
        });

        const list = document.getElementById('history-list');
        if (!activityItems.length) {
            list.innerHTML = renderEmptyState('No activity found for the current filters', 'history');
            return;
        }

        list.innerHTML = activityItems.map(renderActivityStreamItem).join('');
    } catch (error) {
        document.getElementById('history-list').innerHTML = renderEmptyState('Failed to load activity', 'blocked');
    }
}

function buildActivityItems(commands, dispatches, filters) {
    const commandMap = new Map(commands.map(command => [command.id, command]));
    const linkedDispatchByCommand = new Map();

    for (const dispatch of dispatches) {
        if (dispatch.command_id && !linkedDispatchByCommand.has(dispatch.command_id)) {
            linkedDispatchByCommand.set(dispatch.command_id, dispatch);
        }
    }

    const items = [];

    for (const command of commands) {
        if (!matchesCommandActivityFilters(command, filters)) {
            continue;
        }

        const linkedDispatch = linkedDispatchByCommand.get(command.id) || null;
        items.push({
            kind: 'governed',
            sortAt: command.created_at || command.executed_at || '',
            command,
            dispatch: linkedDispatch
        });
    }

    if (filters.isAdmin) {
        for (const dispatch of dispatches) {
            if (dispatch.command_id && commandMap.has(dispatch.command_id)) {
                continue;
            }
            if (!matchesDispatchActivityFilters(dispatch, filters)) {
                continue;
            }

            items.push({
                kind: 'dispatch_only',
                sortAt: dispatch.created_at || '',
                dispatch
            });
        }
    }

    return items.sort((left, right) => new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime());
}

function matchesCommandActivityFilters(command, filters) {
    if (filters.activityTypeFilter === 'local_passthrough' || filters.activityTypeFilter === 'blocked') {
        return false;
    }
    if (filters.riskFilter && command.risk_level !== filters.riskFilter) {
        return false;
    }
    if (filters.statusFilter && !matchesCommandStatus(command.status, filters.statusFilter)) {
        return false;
    }
    return true;
}

function matchesDispatchActivityFilters(dispatch, filters) {
    if (filters.activityTypeFilter === 'governed') {
        return false;
    }
    if (filters.activityTypeFilter === 'local_passthrough' && dispatch.route !== 'LOCAL_PASSTHROUGH') {
        return false;
    }
    if (filters.activityTypeFilter === 'blocked' && dispatch.route !== 'BLOCKED') {
        return false;
    }
    if (filters.riskFilter && dispatch.risk_level !== filters.riskFilter) {
        return false;
    }
    if (filters.statusFilter && !matchesDispatchStatus(dispatch, filters.statusFilter)) {
        return false;
    }
    return true;
}

function matchesCommandStatus(commandStatus, filterValue) {
    return String(commandStatus || '').toLowerCase() === String(filterValue || '').toLowerCase();
}

function matchesDispatchStatus(dispatch, filterValue) {
    const normalizedFilter = String(filterValue || '').toLowerCase();
    const normalizedStatus = String(dispatch.status || '').toLowerCase();
    const normalizedRoute = String(dispatch.route || '').toLowerCase();

    if (normalizedFilter === 'blocked') {
        return normalizedRoute === 'blocked' || normalizedStatus === 'blocked';
    }

    return normalizedStatus === normalizedFilter;
}

function renderActivityStreamItem(item) {
    if (item.kind === 'governed') {
        return renderGovernedActivityItem(item.command, item.dispatch);
    }
    return renderShellOnlyActivityItem(item.dispatch);
}

function renderGovernedActivityItem(command, dispatch) {
    const shellTrail = dispatch
        ? `Started in ${escapeHtml(dispatch.shell || 'shell')} · ${escapeHtml(formatDispatchRoute(dispatch.route))}`
        : 'Created directly in Niyam';
    const showApprovalTrail = shouldShowApprovalTrail(command);
    const approvedBy = Array.isArray(command.approvedBy) ? command.approvedBy.filter(Boolean) : [];
    const subtitleBits = [
        describeActorWithAuth(command.requester, command.authenticationContext),
        timeAgo(command.created_at)
    ];

    if (showApprovalTrail) {
        subtitleBits.push(formatApprovalProgress(command));
    }

    subtitleBits.push(shellTrail);

    return `
        <article class="command-stream-card fade-in">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge approved">Governed Command</span>
                        <span class="risk-badge ${command.risk_level.toLowerCase()}">${command.risk_level}</span>
                        <span class="status-badge ${escapeHtml(activityStatusTone(command.status))}">${escapeHtml(command.status)}</span>
                        ${dispatch ? `<span class="status-badge ${dispatchBadgeTone(dispatch.route)}">${escapeHtml(formatDispatchRoute(dispatch.route))}</span>` : ''}
                        ${command.redacted ? '<span class="status-badge rejected">Redacted</span>' : ''}
                    </div>
                    <div class="command-stream-title"><code>${escapeHtml(buildCommandLineDisplay(command))}</code></div>
                    <div class="command-stream-subtitle">${escapeHtml(subtitleBits.join(' · '))}</div>
                </div>
                <div class="command-stream-side">
                    <div class="history-exit-code">${renderGovernedOutcome(command)}</div>
                </div>
            </div>
            <div class="command-stream-meta-row">
                <span class="command-stream-meta-pill">Requester · ${escapeHtml(command.requester)}</span>
                ${renderAuthenticationMetaPill(command.requester, command.authenticationContext)}
                ${renderApprovalAutomationMetaPill(command)}
                ${showApprovalTrail ? `<span class="command-stream-meta-pill">Approvals · ${escapeHtml(formatApprovalProgress(command))}</span>` : ''}
                ${showApprovalTrail ? `<span class="command-stream-meta-pill">Approved By · ${escapeHtml(approvedBy.join(', ') || 'No approvals yet')}</span>` : ''}
                <span class="command-stream-meta-pill">${command.executed_at ? `Executed · ${formatTime(command.executed_at)}` : `Created · ${formatTime(command.created_at)}`}</span>
                ${command.execution_mode ? `<span class="command-stream-meta-pill">Mode · ${escapeHtml(command.execution_mode)}</span>` : ''}
                ${dispatch ? `<span class="command-stream-meta-pill">First shell token · ${escapeHtml(dispatch.first_token || 'n/a')}</span>` : ''}
                ${dispatch ? `<span class="command-stream-meta-pill">Shell · ${escapeHtml(dispatch.shell || 'unknown')}</span>` : ''}
                ${dispatch && dispatch.working_dir ? `<span class="command-stream-meta-pill">Dir · ${escapeHtml(dispatch.working_dir)}</span>` : ''}
            </div>
            <div class="command-stream-actions">
                <button class="btn btn-secondary btn-sm" onclick="showCommandDetail('${command.id}')">Command Detail</button>
                ${dispatch ? `<button class="btn btn-secondary btn-sm" onclick="showDispatchDetail('${dispatch.id}')">Shell Intake</button>` : ''}
            </div>
        </article>
    `;
}

function renderShellOnlyActivityItem(dispatch) {
    return `
        <article class="command-stream-card fade-in">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge pending">Shell Only</span>
                        <span class="risk-badge ${dispatch.risk_level.toLowerCase()}">${dispatch.risk_level}</span>
                        <span class="status-badge ${dispatchBadgeTone(dispatch.route)}">${escapeHtml(formatDispatchRoute(dispatch.route))}</span>
                        <span class="status-badge ${dispatchStatusTone(dispatch.status)}">${escapeHtml(formatDispatchStatusLabel(dispatch.status))}</span>
                        ${dispatch.redacted ? '<span class="status-badge rejected">Redacted</span>' : ''}
                    </div>
                    <div class="command-stream-title"><code>${escapeHtml(dispatch.command)}</code></div>
                    <div class="command-stream-subtitle">${escapeHtml(describeActorWithAuth(dispatch.requester, dispatch.authenticationContext))} · ${timeAgo(dispatch.created_at)} · ${escapeHtml(describeShellOnlyDispatch(dispatch))}</div>
                </div>
                <div class="command-stream-side">
                    <div class="history-exit-code">${renderDispatchOutcome(dispatch)}</div>
                </div>
            </div>
            <div class="command-stream-meta-row">
                ${renderAuthenticationMetaPill(dispatch.requester, dispatch.authenticationContext)}
                <span class="command-stream-meta-pill">First shell token · ${escapeHtml(dispatch.first_token || 'n/a')}</span>
                <span class="command-stream-meta-pill">First shell token type · ${escapeHtml(dispatch.first_token_type || 'unknown')}</span>
                ${dispatch.working_dir ? `<span class="command-stream-meta-pill">Dir · ${escapeHtml(dispatch.working_dir)}</span>` : ''}
                ${dispatch.execution_mode ? `<span class="command-stream-meta-pill">Mode · ${escapeHtml(dispatch.execution_mode)}</span>` : ''}
                ${dispatch.shell ? `<span class="command-stream-meta-pill">Shell · ${escapeHtml(dispatch.shell)}</span>` : ''}
            </div>
            <div class="command-stream-actions">
                <button class="btn btn-secondary btn-sm" onclick="showDispatchDetail('${dispatch.id}')">Shell Intake</button>
                ${dispatch.command_id ? `<button class="btn btn-secondary btn-sm" onclick="showCommandDetail('${dispatch.command_id}')">Linked Command</button>` : ''}
            </div>
        </article>
    `;
}

function shouldShowApprovalTrail(command) {
    const progress = command.approvalProgress || {};
    const count = Number(progress.count ?? command.approval_count ?? 0);
    const required = Number(progress.required ?? command.required_approvals ?? 0);
    const approvedBy = Array.isArray(command.approvedBy) ? command.approvedBy.filter(Boolean) : [];
    const status = String(command.status || '').toLowerCase();

    return required > 0 || count > 0 || approvedBy.length > 0 || status === 'pending';
}

function renderGovernedOutcome(command) {
    if (command.exit_code !== null && command.exit_code !== undefined) {
        return `Exit ${command.exit_code}`;
    }
    return escapeHtml(command.status || 'pending');
}

function describeShellOnlyDispatch(dispatch) {
    if (dispatch.route === 'LOCAL_PASSTHROUGH') {
        return dispatch.status === 'local_failed'
            ? 'Allowed locally, but failed in the user shell'
            : 'Allowed to stay in the local shell';
    }
    if (dispatch.route === 'BLOCKED') {
        return 'Blocked before command creation';
    }
    return 'Observed at shell intake';
}

function formatDispatchStatusLabel(status) {
    return String(status || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function activityStatusTone(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'completed') return 'completed';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'rejected') return 'rejected';
    if (normalized === 'timeout') return 'timeout';
    if (normalized === 'approved') return 'approved';
    if (normalized === 'executing') return 'executing';
    return 'pending';
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
    return escapeHtml(formatDispatchStatusLabel(dispatch.status || 'Pending'));
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
                <div style="margin-bottom:8px"><strong>Requester:</strong> ${escapeHtml(describeActorWithAuth(cmd.requester, cmd.authenticationContext))}</div>
                ${hasAutoApprovalAssist(cmd) ? '<div style="margin-bottom:8px"><strong>Approval Automation:</strong> Auto-approval assist was used for this command.</div>' : ''}
                ${cmd.executed_at ? `<div style="margin-bottom:8px"><strong>Executed:</strong> ${formatTime(cmd.executed_at)}</div>` : ''}
                ${error ? `<div style="margin-bottom:8px;color:var(--accent-red)"><strong>Error:</strong> ${error}</div>` : ''}
                <div style="margin-top:12px"><strong>Output:</strong><pre style="margin-top:8px;padding:12px;background:rgba(0,0,0,0.3);border-radius:6px;overflow-x:auto;font-size:12px;color:var(--text-secondary);white-space:pre-wrap">${output}</pre></div>
            </div>
        `;

        document.getElementById('approval-modal-title').textContent = 'Command Detail';
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
    } catch (e) {
        showNotification('Failed to load command detail', 'error');
    }
}
