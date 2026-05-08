/**
 * Niyam Dashboard - Main Application Logic
 */

// State
const state = {
    currentPage: 'dashboard',
    ws: null,
    principal: null,
    authentication: null,
    authConfig: {
        allowSelfSignup: false,
        productMode: 'individual',
        profile: null
    },
    initialized: false,
    wsReconnectTimer: null,
    pendingCount: 0,
    currentPageRenderer: null,
    realtimeRefreshTimer: null,
    timerInterval: null,
    previewTimer: null,
    previewSequence: 0,
    pendingBadgeRefreshHooksInitialized: false,
    browserNotificationIds: new Set(),
    browserNotificationRegistrationPromise: null
};

// API Base URL
const API_BASE = '/api';

const REALTIME_REFRESH_DEBOUNCE_MS = 150;
const BROWSER_NOTIFICATIONS_STORAGE_KEY = 'niyam.browserNotifications.enabled';
const BROWSER_NOTIFICATIONS_ENABLED_AT_KEY = 'niyam.browserNotifications.enabledAt';
const BROWSER_NOTIFICATIONS_SEEN_KEY = 'niyam.browserNotifications.seenPendingIds';
const BROWSER_NOTIFICATIONS_DELIVERY_KEY = 'niyam.browserNotifications.deliveryMode';
const BROWSER_NOTIFICATION_DELIVERY_LABELS = {
    'service-worker': 'service-worker',
    'service-worker-native': 'service-worker + system fallback',
    'browser-api': 'browser-api',
    'browser-api-native': 'browser-api + system fallback',
    'native-fallback': 'system fallback',
    unavailable: 'unavailable'
};
const REALTIME_PAGE_EVENT_TYPES = new Set([
    'command_submitted',
    'command_auto_approved',
    'command_approved',
    'approval_granted',
    'command_rejected',
    'command_executing',
    'command_completed',
    'command_failed',
    'command_timeout',
    'command_cancelled',
    'command_killed',
    'cli_dispatch_created',
    'cli_dispatch_linked_command',
    'cli_dispatch_updated',
    'rule_created',
    'rule_updated',
    'rule_deleted'
]);

const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24"><path d="M4 19h16M7 15v-4M12 15V7M17 15v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    playground: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h14m-3-9 3 3-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    workspace: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pending: '<svg viewBox="0 0 24 24"><path d="M8 4h8M8 20h8M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M8 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a3 3 0 1 1 0-6h10M8 5a3 3 0 1 0 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dispatches: '<svg viewBox="0 0 24 24"><path d="M5 12h4l2-4 3 8 2-4h3M6 6h12M6 18h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rules: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v14H5V6h3l1-2Zm0 6h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    audit: '<svg viewBox="0 0 24 24"><path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    activity: '<svg viewBox="0 0 24 24"><path d="M5 12h4l2-4 3 8 2-4h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    account: '<svg viewBox="0 0 24 24"><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg viewBox="0 0 24 24"><path d="m5 12 4.2 4L19 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    blocked: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    package: '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5-8-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const ALL_PAGES = ['dashboard', 'playground', 'workspace', 'pending', 'history', 'rules', 'audit', 'users', 'account'];
const DEFAULT_USER_PAGES = ['dashboard', 'playground', 'workspace', 'pending', 'history', 'account'];

function renderUiIcon(name, className = '') {
    const svg = ICONS[name] || ICONS.activity;
    return `<span class="${className}">${svg}</span>`;
}

function renderEmptyState(message, icon = 'activity') {
    return `
        <div class="empty-state">
            <div class="empty-state-icon">${ICONS[icon] || ICONS.activity}</div>
            <div class="empty-state-text">${message}</div>
        </div>
    `;
}

function renderEventChip(label, tone = '') {
    return `<span class="icon-chip ${tone}">${label}</span>`;
}

// ═══════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    bootstrapApp();
});

async function bootstrapApp() {
    await loadAuthConfig();
    updateModeLabels();
    initAuthUi();

    const restored = await restoreSession();
    if (!restored) {
        enterUnauthenticatedState('Sign in with a local Niyam account to continue.');
    }
}

// ═══════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════
function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateTo(page);
        });
    });
}

function initAuthUi() {
    document.getElementById('login-btn').addEventListener('click', submitLogin);
    document.getElementById('login-password').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            submitLogin();
        }
    });
    document.getElementById('show-signup-btn').addEventListener('click', openSignupOverlay);
    document.getElementById('signup-back-btn').addEventListener('click', () => {
        closeSignupOverlay();
        showLoginOverlay('Sign in with a local Niyam account to continue.');
    });
    document.getElementById('signup-btn').addEventListener('click', submitSignupRequest);
    document.getElementById('signup-password').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            submitSignupRequest();
        }
    });
    document.addEventListener('click', handleAccountActionClick);
    document.getElementById('password-modal-close').addEventListener('click', closePasswordModal);
    document.getElementById('password-cancel-btn').addEventListener('click', closePasswordModal);
    document.getElementById('password-save-btn').addEventListener('click', submitPasswordChange);
    document.getElementById('password-new').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            submitPasswordChange();
        }
    });
    hydrateBrowserNotificationIds();
    updateBrowserNotificationToggle();
    registerBrowserNotificationServiceWorker();
    initPendingBadgeRefreshHooks();
}

function handleAccountActionClick(event) {
    const actionTarget = event.target.closest('[data-account-action]');
    if (!actionTarget) {
        return;
    }

    event.preventDefault();
    const action = actionTarget.dataset.accountAction;
    if (action === 'logout') {
        logout();
    } else if (action === 'change-password') {
        openPasswordModal();
    } else if (action === 'toggle-notifications') {
        toggleBrowserNotifications();
    }
}

async function loadAuthConfig() {
    try {
        const response = await fetch(`${API_BASE}/auth/config`);
        if (!response.ok) {
            return;
        }

        const result = await response.json();
        state.authConfig = {
            ...state.authConfig,
            ...result
        };
        updateModeLabels();
    } catch (error) {
        // Leave defaults in place.
    }
}

async function openTokenShellFromDashboard(token, label, statusElementId = null) {
    const statusElement = statusElementId ? document.getElementById(statusElementId) : null;
    if (statusElement) {
        statusElement.textContent = 'Opening a local shell...';
    }

    try {
        const response = await apiFetch('/cli/open-shell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || result.details?.join(', ') || 'Failed to open a shell');
        }

        if (statusElement) {
            statusElement.textContent = `Opened ${result.terminalApp} using ${result.shell}.`;
        }
        showNotification(`Opened ${result.terminalApp} for ${label}`, 'success');
        return result;
    } catch (error) {
        if (statusElement) {
            statusElement.textContent = error.message || 'Failed to open a shell';
        }
        showNotification(error.message || 'Failed to open a shell', 'error');
        throw error;
    }
}

async function restoreSession() {
    try {
        const response = await fetch(`${API_BASE}/auth/me`);
        if (!response.ok) {
            return false;
        }

        const result = await response.json();
        enterAuthenticatedState(result.principal, result.authentication);
        return true;
    } catch (error) {
        return false;
    }
}

function enterAuthenticatedState(principal, authentication = null) {
    state.principal = principal;
    state.authentication = authentication;
    hideLoginOverlay();
    updateSessionUi();
    updateNavigationForPrincipal();
    updateBrowserNotificationToggle();
    if (areBrowserNotificationsEnabled()) {
        syncNativeNotificationPreference(shouldEnableNativeNotificationFallback(), { silent: true });
    }

    if (!state.initialized) {
        initNavigation();
        initSubmitModal();
        state.initialized = true;

        const pageFromHash = (window.location.hash || '').replace('#', '');
        const savedPage = localStorage.getItem('niyam.currentPage');
        const allowedPages = getAllowedPages(principal);
        const initialPage = allowedPages.includes(pageFromHash)
            ? pageFromHash
            : (allowedPages.includes(savedPage) ? savedPage : 'dashboard');

        window.addEventListener('hashchange', () => {
            const page = (window.location.hash || '').replace('#', '');
            if (state.principal && getAllowedPages(state.principal).includes(page) && page !== state.currentPage) {
                navigateTo(page);
            }
        });

        navigateTo(initialPage);
    } else {
        navigateTo(state.currentPage || 'dashboard');
    }

    const requesterInput = document.getElementById('cmd-requester');
    if (requesterInput) {
        requesterInput.value = principal.identifier;
    }
    updatePendingBadge();

    if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
        initWebSocket();
    }
}

function enterUnauthenticatedState(message) {
    state.principal = null;
    state.authentication = null;
    updateSessionUi();
    updateBrowserNotificationToggle();
    updateNavigationForPrincipal();
    closeApprovalModal();
    closeModal();
    closePasswordModal();
    stopRealtime();
    showLoginOverlay(message);
}

function updateSessionUi() {
    const submitBtn = document.getElementById('submit-command-btn');

    if (!state.principal) {
        document.querySelectorAll('[data-account-session-label]').forEach(element => {
            element.textContent = 'Not signed in';
        });
        if (submitBtn) {
            submitBtn.disabled = true;
        }
        return;
    }

    document.querySelectorAll('[data-account-session-label]').forEach(element => {
        element.textContent = describePrincipal(state.principal);
    });
    if (submitBtn) {
        submitBtn.disabled = false;
    }
}

function showLoginOverlay(message) {
    closeSignupOverlay();
    document.getElementById('login-overlay').style.display = 'flex';
    updateAuthOverlayActions();
    setLoginStatus(message || 'Sign in with a local Niyam account to continue.');
    document.getElementById('login-password').focus();
}

function hideLoginOverlay() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('signup-overlay').style.display = 'none';
    setLoginStatus('Sign in with a local Niyam account to continue.');
    document.getElementById('login-password').value = '';
    setSignupStatus('Your request stays pending until an admin approves it.');
    document.getElementById('signup-password').value = '';
}

function setLoginStatus(message) {
    document.getElementById('login-status').textContent = message;
}

function setSignupStatus(message) {
    document.getElementById('signup-status').textContent = message;
}

function updateAuthOverlayActions() {
    document.getElementById('show-signup-btn').style.display = state.authConfig.allowSelfSignup ? 'inline-flex' : 'none';
}

async function submitLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        setLoginStatus('Username and password are required.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();

        if (!response.ok) {
            setLoginStatus(result.error || 'Login failed.');
            return;
        }

        enterAuthenticatedState(result.principal, result.authentication);
        showNotification('Signed in', 'success');
    } catch (error) {
        setLoginStatus('Network error while signing in.');
    }
}

function openSignupOverlay() {
    if (!state.authConfig.allowSelfSignup) {
        return;
    }

    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('signup-overlay').style.display = 'flex';
    setSignupStatus('Your request stays pending until an admin approves it.');
    document.getElementById('signup-username').focus();
}

function closeSignupOverlay() {
    document.getElementById('signup-overlay').style.display = 'none';
}

async function submitSignupRequest() {
    const username = document.getElementById('signup-username').value.trim();
    const displayName = document.getElementById('signup-display-name').value.trim();
    const password = document.getElementById('signup-password').value;

    if (!username || !password) {
        setSignupStatus('Username and password are required.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/signup-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                displayName: displayName || null,
                password
            })
        });
        const result = await response.json();

        if (!response.ok) {
            setSignupStatus(result.error || result.details?.join(', ') || 'Unable to submit signup request.');
            return;
        }

        document.getElementById('signup-username').value = '';
        document.getElementById('signup-display-name').value = '';
        document.getElementById('signup-password').value = '';
        closeSignupOverlay();
        showLoginOverlay(`Access request submitted for ${result.username}. Wait for admin approval.`);
    } catch (error) {
        setSignupStatus('Network error while requesting access.');
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (error) {
        // The local state still needs to be cleared on logout failure.
    }

    enterUnauthenticatedState('Signed out.');
}

function openPasswordModal() {
    if (!state.principal || state.principal.type !== 'user') {
        return;
    }

    document.getElementById('password-current').value = '';
    document.getElementById('password-new').value = '';
    document.getElementById('password-status').textContent = '';
    document.getElementById('password-modal').style.display = 'flex';
    document.getElementById('password-current').focus();
}

function closePasswordModal() {
    document.getElementById('password-modal').style.display = 'none';
}

async function submitPasswordChange() {
    const currentPassword = document.getElementById('password-current').value;
    const newPassword = document.getElementById('password-new').value;

    if (!currentPassword || !newPassword) {
        document.getElementById('password-status').textContent = 'Current password and new password are required.';
        return;
    }

    try {
        const response = await apiFetch('/auth/change-password', {
            allowUnauthorizedResponse: true,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const result = await response.json();

        if (!response.ok) {
            document.getElementById('password-status').textContent = result.error || result.details?.join(', ') || 'Password change failed.';
            return;
        }

        closePasswordModal();
        enterAuthenticatedState(result.principal, result.authentication);
        showNotification('Password updated', 'success');
    } catch (error) {
        document.getElementById('password-status').textContent = 'Network error while changing password.';
    }
}

async function apiFetch(path, options = {}) {
    const url = path.startsWith('/api') ? path : `${API_BASE}${path}`;
    const response = await fetch(url, options);

    if (response.status === 401 && !options.allowUnauthorizedResponse) {
        enterUnauthenticatedState('Session expired. Sign in again.');
        throw new Error('Authentication required');
    }

    return response;
}

function navigateTo(page) {
    if (page === 'dispatches') {
        page = 'history';
    }

    if (!getAllowedPages(state.principal).includes(page)) {
        page = 'dashboard';
    }

    state.currentPage = page;
    localStorage.setItem('niyam.currentPage', page);

    // Keep URL in sync so refresh stays on the same page
    if (window.location.hash !== `#${page}`) {
        window.location.hash = page;
    }
    
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });
    
    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        playground: 'Playground',
        workspace: 'Workspace',
        pending: 'Pending Approvals',
        history: 'Activity',
        dispatches: 'Activity',
        rules: 'Policy Rules',
        audit: 'Audit Log',
        users: state.authConfig.productMode === 'individual' ? 'Tokens' : 'Users',
        account: 'Account'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    
    // Render page
    const container = document.getElementById('page-container');
    container.innerHTML = '';
    
    switch (page) {
        case 'dashboard': renderDashboard(container); break;
        case 'playground': renderPlayground(container); break;
        case 'workspace': renderWorkspace(container); break;
        case 'pending': renderPending(container); break;
        case 'history': renderHistory(container); break;
        case 'dispatches': renderHistory(container); break;
        case 'rules': renderRules(container); break;
        case 'audit': renderAudit(container); break;
        case 'users': renderUsers(container); break;
        case 'account': renderAccount(container); break;
    }
    
    updatePendingBadge();
    startRealtimeUpdates();
}

// ═══════════════════════════════════════════
// Realtime Updates
// ═══════════════════════════════════════════
function startRealtimeUpdates() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    startTimerUpdates();

    if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
        initWebSocket();
    }
}

function stopRealtime() {
    if (state.realtimeRefreshTimer) clearTimeout(state.realtimeRefreshTimer);
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    state.realtimeRefreshTimer = null;
    state.timerInterval = null;
    state.wsReconnectTimer = null;
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
}

function scheduleRealtimePageRefresh() {
    if (state.realtimeRefreshTimer) {
        clearTimeout(state.realtimeRefreshTimer);
    }

    state.realtimeRefreshTimer = setTimeout(() => {
        state.realtimeRefreshTimer = null;
        refreshCurrentPageData();
    }, REALTIME_REFRESH_DEBOUNCE_MS);
}

async function refreshCurrentPageData() {
    if (!state.principal || !state.currentPage) {
        return;
    }

    updatePendingBadge();

    const submitModal = document.getElementById('submit-modal');
    const approvalModal = document.getElementById('approval-modal');
    if ((submitModal && submitModal.style.display === 'flex') ||
        (approvalModal && approvalModal.style.display === 'flex')) {
        return;
    }

    try {
        switch (state.currentPage) {
            case 'dashboard':
                await Promise.all([
                    loadDashboardStats(),
                    loadRecentActivity(),
                    loadPendingPreview()
                ]);
                break;
            case 'playground':
                await refreshPlaygroundData();
                break;
            case 'workspace':
                await loadWorkspaceDetails();
                break;
            case 'pending':
                await loadPendingPage();
                break;
            case 'history':
            case 'dispatches':
                await loadHistoryPage();
                break;
            case 'rules':
                await loadRulesPage();
                break;
            case 'audit':
                await Promise.all([
                    loadAuditStats(),
                    loadAuditLog()
                ]);
                break;
            case 'users':
                await loadUsersPage();
                break;
        }
    } catch (error) {
        // Page-specific loaders already render their own error states.
    }
}

// ═══════════════════════════════════════════
// Timer Visualization
// ═══════════════════════════════════════════
function startTimerUpdates() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        updateAllTimers();
    }, 1000);
}

function updateAllTimers() {
    document.querySelectorAll('.cmd-timer').forEach(el => {
        const timeout = el.dataset.timeout;
        if (!timeout) return;
        
        const now = Date.now();
        const expiry = new Date(timeout).getTime();
        const created = new Date(el.dataset.created).getTime();
        const remaining = expiry - now;
        const total = expiry - created;
        
        const ring = el.querySelector('.timer-ring-progress');
        const text = el.querySelector('.timer-text');
        const bar = el.querySelector('.timer-bar-fill');
        
        if (remaining <= 0) {
            if (ring) ring.style.strokeDashoffset = '0';
            if (text) text.textContent = 'Expired';
            if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--accent-red)'; }
            el.classList.add('expired');
            return;
        }
        
        // Percentage remaining
        const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
        
        // Ring animation (SVG circle)
        if (ring) {
            const circumference = 2 * Math.PI * 18; // r=18
            const offset = circumference * (1 - pct / 100);
            ring.style.strokeDashoffset = offset;
            
            // Color based on remaining time
            if (pct < 20) ring.style.stroke = 'var(--accent-red)';
            else if (pct < 50) ring.style.stroke = 'var(--accent-yellow)';
            else ring.style.stroke = 'var(--accent-green)';
        }
        
        // Text
        if (text) {
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            if (hours > 0) text.textContent = `${hours}h ${minutes}m`;
            else if (minutes > 0) text.textContent = `${minutes}m ${seconds}s`;
            else text.textContent = `${seconds}s`;
        }
        
        // Bar
        if (bar) {
            bar.style.width = `${100 - pct}%`;
            if (pct < 20) bar.style.background = 'var(--accent-red)';
            else if (pct < 50) bar.style.background = 'var(--accent-yellow)';
            else bar.style.background = 'var(--accent-green)';
        }
    });
}

function renderTimer(timeoutAt, createdAt, type = 'ring') {
    if (!timeoutAt) return '';
    const ts = new Date(timeoutAt).getTime();
    const cs = new Date(createdAt).getTime();
    const remaining = ts - Date.now();
    
    if (type === 'ring') {
        const circumference = 2 * Math.PI * 18;
        const pct = Math.max(0, Math.min(100, (remaining / (ts - cs)) * 100));
        const offset = circumference * (1 - pct / 100);
        let color = 'var(--accent-green)';
        if (pct < 20) color = 'var(--accent-red)';
        else if (pct < 50) color = 'var(--accent-yellow)';
        
        return `<div class="cmd-timer" data-timeout="${timeoutAt}" data-created="${createdAt}">
            <svg class="timer-ring" viewBox="0 0 44 44">
                <circle class="timer-ring-bg" cx="22" cy="22" r="18"/>
                <circle class="timer-ring-progress" cx="22" cy="22" r="18" 
                    style="stroke:${color};stroke-dasharray:${circumference};stroke-dashoffset:${offset}"/>
            </svg>
            <span class="timer-text">${remaining > 0 ? '...' : 'Expired'}</span>
        </div>`;
    }
    
    // Bar type
    return `<div class="cmd-timer" data-timeout="${timeoutAt}" data-created="${createdAt}">
        <div class="timer-bar"><div class="timer-bar-fill"></div></div>
        <span class="timer-text">${remaining > 0 ? '...' : 'Expired'}</span>
    </div>`;
}

// ═══════════════════════════════════════════
// WebSocket
// ═══════════════════════════════════════════
function initWebSocket() {
    if (!state.principal) {
        return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    
    function connect() {
        try {
            state.ws = new WebSocket(wsUrl);
        } catch (e) {
            return;
        }
        
        state.ws.onopen = () => {
            updateConnectionStatus(true);
        };
        
        state.ws.onclose = () => {
            updateConnectionStatus(false);
            if (state.principal) {
                state.wsReconnectTimer = setTimeout(connect, 3000);
            }
        };
        
        state.ws.onerror = () => {
            updateConnectionStatus(false);
        };
        
        state.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleWebSocketMessage(msg);
            } catch (e) {
                // Ignore malformed messages
            }
        };
    }
    
    connect();
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('ws-status');
    if (!statusEl) {
        return;
    }
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');
    
    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Live';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
    }
}

function handleWebSocketMessage(msg) {
    const { type, data = {} } = msg;
    const commandLine = buildCommandLineDisplay(data);
    
    switch (type) {
        case 'command_submitted':
            updatePendingBadge();
            showNotification(`New command: ${commandLine || data.command}`, 'info');
            showBrowserApprovalNotification(data);
            break;
        case 'command_auto_approved':
            updatePendingBadge();
            showNotification(`Command auto-approved: ${commandLine || data.command}`, 'success');
            showBrowserApprovalStatusNotification('command_auto_approved', data);
            break;
        case 'command_approved':
            updatePendingBadge();
            showNotification(`Command approved: ${commandLine || data.command}`, 'success');
            showBrowserApprovalStatusNotification('command_approved', data);
            break;
        case 'command_rejected':
            updatePendingBadge();
            showNotification(`Command rejected: ${commandLine || data.command}`, 'error');
            break;
        case 'command_completed':
            showNotification(`Command completed: ${commandLine || data.command}`, 'success');
            break;
        case 'command_failed':
            showNotification(`Command failed: ${commandLine || data.command}`, 'error');
            break;
        case 'command_timeout':
            updatePendingBadge();
            showNotification(`Command timed out`, 'warning');
            break;
        case 'approval_granted':
            updatePendingBadge();
            showNotification(`Approval granted (${data.approvals}/${data.required})`, 'info');
            showBrowserApprovalStatusNotification('approval_granted', data);
            break;
    }
    
    if (REALTIME_PAGE_EVENT_TYPES.has(type)) {
        scheduleRealtimePageRefresh();
    }
}

function updatePendingBadge() {
    if (!state.principal) {
        return Promise.resolve();
    }

    return apiFetch('/commands?status=pending&limit=0')
        .then(r => r.json())
        .then(data => {
            const count = data.total || 0;
            const badge = document.getElementById('pending-badge');
            if (count > 0) {
                badge.style.display = 'inline';
                badge.textContent = count;
            } else {
                badge.style.display = 'none';
            }
            state.pendingCount = count;
            if (count > 0) {
                syncPendingApprovalNotifications();
            }
        })
        .catch(() => {});
}

// ═══════════════════════════════════════════
// Browser Notifications
// ═══════════════════════════════════════════
function initPendingBadgeRefreshHooks() {
    if (state.pendingBadgeRefreshHooksInitialized) {
        return;
    }

    state.pendingBadgeRefreshHooksInitialized = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updatePendingBadge();
        }
    });
    window.addEventListener('focus', () => {
        updatePendingBadge();
    });
}

function getBrowserNotificationApi() {
    return typeof window !== 'undefined' && 'Notification' in window ? window.Notification : null;
}

function getStoredBrowserNotificationsEnabled() {
    try {
        return localStorage.getItem(BROWSER_NOTIFICATIONS_STORAGE_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

function setStoredBrowserNotificationsEnabled(enabled) {
    try {
        localStorage.setItem(BROWSER_NOTIFICATIONS_STORAGE_KEY, enabled ? 'true' : 'false');
        if (enabled) {
            localStorage.setItem(BROWSER_NOTIFICATIONS_ENABLED_AT_KEY, String(Date.now()));
        }
    } catch (error) {
        // Ignore storage failures; permission still controls browser notification delivery.
    }
}

function getBrowserNotificationsEnabledAt() {
    try {
        const enabledAt = Number.parseInt(localStorage.getItem(BROWSER_NOTIFICATIONS_ENABLED_AT_KEY), 10);
        return Number.isFinite(enabledAt) ? enabledAt : 0;
    } catch (error) {
        return 0;
    }
}

function getStoredBrowserNotificationDelivery() {
    try {
        const delivery = localStorage.getItem(BROWSER_NOTIFICATIONS_DELIVERY_KEY);
        return BROWSER_NOTIFICATION_DELIVERY_LABELS[delivery] ? delivery : 'unavailable';
    } catch (error) {
        return 'unavailable';
    }
}

function setStoredBrowserNotificationDelivery(delivery) {
    const normalized = BROWSER_NOTIFICATION_DELIVERY_LABELS[delivery] ? delivery : 'unavailable';
    try {
        localStorage.setItem(BROWSER_NOTIFICATIONS_DELIVERY_KEY, normalized);
    } catch (error) {
        // Ignore storage failures; the current toggle render still uses the normalized value.
    }
    updateBrowserNotificationToggle();
    return normalized;
}

function shouldEnableNativeNotificationFallback() {
    const delivery = getStoredBrowserNotificationDelivery();
    return delivery === 'native-fallback' ||
        delivery === 'service-worker-native' ||
        delivery === 'browser-api-native';
}

function resolveCombinedNotificationDelivery(browserDelivery, nativeFallbackSent) {
    if (!nativeFallbackSent) {
        return browserDelivery;
    }
    if (browserDelivery === 'service-worker') {
        return 'service-worker-native';
    }
    if (browserDelivery === 'browser-api') {
        return 'browser-api-native';
    }
    return browserDelivery;
}

function rememberBrowserNotificationId(commandId, scope = 'pending') {
    if (!commandId) {
        return;
    }

    const key = buildBrowserNotificationKey(scope, commandId);
    state.browserNotificationIds.add(key);
    try {
        const ids = JSON.parse(localStorage.getItem(BROWSER_NOTIFICATIONS_SEEN_KEY) || '[]');
        const merged = [key, ...ids.filter(id => id !== key)].slice(0, 120);
        localStorage.setItem(BROWSER_NOTIFICATIONS_SEEN_KEY, JSON.stringify(merged));
    } catch (error) {
        // Session memory still prevents duplicate notifications if local storage fails.
    }
}

function hydrateBrowserNotificationIds() {
    try {
        const ids = JSON.parse(localStorage.getItem(BROWSER_NOTIFICATIONS_SEEN_KEY) || '[]');
        if (Array.isArray(ids)) {
            ids.filter(Boolean).forEach(id => state.browserNotificationIds.add(id));
        }
    } catch (error) {
        // Ignore malformed local state.
    }
}

function getBrowserNotificationPermission() {
    const NotificationApi = getBrowserNotificationApi();
    return NotificationApi ? NotificationApi.permission || 'default' : 'unsupported';
}

function supportsServiceWorkerNotifications() {
    return typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof navigator.serviceWorker.register === 'function';
}

function registerBrowserNotificationServiceWorker() {
    if (!supportsServiceWorkerNotifications()) {
        return Promise.resolve(null);
    }

    if (!state.browserNotificationRegistrationPromise) {
        state.browserNotificationRegistrationPromise = navigator.serviceWorker
            .register('/notification-sw.js')
            .then(registration => registration)
            .catch(() => null);
    }

    return state.browserNotificationRegistrationPromise;
}

async function getBrowserNotificationRegistration() {
    const registered = await registerBrowserNotificationServiceWorker();
    if (registered && typeof registered.showNotification === 'function') {
        return registered;
    }

    if (typeof navigator !== 'undefined' &&
        navigator.serviceWorker &&
        navigator.serviceWorker.ready &&
        typeof navigator.serviceWorker.ready.then === 'function') {
        try {
            const ready = await navigator.serviceWorker.ready;
            if (ready && typeof ready.showNotification === 'function') {
                return ready;
            }
        } catch (error) {
            return null;
        }
    }

    return null;
}

function areBrowserNotificationsEnabled() {
    return Boolean(getBrowserNotificationApi()) &&
        getBrowserNotificationPermission() === 'granted' &&
        getStoredBrowserNotificationsEnabled();
}

async function requestBrowserNotificationPermission() {
    const NotificationApi = getBrowserNotificationApi();
    if (!NotificationApi || typeof NotificationApi.requestPermission !== 'function') {
        return 'unsupported';
    }

    try {
        const result = await Promise.resolve(NotificationApi.requestPermission());
        return result || getBrowserNotificationPermission();
    } catch (error) {
        return getBrowserNotificationPermission();
    }
}

async function toggleBrowserNotifications() {
    const permission = getBrowserNotificationPermission();

    if (permission === 'unsupported') {
        setStoredBrowserNotificationsEnabled(false);
        setStoredBrowserNotificationDelivery('unavailable');
        updateBrowserNotificationToggle();
        await syncNativeNotificationPreference(false, { silent: true });
        showNotification('Browser notifications are not supported here.', 'warning');
        return;
    }

    if (areBrowserNotificationsEnabled()) {
        setStoredBrowserNotificationsEnabled(false);
        setStoredBrowserNotificationDelivery('unavailable');
        updateBrowserNotificationToggle();
        await syncNativeNotificationPreference(false);
        showNotification('Notification setting saved: off', 'info');
        return;
    }

    if (permission === 'denied') {
        setStoredBrowserNotificationsEnabled(false);
        setStoredBrowserNotificationDelivery('unavailable');
        updateBrowserNotificationToggle();
        await syncNativeNotificationPreference(false, { silent: true });
        showNotification('Browser notifications are blocked. Enable them in browser site settings.', 'warning');
        return;
    }

    const nextPermission = permission === 'granted'
        ? permission
        : await requestBrowserNotificationPermission();

    if (nextPermission === 'granted') {
        setStoredBrowserNotificationsEnabled(true);
        updateBrowserNotificationToggle();
        const browserDelivery = await sendBrowserNotification('Niyam notifications enabled', {
            body: 'New pending approval requests will notify this browser.',
            tag: 'niyam-notifications-enabled'
        }, 'pending', { suppressWarnings: true });

        if (browserDelivery.sent) {
            await syncNativeNotificationPreference(true, { silent: true });
            const nativeTestSent = await sendNativeNotificationTest();
            setStoredBrowserNotificationDelivery(resolveCombinedNotificationDelivery(browserDelivery.delivery, nativeTestSent));
            showNotification(
                nativeTestSent
                    ? 'Notification setting saved. Test browser notification sent; system fallback enabled.'
                    : 'Notification setting saved. Test browser notification sent.',
                'success'
            );
            await seedPendingApprovalNotificationState();
            return;
        }

        await syncNativeNotificationPreference(true);
        const nativeTestSent = await sendNativeNotificationTest();
        if (nativeTestSent) {
            setStoredBrowserNotificationDelivery('native-fallback');
            showNotification('Notification setting saved. Browser notification unavailable; system fallback sent.', 'warning');
            await seedPendingApprovalNotificationState();
            return;
        }

        setStoredBrowserNotificationsEnabled(false);
        setStoredBrowserNotificationDelivery('unavailable');
        await syncNativeNotificationPreference(false, { silent: true });
        showNotification('Browser accepted permission but did not display notifications.', 'warning');
        return;
    }

    setStoredBrowserNotificationsEnabled(false);
    setStoredBrowserNotificationDelivery('unavailable');
    updateBrowserNotificationToggle();
    await syncNativeNotificationPreference(false, { silent: true });
    showNotification('Browser notifications were not allowed.', 'warning');
}

async function syncNativeNotificationPreference(enabled, options = {}) {
    if (!state.principal || !state.principal.roles || !state.principal.roles.includes('admin')) {
        return false;
    }

    try {
        const response = await apiFetch('/notifications/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nativeNotificationsEnabled: enabled })
        });
        if (!response.ok && !options.silent) {
            showNotification('Could not update system notification setting.', 'warning');
        }
        return response.ok;
    } catch (error) {
        if (!options.silent) {
            showNotification('Could not update system notification setting.', 'warning');
        }
        return false;
    }
}

async function sendNativeNotificationTest() {
    try {
        const response = await apiFetch('/notifications/test', {
            method: 'POST'
        });
        return response.ok;
    } catch (error) {
        // Browser-side notifications may still work; the in-page state should not fail the toggle.
        return false;
    }
}

function updateBrowserNotificationToggle() {
    const buttons = document.querySelectorAll('.browser-notifications-toggle');
    if (buttons.length === 0) {
        return;
    }

    const permission = getBrowserNotificationPermission();
    const enabled = areBrowserNotificationsEnabled();
    const delivery = enabled ? getStoredBrowserNotificationDelivery() : 'unavailable';
    const deliveryLabel = BROWSER_NOTIFICATION_DELIVERY_LABELS[delivery] || 'unavailable';
    let text = enabled ? 'Notify: On' : 'Notify: Off';
    let tooltip = enabled
        ? `Notifications are enabled. Permission: ${permission}. Delivery: ${deliveryLabel}.`
        : `Enable approval notifications. Permission: ${permission}. Delivery: ${deliveryLabel}.`;
    let stateClass = enabled ? 'is-on' : '';

    if (permission === 'unsupported') {
        text = 'Notify: Unsupported';
        tooltip = `This browser does not support desktop notifications. Permission: ${permission}. Delivery: unavailable.`;
        stateClass = 'is-unsupported';
    } else if (permission === 'denied') {
        text = 'Notify: Blocked';
        tooltip = `Browser notifications are blocked in site settings. Permission: ${permission}. Delivery: unavailable.`;
        stateClass = 'is-blocked';
    }

    buttons.forEach(button => {
        const label = button.querySelector('[data-browser-notifications-label]');
        if (label) {
            label.textContent = text;
        }
        button.classList.toggle('is-on', stateClass === 'is-on');
        button.classList.toggle('is-blocked', stateClass === 'is-blocked');
        button.classList.toggle('is-unsupported', stateClass === 'is-unsupported');
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.setAttribute('data-tooltip', tooltip);
    });
}

async function seedPendingApprovalNotificationState() {
    return syncPendingApprovalNotifications({ seedOnly: true });
}

async function syncPendingApprovalNotifications(options = {}) {
    if (!state.principal || !areBrowserNotificationsEnabled()) {
        return;
    }

    try {
        const response = await apiFetch('/commands?status=pending&limit=20');
        if (!response.ok) {
            return;
        }
        const result = await response.json();
        const commands = Array.isArray(result.commands) ? result.commands : [];
        const enabledAt = getBrowserNotificationsEnabledAt();

        for (const command of commands) {
            const createdAt = new Date(command.created_at || command.createdAt || 0).getTime();
            const commandData = {
                ...command,
                riskLevel: command.riskLevel || command.risk_level,
                timeoutAt: command.timeoutAt || command.timeout_at
            };

            if (options.seedOnly || (Number.isFinite(createdAt) && createdAt < enabledAt)) {
                rememberBrowserNotificationId(commandData.id, 'pending');
                continue;
            }

            await showBrowserApprovalNotification(commandData);
        }
    } catch (error) {
        // Notification catch-up should never interrupt the dashboard.
    }
}

async function sendBrowserNotification(title, options = {}, targetPage = null, sendOptions = {}) {
    const NotificationApi = getBrowserNotificationApi();
    if (!NotificationApi || getBrowserNotificationPermission() !== 'granted') {
        return { sent: false, delivery: 'unavailable', reason: 'permission' };
    }

    const targetHash = targetPage ? `#${targetPage}` : null;
    const notificationOptions = {
        ...options,
        data: {
            ...(options.data || {}),
            targetHash,
            url: targetHash ? `${window.location.origin}/${targetHash}` : window.location.href
        }
    };

    const registration = await getBrowserNotificationRegistration();
    if (registration) {
        try {
            await registration.showNotification(title, notificationOptions);
            return { sent: true, delivery: 'service-worker' };
        } catch (error) {
            // Fall through to the direct browser API below.
        }
    }

    try {
        const notification = new NotificationApi(title, notificationOptions);
        if (targetPage) {
            notification.onclick = () => {
                focusAndNavigateForBrowserNotification(targetPage);
                if (typeof notification.close === 'function') {
                    notification.close();
                }
            };
        }
        return { sent: true, delivery: 'browser-api', notification };
    } catch (error) {
        if (!sendOptions.suppressWarnings) {
            showNotification('Browser accepted permission but did not display notifications.', 'warning');
        }
        return { sent: false, delivery: 'unavailable', reason: 'display_failed' };
    }
}

function focusAndNavigateForBrowserNotification(page) {
    if (typeof window.focus === 'function') {
        window.focus();
    }
    if (state.principal && getAllowedPages(state.principal).includes(page)) {
        navigateTo(page);
    } else {
        window.location.hash = page;
    }
}

async function showBrowserApprovalNotification(data = {}) {
    if (!shouldShowBrowserApprovalNotification(data)) {
        return false;
    }

    const commandLine = truncateNotificationText(buildCommandLineDisplay(data) || data.command || 'Command awaiting review', 120);
    const riskLevel = data.riskLevel || data.risk_level || 'Risk pending';
    const requester = data.requester || 'unknown requester';

    const delivery = await sendBrowserNotification('Niyam approval needed', {
        body: `${riskLevel}: ${commandLine} from ${requester}`,
        tag: data.id ? `niyam-approval-${data.id}` : undefined,
        requireInteraction: true
    }, 'pending', { suppressWarnings: true });

    if (!delivery.sent) {
        return false;
    }

    setStoredBrowserNotificationDelivery(delivery.delivery);
    rememberBrowserNotificationId(data.id, 'pending');
    return true;
}

async function showBrowserApprovalStatusNotification(eventType, data = {}) {
    if (!areBrowserNotificationsEnabled() || !data.id) {
        return false;
    }

    const notificationKey = buildBrowserNotificationKey(eventType, data.id);
    if (state.browserNotificationIds.has(notificationKey)) {
        return false;
    }

    const commandData = await resolveBrowserNotificationCommandData(data);
    if (!commandData || commandData.approvalNotificationsEnabled === false) {
        rememberBrowserNotificationId(data.id, eventType);
        return false;
    }

    const commandLine = truncateNotificationText(buildCommandLineDisplay(commandData) || commandData.command || 'Command approval updated', 120);
    const requester = commandData.requester || 'unknown requester';
    const riskLevel = commandData.riskLevel || commandData.risk_level || 'Risk pending';
    const title = eventType === 'approval_granted'
        ? 'Niyam approval progress'
        : 'Niyam approval recorded';

    const targetPage = eventType === 'approval_granted' ? 'pending' : 'history';
    const delivery = await sendBrowserNotification(title, {
        body: `${riskLevel}: ${commandLine} for ${requester}`,
        tag: `niyam-${eventType}-${data.id}`,
        requireInteraction: eventType !== 'approval_granted'
    }, targetPage, { suppressWarnings: true });

    if (!delivery.sent) {
        return false;
    }

    setStoredBrowserNotificationDelivery(delivery.delivery);
    rememberBrowserNotificationId(data.id, eventType);
    return true;
}

async function resolveBrowserNotificationCommandData(data = {}) {
    if (data.approvalNotificationsEnabled !== undefined || data.authenticationContext || data.requester || data.riskLevel || data.risk_level) {
        return data;
    }

    try {
        const response = await apiFetch(`/commands/${encodeURIComponent(data.id)}`);
        if (!response.ok) {
            return data;
        }
        const command = await response.json();
        return {
            ...command,
            riskLevel: command.riskLevel || command.risk_level,
            timeoutAt: command.timeoutAt || command.timeout_at
        };
    } catch (error) {
        return data;
    }
}

function shouldShowBrowserApprovalNotification(data = {}) {
    if (!areBrowserNotificationsEnabled()) {
        return false;
    }
    if (!data.id ||
        state.browserNotificationIds.has(data.id) ||
        state.browserNotificationIds.has(buildBrowserNotificationKey('pending', data.id))) {
        return false;
    }
    if (data.approvalNotificationsEnabled === false) {
        rememberBrowserNotificationId(data.id, 'pending');
        return false;
    }
    if (data.status && data.status !== 'pending') {
        return false;
    }
    if (data.autoApproved) {
        return false;
    }
    if (['policy_auto', 'auto_agent_approved'].includes(data.approvalMode)) {
        return false;
    }
    return true;
}

function buildBrowserNotificationKey(scope, commandId) {
    return `${scope}:${commandId}`;
}

function truncateNotificationText(value, maxLength) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

// ═══════════════════════════════════════════
// Notifications (in-page)
// ═══════════════════════════════════════════
function showNotification(message, type = 'info') {
    const colors = {
        info: 'var(--accent-cyan)',
        success: 'var(--accent-green)',
        error: 'var(--accent-red)',
        warning: 'var(--accent-yellow)'
    };
    
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2000;
        padding: 12px 20px; border-radius: 8px;
        background: var(--bg-secondary); border: 1px solid ${colors[type]};
        color: var(--text-primary); font-size: 13px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        animation: fadeIn 0.3s ease; max-width: 360px;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transition = 'opacity 0.3s';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════
// Submit Command Modal
// ═══════════════════════════════════════════
function initSubmitModal() {
    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-submit-command-trigger], #submit-command-btn');
        if (!trigger) {
            return;
        }
        event.preventDefault();
        openSubmitModal();
    });

    const commandInput = document.getElementById('cmd-input');
    const argsInput = document.getElementById('cmd-args');
    const workingDirInput = document.getElementById('cmd-working-dir');
    if (commandInput) {
        commandInput.addEventListener('input', schedulePolicyPreview);
    }
    if (argsInput) {
        argsInput.addEventListener('input', schedulePolicyPreview);
    }
    if (workingDirInput) {
        workingDirInput.addEventListener('input', schedulePolicyPreview);
    }
}

function openSubmitModal() {
    if (!state.principal) {
        showLoginOverlay('Sign in to submit commands.');
        return;
    }

    const submitModal = document.getElementById('submit-modal');
    if (!submitModal) {
        showNotification('Direct command form is unavailable', 'error');
        return;
    }

    const requesterInput = document.getElementById('cmd-requester');
    if (requesterInput) {
        requesterInput.value = state.principal.identifier;
    }
    submitModal.style.display = 'flex';
    document.getElementById('cmd-input')?.focus();
}

function closeModal() {
    const submitModal = document.getElementById('submit-modal');
    if (!submitModal) {
        return;
    }
    submitModal.style.display = 'none';
    document.getElementById('cmd-input').value = '';
    document.getElementById('cmd-args').value = '';
    document.getElementById('cmd-timeout').value = '';
    document.getElementById('cmd-working-dir').value = '';
    hidePolicyPreview();
}

function hidePolicyPreview() {
    if (state.previewTimer) {
        clearTimeout(state.previewTimer);
        state.previewTimer = null;
    }

    const preview = document.getElementById('risk-preview');
    if (!preview) {
        return;
    }
    preview.style.display = 'none';
    document.getElementById('risk-preview-text').textContent = '';
    document.getElementById('risk-preview-extra').textContent = '';
    document.getElementById('risk-preview-rules').textContent = '';
}

function schedulePolicyPreview() {
    if (state.previewTimer) {
        clearTimeout(state.previewTimer);
    }

    const command = document.getElementById('cmd-input').value.trim();
    if (!command) {
        hidePolicyPreview();
        return;
    }

    state.previewTimer = setTimeout(() => {
        previewPolicy();
    }, 300);
}

async function previewPolicy() {
    const command = document.getElementById('cmd-input').value.trim();
    const args = parseArgsInput(document.getElementById('cmd-args').value.trim());
    const workingDir = document.getElementById('cmd-working-dir').value.trim();
    const preview = document.getElementById('risk-preview');
    const label = document.getElementById('risk-preview-label');
    const text = document.getElementById('risk-preview-text');
    const extra = document.getElementById('risk-preview-extra');
    const rules = document.getElementById('risk-preview-rules');
    const executionBadge = document.getElementById('execution-preview-badge');

    if (!command) {
        hidePolicyPreview();
        return;
    }

    const sequence = ++state.previewSequence;
    preview.style.display = 'flex';
    label.className = 'risk-label';
    label.textContent = '...';
    executionBadge.className = 'status-badge';
    executionBadge.textContent = '...';
    text.textContent = 'Simulating policy...';
    extra.textContent = '';
    rules.textContent = '';

    try {
        const response = await apiFetch('/policy/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command,
                args,
                workingDir: workingDir || null,
                metadata: { source: 'dashboard-preview' }
            })
        });
        const result = await response.json();

        if (sequence !== state.previewSequence) {
            return;
        }

        if (!response.ok) {
            throw new Error(result.error || 'Simulation failed');
        }

        label.className = `risk-label ${String(result.riskLevel || 'MEDIUM').toLowerCase()}`;
        label.textContent = result.riskLevel || 'MEDIUM';
        executionBadge.className = `status-badge ${String(result.executionMode || 'DIRECT').toLowerCase() === 'wrapper' ? 'executing' : 'approved'}`;
        executionBadge.textContent = result.executionMode || 'DIRECT';
        text.textContent = result.reason || 'Policy evaluated';

        const approvalBits = [];
        if (!result.allowed) {
            approvalBits.push('Blocked by policy');
        } else if (result.autoApproved) {
            approvalBits.push('Auto-approved');
        } else {
            approvalBits.push(`${result.threshold?.requiredApprovals || 0} approval(s) required`);
        }
        if (result.threshold?.rationaleRequired) {
            approvalBits.push('Rationale required');
        }
        if (result.redactionPreview?.commandChanged || result.redactionPreview?.argsChanged || result.redactionPreview?.metadataChanged) {
            approvalBits.push('Sensitive values will be redacted');
        }
        extra.textContent = approvalBits.join(' · ');

        const matchedRules = Array.isArray(result.matchedRules) ? result.matchedRules.map(rule => rule.name) : [];
        if (matchedRules.length > 0) {
            rules.textContent = `Matched rules: ${matchedRules.join(', ')}`;
        } else if (result.classifier?.source) {
            rules.textContent = `Classifier: ${result.classifier.source}`;
        } else {
            rules.textContent = '';
        }
    } catch (error) {
        if (sequence !== state.previewSequence) {
            return;
        }
        label.className = 'risk-label medium';
        label.textContent = 'ERR';
        executionBadge.className = 'status-badge rejected';
        executionBadge.textContent = 'N/A';
        text.textContent = 'Policy simulation unavailable';
        extra.textContent = error.message || 'Failed to evaluate command policy';
        rules.textContent = '';
    }
}

async function submitCommand() {
    const command = document.getElementById('cmd-input').value.trim();
    const argsStr = document.getElementById('cmd-args').value.trim();
    const timeoutHours = document.getElementById('cmd-timeout').value.trim();
    const workingDir = document.getElementById('cmd-working-dir').value.trim();
    
    if (!command) {
        showNotification('Command is required', 'error');
        return;
    }
    
    const args = parseArgsInput(argsStr);
    
    const body = { command, args };
    if (timeoutHours) {
        const hours = parseFloat(timeoutHours);
        if (hours > 0 && hours <= 168) {
            body.timeoutHours = hours;
        }
    }
    if (workingDir) {
        body.workingDir = workingDir;
    }
    
    try {
        const response = await apiFetch('/commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            const riskLabel = result.riskLevel || 'MEDIUM';
            let msg = `Command submitted, awaiting approval (${riskLabel})`;
            let tone = 'info';
            if (result.approvalMode === 'auto_agent_approved') {
                msg = `Command auto-approved by Niyam Auto Approver (${riskLabel})`;
                tone = 'success';
            } else if (result.autoApproved) {
                msg = `Command auto-approved (${riskLabel})`;
                tone = 'success';
            } else if (result.approvalMode === 'auto_agent_pending') {
                msg = `Command submitted with auto-approval assist (${riskLabel})`;
            }
            showNotification(msg, tone);
            closeModal();
            refreshCurrentPageData();
        } else {
            showNotification(result.error || 'Submission failed', 'error');
        }
    } catch (e) {
        showNotification('Network error', 'error');
    }
}

// ═══════════════════════════════════════════
// Approval Modal
// ═══════════════════════════════════════════
let currentApprovalCommandId = null;

function openApprovalModal(commandId, command, riskLevel) {
    currentApprovalCommandId = commandId;
    document.getElementById('approval-modal').style.display = 'flex';
    document.getElementById('approval-command-detail').innerHTML = '<div class="text-sm text-muted">Loading command context...</div>';
    document.getElementById('approval-rationale').value = '';
    
    const requiresRationale = riskLevel === 'HIGH';
    document.getElementById('approval-modal-title').textContent =
        requiresRationale ? 'Approve Command (Rationale Required)' : 'Approve Command';
    document.getElementById('approve-btn').disabled = false;
    document.getElementById('reject-btn').disabled = false;
    loadApprovalContext(commandId, command, riskLevel);
}

function closeApprovalModal() {
    document.getElementById('approval-modal').style.display = 'none';
    currentApprovalCommandId = null;
}

async function processApproval(decision) {
    if (!currentApprovalCommandId) return;
    
    const rationale = document.getElementById('approval-rationale').value.trim();
    const endpoint = decision === 'approve' ? 'approve' : 'reject';
    
    try {
        const response = await apiFetch(`/approvals/${currentApprovalCommandId}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rationale: rationale || null
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            const message = decision === 'approve'
                ? (result.fullyApproved ? 'Command approved' : 'Approval recorded, still pending')
                : 'Command rejected';
            showNotification(message, decision === 'approve' ? 'success' : 'warning');
            closeApprovalModal();
            refreshCurrentPageData();
        } else {
            showNotification(result.error || 'Action failed', 'error');
        }
    } catch (e) {
        showNotification('Network error', 'error');
    }
}

// ═══════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════
function formatTime(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleString();
}

function timeAgo(isoString) {
    if (!isoString) return '-';
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function shouldShowCredentialLabel(actor, authenticationContext) {
    if (!authenticationContext || !authenticationContext.credentialLabel) {
        return false;
    }

    return authenticationContext.credentialLabel !== actor;
}

function isSystemAutoApprover(actor) {
    return String(actor || '').trim() === 'niyam-auto-approver';
}

function hasAutoApprovalAssist(record) {
    const approvedBy = Array.isArray(record && record.approvedBy) ? record.approvedBy : [];
    if (approvedBy.includes('niyam-auto-approver')) {
        return true;
    }

    const approvalMode = String(record && record.approvalMode || '').trim();
    return approvalMode.startsWith('auto_agent');
}

function renderApprovalAutomationMetaPill(record) {
    if (!hasAutoApprovalAssist(record)) {
        return '';
    }

    const label = String(record.status || '').toLowerCase() === 'approved'
        ? 'Auto approved'
        : 'Auto approval active';
    return `<span class="command-stream-meta-pill">${escapeHtml(label)}</span>`;
}

function describeActorWithAuth(actor, authenticationContext) {
    const label = String(actor || '').trim();
    if (!label) {
        return '';
    }

    if (shouldShowCredentialLabel(label, authenticationContext)) {
        return `${label} via ${authenticationContext.credentialLabel}`;
    }

    return label;
}

function renderAuthenticationMetaPill(actor, authenticationContext) {
    if (!shouldShowCredentialLabel(actor, authenticationContext)) {
        return '';
    }

    return `<span class="command-stream-meta-pill">Via · ${escapeHtml(authenticationContext.credentialLabel)}</span>`;
}

function parseArgsInput(argsStr) {
    return argsStr ? argsStr.split(',').map(arg => arg.trim()).filter(Boolean) : [];
}

function buildCommandLineDisplay(record) {
    if (!record) return '';
    if (typeof record === 'string') return record.trim();

    const command = String(record.command || '').trim();
    const args = Array.isArray(record.args)
        ? record.args.map(arg => String(arg || '').trim()).filter(Boolean)
        : [];

    return [command, ...args].filter(Boolean).join(' ').trim();
}

async function loadApprovalContext(commandId, fallbackCommand, fallbackRiskLevel) {
    try {
        const response = await apiFetch(`/commands/${commandId}`);
        const command = await response.json();
        if (!response.ok) {
            throw new Error(command.error || 'Failed to load command');
        }

        renderApprovalContext(command);
    } catch (error) {
        document.getElementById('approval-command-detail').innerHTML = `
            <div class="command-detail">
                <div><strong>Command:</strong> <code>${escapeHtml(fallbackCommand || '')}</code></div>
                <div><strong>Risk:</strong> ${escapeHtml(fallbackRiskLevel || 'UNKNOWN')}</div>
                <div class="text-sm text-muted" style="margin-top:8px">${escapeHtml(error.message || 'Failed to load approval context')}</div>
            </div>
        `;
    }
}

function renderApprovalContext(command) {
    const detail = document.getElementById('approval-command-detail');
    const blockReason = getApprovalBlockReason(command);
    const approvedBy = Array.isArray(command.approvedBy) ? command.approvedBy : [];
    detail.innerHTML = `
        <div class="command-detail">
            <div style="margin-bottom:10px"><strong>Command:</strong> <code>${escapeHtml(buildCommandLineDisplay(command))}</code></div>
            <div style="margin-bottom:8px"><strong>Requester:</strong> ${escapeHtml(describeActorWithAuth(command.requester, command.authenticationContext))}</div>
            <div style="margin-bottom:8px"><strong>Risk:</strong> <span class="risk-badge ${String(command.risk_level || 'medium').toLowerCase()}">${escapeHtml(command.risk_level || 'MEDIUM')}</span></div>
            <div style="margin-bottom:8px"><strong>Progress:</strong> ${escapeHtml(formatApprovalProgress(command))}</div>
            <div style="margin-bottom:8px"><strong>Approved by:</strong> ${approvedBy.length > 0 ? escapeHtml(approvedBy.join(', ')) : 'No approvals yet'}</div>
            ${command.rejectedBy ? `<div style="margin-bottom:8px"><strong>Rejected by:</strong> ${escapeHtml(command.rejectedBy)}</div>` : ''}
            ${command.timeout_at ? `<div style="margin-bottom:8px"><strong>Approval window:</strong> ${escapeHtml(formatTimeout(command.timeout_at))}</div>` : ''}
            ${hasAutoApprovalAssist(command) ? '<div class="text-sm text-muted" style="margin-top:10px">Auto approval assist is active for this command.</div>' : ''}
            ${command.approvalProgress && !command.approvalProgress.twoPersonSatisfied ? `<div class="text-sm text-muted" style="margin-top:10px">${escapeHtml(formatHighRiskPendingMessage(command))}</div>` : ''}
            ${blockReason ? `<div class="text-sm text-muted" style="margin-top:10px;color:var(--accent-red)">${escapeHtml(blockReason)}</div>` : ''}
        </div>
    `;

    document.getElementById('approve-btn').disabled = Boolean(blockReason);
    document.getElementById('reject-btn').disabled = Boolean(blockReason);
}

function updateNavigationForPrincipal() {
    document.querySelectorAll('.nav-link').forEach(link => {
        const adminOnly = link.dataset.adminOnly === 'true';
        const authOnly = link.dataset.authOnly === 'true';
        link.style.display = (!authOnly || state.principal) && (!adminOnly || isAdminPrincipal(state.principal)) ? '' : 'none';
    });
    updateModeLabels();
}

function getAllowedPages(principal) {
    if (!principal) {
        return ['dashboard'];
    }

    return isAdminPrincipal(principal) ? [...ALL_PAGES] : [...DEFAULT_USER_PAGES];
}

function isAdminPrincipal(principal) {
    return Boolean(principal && Array.isArray(principal.roles) && principal.roles.includes('admin'));
}

function describePrincipal(principal) {
    if (!principal) {
        return 'Not signed in';
    }

    const label = principal.displayName || principal.identifier;
    const roles = Array.isArray(principal.roles) ? principal.roles : [];
    const context = roles.includes('admin')
        ? 'admin'
        : (roles.includes('approver') ? 'approver' : principal.type);
    const viaLabel = state.authentication && shouldShowCredentialLabel(principal.identifier, state.authentication)
        ? ` via ${state.authentication.credentialLabel}`
        : '';
    return `${label}${viaLabel} · ${context}`;
}

function updateModeLabels() {
    const usersNavText = document.querySelector('.nav-link[data-page="users"] .nav-text');
    if (usersNavText) {
        usersNavText.textContent = state.authConfig.productMode === 'individual' ? 'Tokens' : 'Users';
    }

    if (state.currentPage === 'users') {
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
            pageTitle.textContent = state.authConfig.productMode === 'individual' ? 'Tokens' : 'Users';
        }
    }
}

function getApprovalBlockReason(command) {
    if (!state.principal) {
        return 'Sign in to review this command.';
    }

    if (command.status && command.status !== 'pending') {
        return `Command is ${command.status}, not pending.`;
    }

    if (command.requester === state.principal.identifier) {
        return 'Requester cannot approve their own command.';
    }

    const capabilities = state.principal.approvalCapabilities || {};
    if (command.risk_level === 'HIGH' && !capabilities.canApproveHigh) {
        return 'You are not authorized for HIGH risk.';
    }

    if (command.risk_level === 'MEDIUM' && !(capabilities.canApproveMedium || capabilities.canApproveHigh)) {
        return 'You are not authorized for MEDIUM risk.';
    }

    if (Array.isArray(command.approvedBy) && command.approvedBy.includes(state.principal.identifier)) {
        return 'You have already approved this command.';
    }

    if (command.rejectedBy === state.principal.identifier) {
        return 'You have already reviewed this command.';
    }

    return '';
}

function formatApprovalProgress(command) {
    const progress = command.approvalProgress || {
        count: Number(command.approval_count || 0),
        required: Number(command.required_approvals || 0),
        remaining: Math.max(0, Number(command.required_approvals || 0) - Number(command.approval_count || 0)),
        twoPersonSatisfied: command.risk_level !== 'HIGH'
    };
    const base = `${progress.count}/${progress.required} approvals`;
    if (command.risk_level === 'HIGH' && !progress.twoPersonSatisfied) {
        return `${base} · ${formatHighRiskPendingMessage(command)}`;
    }
    return progress.remaining > 0 ? `${base} · ${progress.remaining} remaining` : `${base} · ready`;
}

function formatHighRiskPendingMessage(command) {
    if (hasAutoApprovalAssist(command)) {
        return 'waiting for one human approver';
    }
    return 'waiting for distinct approver';
}
