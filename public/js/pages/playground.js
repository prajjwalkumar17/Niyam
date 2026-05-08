/**
 * Playground Page - Guided command lifecycle lab
 */

const playgroundState = {
    scenario: 'dashboard_medium',
    approvalMode: 'off',
    simulationCommand: 'gh pr create --title custom-demo',
    simulationSourceMode: 'dashboard',
    simulationApprovalMode: 'off',
    simulationWorkingDir: '',
    simulationResult: null,
    simulatorCollapsed: true,
    recentRuns: [],
    activeRun: null,
    loading: false
};

const PLAYGROUND_SCENARIOS = {
    dashboard_medium: {
        title: 'Dashboard Request',
        eyebrow: 'Governed command',
        command: 'gh pr create --title playground-demo',
        description: 'Creates a medium-risk dashboard request so the approval queue is easy to inspect.',
        source: 'Dashboard',
        expected: 'Pending when Off, auto-approved when Normal or All.'
    },
    dashboard_high: {
        title: 'High Risk Approval',
        eyebrow: 'Auto-approval modes',
        command: 'gh pr merge 42',
        description: 'Shows the difference between high-risk review, auto-assist, and approve-everything mode.',
        source: 'Dashboard',
        expected: 'High-risk commands need stronger approval unless All is selected.'
    },
    wrapper_remote: {
        title: 'Wrapper Remote Exec',
        eyebrow: 'Shell wrapper',
        command: 'git status',
        description: 'Represents a wrapped shell line that can become a governed remote command.',
        source: 'Wrapper',
        expected: 'Creates a dispatch, links a command, and stays safe in lifecycle mode.'
    },
    wrapper_local: {
        title: 'Wrapper Local Passthrough',
        eyebrow: 'Shell wrapper',
        command: 'cd public',
        description: 'Shows why builtins and shell-local operations stay in the active shell.',
        source: 'Wrapper',
        expected: 'Creates a local passthrough dispatch and marks it completed.'
    },
    wrapper_blocked: {
        title: 'Wrapper Blocked',
        eyebrow: 'Policy block',
        command: 'playground-blocked --demo',
        description: 'Uses a deterministic playground policy rule to show a blocked shell line.',
        source: 'Wrapper',
        expected: 'Creates a blocked dispatch without creating a governed command.'
    }
};

function renderPlayground(container) {
    container.innerHTML = `
        <section class="playground-shell fade-in">
            <div class="playground-stage">
                <div class="playground-stage-copy">
                    <div class="workspace-kicker">Command Playground</div>
                    <h2 class="playground-title">Run safe lifecycle demos across dashboard, wrapper, and auto-approval paths.</h2>
                    <p class="workspace-subtitle">Curated runs create real Niyam records and realtime events, while safe mode keeps arbitrary command execution off.</p>
                </div>
                <div class="playground-safety">
                    <span class="status-dot connected"></span>
                    Safe lifecycle
                </div>
            </div>

            <section class="surface-card playground-simulator ${playgroundState.simulatorCollapsed ? 'is-collapsed' : ''}" data-testid="custom-command-simulator" id="playground-custom-command-panel">
                <div class="playground-simulator-head">
                    <div class="playground-simulator-copy">
                        <div class="card-title">Custom Command</div>
                        <div class="surface-section-copy">Preview policy, route, approval, and outcome without storing or executing anything.</div>
                    </div>
                    <div class="playground-simulator-summary">
                        <span class="status-badge approved">Dashboard</span>
                        <span class="status-badge pending">Wrapper</span>
                        <span class="status-badge timeout">Simulation only</span>
                    </div>
                    <button
                        class="btn btn-secondary playground-simulator-toggle"
                        type="button"
                        id="playground-simulator-toggle"
                        aria-controls="playground-simulator-details"
                        aria-expanded="${playgroundState.simulatorCollapsed ? 'false' : 'true'}"
                    >
                        ${playgroundState.simulatorCollapsed ? 'Simulate Commands' : 'Hide Simulator'}
                    </button>
                </div>
                <div class="playground-simulator-details" id="playground-simulator-details" aria-hidden="${playgroundState.simulatorCollapsed ? 'true' : 'false'}">
                    <div class="playground-simulator-intro">
                        <div class="workspace-kicker">Custom Command Simulator</div>
                        <h3>Try any command and see what Niyam would do.</h3>
                        <p>Simulation only. No command is stored or executed.</p>
                    </div>
                    <div class="playground-simulator-form">
                        <label class="playground-command-label" for="playground-sim-command">Command line</label>
                        <input class="form-input" id="playground-sim-command" data-testid="playground-sim-command" type="text" value="${escapeHtml(playgroundState.simulationCommand)}" placeholder="e.g. gh pr merge 42">
                        <div class="playground-simulator-grid">
                            <div>
                                <div class="playground-control-label">Source mode</div>
                                <div class="playground-mode-switch playground-sim-switch" id="playground-sim-source-switch" data-cols="2">
                                    ${renderPlaygroundSimulationButton('source', 'dashboard', 'Dashboard', playgroundState.simulationSourceMode)}
                                    ${renderPlaygroundSimulationButton('source', 'wrapper', 'Wrapper', playgroundState.simulationSourceMode)}
                                </div>
                            </div>
                            <div>
                                <div class="playground-control-label">Auto approval</div>
                                <div class="playground-mode-switch playground-sim-switch" id="playground-sim-approval-switch">
                                    ${renderPlaygroundSimulationButton('approval', 'off', 'Off', playgroundState.simulationApprovalMode)}
                                    ${renderPlaygroundSimulationButton('approval', 'normal', 'Normal', playgroundState.simulationApprovalMode)}
                                    ${renderPlaygroundSimulationButton('approval', 'all', 'All', playgroundState.simulationApprovalMode)}
                                </div>
                            </div>
                        </div>
                        <label class="playground-command-label" for="playground-sim-working-dir">Working directory</label>
                        <input class="form-input" id="playground-sim-working-dir" data-testid="playground-sim-working-dir" type="text" value="${escapeHtml(playgroundState.simulationWorkingDir)}" placeholder="Optional absolute path">
                        <button class="btn btn-primary playground-simulate-btn" id="playground-simulate-btn" data-testid="playground-simulate-command">Simulate Command</button>
                    </div>
                    <div class="playground-simulation-result" id="playground-simulation-result" data-testid="playground-simulation-result">
                        ${playgroundState.simulationResult
                            ? renderPlaygroundSimulationResultMarkup(playgroundState.simulationResult)
                            : renderEmptyState('Run a custom simulation to see policy, route, approval, and outcome.', 'activity')}
                    </div>
                </div>
            </section>

            <div class="playground-workspace">
                <aside class="playground-scenarios" id="playground-scenarios"></aside>

                <section class="playground-console">
                    <div class="playground-console-head">
                        <div>
                            <div class="card-title" id="playground-selected-title"></div>
                            <div class="surface-section-copy" id="playground-selected-copy"></div>
                        </div>
                        <span class="status-badge approved" id="playground-selected-source"></span>
                    </div>

                    <label class="playground-command-label" for="playground-custom-command">Command line</label>
                    <div class="playground-command-line">
                        <code id="playground-command-preview"></code>
                    </div>

                    <div class="playground-control-row">
                        <div>
                            <div class="playground-control-label">Auto approval</div>
                            <div class="playground-mode-switch" id="playground-mode-switch">
                                ${renderPlaygroundModeButton('off', 'Off')}
                                ${renderPlaygroundModeButton('normal', 'Normal')}
                                ${renderPlaygroundModeButton('all', 'All')}
                            </div>
                        </div>
                        <button class="btn btn-primary playground-run-btn" id="playground-run-btn" data-testid="playground-run">
                            Run Scenario
                        </button>
                    </div>

                    <div class="playground-preview" id="playground-policy-preview">
                        ${renderEmptyState('Select a scenario to inspect the route before running.', 'activity')}
                    </div>
                </section>

                <section class="playground-inspector">
                    <div class="surface-section-head">
                        <div>
                            <div class="card-title">Run Timeline</div>
                            <div class="surface-section-copy">Policy, route, approval, and outcome for the selected run.</div>
                        </div>
                    </div>
                    <div id="playground-active-run">
                        ${renderEmptyState('No playground run selected yet', 'activity')}
                    </div>
                </section>
            </div>
        </section>

        <section class="surface-section playground-recent-section fade-in">
            <div class="surface-section-head">
                <div>
                    <div class="card-title">Recent Playground Runs</div>
                    <div class="surface-section-copy">Use these runs to jump into Pending, Activity, or the linked shell dispatch.</div>
                </div>
                <button class="btn btn-secondary btn-sm" id="playground-refresh-btn">Refresh</button>
            </div>
            <div class="command-stream playground-recent-stream" id="playground-recent-runs">
                ${renderEmptyState('Loading playground runs...', 'activity')}
            </div>
        </section>
    `;

    document.getElementById('playground-run-btn').addEventListener('click', runPlaygroundScenario);
    document.getElementById('playground-refresh-btn').addEventListener('click', refreshPlaygroundData);
    document.getElementById('playground-simulator-toggle').addEventListener('click', togglePlaygroundSimulator);
    document.getElementById('playground-simulate-btn').addEventListener('click', simulateCustomPlaygroundCommand);
    document.getElementById('playground-sim-command').addEventListener('input', event => {
        playgroundState.simulationCommand = event.target.value;
    });
    document.getElementById('playground-sim-working-dir').addEventListener('input', event => {
        playgroundState.simulationWorkingDir = event.target.value;
    });
    document.querySelectorAll('[data-sim-source]').forEach(button => {
        button.addEventListener('click', () => {
            playgroundState.simulationSourceMode = button.dataset.simSource;
            updatePlaygroundSimulationToggles();
        });
    });
    document.querySelectorAll('[data-sim-approval]').forEach(button => {
        button.addEventListener('click', () => {
            playgroundState.simulationApprovalMode = button.dataset.simApproval;
            updatePlaygroundSimulationToggles();
        });
    });

    renderPlaygroundScenarios();
    renderPlaygroundSelection();
    refreshPlaygroundData();
    previewPlaygroundPolicy();
}

function renderPlaygroundModeButton(mode, label) {
    return `<button class="playground-mode-btn ${playgroundState.approvalMode === mode ? 'active' : ''}" type="button" data-mode="${mode}">${label}</button>`;
}

function renderPlaygroundSimulationButton(kind, value, label, selectedValue) {
    const attribute = kind === 'source' ? 'data-sim-source' : 'data-sim-approval';
    return `<button class="playground-mode-btn ${selectedValue === value ? 'active' : ''}" type="button" ${attribute}="${value}">${label}</button>`;
}

function updatePlaygroundSimulationToggles() {
    document.querySelectorAll('[data-sim-source]').forEach(button => {
        button.classList.toggle('active', button.dataset.simSource === playgroundState.simulationSourceMode);
    });
    document.querySelectorAll('[data-sim-approval]').forEach(button => {
        button.classList.toggle('active', button.dataset.simApproval === playgroundState.simulationApprovalMode);
    });
}

function togglePlaygroundSimulator() {
    playgroundState.simulatorCollapsed = !playgroundState.simulatorCollapsed;
    syncPlaygroundSimulatorState();
}

function syncPlaygroundSimulatorState() {
    const simulator = document.getElementById('playground-custom-command-panel');
    const toggle = document.getElementById('playground-simulator-toggle');
    const details = document.getElementById('playground-simulator-details');
    if (!simulator || !toggle || !details) {
        return;
    }

    simulator.classList.toggle('is-collapsed', playgroundState.simulatorCollapsed);
    toggle.textContent = playgroundState.simulatorCollapsed ? 'Simulate Commands' : 'Hide Simulator';
    toggle.setAttribute('aria-expanded', playgroundState.simulatorCollapsed ? 'false' : 'true');
    details.setAttribute('aria-hidden', playgroundState.simulatorCollapsed ? 'true' : 'false');
}

function renderPlaygroundScenarios() {
    const list = document.getElementById('playground-scenarios');
    list.innerHTML = Object.entries(PLAYGROUND_SCENARIOS).map(([id, scenario]) => `
        <button class="playground-scenario ${playgroundState.scenario === id ? 'active' : ''}" type="button" data-scenario="${id}">
            <span>${escapeHtml(scenario.eyebrow)}</span>
            <strong>${escapeHtml(scenario.title)}</strong>
            <code>${escapeHtml(scenario.command)}</code>
        </button>
    `).join('');

    list.querySelectorAll('.playground-scenario').forEach(button => {
        button.addEventListener('click', () => {
            playgroundState.scenario = button.dataset.scenario;
            renderPlaygroundScenarios();
            renderPlaygroundSelection();
            previewPlaygroundPolicy();
        });
    });

    document.querySelectorAll('.playground-mode-btn').forEach(button => {
        button.addEventListener('click', () => {
            playgroundState.approvalMode = button.dataset.mode;
            document.querySelectorAll('.playground-mode-btn').forEach(modeButton => {
                modeButton.classList.toggle('active', modeButton.dataset.mode === playgroundState.approvalMode);
            });
            previewPlaygroundPolicy();
        });
    });
}

function renderPlaygroundSelection() {
    const scenario = PLAYGROUND_SCENARIOS[playgroundState.scenario];
    const command = getPlaygroundCommandLine();
    document.getElementById('playground-selected-title').textContent = scenario.title;
    document.getElementById('playground-selected-copy').textContent = scenario.description;
    document.getElementById('playground-selected-source').textContent = scenario.source;
    document.getElementById('playground-command-preview').textContent = command;
}

async function previewPlaygroundPolicy() {
    const preview = document.getElementById('playground-policy-preview');
    const scenario = PLAYGROUND_SCENARIOS[playgroundState.scenario];
    const commandLine = getPlaygroundCommandLine();
    const parsed = parsePlaygroundCommandLine(commandLine);

    preview.innerHTML = `
        <div class="playground-preview-row">
            <span class="status-badge">...</span>
            <span>Evaluating policy...</span>
        </div>
    `;

    if (playgroundState.scenario === 'wrapper_local') {
        preview.innerHTML = renderPlaygroundStaticPreview('LOCAL_PASSTHROUGH', 'LOW', scenario.expected);
        return;
    }
    if (playgroundState.scenario === 'wrapper_blocked') {
        preview.innerHTML = renderPlaygroundStaticPreview('BLOCKED', 'MEDIUM', scenario.expected);
        return;
    }

    try {
        const response = await apiFetch('/policy/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command: parsed.command,
                args: parsed.args,
                metadata: { source: 'playground-preview' }
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Policy simulation failed');
        }

        const matchedRules = Array.isArray(result.matchedRules) && result.matchedRules.length > 0
            ? result.matchedRules.map(rule => rule.name).join(', ')
            : (result.classifier?.source || 'built-in classifier');
        preview.innerHTML = `
            <div class="playground-preview-row">
                <span class="risk-label ${String(result.riskLevel || 'MEDIUM').toLowerCase()}">${escapeHtml(result.riskLevel || 'MEDIUM')}</span>
                <span class="status-badge ${String(result.executionMode || '').toLowerCase() === 'wrapper' ? 'executing' : 'approved'}">${escapeHtml(result.executionMode || 'DIRECT')}</span>
                <span>${escapeHtml(result.reason || scenario.expected)}</span>
            </div>
            <div class="text-sm text-muted">Rules: ${escapeHtml(matchedRules)}</div>
        `;
    } catch (error) {
        preview.innerHTML = renderPlaygroundStaticPreview('Preview unavailable', 'MEDIUM', error.message || scenario.expected);
    }
}

function renderPlaygroundStaticPreview(route, risk, copy) {
    return `
        <div class="playground-preview-row">
            <span class="risk-label ${String(risk).toLowerCase()}">${escapeHtml(risk)}</span>
            <span class="status-badge ${String(route).toLowerCase().includes('blocked') ? 'rejected' : 'approved'}">${escapeHtml(route)}</span>
            <span>${escapeHtml(copy)}</span>
        </div>
    `;
}

async function runPlaygroundScenario() {
    const button = document.getElementById('playground-run-btn');
    button.disabled = true;
    button.textContent = 'Running...';

    try {
        const response = await apiFetch('/playground/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scenario: playgroundState.scenario,
                approvalMode: playgroundState.approvalMode,
                safeLifecycle: true
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Playground run failed');
        }

        playgroundState.activeRun = result.run;
        showNotification('Playground run created', 'success');
        renderPlaygroundActiveRun();
        await refreshPlaygroundData();
        updatePendingBadge();
    } catch (error) {
        showNotification(error.message || 'Playground run failed', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Run Scenario';
    }
}

async function simulateCustomPlaygroundCommand() {
    const button = document.getElementById('playground-simulate-btn');
    const command = playgroundState.simulationCommand.trim();
    const resultTarget = document.getElementById('playground-simulation-result');
    if (!command) {
        showNotification('Command is required for simulation', 'error');
        return;
    }

    button.disabled = true;
    button.textContent = 'Simulating...';
    resultTarget.innerHTML = renderEmptyState('Simulating command...', 'activity');

    try {
        const response = await apiFetch('/playground/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rawCommand: command,
                sourceMode: playgroundState.simulationSourceMode,
                approvalMode: playgroundState.simulationApprovalMode,
                workingDir: playgroundState.simulationWorkingDir.trim() || undefined
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Simulation failed');
        }

        playgroundState.simulationResult = result;
        renderPlaygroundSimulationResult(result);
        showNotification('Simulation ready', 'success');
    } catch (error) {
        resultTarget.innerHTML = renderEmptyState(error.message || 'Simulation failed', 'blocked');
        showNotification(error.message || 'Simulation failed', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Simulate Command';
    }
}

function renderPlaygroundSimulationResult(result) {
    const target = document.getElementById('playground-simulation-result');
    if (!target) {
        return;
    }
    target.innerHTML = renderPlaygroundSimulationResultMarkup(result);
}

function renderPlaygroundSimulationResultMarkup(result) {
    const matchedRules = Array.isArray(result.matchedRules) && result.matchedRules.length > 0
        ? result.matchedRules.map(rule => rule.name).join(', ')
        : (result.classifier?.source || 'built-in classifier');
    return `
        <div class="playground-simulation-summary">
            <span class="risk-label ${String(result.riskLevel || 'MEDIUM').toLowerCase()}">${escapeHtml(result.riskLevel || 'MEDIUM')}</span>
            <span class="status-badge ${playgroundStatusTone(result.predictedStatus)}">${escapeHtml(formatPlaygroundStatus(result.predictedStatus))}</span>
            <span class="status-badge pending">${escapeHtml(formatPlaygroundRoute(result.route))}</span>
        </div>
        <div class="playground-timeline">
            ${(result.timelineSteps || []).map(step => renderPlaygroundStep(step.label, step.value, step.detail)).join('')}
        </div>
        <div class="text-sm text-muted">Rules: ${escapeHtml(matchedRules)}</div>
    `;
}

async function refreshPlaygroundData() {
    const list = document.getElementById('playground-recent-runs');
    if (!list) {
        return;
    }

    try {
        const response = await apiFetch('/playground/runs?limit=10');
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load playground runs');
        }

        playgroundState.recentRuns = result.runs || [];
        renderPlaygroundRecentRuns();
        if (playgroundState.activeRun) {
            const detail = await apiFetch(`/playground/runs/${encodeURIComponent(playgroundState.activeRun.id)}`);
            if (detail.ok) {
                const detailResult = await detail.json();
                playgroundState.activeRun = detailResult.run;
                renderPlaygroundActiveRun();
            }
        }
    } catch (error) {
        list.innerHTML = renderEmptyState(error.message || 'Failed to load playground runs', 'blocked');
    }
}

function renderPlaygroundRecentRuns() {
    const list = document.getElementById('playground-recent-runs');
    if (!playgroundState.recentRuns.length) {
        list.innerHTML = renderEmptyState('No playground runs yet', 'activity');
        return;
    }

    list.innerHTML = playgroundState.recentRuns.map(run => {
        const isSelected = playgroundState.activeRun?.id === run.id;
        return `
        <article class="command-stream-card playground-run-card fade-in${isSelected ? ' is-selected' : ''}" data-run-id="${escapeHtml(run.id)}">
            <div class="command-stream-head">
                <div class="command-stream-main">
                    <div class="command-stream-badges">
                        <span class="status-badge ${playgroundStatusTone(run.status)}">${escapeHtml(formatPlaygroundStatus(run.status))}</span>
                        <span class="status-badge pending">${escapeHtml(formatPlaygroundRoute(run.route))}</span>
                        <span class="status-badge approved">${escapeHtml(formatAutoApprovalMode(run.approvalMode))}</span>
                    </div>
                    <div class="command-stream-title"><code>${escapeHtml(run.command)}</code></div>
                    <div class="command-stream-subtitle">${escapeHtml(run.requester || 'playground')} · ${timeAgo(run.createdAt)} · ${escapeHtml(PLAYGROUND_SCENARIOS[run.scenario]?.title || run.scenario)}</div>
                </div>
                <div class="command-stream-side">
                    <button class="btn btn-secondary btn-sm playground-select-run" data-testid="playground-inspect-run" data-id="${escapeHtml(run.id)}">${isSelected ? 'Inspecting' : 'Inspect'}</button>
                </div>
            </div>
        </article>
    `;
    }).join('');

    list.querySelectorAll('.playground-select-run').forEach(button => {
        button.addEventListener('click', () => selectPlaygroundRun(button.dataset.id));
    });
}

async function selectPlaygroundRun(runId) {
    const button = Array.from(document.querySelectorAll('.playground-select-run'))
        .find(candidate => candidate.dataset.id === runId);
    if (button) {
        button.disabled = true;
        button.textContent = 'Loading...';
    }

    try {
        const response = await apiFetch(`/playground/runs/${encodeURIComponent(runId)}`);
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load run');
        }
        playgroundState.activeRun = result.run;
        renderPlaygroundActiveRun();
        renderPlaygroundRecentRuns();
        document.querySelector('.playground-inspector')?.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    } catch (error) {
        showNotification(error.message || 'Failed to load run', 'error');
        renderPlaygroundRecentRuns();
    }
}

function renderPlaygroundActiveRun() {
    const target = document.getElementById('playground-active-run');
    const run = playgroundState.activeRun;
    if (!target || !run) {
        return;
    }

    const command = run.commandRecord;
    const dispatch = run.dispatchRecord;
    const steps = [
        renderPlaygroundStep('Policy', run.metadata?.riskLevel || command?.risk_level || dispatch?.risk_level || 'LOW', run.metadata?.reason || command?.status || 'Evaluated by policy'),
        renderPlaygroundStep('Route', formatPlaygroundRoute(run.route), dispatch ? dispatch.reason : 'Dashboard command request'),
        renderPlaygroundStep('Approval', formatAutoApprovalMode(run.approvalMode), command ? formatPlaygroundCommandApproval(command) : 'No governed command was created'),
        renderPlaygroundStep('Outcome', formatPlaygroundStatus(run.status), run.safeLifecycle ? 'Safe lifecycle mode kept arbitrary execution off.' : 'Real execution mode')
    ];

    target.innerHTML = `
        <div class="playground-timeline">
            ${steps.join('')}
        </div>
        <div class="playground-linked-actions">
            ${run.commandId ? `<button class="btn btn-secondary btn-sm" data-page-link="history">Open Activity</button>` : ''}
            ${command && command.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-page-link="pending">Open Pending</button>` : ''}
        </div>
    `;

    target.querySelectorAll('[data-page-link]').forEach(button => {
        button.addEventListener('click', () => navigateTo(button.dataset.pageLink));
    });
}

function renderPlaygroundStep(label, value, detail) {
    return `
        <div class="playground-step">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value || '-')}</strong>
            <p>${escapeHtml(detail || '')}</p>
        </div>
    `;
}

function getPlaygroundCommandLine() {
    return PLAYGROUND_SCENARIOS[playgroundState.scenario].command;
}

function parsePlaygroundCommandLine(commandLine) {
    const parts = String(commandLine || '').trim().split(/\s+/).filter(Boolean);
    return {
        command: parts[0] || 'echo',
        args: parts.slice(1)
    };
}

function playgroundStatusTone(status) {
    const normalized = String(status || '').toLowerCase();
    if (['blocked', 'rejected', 'failed', 'local_failed'].includes(normalized)) return 'rejected';
    if (['approved', 'completed', 'local_completed', 'linked_command'].includes(normalized)) return 'approved';
    return 'pending';
}

function formatPlaygroundStatus(status) {
    return String(status || 'created').replace(/_/g, ' ');
}

function formatPlaygroundRoute(route) {
    if (!route) return 'Dashboard';
    return String(route).replace(/_/g, ' ');
}

function formatPlaygroundCommandApproval(command) {
    const progress = command.approvalProgress;
    if (!progress) {
        return command.status || 'created';
    }
    return `${progress.count}/${progress.required} approvals · ${command.status}`;
}
