/**
 * Account Page - Session, notifications, and local account controls
 */

function renderAccount(container) {
    const principal = state.principal;

    if (!principal) {
        container.innerHTML = renderEmptyState('Sign in to manage account settings.', 'account');
        return;
    }

    const roles = Array.isArray(principal.roles) && principal.roles.length > 0
        ? principal.roles.join(', ')
        : 'none';
    const authLabel = state.authentication?.credentialLabel || state.authentication?.mode || 'local session';
    const canChangePassword = principal.type === 'user';

    container.innerHTML = `
        <section class="dashboard-hero account-hero fade-in">
            <div class="dashboard-hero-copy">
                <div class="workspace-kicker">Account</div>
                <h2 class="dashboard-hero-title">Session controls and personal notification settings.</h2>
                <p class="workspace-subtitle">Manage your signed-in dashboard identity, browser approval alerts, and password access from one place.</p>
            </div>
            <div class="dashboard-hero-rail">
                <div class="session-pill account-session-pill" data-account-session-label data-testid="account-session-summary">${escapeHtml(describePrincipal(principal))}</div>
            </div>
        </section>

        <section class="surface-grid-2 fade-in">
            <div class="surface-card account-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Identity</div>
                        <div class="surface-section-copy">Current dashboard session.</div>
                    </div>
                </div>
                <div class="account-detail-list">
                    ${renderAccountDetail('Display name', principal.displayName || principal.identifier || '-')}
                    ${renderAccountDetail('Identifier', principal.identifier || '-')}
                    ${renderAccountDetail('Account type', principal.type || '-')}
                    ${renderAccountDetail('Roles', roles)}
                    ${renderAccountDetail('Credential', authLabel)}
                </div>
            </div>

            <div class="surface-card account-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Notifications</div>
                        <div class="surface-section-copy">Browser approval alerts for this device and origin.</div>
                    </div>
                </div>
                <div class="account-setting-row">
                    <div>
                        <div class="account-setting-title">Approval notifications</div>
                        <div class="account-setting-copy">New pending approvals can trigger a browser or system notification.</div>
                    </div>
                    <button class="btn btn-secondary browser-notifications-toggle has-tooltip tooltip-below tooltip-right" type="button" data-account-action="toggle-notifications" data-testid="browser-notifications-toggle" data-tooltip="Enable approval notifications. Permission: default. Delivery: unavailable.">
                        <span class="btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </span>
                        <span data-browser-notifications-label>Notify: Off</span>
                    </button>
                </div>
            </div>
        </section>

        <section class="surface-grid-2 fade-in">
            <div class="surface-card account-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Password</div>
                        <div class="surface-section-copy">${canChangePassword ? 'Change the password for this local account.' : 'Password changes are not available for this principal.'}</div>
                    </div>
                </div>
                <button class="btn btn-secondary" type="button" data-account-action="change-password" data-testid="account-change-password" ${canChangePassword ? '' : 'disabled'}>
                    Change Password
                </button>
            </div>

            <div class="surface-card account-card">
                <div class="surface-section-head">
                    <div>
                        <div class="card-title">Session</div>
                        <div class="surface-section-copy">End the current dashboard session on this browser.</div>
                    </div>
                </div>
                <button class="btn btn-secondary" type="button" data-account-action="logout" data-testid="account-sign-out">
                    Sign Out
                </button>
            </div>
        </section>
    `;

    updateSessionUi();
    updateBrowserNotificationToggle();
}

function renderAccountDetail(label, value) {
    return `
        <div class="account-detail-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `;
}
