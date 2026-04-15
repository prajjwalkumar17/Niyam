const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { validateRule } = require('../rules');

const PACK_DIR = __dirname;

function listPacks(db) {
    return loadAllPacks().map(pack => summarizePack(pack, db));
}

function getPack(db, packId) {
    const pack = loadPack(packId);
    return {
        ...summarizePack(pack, db),
        rules: pack.rules.map(rule => ({
            ...normalizePackRule(rule),
            installed: Boolean(findInstalledRule(db, pack.id, rule.pack_rule_id))
        }))
    };
}

function installPack(db, packId, mode = 'install_if_missing') {
    const pack = loadPack(packId);
    const inserted = [];
    const skipped = [];

    for (const rule of pack.rules) {
        const normalizedRule = normalizePackRule(rule);
        const existing = findInstalledRule(db, pack.id, normalizedRule.pack_rule_id);
        if (existing) {
            skipped.push(describeRule(existing, normalizedRule.pack_rule_id));
            continue;
        }

        insertPackRule(db, pack, normalizedRule, mode);
        inserted.push({
            pack_rule_id: normalizedRule.pack_rule_id,
            name: normalizedRule.name
        });
    }

    return {
        pack: summarizePack(pack, db),
        mode,
        inserted,
        skipped
    };
}

function previewPackUpgrade(db, packId) {
    const pack = loadPack(packId);
    const preview = {
        pack: summarizePack(pack, db),
        new_rules: [],
        unchanged_rules: [],
        local_conflicts: [],
        upgradable_rules: []
    };

    for (const rule of pack.rules) {
        const normalizedRule = normalizePackRule(rule);
        const existing = findInstalledRule(db, pack.id, normalizedRule.pack_rule_id);
        const desiredSignature = buildRuleSignature(normalizedRule);

        if (!existing) {
            preview.new_rules.push({
                pack_rule_id: normalizedRule.pack_rule_id,
                name: normalizedRule.name
            });
            continue;
        }

        const existingMetadata = parseJson(existing.metadata, {});
        const appliedSignature = existingMetadata.pack_signature || buildRuleSignature(existing);
        const currentSignature = buildRuleSignature(existing);

        if (currentSignature !== appliedSignature) {
            preview.local_conflicts.push({
                pack_rule_id: normalizedRule.pack_rule_id,
                name: normalizedRule.name,
                existing_rule_id: existing.id
            });
            continue;
        }

        if (desiredSignature === currentSignature) {
            preview.unchanged_rules.push({
                pack_rule_id: normalizedRule.pack_rule_id,
                name: normalizedRule.name,
                existing_rule_id: existing.id
            });
            continue;
        }

        preview.upgradable_rules.push({
            pack_rule_id: normalizedRule.pack_rule_id,
            name: normalizedRule.name,
            existing_rule_id: existing.id,
            current_version: existing.managed_by_pack_version || null,
            target_version: pack.version
        });
    }

    return preview;
}

function applyPackUpgrade(db, packId) {
    const pack = loadPack(packId);
    const preview = previewPackUpgrade(db, packId);
    const applied = [];
    const inserted = [];

    for (const item of preview.new_rules) {
        const normalizedRule = normalizePackRule(
            pack.rules.find(rule => rule.pack_rule_id === item.pack_rule_id)
        );
        insertPackRule(db, pack, normalizedRule, 'install_if_missing');
        inserted.push(item);
    }

    for (const item of preview.upgradable_rules) {
        const normalizedRule = normalizePackRule(
            pack.rules.find(rule => rule.pack_rule_id === item.pack_rule_id)
        );
        updatePackRule(db, pack, normalizedRule, item.existing_rule_id);
        applied.push(item);
    }

    return {
        pack: summarizePack(pack, db),
        inserted,
        applied,
        local_conflicts: preview.local_conflicts,
        unchanged_rules: preview.unchanged_rules
    };
}

function summarizePack(pack, db) {
    const installedRows = db
        ? db.prepare('SELECT * FROM rules WHERE managed_by_pack = ?').all(pack.id)
        : [];

    return {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        totalRules: pack.rules.length,
        installed: installedRows.length > 0,
        installedRuleCount: installedRows.length,
        installedVersion: installedRows[0] ? installedRows[0].managed_by_pack_version || null : null
    };
}

function insertPackRule(db, pack, rule) {
    const now = new Date().toISOString();
    const metadata = JSON.stringify({
        ...(rule.metadata || {}),
        pack_signature: buildRuleSignature(rule)
    });

    db.prepare(`
        INSERT INTO rules (
            id, name, description, rule_type, pattern, risk_level, execution_mode,
            managed_by_pack, managed_by_pack_rule_id, managed_by_pack_version,
            enabled, priority, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuidv4(),
        rule.name,
        rule.description || null,
        rule.rule_type,
        rule.pattern || null,
        rule.risk_level || null,
        rule.execution_mode || null,
        pack.id,
        rule.pack_rule_id,
        pack.version,
        rule.enabled,
        rule.priority,
        now,
        now,
        metadata
    );
}

function updatePackRule(db, pack, rule, existingRuleId) {
    const existing = db.prepare('SELECT metadata FROM rules WHERE id = ?').get(existingRuleId);
    const existingMetadata = parseJson(existing?.metadata, {});
    const nextMetadata = JSON.stringify({
        ...existingMetadata,
        ...(rule.metadata || {}),
        pack_signature: buildRuleSignature(rule)
    });

    db.prepare(`
        UPDATE rules SET
            name = ?,
            description = ?,
            rule_type = ?,
            pattern = ?,
            risk_level = ?,
            execution_mode = ?,
            managed_by_pack_version = ?,
            enabled = ?,
            priority = ?,
            updated_at = ?,
            metadata = ?
        WHERE id = ?
    `).run(
        rule.name,
        rule.description || null,
        rule.rule_type,
        rule.pattern || null,
        rule.risk_level || null,
        rule.execution_mode || null,
        pack.version,
        rule.enabled,
        rule.priority,
        new Date().toISOString(),
        nextMetadata,
        existingRuleId
    );
}

function loadAllPacks() {
    return fs.readdirSync(PACK_DIR)
        .filter(file => file.endsWith('.json'))
        .sort()
        .map(file => loadPack(path.basename(file, '.json')));
}

function loadPack(packId) {
    const packPath = path.join(PACK_DIR, `${packId}.json`);
    if (!fs.existsSync(packPath)) {
        throw new Error(`Rule pack not found: ${packId}`);
    }

    const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
    if (!pack.id || !Array.isArray(pack.rules)) {
        throw new Error(`Invalid rule pack definition: ${packId}`);
    }

    for (const rule of pack.rules) {
        const normalizedRule = normalizePackRule(rule);
        const validation = validateRule(normalizedRule);
        if (!validation.valid) {
            throw new Error(`Invalid rule in pack ${packId}/${normalizedRule.pack_rule_id}: ${validation.errors.join(', ')}`);
        }
    }

    return pack;
}

function normalizePackRule(rule) {
    return {
        pack_rule_id: rule.pack_rule_id,
        name: rule.name,
        description: rule.description || '',
        rule_type: rule.rule_type,
        pattern: rule.pattern || null,
        risk_level: rule.risk_level || null,
        execution_mode: rule.execution_mode || null,
        priority: Number(rule.priority || 0),
        enabled: rule.enabled_by_default === false ? 0 : 1,
        metadata: rule.metadata || {}
    };
}

function findInstalledRule(db, packId, packRuleId) {
    if (!db) {
        return null;
    }

    return db.prepare(`
        SELECT * FROM rules
        WHERE managed_by_pack = ? AND managed_by_pack_rule_id = ?
    `).get(packId, packRuleId);
}

function buildRuleSignature(rule) {
    return JSON.stringify({
        name: rule.name,
        description: rule.description || '',
        rule_type: rule.rule_type,
        pattern: rule.pattern || null,
        risk_level: rule.risk_level || null,
        execution_mode: rule.execution_mode || null,
        priority: Number(rule.priority || 0),
        enabled: Number(rule.enabled || 0)
    });
}

function describeRule(rule, packRuleId) {
    return {
        pack_rule_id: packRuleId,
        name: rule.name,
        existing_rule_id: rule.id
    };
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

module.exports = {
    applyPackUpgrade,
    getPack,
    installPack,
    listPacks,
    previewPackUpgrade
};
