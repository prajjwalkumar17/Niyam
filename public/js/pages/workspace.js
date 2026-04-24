/**
 * Workspace Page - Runtime, access, and CLI setup guidance
 */

let workspacePageState = {
    payload: null,
    myTokens: []
};

function renderWorkspace(container) {
    container.innerHTML = `
        <section class="dashboard-hero fade-in">
            <div class="dashboard-hero-copy">
                <div class="workspace-kicker">Workspace</div>
                <h2 class="dashboard-hero-title">Runtime context, access posture, and shell setup in one place.</h2>
                <p class="workspace-subtitle">Use this page for the current dashboard identity, the live server shape, and the CLI wrapper commands that match the active Niyam instance.</p>
            </div>
            <div class="dashboard-hero-rail">
                <div class="dashboard-hero-note" id="workspace-hero-note">Admin sessions see instance details. Local user sessions can also manage their own CLI tokens here.</div>
                <div class="workspace-controls" id="workspace-chip-rail"></div>
            </div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card" id="workspace-runtime-card"></div>
            <div class="surface-card" id="workspace-access-card"></div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card" id="workspace-cli-card"></div>
            <div class="surface-card" id="workspace-ops-card"></div>
        </section>
        <section class="surface-section fade-in" style="display:none" id="workspace-tokens-section">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">My CLI Tokens</div>
                    <div class="surface-section-copy">Create and block the tokens you use for different CLIs or local agent workflows.</div>
                </div>
                <button class="btn btn-primary" id="workspace-add-token-btn">New Token</button>
            </div>
            <div class="command-stream" id="workspace-tokens-list"></div>
        </section>
    `;

    const addTokenBtn = document.getElementById('workspace-add-token-btn');
    addTokenBtn.addEventListener('click', openWorkspaceManagedTokenForm);
    loadWorkspaceDetails();
}

async function loadWorkspaceDetails() {
    try {
        const response = await apiFetch('/workspace');
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to load workspace details');
        }

        workspacePageState.payload = payload;
        renderWorkspaceDetails(payload);
        await loadWorkspaceManagedTokens(payload);
    } catch (error) {
        document.getElementById('workspace-runtime-card').innerHTML = renderEmptyState('Failed to load runtime details', 'blocked');
        document.getElementById('workspace-access-card').innerHTML = renderEmptyState(error.message || 'Authentication required', 'blocked');
        document.getElementById('workspace-cli-card').innerHTML = renderEmptyState('CLI guidance unavailable', 'blocked');
        document.getElementById('workspace-ops-card').innerHTML = renderEmptyState('Operational details unavailable', 'blocked');
        document.getElementById('workspace-tokens-section').style.display = 'none';
    }
}

async function loadWorkspaceManagedTokens(payload) {
    const tokenSection = document.getElementById('workspace-tokens-section');
    const tokenList = document.getElementById('workspace-tokens-list');
    if (!payload.currentAccess?.canManageOwnTokens) {
        tokenSection.style.display = 'none';
        return;
    }

    tokenSection.style.display = '';
    tokenList.innerHTML = renderEmptyState('Loading your CLI tokens...', 'activity');

    try {
        const response = await apiFetch('/my/tokens');
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load your tokens');
        }

        workspacePageState.myTokens = result.tokens || [];
        renderWorkspaceManagedTokens();
    } catch (error) {
        tokenList.innerHTML = renderEmptyState(error.message || 'Failed to load your tokens', 'blocked');
    }
}

function renderWorkspaceDetails(payload) {
    const chipRail = document.getElementById('workspace-chip-rail');
    const runtimeCard = document.getElementById('workspace-runtime-card');
    const accessCard = document.getElementById('workspace-access-card');
    const cliCard = document.getElementById('workspace-cli-card');
    const opsCard = document.getElementById('workspace-ops-card');

    const runtime = payload.runtime || {};
    const access = payload.currentAccess || {};
    const approvalAutomation = payload.approvalAutomation || {};
    const instance = payload.instance;
    const commands = payload.commands || {};
    const bootstrapAccess = payload.bootstrapAccess || {};
    const heroNote = document.getElementById('workspace-hero-note');

    if (heroNote) {
        heroNote.textContent = runtime.productMode === 'individual'
            ? 'Use the dashboard as the bootstrap admin. Individual mode keeps CLI identity on standalone managed tokens.'
            : 'Admin sessions see instance details. Local user sessions can also manage their own CLI tokens here.';
    }

    chipRail.innerHTML = [
        renderWorkspaceChip(`Mode: ${runtime.productMode || 'unknown'}`),
        renderWorkspaceChip(`Profile: ${runtime.profile || 'unknown'}`),
        renderWorkspaceChip(`Execution: ${runtime.executionMode || 'unknown'}`),
        renderWorkspaceChip(`Auth: ${access.authMode || 'unknown'}`),
        renderWorkspaceChip(`Signed in: ${access.username || 'unknown'}`)
    ].join('');

    runtimeCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">Runtime</div>
                <div class="surface-section-copy">Live configuration reported by the running server process.</div>
            </div>
        </div>
        ${renderWorkspaceRows([
            ['Product mode', runtime.productMode || 'unknown'],
            ['Profile', runtime.profile || 'unknown'],
            ['Dashboard URL', runtime.dashboardUrl || location.origin],
            ['Port', runtime.port || '-'],
            ['Team mode', runtime.teamModeDescription || (runtime.teamMode ? 'enabled' : 'disabled')],
            ['Execution mode', runtime.executionMode || '-'],
            ...(instance ? [
                ['Env file', instance.envFile || 'Not provided at runtime'],
                ['Data dir', instance.dataDir || '-'],
                ['Allowed roots', Array.isArray(instance.allowedRoots) ? instance.allowedRoots.join(', ') : '-']
            ] : [])
        ])}
    `;

    accessCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">Access</div>
                <div class="surface-section-copy">Current signed-in identity plus the login shape for this workspace.</div>
            </div>
        </div>
        ${renderWorkspaceRows([
            ['Signed in as', access.displayName || access.username || '-'],
            ['Username', access.username || '-'],
            ['Role', access.roleContext || access.principalType || '-'],
            ['Account type', access.principalType || '-'],
            ['Auth mode', access.authMode || '-'],
            ...(access.tokenLabel ? [['Token label', access.tokenLabel]] : []),
            ['Password management', access.passwordMessage || 'Unavailable'],
            ...(bootstrapAccess.canRevealPasswordSource ? [
                ['Bootstrap admin username', bootstrapAccess.username || 'admin'],
                ['Bootstrap password source', bootstrapAccess.passwordSource || 'Not provided at runtime']
            ] : [])
        ])}
    `;

    const cliBlocks = [
        renderWorkspaceCommandBlock('Install for zsh', commands.cliInstall?.zsh || []),
        renderWorkspaceCommandBlock('Install for bash', commands.cliInstall?.bash || []),
        renderWorkspaceCommandBlock('Managed token login', [commands.cliTokenLogin || "niyam-cli login --token '<token>'"])
    ];

    if (runtime.productMode === 'teams' && commands.cliUserLogin) {
        cliBlocks.push(renderWorkspaceCommandBlock('Local user login', [commands.cliUserLogin]));
    }

    cliBlocks.push(renderWorkspaceCommandBlock('Fully uninstall for zsh', commands.cliRemove?.zsh || []));
    cliBlocks.push(renderWorkspaceCommandBlock('Fully uninstall for bash', commands.cliRemove?.bash || []));

    cliCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">CLI Wrapper</div>
                <div class="surface-section-copy">Install, remove, and choose the auth mode that fits this Niyam workspace.</div>
            </div>
        </div>
        <div class="workspace-stack">${cliBlocks.join('')}</div>
    `;

    const opsBlocks = [];
    if (commands.startLater) {
        opsBlocks.push(renderWorkspaceCommandBlock('Start later', [commands.startLater]));
    }
    opsBlocks.push(renderWorkspaceApprovalAutomation(runtime, approvalAutomation, access));
    opsBlocks.push(renderWorkspaceRows([
        ['Current shell off', commands.cliCurrentShellOff || 'niyam-off'],
        ['Current shell on', commands.cliCurrentShellOn || 'niyam-on'],
        ['Can manage own tokens', access.canManageOwnTokens ? 'yes' : 'no'],
        ['Can manage all tokens', access.canManageAllTokens ? 'yes' : 'no']
    ]));
    opsBlocks.push(`
        <div class="workspace-note">
            ${runtime.productMode === 'teams'
                ? 'Teams mode keeps password-based dashboard users while letting each user issue CLI tokens for their own toolchains.'
                : 'Individual mode is optimized for named standalone CLI identities. Use the bootstrap admin password only for dashboard access, and use standalone managed tokens for CLI flows.'}
        </div>
    `);

    opsCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">Operations</div>
                <div class="surface-section-copy">Lifecycle commands and the current workspace operating mode.</div>
            </div>
        </div>
        <div class="workspace-stack">${opsBlocks.join('')}</div>
    `;

    const modeSelect = document.getElementById('workspace-auto-approval-mode');
    if (modeSelect) {
        modeSelect.addEventListener('change', updateWorkspaceAutoApprovalMode);
    }
    bindCopyButtons(document.getElementById('workspace-cli-card'));
    bindCopyButtons(document.getElementById('workspace-ops-card'));
}

function renderWorkspaceManagedTokens() {
    const tokenList = document.getElementById('workspace-tokens-list');
    if (!workspacePageState.myTokens.length) {
        tokenList.innerHTML = renderEmptyState('No personal CLI tokens yet', 'activity');
        return;
    }

    tokenList.innerHTML = workspacePageState.myTokens.map(token => `
        <article class="command-stream-card fade-in">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge ${token.status === 'active' ? 'approved' : 'rejected'}">${escapeHtml(token.status.toUpperCase())}</span>
                    </div>
                    <div class="command-stream-title">${escapeHtml(token.label)}</div>
                    <div class="command-stream-subtitle">${escapeHtml(token.principalDisplayName || token.principalIdentifier)} · ${token.lastUsedAt ? `last used ${timeAgo(token.lastUsedAt)}` : 'never used'}</div>
                </div>
                <div class="command-stream-side">
                    <div class="history-exit-code">${escapeHtml(token.tokenPrefix)}</div>
                </div>
            </div>
            <div class="command-stream-meta-row">
                <span class="command-stream-meta-pill">Created · ${formatTime(token.createdAt)}</span>
            ${token.blockedAt ? `<span class="command-stream-meta-pill">Blocked · ${formatTime(token.blockedAt)}</span>` : ''}
            <span class="command-stream-meta-pill">Auto approval · ${formatAutoApprovalMode(token.autoApprovalMode)}</span>
            </div>
            <div class="command-stream-actions">
                ${token.status === 'active' ? `<button class="btn btn-secondary btn-sm workspace-block-token-btn" data-id="${token.id}">Block</button>` : ''}
            </div>
        </article>
    `).join('');

    tokenList.querySelectorAll('.workspace-block-token-btn').forEach(button => {
        button.addEventListener('click', () => blockWorkspaceManagedToken(button.dataset.id));
    });
}

function renderWorkspaceRows(entries) {
    return `
        <div class="workspace-detail-list">
            ${entries.map(([label, value]) => `
                <div class="workspace-detail-row">
                    <div class="workspace-detail-label">${escapeHtml(String(label))}</div>
                    <div class="workspace-detail-value">${escapeHtml(String(value))}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderWorkspaceCommandBlock(title, commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return '';
    }

    const commandText = commands.join('\n');

    return `
        <div class="workspace-command-block">
            <div class="workspace-command-head">
                <div class="workspace-command-title">${escapeHtml(title)}</div>
            </div>
            <div class="workspace-command-shell">
                ${renderCopyIconButton(commandText, `Copy ${title}`)}
                <pre class="workspace-command-pre"><code>${escapeHtml(commandText)}</code></pre>
            </div>
        </div>
    `;
}

function renderWorkspaceApprovalAutomation(runtime = {}, approvalAutomation = {}, access = {}) {
    const canToggle = Boolean(access && access.canChangePassword && runtime.productMode !== 'individual');
    const mode = formatAutoApprovalMode(approvalAutomation.autoApprovalMode);
    const selector = canToggle
        ? `
            <div class="form-group" style="margin-top:12px; margin-bottom:0">
                <label for="workspace-auto-approval-mode">Auto Approver Setting</label>
                <select class="filter-select" id="workspace-auto-approval-mode">
                    ${renderAutoApprovalModeOptions(approvalAutomation.autoApprovalMode || 'off')}
                </select>
                <div class="text-sm text-muted" style="margin-top:8px">
                    ${escapeHtml(describeAutoApprovalMode(approvalAutomation.autoApprovalMode || 'off', runtime.productMode))}
                </div>
            </div>
        `
        : '';
    const note = runtime.productMode === 'individual'
        ? 'In individual mode, HIGH always gets one synthetic review first, so one human approval remains. Configure standalone token behavior from Tokens.'
        : (canToggle
            ? 'This affects commands submitted by your dashboard session and any user-linked CLI tokens tied to your account.'
            : 'Auto-approval preferences are visible here, but changing them requires a local user session.');

    return `
        <div class="workspace-command-block">
            <div class="workspace-command-title">Approval Automation</div>
            ${renderWorkspaceRows([
                ['Scope', approvalAutomation.scope || 'none'],
                ['Mode', mode],
                ['LOW', approvalAutomation.lowRiskBehavior || 'policy-auto'],
                ['MEDIUM', approvalAutomation.mediumRiskBehavior || 'manual'],
                ['HIGH', approvalAutomation.highRiskBehavior || 'auto-plus-one-human']
            ])}
            ${selector}
            <div class="workspace-note" style="margin-top:12px">${note}</div>
        </div>
    `;
}

async function updateWorkspaceAutoApprovalMode() {
    const modeSelect = document.getElementById('workspace-auto-approval-mode');
    const nextMode = modeSelect ? modeSelect.value : 'off';

    try {
        const response = await apiFetch('/my/approval-preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                autoApprovalMode: nextMode
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || result.details?.join(', ') || 'Failed to update auto approval');
        }

        showNotification(`Auto approver set to ${formatAutoApprovalMode(result.autoApprovalMode)}`, 'success');
        await loadWorkspaceDetails();
    } catch (error) {
        showNotification(error.message || 'Failed to update auto approval', 'error');
    }
}

function renderAutoApprovalModeOptions(selectedMode) {
    return [
        ['off', 'Off'],
        ['normal', 'Normal Mode'],
        ['all', 'Approve Everything']
    ].map(([value, label]) => `
        <option value="${value}" ${value === (selectedMode || 'off') ? 'selected' : ''}>${label}</option>
    `).join('');
}

function formatAutoApprovalMode(mode) {
    switch (String(mode || '').trim().toLowerCase()) {
        case 'all':
            return 'Approve Everything';
        case 'normal':
            return 'Normal Mode';
        default:
            return 'Off';
    }
}

function describeAutoApprovalMode(mode, productMode = 'teams') {
    switch (String(mode || '').trim().toLowerCase()) {
        case 'normal':
            return 'Normal Mode: MEDIUM auto-approves, HIGH still needs one human approval.';
        case 'all':
            return 'Approve Everything: MEDIUM and HIGH both auto-approve.';
        default:
            return productMode === 'individual'
                ? 'Off: MEDIUM waits for review, HIGH still needs one human approval.'
                : 'Off: MEDIUM waits for review, and HIGH follows the normal approval flow.';
    }
}

function renderWorkspaceChip(label) {
    return `<span class="workspace-chip">${escapeHtml(label)}</span>`;
}

function openWorkspaceManagedTokenForm() {
    closeWorkspaceTokenModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'workspace-token-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Create My CLI Token</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                <div class="text-sm text-muted" style="margin-bottom:12px">Use a separate label for each CLI or workflow so audit can show which tool submitted or approved commands.</div>
                <div class="form-group">
                    <label for="workspace-token-label">Token Label</label>
                    <input type="text" id="workspace-token-label" class="form-input" placeholder="e.g. Claude Code">
                </div>
                <div class="text-sm text-muted" id="workspace-token-status"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" id="workspace-token-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="workspace-token-save">Create Token</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeWorkspaceTokenModal);
    overlay.querySelector('#workspace-token-cancel').addEventListener('click', closeWorkspaceTokenModal);
    overlay.querySelector('#workspace-token-save').addEventListener('click', saveWorkspaceManagedToken);
}

async function saveWorkspaceManagedToken() {
    const label = document.getElementById('workspace-token-label').value.trim();

    try {
        const response = await apiFetch('/my/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label })
        });
        const result = await response.json();
        if (!response.ok) {
            document.getElementById('workspace-token-status').textContent = result.error || result.details?.join(', ') || 'Failed to create token';
            return;
        }

        showNotification('CLI token created', 'success');
        showWorkspaceManagedTokenReveal(result.token, result.plainTextToken);
        await loadWorkspaceManagedTokens(workspacePageState.payload);
    } catch (error) {
        document.getElementById('workspace-token-status').textContent = 'Network error while creating token';
    }
}

async function blockWorkspaceManagedToken(tokenId) {
    try {
        const response = await apiFetch(`/my/tokens/${tokenId}/block`, {
            method: 'POST'
        });
        const result = await response.json();
        if (!response.ok) {
            showNotification(result.error || 'Failed to block token', 'error');
            return;
        }

        showNotification('CLI token blocked', 'success');
        await loadWorkspaceManagedTokens(workspacePageState.payload);
    } catch (error) {
        showNotification('Network error while blocking token', 'error');
    }
}

function showWorkspaceManagedTokenReveal(token, plainTextToken) {
    closeWorkspaceTokenModal();
    const loginCommand = `niyam-cli login --token '${plainTextToken}'`;
    const openShellStatusId = 'workspace-token-open-shell-status';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'workspace-token-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>CLI Token Created</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                <div class="text-sm text-muted" style="margin-bottom:12px">This token is shown once. Store it in the CLI named ${escapeHtml(token.label)}.</div>
                <div class="workspace-command-block">
                    <div class="workspace-command-head">
                        <div class="workspace-command-title">${escapeHtml(token.label)}</div>
                    </div>
                    <div class="workspace-command-shell">
                        ${renderCopyIconButton(plainTextToken, `Copy token for ${token.label}`)}
                        <pre class="workspace-command-pre"><code>${escapeHtml(plainTextToken)}</code></pre>
                    </div>
                </div>
                <div class="workspace-command-block">
                    <div class="workspace-command-head">
                        <div class="workspace-command-title">CLI Login</div>
                    </div>
                    <div class="workspace-command-shell">
                        ${renderCopyIconButton(loginCommand, 'Copy CLI login command')}
                        <pre class="workspace-command-pre"><code>${escapeHtml(loginCommand)}</code></pre>
                    </div>
                </div>
                ${state.authConfig.profile === 'local' ? `
                    <div class="text-sm text-muted" id="${openShellStatusId}" style="margin-top:12px"></div>
                ` : ''}
            </div>
            <div class="modal-footer">
                ${state.authConfig.profile === 'local' ? '<button class="btn btn-secondary" type="button" id="workspace-token-open-shell">Open Local Shell</button>' : ''}
                <button class="btn btn-primary" type="button" id="workspace-token-save">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    bindCopyButtons(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeWorkspaceTokenModal);
    overlay.querySelector('#workspace-token-save').addEventListener('click', closeWorkspaceTokenModal);

    const openShellButton = overlay.querySelector('#workspace-token-open-shell');
    if (openShellButton) {
        openShellButton.addEventListener('click', async () => {
            openShellButton.disabled = true;
            try {
                await openTokenShellFromDashboard(plainTextToken, token.label, openShellStatusId);
            } finally {
                openShellButton.disabled = false;
            }
        });
    }
}

function closeWorkspaceTokenModal() {
    const overlay = document.getElementById('workspace-token-overlay');
    if (overlay) {
        overlay.remove();
    }
}

function bindCopyButtons(root) {
    if (!root) {
        return;
    }

    root.querySelectorAll('.copy-text-btn').forEach(button => {
        if (button.dataset.boundCopy === 'true') {
            return;
        }
        button.dataset.boundCopy = 'true';
        button.addEventListener('click', async () => {
            const text = button.dataset.copyText || '';
            try {
                await copyText(text);
                flashCopyButtonState(button);
                showNotification('Copied', 'success');
            } catch (error) {
                showNotification('Copy failed', 'error');
            }
        });
    });
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const succeeded = document.execCommand('copy');
    textarea.remove();
    if (!succeeded) {
        throw new Error('Copy failed');
    }
}

function escapeHtmlAttribute(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderCopyIconButton(text, label = 'Copy to clipboard') {
    return `
        <button
            class="copy-text-btn copy-icon-btn"
            type="button"
            data-copy-text="${escapeHtmlAttribute(text)}"
            data-copy-label="${escapeHtmlAttribute(label)}"
            title="${escapeHtmlAttribute(label)}"
            aria-label="${escapeHtmlAttribute(label)}"
        >${renderCopyButtonIcon()}</button>
    `;
}

function flashCopyButtonState(button) {
    const originalLabel = button.dataset.copyLabel || 'Copy to clipboard';
    window.clearTimeout(Number(button.dataset.copyResetTimer || 0));
    button.classList.add('copied');
    button.innerHTML = renderCopyButtonIcon(true);
    button.title = 'Copied';
    button.setAttribute('aria-label', 'Copied');
    const timer = window.setTimeout(() => {
        button.classList.remove('copied');
        button.innerHTML = renderCopyButtonIcon(false);
        button.title = originalLabel;
        button.setAttribute('aria-label', originalLabel);
    }, 1400);
    button.dataset.copyResetTimer = String(timer);
}

function renderCopyButtonIcon(copied = false) {
    return copied
        ? `
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4.5 10.5L8.2 14.2L15.5 6.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
        `
        : `
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="7" y="3.5" width="9" height="11" rx="2.2" stroke="currentColor" stroke-width="1.4"></rect>
                <rect x="4" y="6.5" width="9" height="11" rx="2.2" stroke="currentColor" stroke-width="1.4"></rect>
            </svg>
        `;
}
