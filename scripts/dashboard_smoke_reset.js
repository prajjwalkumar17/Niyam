#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const DEFAULT_STATE_PATH = path.join(ROOT_DIR, '.local', 'dashboard-smoke-state.json');
const SMOKE_SOURCE = 'dashboard_smoke';

function main() {
    const envPath = path.resolve(process.env.NIYAM_DASHBOARD_SMOKE_ENV || DEFAULT_ENV_PATH);
    const statePath = path.resolve(process.env.NIYAM_DASHBOARD_SMOKE_STATE || DEFAULT_STATE_PATH);
    const env = loadEnvFile(envPath);
    const state = loadStateFile(statePath);
    const dbPath = resolveDbPath(env);
    const db = new Database(dbPath, { fileMustExist: true });

    db.pragma('foreign_keys = ON');

    try {
        const targets = collectTargets(db, state);
        const summary = deleteTargets(db, targets);

        if (fs.existsSync(statePath)) {
            fs.rmSync(statePath, { force: true });
        }

        process.stdout.write(`${JSON.stringify({
            ok: true,
            dbPath,
            stateFileRemoved: fs.existsSync(statePath) === false,
            removed: summary
        }, null, 2)}\n`);
    } finally {
        db.close();
    }
}

function collectTargets(db, state) {
    const commandIds = new Set(Array.isArray(state?.commands) ? state.commands : []);
    const ruleIds = new Set(Array.isArray(state?.createdRules) ? state.createdRules : []);
    const smokeRuleNames = Array.isArray(state?.smokeRuleNames) ? state.smokeRuleNames : [];
    const installedPack = state?.installedPack || null;

    for (const row of db.prepare('SELECT id FROM commands WHERE metadata LIKE ?').all(`%${SMOKE_SOURCE}%`)) {
        commandIds.add(row.id);
    }

    for (const row of db.prepare('SELECT id FROM rules WHERE metadata LIKE ?').all(`%${SMOKE_SOURCE}%`)) {
        ruleIds.add(row.id);
    }

    if (smokeRuleNames.length > 0) {
        const placeholders = smokeRuleNames.map(() => '?').join(', ');
        const rows = db.prepare(`SELECT id FROM rules WHERE name IN (${placeholders})`).all(...smokeRuleNames);
        for (const row of rows) {
            ruleIds.add(row.id);
        }
    } else {
        for (const row of db.prepare("SELECT id FROM rules WHERE name LIKE 'Dashboard Smoke %'").all()) {
            ruleIds.add(row.id);
        }
    }

    const packRuleIds = new Set();
    if (installedPack?.installedBySmoke && installedPack.id) {
        for (const row of db.prepare('SELECT id FROM rules WHERE managed_by_pack = ?').all(installedPack.id)) {
            packRuleIds.add(row.id);
            ruleIds.add(row.id);
        }
    }

    return {
        commandIds: [...commandIds],
        ruleIds: [...ruleIds],
        packRuleIds: [...packRuleIds],
        packId: installedPack?.installedBySmoke ? installedPack.id : null,
        startedAt: state?.startedAt || null,
        finishedAt: state?.finishedAt || null
    };
}

function deleteTargets(db, targets) {
    const summary = {
        commands: 0,
        approvals: 0,
        orphanApprovals: 0,
        rules: 0,
        auditEntries: 0,
        packRules: 0
    };

    const transaction = db.transaction(() => {
        if (targets.commandIds.length > 0) {
            summary.auditEntries += deleteByIds(db, 'audit_log', 'entity_id', targets.commandIds, "entity_type = 'command'");
            summary.approvals += deleteByIds(db, 'approvals', 'command_id', targets.commandIds);
            summary.commands += deleteByIds(db, 'commands', 'id', targets.commandIds);
        }

        if (targets.ruleIds.length > 0) {
            summary.auditEntries += deleteByIds(db, 'audit_log', 'entity_id', targets.ruleIds, "entity_type = 'rule'");
            summary.rules += deleteByIds(db, 'rules', 'id', targets.ruleIds);
        }

        if (targets.packRuleIds.length > 0) {
            summary.packRules = targets.packRuleIds.length;
        }

        if (targets.packId && targets.startedAt && targets.finishedAt) {
            const result = db.prepare(`
                DELETE FROM audit_log
                WHERE entity_type = 'rule_pack'
                  AND entity_id = ?
                  AND created_at >= ?
                  AND created_at <= ?
            `).run(targets.packId, targets.startedAt, targets.finishedAt);
            summary.auditEntries += result.changes;
        }

        summary.auditEntries += deleteSmokeSignatureAuditEntries(db);
        summary.orphanApprovals += db.prepare(`
            DELETE FROM approvals
            WHERE NOT EXISTS (
                SELECT 1 FROM commands WHERE commands.id = approvals.command_id
            )
        `).run().changes;
    });

    transaction();
    return summary;
}

function deleteByIds(db, table, column, ids, extraWhere = '') {
    if (!Array.isArray(ids) || ids.length === 0) {
        return 0;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const where = extraWhere ? `${extraWhere} AND ${column} IN (${placeholders})` : `${column} IN (${placeholders})`;
    const result = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...ids);
    return result.changes;
}

function deleteSmokeSignatureAuditEntries(db) {
    const result = db.prepare(`
        DELETE FROM audit_log
        WHERE details LIKE '%Dashboard Smoke %'
           OR details LIKE '%dashboard-medium-%'
           OR details LIKE '%dashboard-high-%'
    `).run();
    return result.changes;
}

function resolveDbPath(env) {
    if (process.env.NIYAM_DB) {
        return path.resolve(process.env.NIYAM_DB);
    }
    if (env.NIYAM_DB) {
        return path.resolve(env.NIYAM_DB);
    }

    const dataDir = process.env.NIYAM_DATA_DIR
        ? path.resolve(process.env.NIYAM_DATA_DIR)
        : env.NIYAM_DATA_DIR
            ? path.resolve(env.NIYAM_DATA_DIR)
            : path.join(ROOT_DIR, 'data');

    return path.join(dataDir, 'niyam.db');
}

function loadStateFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEnvFile(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        return {};
    }

    const values = {};
    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        if (!line || line.trim().startsWith('#')) {
            continue;
        }

        const index = line.indexOf('=');
        if (index === -1) {
            continue;
        }

        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();

        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

try {
    main();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
}
