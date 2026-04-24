/**
 * Rules/Policy Management Page
 */

let editingRuleId = null;
let rulesPageState = {
    packsCollapsed: true
};

function renderRules(container) {
    container.innerHTML = `
        <section class="rules-overview fade-in" id="rules-overview"></section>
        <section class="rules-section fade-in rules-pack-library ${rulesPageState.packsCollapsed ? 'is-collapsed' : ''}" id="rules-pack-library">
            <div class="rules-section-head">
                <div>
                    <div class="card-title">Built-In Rule Packs</div>
                    <div class="rules-section-copy">Keep the pack library nearby for bootstrapping and upgrades, but out of the way when you are working on live rules.</div>
                </div>
                <div class="rules-pack-library-actions">
                    <span class="rules-summary-chip" id="rule-packs-summary">Pack library</span>
                    <button
                        class="btn btn-secondary"
                        id="toggle-rule-packs-btn"
                        data-testid="rule-packs-toggle"
                        type="button"
                        aria-controls="rule-packs-panel"
                        aria-expanded="${rulesPageState.packsCollapsed ? 'false' : 'true'}"
                    >
                        ${rulesPageState.packsCollapsed ? 'Show Pack Library' : 'Hide Pack Library'}
                    </button>
                </div>
            </div>
            <div class="rules-pack-library-body" id="rule-packs-panel" aria-hidden="${rulesPageState.packsCollapsed ? 'true' : 'false'}">
                <div class="rules-pack-grid" id="rule-packs-list"></div>
            </div>
        </section>
        <section class="rules-section fade-in">
            <div class="rules-section-head">
                <div>
                    <div class="card-title">Policy Catalog</div>
                    <div class="rules-section-copy">Live rules evaluated by the engine, ordered for operator review and quick edits.</div>
                </div>
                <div class="rules-toolbar">
                    <select class="filter-select" id="rules-source-filter">
                        <option value="">All Sources</option>
                    </select>
                    <select class="filter-select" id="rules-type-filter">
                        <option value="">All Types</option>
                        <option value="pattern">Pattern</option>
                        <option value="allowlist">Allowlist</option>
                        <option value="denylist">Denylist</option>
                        <option value="risk_override">Risk Override</option>
                        <option value="execution_mode">Execution Mode</option>
                    </select>
                </div>
            </div>
            <div id="rules-list"></div>
        </section>
        <button class="btn btn-primary rules-fab" id="add-rule-btn" data-testid="rules-fab" type="button" aria-label="Add new rule">
            <span class="rules-fab-icon" aria-hidden="true">+</span>
            <span class="rules-fab-label">New Rule</span>
        </button>
    `;

    document.getElementById('rules-type-filter').addEventListener('change', loadRulesPage);
    document.getElementById('rules-source-filter').addEventListener('change', loadRulesPage);
    document.getElementById('add-rule-btn').addEventListener('click', () => openRuleForm());
    initRulePackLibrary();
    loadRulesPage();
}

async function loadRulesPage() {
    try {
        const typeFilter = document.getElementById('rules-type-filter').value;
        const sourceFilter = document.getElementById('rules-source-filter').value;

        const [packsResponse, rulesResponse] = await Promise.all([
            apiFetch('/rule-packs'),
            apiFetch('/rules')
        ]);

        const [packs, rules] = await Promise.all([
            packsResponse.json(),
            rulesResponse.json()
        ]);

        populateSourceFilter(packs, rules, sourceFilter);
        const filteredRules = filterRules(rules, typeFilter, sourceFilter);

        renderRulesOverview(packs, filteredRules, typeFilter, sourceFilter);
        renderRulesList(filteredRules, typeFilter, sourceFilter);
        renderRulePacks(packs);
        updateRulePackLibrarySummary(packs);
    } catch (error) {
        document.getElementById('rules-overview').innerHTML = renderEmptyState('Failed to load policy overview', 'blocked');
        document.getElementById('rule-packs-list').innerHTML = renderEmptyState('Failed to load rule packs', 'blocked');
        document.getElementById('rules-list').innerHTML = renderEmptyState('Failed to load rules', 'blocked');
        const summary = document.getElementById('rule-packs-summary');
        if (summary) {
            summary.textContent = 'Pack library unavailable';
        }
    }
}

function renderRulesOverview(packs, rules, typeFilter, sourceFilter) {
    const overview = document.getElementById('rules-overview');
    const installedPackCount = Array.isArray(packs) ? packs.filter(pack => pack.installed).length : 0;
    const managedRules = Array.isArray(rules) ? rules.filter(rule => Boolean(rule.managed_by_pack)).length : 0;
    const wrapperRules = Array.isArray(rules) ? rules.filter(rule => rule.execution_mode === 'WRAPPER').length : 0;
    const enabledRules = Array.isArray(rules) ? rules.filter(rule => Number(rule.enabled) === 1).length : 0;

    overview.innerHTML = `
        <div class="rules-overview-grid">
            <div class="rules-metric-tile">
                <div class="rules-metric-label">Live Rules</div>
                <div class="rules-metric-value">${Array.isArray(rules) ? rules.length : 0}</div>
                <div class="rules-metric-foot">${enabledRules} enabled for evaluation</div>
            </div>
            <div class="rules-metric-tile">
                <div class="rules-metric-label">Installed Packs</div>
                <div class="rules-metric-value">${installedPackCount}</div>
                <div class="rules-metric-foot">${Array.isArray(packs) ? packs.length : 0} curated packs available</div>
            </div>
            <div class="rules-metric-tile">
                <div class="rules-metric-label">Wrapper Paths</div>
                <div class="rules-metric-value">${wrapperRules}</div>
                <div class="rules-metric-foot">Rules forcing isolated execution</div>
            </div>
            <div class="rules-metric-tile">
                <div class="rules-metric-label">Pack Managed</div>
                <div class="rules-metric-value">${managedRules}</div>
                <div class="rules-metric-foot">Rules installed from curated packs</div>
            </div>
        </div>
        <div class="rules-summary-rail">
            <span class="rules-summary-chip">${typeFilter ? `Filter · ${formatRuleType(typeFilter)}` : 'Filter · All types'}</span>
            <span class="rules-summary-chip">${formatSourceFilterLabel(sourceFilter, packs)}</span>
            <span class="rules-summary-chip">Priority driven evaluation</span>
            <span class="rules-summary-chip">Approval and execution routing</span>
        </div>
    `;
}

function renderRulePacks(packs) {
    const container = document.getElementById('rule-packs-list');

    if (!Array.isArray(packs) || packs.length === 0) {
        container.innerHTML = renderEmptyState('No built-in rule packs found', 'package');
        return;
    }

    container.innerHTML = packs.map(pack => `
        <article class="pack-panel fade-in">
            <div class="pack-panel-head">
                <div class="pack-mark">${escapeHtml(pack.id.slice(0, 2).toUpperCase())}</div>
                <div class="pack-head-copy">
                    <div class="pack-title-row">
                        <h3 class="pack-title">${escapeHtml(pack.name)}</h3>
                        <span class="pack-version">v${escapeHtml(pack.version)}</span>
                    </div>
                    <p class="pack-description">${escapeHtml(pack.description || '')}</p>
                </div>
            </div>
            <div class="pack-stats">
                <div class="pack-stat">
                    <span class="pack-stat-label">Status</span>
                    <span class="status-badge ${pack.installed ? 'approved' : 'pending'}">${pack.installed ? 'Installed' : 'Available'}</span>
                </div>
                <div class="pack-stat">
                    <span class="pack-stat-label">Rules</span>
                    <span class="pack-stat-value">${pack.installedRuleCount}/${pack.totalRules}</span>
                </div>
            </div>
            <div class="pack-actions">
                <button class="btn btn-secondary btn-sm" onclick="previewRulePack('${pack.id}')">Preview</button>
                <button class="btn btn-secondary btn-sm" onclick="previewRulePackUpgrade('${pack.id}')">Upgrade Preview</button>
                <button class="btn btn-primary btn-sm" onclick="installRulePack('${pack.id}')">Install</button>
                <button class="btn btn-secondary btn-sm" onclick="upgradeRulePack('${pack.id}')">Upgrade</button>
            </div>
        </article>
    `).join('');
}

function initRulePackLibrary() {
    const toggle = document.getElementById('toggle-rule-packs-btn');
    if (!toggle) {
        return;
    }

    toggle.addEventListener('click', () => {
        rulesPageState.packsCollapsed = !rulesPageState.packsCollapsed;
        syncRulePackLibraryState();
    });
}

function syncRulePackLibraryState() {
    const library = document.getElementById('rules-pack-library');
    const toggle = document.getElementById('toggle-rule-packs-btn');
    const panel = document.getElementById('rule-packs-panel');
    if (!library || !toggle || !panel) {
        return;
    }

    library.classList.toggle('is-collapsed', rulesPageState.packsCollapsed);
    toggle.textContent = rulesPageState.packsCollapsed ? 'Show Pack Library' : 'Hide Pack Library';
    toggle.setAttribute('aria-expanded', rulesPageState.packsCollapsed ? 'false' : 'true');
    panel.setAttribute('aria-hidden', rulesPageState.packsCollapsed ? 'true' : 'false');
}

function updateRulePackLibrarySummary(packs) {
    const summary = document.getElementById('rule-packs-summary');
    if (!summary) {
        return;
    }

    const installedPackCount = Array.isArray(packs) ? packs.filter(pack => pack.installed).length : 0;
    const totalPackCount = Array.isArray(packs) ? packs.length : 0;
    summary.textContent = `${installedPackCount} installed · ${totalPackCount} available`;
}

function renderRulesList(rules, typeFilter, sourceFilter) {
    const list = document.getElementById('rules-list');

    if (!Array.isArray(rules) || rules.length === 0) {
        const hasFilter = Boolean(typeFilter || sourceFilter);
        list.innerHTML = renderEmptyState(hasFilter ? 'No rules match the selected filters' : 'No rules defined', 'rules');
        return;
    }

    list.innerHTML = `<div class="policy-stream">${
        rules.map(rule => `
            <article class="policy-card fade-in ${rule.enabled ? 'is-enabled' : 'is-disabled'}">
                <div class="policy-card-head">
                    <div class="policy-card-copy">
                        <div class="policy-card-meta">
                            <span class="policy-source">${rule.managed_by_pack ? `Pack · ${escapeHtml(rule.managed_by_pack)}` : 'Custom rule'}</span>
                            <span class="policy-state ${rule.enabled ? 'enabled' : 'disabled'}">${rule.enabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <h3 class="policy-title">${escapeHtml(rule.name)}</h3>
                        <p class="policy-description">${escapeHtml(rule.description || 'No description')}</p>
                    </div>
                    <div class="policy-badges">
                        <span class="rule-type-badge ${rule.rule_type}">${formatRuleType(rule.rule_type)}</span>
                        ${rule.risk_level ? '<span class="risk-badge ' + rule.risk_level.toLowerCase() + '">' + rule.risk_level + '</span>' : ''}
                        ${rule.execution_mode ? '<span class="status-badge executing">' + rule.execution_mode + '</span>' : ''}
                        <span class="rule-priority">P:${rule.priority}</span>
                    </div>
                </div>
                <div class="policy-card-body">
                    ${rule.pattern ? `<div class="policy-pattern"><span class="policy-pattern-label">Pattern</span><code>${escapeHtml(rule.pattern)}</code></div>` : '<div class="policy-pattern policy-pattern-empty"><span class="policy-pattern-label">Pattern</span><span class="text-muted">No regex pattern attached</span></div>'}
                    <div class="policy-actions">
                        <button class="btn btn-secondary btn-sm" onclick="toggleRule('${rule.id}', ${rule.enabled})">${rule.enabled ? 'Disable' : 'Enable'}</button>
                        <button class="btn btn-secondary btn-sm" onclick="editRule('${rule.id}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteRule('${rule.id}', '${escapeHtml(rule.name)}')">Delete</button>
                    </div>
                </div>
            </article>
        `).join('')
    }</div>`;
}

function openRuleForm(rule = null) {
    editingRuleId = rule ? rule.id : null;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'rule-form-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>${rule ? 'Edit Rule' : 'Add Rule'}</h2>
                <button class="modal-close" onclick="closeRuleForm()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" class="form-input" id="rule-name" value="${rule ? escapeHtml(rule.name) : ''}" placeholder="Rule name">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="form-input" id="rule-desc" value="${rule ? escapeHtml(rule.description || '') : ''}" placeholder="What this rule does">
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select class="filter-select" id="rule-type" style="width:100%">
                        <option value="pattern" ${rule?.rule_type === 'pattern' ? 'selected' : ''}>Pattern (regex match)</option>
                        <option value="allowlist" ${rule?.rule_type === 'allowlist' ? 'selected' : ''}>Allowlist</option>
                        <option value="denylist" ${rule?.rule_type === 'denylist' ? 'selected' : ''}>Denylist</option>
                        <option value="risk_override" ${rule?.rule_type === 'risk_override' ? 'selected' : ''}>Risk Override</option>
                        <option value="execution_mode" ${rule?.rule_type === 'execution_mode' ? 'selected' : ''}>Execution Mode</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Pattern (regex)</label>
                    <input type="text" class="form-input" id="rule-pattern" value="${rule ? escapeHtml(rule.pattern || '') : ''}" placeholder="e.g., pr\\s+merge">
                </div>
                <div class="form-group">
                    <label>Risk Level</label>
                    <select class="filter-select" id="rule-risk-level" style="width:100%">
                        <option value="" ${!rule?.risk_level ? 'selected' : ''}>None</option>
                        <option value="HIGH" ${rule?.risk_level === 'HIGH' ? 'selected' : ''}>HIGH</option>
                        <option value="MEDIUM" ${rule?.risk_level === 'MEDIUM' ? 'selected' : ''}>MEDIUM</option>
                        <option value="LOW" ${rule?.risk_level === 'LOW' ? 'selected' : ''}>LOW</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Execution Mode</label>
                    <select class="filter-select" id="rule-execution-mode" style="width:100%">
                        <option value="" ${!rule?.execution_mode ? 'selected' : ''}>None</option>
                        <option value="DIRECT" ${rule?.execution_mode === 'DIRECT' ? 'selected' : ''}>DIRECT</option>
                        <option value="WRAPPER" ${rule?.execution_mode === 'WRAPPER' ? 'selected' : ''}>WRAPPER</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Priority (higher = evaluated first)</label>
                    <input type="number" class="form-input" id="rule-priority" value="${rule ? rule.priority : 50}">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeRuleForm()">Cancel</button>
                <button class="btn btn-primary" onclick="saveRuleForm()">Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closeRuleForm() {
    const overlay = document.getElementById('rule-form-overlay');
    if (overlay) overlay.remove();
    editingRuleId = null;
}

async function saveRuleForm() {
    const data = {
        name: document.getElementById('rule-name').value.trim(),
        description: document.getElementById('rule-desc').value.trim(),
        rule_type: document.getElementById('rule-type').value,
        pattern: document.getElementById('rule-pattern').value.trim(),
        risk_level: document.getElementById('rule-risk-level').value || null,
        execution_mode: document.getElementById('rule-execution-mode').value || null,
        priority: parseInt(document.getElementById('rule-priority').value, 10) || 50
    };

    if (!data.name) {
        showNotification('Rule name is required', 'error');
        return;
    }

    try {
        const url = editingRuleId ? `${API_BASE}/rules/${editingRuleId}` : `${API_BASE}/rules`;
        const method = editingRuleId ? 'PUT' : 'POST';

        const response = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showNotification(editingRuleId ? 'Rule updated' : 'Rule created', 'success');
            closeRuleForm();
            loadRulesPage();
        } else {
            const result = await response.json();
            showNotification(result.error || 'Failed to save rule', 'error');
        }
    } catch (error) {
        showNotification('Network error', 'error');
    }
}

async function editRule(ruleId) {
    try {
        const response = await apiFetch(`/rules/${ruleId}`);
        const rule = await response.json();
        if (response.ok) {
            openRuleForm(rule);
        }
    } catch (error) {
        showNotification('Failed to load rule', 'error');
    }
}

async function toggleRule(ruleId, currentlyEnabled) {
    try {
        const response = await apiFetch(`/rules/${ruleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: currentlyEnabled ? 0 : 1 })
        });

        if (response.ok) {
            showNotification(`Rule ${currentlyEnabled ? 'disabled' : 'enabled'}`, 'info');
            loadRulesPage();
        }
    } catch (error) {
        showNotification('Failed to toggle rule', 'error');
    }
}

async function deleteRule(ruleId, ruleName) {
    if (!confirm(`Delete rule "${ruleName}"?`)) return;

    try {
        const response = await apiFetch(`/rules/${ruleId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Rule deleted', 'success');
            loadRulesPage();
        }
    } catch (error) {
        showNotification('Failed to delete rule', 'error');
    }
}

async function previewRulePack(packId) {
    try {
        const response = await apiFetch(`/rule-packs/${packId}`);
        const pack = await response.json();
        if (!response.ok) {
            throw new Error(pack.error || 'Failed to load pack');
        }

        openPackModal(
            `${pack.name} v${pack.version}`,
            `
                <div class="text-sm text-muted" style="margin-bottom:12px">${escapeHtml(pack.description || '')}</div>
                ${pack.rules.map(rule => `
                    <div style="padding:10px 0;border-bottom:1px solid var(--border-color)">
                        <div><strong>${escapeHtml(rule.name)}</strong> <span class="text-sm text-muted">(${escapeHtml(rule.rule_type)})</span></div>
                        <div class="text-sm text-muted">${escapeHtml(rule.description || '')}</div>
                        <div class="text-sm text-muted">Pattern: <code>${escapeHtml(rule.pattern || '')}</code></div>
                        <div class="text-sm text-muted">Installed: ${rule.installed ? 'Yes' : 'No'}</div>
                    </div>
                `).join('')}
            `
        );
    } catch (error) {
        showNotification(error.message || 'Failed to load rule pack', 'error');
    }
}

async function previewRulePackUpgrade(packId) {
    try {
        const response = await apiFetch(`/rule-packs/${packId}/upgrade-preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to preview upgrade');
        }

        openPackModal(
            `Upgrade Preview · ${escapeHtml(result.pack.name)}`,
            `
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                    <div class="card"><div class="card-header"><span class="card-title">New</span></div><div>${renderPackRuleNames(result.new_rules)}</div></div>
                    <div class="card"><div class="card-header"><span class="card-title">Upgradable</span></div><div>${renderPackRuleNames(result.upgradable_rules)}</div></div>
                    <div class="card"><div class="card-header"><span class="card-title">Conflicts</span></div><div>${renderPackRuleNames(result.local_conflicts)}</div></div>
                    <div class="card"><div class="card-header"><span class="card-title">Unchanged</span></div><div>${renderPackRuleNames(result.unchanged_rules)}</div></div>
                </div>
            `
        );
    } catch (error) {
        showNotification(error.message || 'Failed to preview upgrade', 'error');
    }
}

async function installRulePack(packId) {
    try {
        const response = await apiFetch(`/rule-packs/${packId}/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'install_if_missing' })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to install pack');
        }

        showNotification(`Installed ${result.inserted.length} rule(s) from ${packId}`, 'success');
        loadRulesPage();
    } catch (error) {
        showNotification(error.message || 'Failed to install pack', 'error');
    }
}

async function upgradeRulePack(packId) {
    try {
        const response = await apiFetch(`/rule-packs/${packId}/upgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to upgrade pack');
        }

        showNotification(
            `Applied ${result.applied.length} upgrade(s), inserted ${result.inserted.length}, conflicts ${result.local_conflicts.length}`,
            result.local_conflicts.length > 0 ? 'warning' : 'success'
        );
        loadRulesPage();
    } catch (error) {
        showNotification(error.message || 'Failed to upgrade pack', 'error');
    }
}

function renderPackRuleNames(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '<div class="text-sm text-muted">None</div>';
    }

    return items.map(item => `<div class="text-sm" style="padding:4px 0">${escapeHtml(item.name)}</div>`).join('');
}

function formatRuleType(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
}

function populateSourceFilter(packs, rules, selectedValue) {
    const select = document.getElementById('rules-source-filter');
    if (!select) {
        return;
    }

    const options = [];
    const hasCustomRules = Array.isArray(rules) && rules.some(rule => !rule.managed_by_pack);
    if (hasCustomRules) {
        options.push({ value: '__custom__', label: 'Custom Rules' });
    }

    const installedPacks = Array.isArray(packs)
        ? packs.filter(pack => pack.installed || (Array.isArray(rules) && rules.some(rule => rule.managed_by_pack === pack.id)))
        : [];

    for (const pack of installedPacks) {
        options.push({
            value: pack.id,
            label: pack.name || pack.id
        });
    }

    select.innerHTML = [
        '<option value="">All Sources</option>',
        ...options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    ].join('');

    select.value = options.some(option => option.value === selectedValue) ? selectedValue : '';
}

function filterRules(rules, typeFilter, sourceFilter) {
    if (!Array.isArray(rules)) {
        return [];
    }

    return rules.filter(rule => {
        if (typeFilter && rule.rule_type !== typeFilter) {
            return false;
        }

        if (!sourceFilter) {
            return true;
        }

        if (sourceFilter === '__custom__') {
            return !rule.managed_by_pack;
        }

        return rule.managed_by_pack === sourceFilter;
    });
}

function formatSourceFilterLabel(sourceFilter, packs) {
    if (!sourceFilter) {
        return 'Source · All origins';
    }

    if (sourceFilter === '__custom__') {
        return 'Source · Custom rules';
    }

    const matchingPack = Array.isArray(packs) ? packs.find(pack => pack.id === sourceFilter) : null;
    return `Source · ${matchingPack?.name || sourceFilter}`;
}

function openPackModal(title, bodyHtml) {
    closePackModal();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'rule-pack-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width:860px">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="modal-close" onclick="closePackModal()">&times;</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closePackModal()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closePackModal() {
    const overlay = document.getElementById('rule-pack-overlay');
    if (overlay) {
        overlay.remove();
    }
}
