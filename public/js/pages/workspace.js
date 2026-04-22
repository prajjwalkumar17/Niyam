/**
 * Workspace Page - Runtime, access, and CLI setup guidance
 */

function renderWorkspace(container) {
    container.innerHTML = `
        <section class="dashboard-hero fade-in">
            <div class="dashboard-hero-copy">
                <div class="workspace-kicker">Workspace</div>
                <h2 class="dashboard-hero-title">Runtime context, access posture, and shell setup in one place.</h2>
                <p class="workspace-subtitle">Use this page for the current dashboard identity, the live server shape, and the CLI wrapper commands that match the active Niyam instance.</p>
            </div>
            <div class="dashboard-hero-rail">
                <div class="dashboard-hero-note">Admin sessions see instance details. Other users still get their own access context and wrapper commands.</div>
                <div class="workspace-controls" id="workspace-chip-rail"></div>
            </div>
        </section>
        <section class="surface-grid-2 fade-in">
            <div class="surface-card" id="workspace-runtime-card"></div>
            <div class="surface-card" id="workspace-access-card"></div>
        </section>
        <section class="surface-grid-2 fade-in" style="margin-top:24px">
            <div class="surface-card" id="workspace-cli-card"></div>
            <div class="surface-card" id="workspace-ops-card"></div>
        </section>
    `;

    loadWorkspaceDetails();
}

async function loadWorkspaceDetails() {
    try {
        const response = await apiFetch('/workspace');
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to load workspace details');
        }

        renderWorkspaceDetails(payload);
    } catch (error) {
        document.getElementById('workspace-runtime-card').innerHTML = renderEmptyState('Failed to load runtime details', 'blocked');
        document.getElementById('workspace-access-card').innerHTML = renderEmptyState(error.message || 'Authentication required', 'blocked');
        document.getElementById('workspace-cli-card').innerHTML = renderEmptyState('CLI guidance unavailable', 'blocked');
        document.getElementById('workspace-ops-card').innerHTML = renderEmptyState('Operational details unavailable', 'blocked');
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
    const instance = payload.instance;
    const commands = payload.commands || {};
    const bootstrapAccess = payload.bootstrapAccess || {};

    chipRail.innerHTML = [
        renderWorkspaceChip(`Profile: ${runtime.profile || 'unknown'}`),
        renderWorkspaceChip(`Execution: ${runtime.executionMode || 'unknown'}`),
        renderWorkspaceChip(`Team mode: ${runtime.teamMode ? 'enabled' : 'disabled'}`),
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
            ['Password management', access.passwordMessage || 'Unavailable'],
            ...(bootstrapAccess.canRevealPasswordSource ? [
                ['Bootstrap admin username', bootstrapAccess.username || 'admin'],
                ['Bootstrap password source', bootstrapAccess.passwordSource || 'Not provided at runtime']
            ] : [])
        ])}
    `;

    cliCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">CLI Wrapper</div>
                <div class="surface-section-copy">Install, remove, and toggle shell interception for this Niyam repo.</div>
            </div>
        </div>
        ${renderWorkspaceCommandBlock('Install for zsh', commands.cliInstall?.zsh || [])}
        ${renderWorkspaceCommandBlock('Install for bash', commands.cliInstall?.bash || [])}
        ${renderWorkspaceCommandBlock('Fully uninstall for zsh', commands.cliRemove?.zsh || [])}
        ${renderWorkspaceCommandBlock('Fully uninstall for bash', commands.cliRemove?.bash || [])}
    `;

    const opsBlocks = [];
    if (commands.startLater) {
        opsBlocks.push(renderWorkspaceCommandBlock('Start later', [commands.startLater]));
    }
    opsBlocks.push(renderWorkspaceRows([
        ['Current shell off', commands.cliCurrentShellOff || 'niyam-off'],
        ['Current shell on', commands.cliCurrentShellOn || 'niyam-on']
    ]));
    opsBlocks.push(`
        <div class="workspace-note">
            ${runtime.teamMode
                ? 'Team mode is enabled. New users can request access, and admins approve them from the Users page.'
                : 'Team mode is disabled. Accounts are created and managed directly by admins from the Users page.'}
        </div>
    `);

    opsCard.innerHTML = `
        <div class="surface-section-head">
            <div>
                <div class="card-title">Operations</div>
                <div class="surface-section-copy">Lifecycle commands and the current workspace operating mode.</div>
            </div>
        </div>
        ${opsBlocks.join('')}
    `;
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

    return `
        <div class="workspace-command-block">
            <div class="workspace-command-title">${escapeHtml(title)}</div>
            <pre class="workspace-command-pre"><code>${escapeHtml(commands.join('\n'))}</code></pre>
        </div>
    `;
}

function renderWorkspaceChip(label) {
    return `<span class="workspace-chip">${escapeHtml(label)}</span>`;
}
