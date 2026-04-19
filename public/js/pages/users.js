let usersPageState = {
    users: [],
    signupRequests: []
};

function renderUsers(container) {
    container.innerHTML = `
        <section class="workspace-header fade-in">
            <div class="workspace-header-copy">
                <div class="workspace-kicker">Identity Control</div>
                <p class="workspace-subtitle">Manage local dashboard users, approval capabilities, and team signup requests.</p>
            </div>
            <div class="workspace-controls">
                <button class="btn btn-primary" id="add-user-btn">New User</button>
            </div>
        </section>
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
        <section class="surface-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Local Users</div>
                    <div class="surface-section-copy">Local dashboard identities, their roles, and approval privileges.</div>
                </div>
            </div>
            <div class="command-stream" id="users-list">
                ${renderEmptyState('Loading users...', 'activity')}
            </div>
        </section>
    `;

    document.getElementById('add-user-btn').addEventListener('click', () => openUserForm());
    loadUsersPage();
}

async function loadUsersPage() {
    try {
        const [usersResponse, requestsResponse] = await Promise.all([
            apiFetch('/users'),
            apiFetch('/signup-requests')
        ]);
        const usersData = await usersResponse.json();
        const requestsData = await requestsResponse.json();

        usersPageState.users = usersData.users || [];
        usersPageState.signupRequests = requestsData.requests || [];

        renderSignupRequestsList();
        renderUsersList();
    } catch (error) {
        document.getElementById('signup-requests-list').innerHTML = renderEmptyState('Failed to load signup requests', 'blocked');
        document.getElementById('users-list').innerHTML = renderEmptyState('Failed to load users', 'blocked');
    }
}

function renderSignupRequestsList() {
    const list = document.getElementById('signup-requests-list');
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
    if (!usersPageState.users.length) {
        list.innerHTML = renderEmptyState('No local users found', 'activity');
        return;
    }

    list.innerHTML = usersPageState.users.map(user => `
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
                <span class="command-stream-meta-pill">Created · ${formatTime(user.createdAt)}</span>
                <span class="command-stream-meta-pill">Updated · ${formatTime(user.updatedAt)}</span>
            </div>
            <div class="command-stream-actions">
                <button class="btn btn-secondary btn-sm edit-user-btn" data-id="${user.id}">Edit</button>
                <button class="btn btn-secondary btn-sm password-user-btn" data-id="${user.id}">Reset Password</button>
            </div>
        </article>
    `).join('');

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

function describeUserApprovalScope(user) {
    if (user.approvalCapabilities.canApproveHigh) {
        return 'Can approve HIGH and MEDIUM';
    }
    if (user.approvalCapabilities.canApproveMedium) {
        return 'Can approve MEDIUM';
    }
    return 'No approval privileges';
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
