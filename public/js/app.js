/**
 * Niyam Dashboard - Main Application Logic
 */

// State
const state = {
    currentPage: 'dashboard',
    ws: null,
    principal: null,
    initialized: false,
    wsReconnectTimer: null,
    pendingCount: 0,
    currentPageRenderer: null,
    refreshInterval: null,
    timerInterval: null,
    autoRefreshEnabled: localStorage.getItem('niyam.autoRefresh') !== 'off',
    previewTimer: null,
    previewSequence: 0
};

// API Base URL
const API_BASE = '/api';

// Auto-refresh interval (ms)
const AUTO_REFRESH_MS = 10000;

const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24"><path d="M4 19h16M7 15v-4M12 15V7M17 15v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    pending: '<svg viewBox="0 0 24 24"><path d="M8 4h8M8 20h8M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M8 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a3 3 0 1 1 0-6h10M8 5a3 3 0 1 0 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dispatches: '<svg viewBox="0 0 24 24"><path d="M5 12h4l2-4 3 8 2-4h3M6 6h12M6 18h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rules: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v14H5V6h3l1-2Zm0 6h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    audit: '<svg viewBox="0 0 24 24"><path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    activity: '<svg viewBox="0 0 24 24"><path d="M5 12h4l2-4 3 8 2-4h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg viewBox="0 0 24 24"><path d="m5 12 4.2 4L19 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    blocked: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    package: '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5-8-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

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
    initAuthUi();
    updateAutoRefreshButton();

    const restored = await restoreSession();
    if (!restored) {
        enterUnauthenticatedState('Dashboard access requires a local admin session.');
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
    document.getElementById('logout-btn').addEventListener('click', logout);
}

async function restoreSession() {
    try {
        const response = await fetch(`${API_BASE}/auth/me`);
        if (!response.ok) {
            return false;
        }

        const result = await response.json();
        enterAuthenticatedState(result.principal);
        return true;
    } catch (error) {
        return false;
    }
}

function enterAuthenticatedState(principal) {
    state.principal = principal;
    hideLoginOverlay();
    updateSessionUi();

    if (!state.initialized) {
        initNavigation();
        initSubmitModal();
        state.initialized = true;

        const pageFromHash = (window.location.hash || '').replace('#', '');
        const savedPage = localStorage.getItem('niyam.currentPage');
        const initialPage = ['dashboard', 'pending', 'history', 'dispatches', 'rules', 'audit'].includes(pageFromHash)
            ? pageFromHash
            : (['dashboard', 'pending', 'history', 'dispatches', 'rules', 'audit'].includes(savedPage) ? savedPage : 'dashboard');

        window.addEventListener('hashchange', () => {
            const page = (window.location.hash || '').replace('#', '');
            if (state.principal && ['dashboard', 'pending', 'history', 'dispatches', 'rules', 'audit'].includes(page) && page !== state.currentPage) {
                navigateTo(page);
            }
        });

        navigateTo(initialPage);
    } else {
        navigateTo(state.currentPage || 'dashboard');
    }

    document.getElementById('cmd-requester').value = principal.identifier;

    if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
        initWebSocket();
    }
}

function enterUnauthenticatedState(message) {
    state.principal = null;
    updateSessionUi();
    closeApprovalModal();
    closeModal();
    stopRealtime();
    showLoginOverlay(message);
}

function updateSessionUi() {
    const pill = document.getElementById('session-pill');
    const logoutBtn = document.getElementById('logout-btn');
    const submitBtn = document.getElementById('submit-command-btn');

    if (!state.principal) {
        pill.textContent = 'Not signed in';
        logoutBtn.style.display = 'none';
        submitBtn.disabled = true;
        return;
    }

    pill.textContent = `${state.principal.identifier} · ${state.principal.type}`;
    logoutBtn.style.display = 'inline-flex';
    submitBtn.disabled = false;
}

function showLoginOverlay(message) {
    document.getElementById('login-overlay').style.display = 'flex';
    setLoginStatus(message || 'Dashboard access requires a local admin session.');
    document.getElementById('login-password').focus();
}

function hideLoginOverlay() {
    document.getElementById('login-overlay').style.display = 'none';
    setLoginStatus('Dashboard access requires a local admin session.');
    document.getElementById('login-password').value = '';
}

function setLoginStatus(message) {
    document.getElementById('login-status').textContent = message;
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

        enterAuthenticatedState(result.principal);
        showNotification('Signed in', 'success');
    } catch (error) {
        setLoginStatus('Network error while signing in.');
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

async function apiFetch(path, options = {}) {
    const url = path.startsWith('/api') ? path : `${API_BASE}${path}`;
    const response = await fetch(url, options);

    if (response.status === 401) {
        enterUnauthenticatedState('Session expired. Sign in again.');
        throw new Error('Authentication required');
    }

    return response;
}

function navigateTo(page) {
    if (!['dashboard', 'pending', 'history', 'dispatches', 'rules', 'audit'].includes(page)) {
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
        pending: 'Pending Approvals',
        history: 'Command History',
        dispatches: 'Shell Dispatches',
        rules: 'Policy Rules',
        audit: 'Audit Log'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    
    // Render page
    const container = document.getElementById('page-container');
    container.innerHTML = '';
    
    switch (page) {
        case 'dashboard': renderDashboard(container); break;
        case 'pending': renderPending(container); break;
        case 'history': renderHistory(container); break;
        case 'dispatches': renderDispatches(container); break;
        case 'rules': renderRules(container); break;
        case 'audit': renderAudit(container); break;
    }
    
    // Start auto-refresh
    startAutoRefresh();
}

// ═══════════════════════════════════════════
// Auto-Refresh
// ═══════════════════════════════════════════
function startAutoRefresh() {
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    if (state.timerInterval) clearInterval(state.timerInterval);

    if (!state.autoRefreshEnabled) {
        return;
    }

    state.refreshInterval = setInterval(() => {
        silentlyRefreshCurrentPage();
    }, AUTO_REFRESH_MS);
    startTimerUpdates();
}

function stopRealtime() {
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    state.refreshInterval = null;
    state.timerInterval = null;
    state.wsReconnectTimer = null;
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
}

function toggleAutoRefresh() {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    localStorage.setItem('niyam.autoRefresh', state.autoRefreshEnabled ? 'on' : 'off');
    updateAutoRefreshButton();

    if (state.autoRefreshEnabled) {
        startAutoRefresh();
        showNotification('Auto-refresh enabled', 'success');
    } else {
        if (state.refreshInterval) clearInterval(state.refreshInterval);
        if (state.timerInterval) clearInterval(state.timerInterval);
        state.refreshInterval = null;
        state.timerInterval = null;
        showNotification('Auto-refresh paused', 'warning');
    }
}

function updateAutoRefreshButton() {
    const btn = document.getElementById('auto-refresh-toggle');
    if (!btn) return;
    btn.innerHTML = `${renderUiIcon('activity', 'btn-icon')}Auto: ${state.autoRefreshEnabled ? 'ON' : 'OFF'}`;
}

function silentlyRefreshCurrentPage() {
    const container = document.getElementById('page-container');
    if (!container || !state.currentPage) return;
    
    // Don't refresh if modal is open
    const submitModal = document.getElementById('submit-modal');
    const approvalModal = document.getElementById('approval-modal');
    if ((submitModal && submitModal.style.display === 'flex') ||
        (approvalModal && approvalModal.style.display === 'flex')) {
        return;
    }
    
    switch (state.currentPage) {
        case 'dashboard': renderDashboard(container); break;
        case 'pending': renderPending(container); break;
        case 'history': renderHistory(container); break;
        case 'dispatches': renderDispatches(container); break;
        case 'rules': renderRules(container); break;
        case 'audit': renderAudit(container); break;
    }
    updatePendingBadge();
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
    const { type, data } = msg;
    const commandLine = buildCommandLineDisplay(data);
    
    switch (type) {
        case 'command_submitted':
            updatePendingBadge();
            showNotification(`New command: ${commandLine || data.command}`, 'info');
            break;
        case 'command_approved':
            updatePendingBadge();
            showNotification(`Command approved: ${commandLine || data.command}`, 'success');
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
            showNotification(`Approval granted (${data.approvals}/${data.required})`, 'info');
            break;
    }
    
    // Refresh current page
    if (state.currentPage) {
        navigateTo(state.currentPage);
    }
}

function updatePendingBadge() {
    if (!state.principal) {
        return;
    }

    apiFetch('/commands?status=pending&limit=0')
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
        })
        .catch(() => {});
}

// ═══════════════════════════════════════════
// Notifications (in-page, not browser API)
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
    document.getElementById('submit-command-btn').addEventListener('click', () => {
        if (!state.principal) {
            showLoginOverlay('Sign in to submit commands.');
            return;
        }
        document.getElementById('cmd-requester').value = state.principal.identifier;
        document.getElementById('submit-modal').style.display = 'flex';
    });

    document.getElementById('cmd-input').addEventListener('input', schedulePolicyPreview);
    document.getElementById('cmd-args').addEventListener('input', schedulePolicyPreview);
    document.getElementById('cmd-working-dir').addEventListener('input', schedulePolicyPreview);
}

function closeModal() {
    document.getElementById('submit-modal').style.display = 'none';
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

    document.getElementById('risk-preview').style.display = 'none';
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
            const msg = result.autoApproved
                ? `Command auto-approved (${riskLabel})`
                : `Command submitted, awaiting approval (${riskLabel})`;
            showNotification(msg, result.autoApproved ? 'success' : 'info');
            closeModal();
            navigateTo(state.currentPage);
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
    document.getElementById('approval-command-detail').textContent = command;
    document.getElementById('approval-rationale').value = '';
    
    const requiresRationale = riskLevel === 'HIGH';
    document.getElementById('approval-modal-title').textContent =
        requiresRationale ? 'Approve Command (Rationale Required)' : 'Approve Command';
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
            showNotification(
                decision === 'approve' ? 'Command approved' : 'Command rejected',
                decision === 'approve' ? 'success' : 'warning'
            );
            closeApprovalModal();
            navigateTo(state.currentPage);
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
