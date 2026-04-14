/**
 * Rules/Policy Management Page
 */

let editingRuleId = null;

function renderRules(container) {
    container.innerHTML = `
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
    const typeFilter = document.getElementById('rules-type-filter').value;
    
    try {
        let url = `${API_BASE}/rules`;
        if (typeFilter) url += `?ruleType=${typeFilter}`;
        
        const response = await apiFetch(url);
        const rules = await response.json();
        
        const list = document.getElementById('rules-list');
        
        if (!rules || rules.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No rules defined</div></div>';
            return;
        }
        
        list.innerHTML = rules.map(rule => `
            <div class="rule-card fade-in">
                <div class="rule-info">
                    <div class="rule-name">${escapeHtml(rule.name)}</div>
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
    } catch (e) {
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
        priority: parseInt(document.getElementById('rule-priority').value) || 50
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
        showNotification('Failed to delete rule', 'error');
    }
}
