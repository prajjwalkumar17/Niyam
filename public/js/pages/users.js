let usersPageState = {
    users: [],
    signupRequests: [],
    tokens: []
};

function renderUsers(container) {
    const productMode = state.authConfig.productMode || 'individual';
    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Identity Control</div>
                <p class="workspace-subtitle">${productMode === 'individual'
                    ? 'Manage named standalone CLI identities for individual-mode demos and local operator use.'
                    : 'Manage local dashboard users, team signup requests, and centrally managed CLI tokens.'}</p>
            </div>
            <div class="workspace-controls">
                <button class="btn btn-secondary" id="add-token-btn">New Token</button>
                ${productMode === 'teams' ? '<button class="btn btn-primary" id="add-user-btn">New User</button>' : ''}
            </div>
        </section>
        ${renderUsersPageSections(productMode)}
    `;

    const addUserButton = document.getElementById('add-user-btn');
    if (addUserButton) {
        addUserButton.addEventListener('click', () => openUserForm());
    }
    document.getElementById('add-token-btn').addEventListener('click', () => openManagedTokenForm());
    loadUsersPage();
}

function renderUsersPageSections(productMode) {
    const tokenSection = `
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Managed Tokens</div>
                    <div class="surface-section-copy">${productMode === 'individual'
                        ? 'Standalone CLI identities for named local demos and individual-mode operator workflows.'
                        : 'Tokens that admins can issue for users or standalone automation identities.'}</div>
                </div>
            </div>
            <div class="command-stream" id="managed-tokens-list">
                ${renderEmptyState('Loading managed tokens...', 'activity')}
            </div>
        </section>
    `;

    const signupSection = `
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Signup Requests</div>
                    <div class="surface-section-copy">Pending and resolved self-signup requests for team mode deployments.</div>
                </div>
            </div>
            <div class="command-stream" id="signup-requests-list">
                ${renderEmptyState('Loading signup requests...', 'activity')}
            </div>
        </section>
    `;

    const userSection = `
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Local Users</div>
                    <div class="surface-section-copy">Local dashboard identities, their roles, approval privileges, and linked CLI tokens.</div>
                </div>
            </div>
            <div class="command-stream" id="users-list">
                ${renderEmptyState('Loading users...', 'activity')}
            </div>
        </section>
    `;

    return productMode === 'teams'
        ? `${userSection}${signupSection}${tokenSection}`
        : `${tokenSection}`;
}

async function loadUsersPage() {
    const productMode = state.authConfig.productMode || 'individual';

    try {
        if (productMode === 'individual') {
            const tokensResponse = await apiFetch('/tokens');
            const tokensData = await tokensResponse.json();

            usersPageState.users = [];
            usersPageState.signupRequests = [];
            usersPageState.tokens = tokensData.tokens || [];
            renderManagedTokensList();
            return;
        }

        const [usersResponse, requestsResponse, tokensResponse] = await Promise.all([
            apiFetch('/users'),
            apiFetch('/signup-requests'),
            apiFetch('/tokens')
        ]);
        const usersData = await usersResponse.json();
        const requestsData = await requestsResponse.json();
        const tokensData = await tokensResponse.json();

        usersPageState.users = usersData.users || [];
        usersPageState.signupRequests = requestsData.requests || [];
        usersPageState.tokens = tokensData.tokens || [];

        renderSignupRequestsList();
        renderUsersList();
        renderManagedTokensList();
    } catch (error) {
        const requestsList = document.getElementById('signup-requests-list');
        const usersList = document.getElementById('users-list');
        const tokensList = document.getElementById('managed-tokens-list');
        if (requestsList) requestsList.innerHTML = renderEmptyState('Failed to load signup requests', 'blocked');
        if (usersList) usersList.innerHTML = renderEmptyState('Failed to load users', 'blocked');
        if (tokensList) tokensList.innerHTML = renderEmptyState('Failed to load managed tokens', 'blocked');
    }
}

function renderManagedTokensList() {
    const list = document.getElementById('managed-tokens-list');
    if (!list) {
        return;
    }

    if (!usersPageState.tokens.length) {
        list.innerHTML = renderEmptyState(
            state.authConfig.productMode === 'individual'
                ? 'No standalone CLI identities yet'
                : 'No managed tokens yet',
            'activity'
        );
        return;
    }

    list.innerHTML = usersPageState.tokens.map(token => `
        <article class="command-stream-card fade-in">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge ${token.status === 'active' ? 'approved' : 'rejected'}">${escapeHtml(token.status.toUpperCase())}</span>
                        <span class="status-badge pending">${escapeHtml(token.subjectType === 'standalone' ? 'Standalone' : 'User-linked')}</span>
                    </div>
                    <div class="command-stream-title">${escapeHtml(token.label)}</div>
                    <div class="command-stream-subtitle">${escapeHtml(describeManagedTokenSubject(token))}</div>
                </div>
                <div class="command-stream-side">
                    <div class="history-exit-code">${token.lastUsedAt ? `Last used ${timeAgo(token.lastUsedAt)}` : 'Never used'}</div>
                </div>
            </div>
            <div class="command-stream-meta-row">
                <span class="command-stream-meta-pill">Prefix · ${escapeHtml(token.tokenPrefix)}</span>
                <span class="command-stream-meta-pill">Created · ${formatTime(token.createdAt)}</span>
                <span class="command-stream-meta-pill">Created By · ${escapeHtml(token.createdBy)}</span>
                <span class="command-stream-meta-pill">Auto Approval · ${escapeHtml(describeManagedTokenAutoApproval(token))}</span>
                ${token.blockedAt ? `<span class="command-stream-meta-pill">Blocked · ${formatTime(token.blockedAt)}</span>` : ''}
                ${token.linkedUser ? `<span class="command-stream-meta-pill">User · ${escapeHtml(token.linkedUser.username)}</span>` : ''}
            </div>
            <div class="command-stream-actions">
                ${token.subjectType === 'standalone' && token.status === 'active'
                    ? `
                        <label class="text-sm text-muted" for="token-auto-approval-mode-${token.id}">Auto Approver Setting</label>
                        <select class="filter-select token-auto-approval-mode" id="token-auto-approval-mode-${token.id}" data-id="${token.id}">
                            ${renderAutoApprovalModeOptions(token.autoApprovalMode || 'off')}
                        </select>
                        <div class="text-sm text-muted" style="margin-right:auto">
                            ${escapeHtml(describeAutoApprovalMode(token.autoApprovalMode || 'off', 'individual'))}
                        </div>
                    `
                    : ''}
                ${token.status === 'active' ? `<button class="btn btn-secondary btn-sm block-token-btn" data-id="${token.id}">Block</button>` : ''}
            </div>
        </article>
    `).join('');

    list.querySelectorAll('.token-auto-approval-mode').forEach(select => {
        select.addEventListener('change', () => updateManagedTokenAutoApprovalMode(select.dataset.id, select.value));
    });
    list.querySelectorAll('.block-token-btn').forEach(button => {
        button.addEventListener('click', () => blockManagedToken(button.dataset.id, '/tokens'));
    });
}

function renderSignupRequestsList() {
    const list = document.getElementById('signup-requests-list');
    if (!list) {
        return;
    }

    if (!usersPageState.signupRequests.length) {
        list.innerHTML = renderEmptyState('No signup requests yet', 'activity');
        return;
    }

    list.innerHTML = usersPageState.signupRequests.map(request => `
        <article class="command-stream-card fade-in">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge ${renderRequestStatusTone(request.status)}">${escapeHtml(request.status.toUpperCase())}</span>
                    </div>
                    <div class="command-stream-title">${escapeHtml(request.displayName || request.username)}</div>
                    <div class="command-stream-subtitle">${escapeHtml(request.username)} · requested ${timeAgo(request.requestedAt)}</div>
                </div>
                <div class="command-stream-side">
                    <div class="history-exit-code">${request.reviewedAt ? `Reviewed ${timeAgo(request.reviewedAt)}` : 'Awaiting review'}</div>
                </div>
            </div>
            <div class="command-stream-meta-row">
                <span class="command-stream-meta-pill">Requested · ${formatTime(request.requestedAt)}</span>
                <span class="command-stream-meta-pill">Reviewed By · ${escapeHtml(request.reviewedBy || 'Unassigned')}</span>
                <span class="command-stream-meta-pill">Reason · ${escapeHtml(request.decisionReason || 'None')}</span>
            </div>
            ${request.status === 'pending' ? `
                <div class="command-stream-actions">
                    <button class="btn btn-primary btn-sm approve-signup-btn" data-id="${request.id}">Approve</button>
                    <button class="btn btn-secondary btn-sm reject-signup-btn" data-id="${request.id}">Reject</button>
                </div>
            ` : ''}
        </article>
    `).join('');

    list.querySelectorAll('.approve-signup-btn').forEach(button => {
        button.addEventListener('click', () => {
            const request = usersPageState.signupRequests.find(entry => entry.id === button.dataset.id);
            if (request) {
                openSignupReviewForm(request, 'approve');
            }
        });
    });
    list.querySelectorAll('.reject-signup-btn').forEach(button => {
        button.addEventListener('click', () => {
            const request = usersPageState.signupRequests.find(entry => entry.id === button.dataset.id);
            if (request) {
                openSignupReviewForm(request, 'reject');
            }
        });
    });
}

function renderUsersList() {
    const list = document.getElementById('users-list');
    if (!list) {
        return;
    }

    if (!usersPageState.users.length) {
        list.innerHTML = renderEmptyState('No local users found', 'activity');
        return;
    }

    list.innerHTML = usersPageState.users.map(user => {
        const linkedTokenCount = usersPageState.tokens.filter(token => token.linkedUser && token.linkedUser.id === user.id).length;
        return `
            <article class="command-stream-card fade-in">
                <div class="command-stream-head">
                    <div class="command-stream-main">
                        <div class="command-stream-badges">
                            <span class="status-badge ${user.enabled ? 'approved' : 'rejected'}">${user.enabled ? 'Enabled' : 'Disabled'}</span>
                            ${user.roles.includes('admin') ? '<span class="status-badge pending">Admin</span>' : ''}
                            ${user.approvalCapabilities.canApproveHigh ? '<span class="risk-badge high">HIGH</span>' : ''}
                            ${user.approvalCapabilities.canApproveMedium ? '<span class="risk-badge medium">MEDIUM</span>' : ''}
                        </div>
                        <div class="command-stream-title">${escapeHtml(user.displayName || user.username)}</div>
                        <div class="command-stream-subtitle">${escapeHtml(user.username)} · ${escapeHtml(describeUserApprovalScope(user))}</div>
                    </div>
                    <div class="command-stream-side">
                        <div class="history-exit-code">${user.lastLoginAt ? `Last login ${timeAgo(user.lastLoginAt)}` : 'Never logged in'}</div>
                    </div>
                </div>
                <div class="command-stream-meta-row">
                    <span class="command-stream-meta-pill">Roles · ${escapeHtml(user.roles.join(', ') || 'operator')}</span>
                    <span class="command-stream-meta-pill">Linked tokens · ${linkedTokenCount}</span>
                    <span class="command-stream-meta-pill">Auto Approval · ${formatAutoApprovalMode(user.autoApprovalMode)}</span>
                    <span class="command-stream-meta-pill">Created · ${formatTime(user.createdAt)}</span>
                    <span class="command-stream-meta-pill">Updated · ${formatTime(user.updatedAt)}</span>
                </div>
                <div class="command-stream-actions">
                    <button class="btn btn-secondary btn-sm edit-user-btn" data-id="${user.id}">Edit</button>
                    <button class="btn btn-secondary btn-sm password-user-btn" data-id="${user.id}">Reset Password</button>
                    <button class="btn btn-secondary btn-sm create-user-token-btn" data-id="${user.id}">Create Token</button>
                </div>
            </article>
        `;
    }).join('');

    list.querySelectorAll('.edit-user-btn').forEach(button => {
        button.addEventListener('click', () => {
            const user = usersPageState.users.find(entry => entry.id === button.dataset.id);
            if (user) {
                openUserForm(user);
            }
        });
    });
    list.querySelectorAll('.password-user-btn').forEach(button => {
        button.addEventListener('click', () => openPasswordResetForm(button.dataset.id));
    });
    list.querySelectorAll('.create-user-token-btn').forEach(button => {
        button.addEventListener('click', () => openManagedTokenForm({
            subjectType: 'user',
            userId: button.dataset.id
        }));
    });
}

function openUserForm(user = null) {
    closeUserModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-form-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>${user ? 'Edit User' : 'Create User'}</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                ${user ? '' : `
                    <div class="form-group">
                        <label for="user-username">Username</label>
                        <input type="text" id="user-username" class="form-input" placeholder="e.g. alice">
                    </div>
                    <div class="form-group">
                        <label for="user-password">Password</label>
                        <input type="password" id="user-password" class="form-input" placeholder="Set an initial password">
                    </div>
                `}
                <div class="form-group">
                    <label for="user-display-name">Display Name</label>
                    <input type="text" id="user-display-name" class="form-input" value="${escapeHtmlAttribute(user?.displayName || '')}" placeholder="e.g. Alice">
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="user-enabled" ${user ? (user.enabled ? 'checked' : '') : 'checked'}> Enabled</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="user-admin" ${user?.roles.includes('admin') ? 'checked' : ''}> Admin</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="user-approve-medium" ${user?.approvalCapabilities.canApproveMedium ? 'checked' : ''}> Can approve MEDIUM</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="user-approve-high" ${user?.approvalCapabilities.canApproveHigh ? 'checked' : ''}> Can approve HIGH</label>
                </div>
                <div class="text-sm text-muted" id="user-form-status"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" id="user-form-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="user-form-save">${user ? 'Save Changes' : 'Create User'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-cancel').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-save').addEventListener('click', () => saveUser(user?.id || null));
}

function openManagedTokenForm(defaults = {}) {
    closeUserModal();
    const productMode = state.authConfig.productMode || 'individual';
    const defaultSubjectType = productMode === 'individual'
        ? 'standalone'
        : (defaults.subjectType || 'user');
    const derivedStandaloneName = defaults.principalDisplayName || defaults.principalIdentifier || defaults.label || '';
    const userOptions = productMode === 'teams'
        ? usersPageState.users.map(user => `
            <option value="${user.id}" ${defaults.userId === user.id ? 'selected' : ''}>${escapeHtml(user.displayName || user.username)} (${escapeHtml(user.username)})</option>
        `).join('')
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-form-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Create Managed Token</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                ${productMode === 'individual' ? `
                    <div class="form-group">
                        <label for="managed-token-name">Name</label>
                        <input type="text" id="managed-token-name" class="form-input" value="${escapeHtmlAttribute(derivedStandaloneName)}" placeholder="e.g. January">
                        <div class="text-sm text-muted" style="margin-top:8px">
                            This name will appear in audit, history, pending approvals, and CLI login as this standalone identity.
                        </div>
                    </div>
                ` : `
                    <div class="form-group">
                        <label for="managed-token-label">Token Label</label>
                        <input type="text" id="managed-token-label" class="form-input" value="${escapeHtmlAttribute(defaults.label || '')}" placeholder="e.g. Cursor CLI">
                    </div>
                `}
                ${productMode === 'teams' ? `
                    <div class="form-group">
                        <label for="managed-token-subject-type">Subject Type</label>
                        <select id="managed-token-subject-type" class="filter-select">
                            <option value="standalone" ${defaultSubjectType === 'standalone' ? 'selected' : ''}>Standalone identity</option>
                            <option value="user" ${defaultSubjectType === 'user' ? 'selected' : ''}>Local user</option>
                        </select>
                    </div>
                ` : ''}
                ${productMode === 'teams' ? `
                    <div id="managed-token-standalone-fields">
                        <div class="form-group">
                            <label for="managed-token-principal-identifier">Identity Name</label>
                            <input type="text" id="managed-token-principal-identifier" class="form-input" value="${escapeHtmlAttribute(defaults.principalIdentifier || '')}" placeholder="e.g. June">
                        </div>
                        <div class="form-group">
                            <label for="managed-token-principal-display-name">Display Name <span style="color:var(--text-muted);font-weight:normal">optional</span></label>
                            <input type="text" id="managed-token-principal-display-name" class="form-input" value="${escapeHtmlAttribute(defaults.principalDisplayName || '')}" placeholder="e.g. June">
                        </div>
                    </div>
                ` : ''}
                <div id="managed-token-user-fields">
                    <div class="form-group">
                        <label for="managed-token-user-id">User</label>
                        <select id="managed-token-user-id" class="filter-select">
                            <option value="">Select a user</option>
                            ${userOptions}
                        </select>
                    </div>
                </div>
                <div class="text-sm text-muted" id="user-form-status"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" id="user-form-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="user-form-save">Create Token</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    const typeSelect = overlay.querySelector('#managed-token-subject-type');
    if (typeSelect) {
        typeSelect.addEventListener('change', syncManagedTokenFormFields);
    }
    syncManagedTokenFormFields();
    overlay.querySelector('.modal-close').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-cancel').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-save').addEventListener('click', saveManagedToken);
}

function syncManagedTokenFormFields() {
    const typeSelect = document.getElementById('managed-token-subject-type');
    const subjectType = typeSelect ? typeSelect.value : 'standalone';
    const standaloneFields = document.getElementById('managed-token-standalone-fields');
    const userFields = document.getElementById('managed-token-user-fields');
    if (standaloneFields) {
        standaloneFields.style.display = subjectType === 'standalone' ? '' : 'none';
    }
    if (userFields) {
        userFields.style.display = subjectType === 'user' ? '' : 'none';
    }
}

async function saveManagedToken() {
    const productMode = state.authConfig.productMode || 'individual';
    const individualName = productMode === 'individual'
        ? document.getElementById('managed-token-name').value.trim()
        : null;
    const payload = {
        label: productMode === 'individual'
            ? individualName
            : document.getElementById('managed-token-label').value.trim(),
        subjectType: productMode === 'individual'
            ? 'standalone'
            : document.getElementById('managed-token-subject-type').value
    };

    if (payload.subjectType === 'standalone') {
        if (productMode === 'individual') {
            payload.principalIdentifier = individualName;
            payload.principalDisplayName = individualName || null;
        } else {
            payload.principalIdentifier = document.getElementById('managed-token-principal-identifier').value.trim();
            payload.principalDisplayName = document.getElementById('managed-token-principal-display-name').value.trim() || null;
        }
    } else {
        payload.userId = document.getElementById('managed-token-user-id').value;
    }

    try {
        const response = await apiFetch('/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok) {
            document.getElementById('user-form-status').textContent = result.error || result.details?.join(', ') || 'Failed to create token';
            return;
        }

        showNotification('Managed token created', 'success');
        showManagedTokenReveal(result.token, result.plainTextToken);
        loadUsersPage();
    } catch (error) {
        document.getElementById('user-form-status').textContent = 'Network error while creating token';
    }
}

function showManagedTokenReveal(token, plainTextToken) {
    closeUserModal();
    const loginCommand = `niyam-cli login --token '${plainTextToken}'`;
    const openShellStatusId = 'managed-token-open-shell-status';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-form-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Managed Token Created</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                <div class="text-sm text-muted" style="margin-bottom:12px">This token is shown once. Save it in the CLI you want to connect as ${escapeHtml(token.principalDisplayName || token.principalIdentifier)}.</div>
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
                ${state.authConfig.profile === 'local' ? '<button class="btn btn-secondary" type="button" id="user-form-open-shell">Open Local Shell</button>' : ''}
                <button class="btn btn-primary" type="button" id="user-form-save">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    bindCopyButtons(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-save').addEventListener('click', closeUserModal);

    const openShellButton = overlay.querySelector('#user-form-open-shell');
    if (openShellButton) {
        openShellButton.addEventListener('click', async () => {
            openShellButton.disabled = true;
            try {
                await openTokenShellFromDashboard(plainTextToken, token.label, openShellStatusId);
                openShellButton.textContent = 'Opened';
                openShellButton.setAttribute('aria-disabled', 'true');
            } catch (error) {
                openShellButton.disabled = false;
                openShellButton.removeAttribute('aria-disabled');
            }
        });
    }
}

async function blockManagedToken(tokenId, routeBase) {
    try {
        const response = await apiFetch(`${routeBase}/${tokenId}/block`, {
            method: 'POST'
        });
        const result = await response.json();
        if (!response.ok) {
            showNotification(result.error || 'Failed to block token', 'error');
            return;
        }

        showNotification('Managed token blocked', 'success');
        loadUsersPage();
    } catch (error) {
        showNotification('Network error while blocking token', 'error');
    }
}

async function updateManagedTokenAutoApprovalMode(tokenId, autoApprovalMode) {
    const token = usersPageState.tokens.find(entry => entry.id === tokenId);
    if (!token) {
        return;
    }

    try {
        const response = await apiFetch(`/tokens/${tokenId}/approval-preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                autoApprovalMode
            })
        });
        const result = await response.json();
        if (!response.ok) {
            showNotification(result.error || result.details?.join(', ') || 'Failed to update token auto approval', 'error');
            return;
        }

        showNotification(`Auto approver set to ${formatAutoApprovalMode(result.token.autoApprovalMode)} for ${result.token.label}`, 'success');
        loadUsersPage();
    } catch (error) {
        showNotification('Network error while updating token auto approval', 'error');
    }
}

function openSignupReviewForm(request, decision) {
    closeUserModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-form-overlay';
    overlay.innerHTML = decision === 'approve'
        ? `
            <div class="modal">
                <div class="modal-header">
                    <h2>Approve Signup Request</h2>
                    <button class="modal-close" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="text-sm text-muted" style="margin-bottom:12px">Provision ${escapeHtml(request.username)} with the following access.</div>
                    <div class="form-group">
                        <label for="signup-review-display-name">Display Name</label>
                        <input type="text" id="signup-review-display-name" class="form-input" value="${escapeHtmlAttribute(request.displayName || request.username)}">
                    </div>
                    <div class="form-group">
                        <label><input type="checkbox" id="signup-review-enabled" checked> Enabled</label>
                    </div>
                    <div class="form-group">
                        <label><input type="checkbox" id="signup-review-admin"> Admin</label>
                    </div>
                    <div class="form-group">
                        <label><input type="checkbox" id="signup-review-medium"> Can approve MEDIUM</label>
                    </div>
                    <div class="form-group">
                        <label><input type="checkbox" id="signup-review-high"> Can approve HIGH</label>
                    </div>
                    <div class="text-sm text-muted" id="user-form-status"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" id="user-form-cancel">Cancel</button>
                    <button class="btn btn-primary" type="button" id="user-form-save">Approve Request</button>
                </div>
            </div>
        `
        : `
            <div class="modal">
                <div class="modal-header">
                    <h2>Reject Signup Request</h2>
                    <button class="modal-close" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="text-sm text-muted" style="margin-bottom:12px">Reject access request for ${escapeHtml(request.username)}.</div>
                    <div class="form-group">
                        <label for="signup-review-rationale">Reason <span style="color:var(--text-muted);font-weight:normal">optional</span></label>
                        <textarea id="signup-review-rationale" class="form-input" rows="3" placeholder="Why is this request being rejected?"></textarea>
                    </div>
                    <div class="text-sm text-muted" id="user-form-status"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" id="user-form-cancel">Cancel</button>
                    <button class="btn btn-primary" type="button" id="user-form-save">Reject Request</button>
                </div>
            </div>
        `;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-cancel').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-save').addEventListener('click', () => saveSignupReview(request.id, decision));
}

async function saveUser(userId) {
    const payload = {
        displayName: document.getElementById('user-display-name').value.trim() || null,
        enabled: document.getElementById('user-enabled').checked,
        roles: document.getElementById('user-admin').checked ? ['admin'] : [],
        approvalCapabilities: {
            canApproveMedium: document.getElementById('user-approve-medium').checked,
            canApproveHigh: document.getElementById('user-approve-high').checked
        }
    };

    if (!userId) {
        payload.username = document.getElementById('user-username').value.trim();
        payload.password = document.getElementById('user-password').value;
    }

    try {
        const response = await apiFetch(userId ? `/users/${userId}` : '/users', {
            method: userId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok) {
            document.getElementById('user-form-status').textContent = result.error || result.details?.join(', ') || 'Failed to save user';
            return;
        }

        showNotification(userId ? 'User updated' : 'User created', 'success');
        closeUserModal();
        loadUsersPage();
    } catch (error) {
        document.getElementById('user-form-status').textContent = 'Network error while saving user';
    }
}

async function saveSignupReview(requestId, decision) {
    const body = decision === 'approve'
        ? {
            displayName: document.getElementById('signup-review-display-name').value.trim() || null,
            enabled: document.getElementById('signup-review-enabled').checked,
            roles: document.getElementById('signup-review-admin').checked ? ['admin'] : [],
            approvalCapabilities: {
                canApproveMedium: document.getElementById('signup-review-medium').checked,
                canApproveHigh: document.getElementById('signup-review-high').checked
            }
        }
        : {
            rationale: document.getElementById('signup-review-rationale').value.trim() || null
        };

    try {
        const response = await apiFetch(`/signup-requests/${requestId}/${decision}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json();

        if (!response.ok) {
            document.getElementById('user-form-status').textContent = result.error || result.details?.join(', ') || 'Failed to review signup request';
            return;
        }

        showNotification(decision === 'approve' ? 'Signup approved' : 'Signup rejected', 'success');
        closeUserModal();
        loadUsersPage();
    } catch (error) {
        document.getElementById('user-form-status').textContent = 'Network error while reviewing signup request';
    }
}

function openPasswordResetForm(userId) {
    closeUserModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-form-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Reset Password</h2>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="user-reset-password">New Password</label>
                    <input type="password" id="user-reset-password" class="form-input" placeholder="Enter a new password">
                </div>
                <div class="text-sm text-muted" id="user-form-status"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" id="user-form-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="user-form-save">Reset Password</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-cancel').addEventListener('click', closeUserModal);
    overlay.querySelector('#user-form-save').addEventListener('click', () => saveUserPassword(userId));
}

async function saveUserPassword(userId) {
    const password = document.getElementById('user-reset-password').value;

    try {
        const response = await apiFetch(`/users/${userId}/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const result = await response.json();

        if (!response.ok) {
            document.getElementById('user-form-status').textContent = result.error || result.details?.join(', ') || 'Failed to reset password';
            return;
        }

        showNotification('Password reset', 'success');
        closeUserModal();
    } catch (error) {
        document.getElementById('user-form-status').textContent = 'Network error while resetting password';
    }
}

function closeUserModal() {
    const overlay = document.getElementById('user-form-overlay');
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

function describeUserApprovalScope(user) {
    if (user.approvalCapabilities.canApproveHigh) {
        return 'Can approve HIGH and MEDIUM';
    }
    if (user.approvalCapabilities.canApproveMedium) {
        return 'Can approve MEDIUM';
    }
    return 'No approval privileges';
}

function describeManagedTokenSubject(token) {
    if (token.subjectType === 'user' && token.linkedUser) {
        return `${token.linkedUser.displayName || token.linkedUser.username} · user-linked token`;
    }

    return `${token.principalDisplayName || token.principalIdentifier} · standalone identity`;
}

function describeManagedTokenAutoApproval(token) {
    if (token.subjectType === 'user') {
        return `Inherited from user: ${formatAutoApprovalMode(token.derivedAutoApprovalMode)}`;
    }

    return formatAutoApprovalMode(token.autoApprovalMode);
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

function renderRequestStatusTone(status) {
    if (status === 'approved') {
        return 'approved';
    }
    if (status === 'rejected') {
        return 'rejected';
    }
    return 'pending';
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
