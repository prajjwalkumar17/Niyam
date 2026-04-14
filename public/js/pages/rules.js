/**
 * Rules/Policy Management Page
 */

let editingRuleId = null;

function renderRules(container) {
    container.innerHTML = `
        <div class="card" style="margin-bottom:20px">
            <div class="card-header">
                <span class="card-title">Built-In Rule Packs</span>
            </div>
            <div id="rule-packs-list"></div>
        </div>
        <div class="filters">
            <select class="filter-select" id="rules-type-filter">
                <option value="">All Types</option>
                <option value="pattern">Pattern</option>
                <option value="allowlist">Allowlist</option>
                <option value="denylist">Denylist</option>
                <option value="risk_override">Risk Override</option>
                <option value="execution_mode">Execution Mode</option>
            </select>
            <button class="btn btn-primary" id="add-rule-btn">+ Add Rule</button>
        </div>
        <div id="rules-list"></div>
    `;

    document.getElementById('rules-type-filter').addEventListener('change', loadRulesPage);
    document.getElementById('add-rule-btn').addEventListener('click', () => openRuleForm());
    loadRulesPage();
}

async function loadRulesPage() {
    await Promise.all([
        loadRulePacks(),
        loadRulesList()
    ]);
}

async function loadRulePacks() {
    const container = document.getElementById('rule-packs-list');

    try {
        const response = await apiFetch('/rule-packs');
        const packs = await response.json();

        if (!Array.isArray(packs) || packs.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No built-in rule packs found</div></div>';
            return;
        }

        container.innerHTML = packs.map(pack => `
            <div class="rule-card fade-in">
                <div class="rule-info">
                    <div class="rule-name">${escapeHtml(pack.name)} <span class="text-sm text-muted">v${escapeHtml(pack.version)}</span></div>
                    <div class="rule-desc">${escapeHtml(pack.description || '')}</div>
                </div>
                <div class="rule-meta">
                    <span class="status-badge ${pack.installed ? 'approved' : 'pending'}">${pack.installed ? `Installed (${pack.installedRuleCount}/${pack.totalRules})` : 'Not Installed'}</span>
                </div>
                <div class="rule-actions">
                    <button class="btn btn-secondary btn-sm" onclick="previewRulePack('${pack.id}')">Preview</button>
                    <button class="btn btn-secondary btn-sm" onclick="previewRulePackUpgrade('${pack.id}')">Upgrade Preview</button>
                    <button class="btn btn-primary btn-sm" onclick="installRulePack('${pack.id}')">Install</button>
                    <button class="btn btn-secondary btn-sm" onclick="upgradeRulePack('${pack.id}')">Upgrade</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load rule packs</div></div>';
    }
}

async function loadRulesList() {
    const typeFilter = document.getElementById('rules-type-filter').value;

    try {
        let url = `${API_BASE}/rules`;
        if (typeFilter) {
            url += `?ruleType=${typeFilter}`;
        }

        const response = await apiFetch(url);
        const rules = await response.json();

        const list = document.getElementById('rules-list');

        if (!Array.isArray(rules) || rules.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No rules defined</div></div>';
            return;
        }

        list.innerHTML = rules.map(rule => `
            <div class="rule-card fade-in">
                <div class="rule-info">
                    <div class="rule-name">
                        ${escapeHtml(rule.name)}
                        ${rule.managed_by_pack ? `<span class="text-sm text-muted">· pack ${escapeHtml(rule.managed_by_pack)} v${escapeHtml(rule.managed_by_pack_version || 'unknown')}</span>` : ''}
                    </div>
                    <div class="rule-desc">${escapeHtml(rule.description || 'No description')} ${rule.pattern ? '· Pattern: <code>' + escapeHtml(rule.pattern) + '</code>' : ''}</div>
                </div>
                <div class="rule-meta">
                    <span class="rule-type-badge ${rule.rule_type}">${rule.rule_type.replace('_', ' ')}</span>
                    ${rule.risk_level ? '<span class="risk-badge ' + rule.risk_level.toLowerCase() + '">' + rule.risk_level + '</span>' : ''}
                    ${rule.execution_mode ? '<span class="status-badge executing">' + rule.execution_mode + '</span>' : ''}
                    <span class="text-sm text-muted">P:${rule.priority}</span>
                </div>
                <div class="rule-actions">
                    <button class="btn btn-secondary btn-sm" onclick="toggleRule('${rule.id}', ${rule.enabled})">${rule.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-secondary btn-sm" onclick="editRule('${rule.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteRule('${rule.id}', '${escapeHtml(rule.name)}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        document.getElementById('rules-list').innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load rules</div></div>';
    }
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
