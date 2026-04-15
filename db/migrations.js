const MIGRATIONS = [
    {
        id: '001_execution_mode_and_sessions',
        description: 'Ensure execution mode columns and sessions table exist',
        up(db) {
            ensureColumn(db, 'commands', 'working_dir', 'ALTER TABLE commands ADD COLUMN working_dir TEXT');
            ensureColumn(db, 'commands', 'execution_mode', "ALTER TABLE commands ADD COLUMN execution_mode TEXT");
            ensureColumn(db, 'rules', 'execution_mode', "ALTER TABLE rules ADD COLUMN execution_mode TEXT");

            if (!hasTable(db, 'sessions')) {
                db.exec(`
                    CREATE TABLE sessions (
                        id TEXT PRIMARY KEY,
                        token_hash TEXT NOT NULL UNIQUE,
                        identifier TEXT NOT NULL,
                        roles TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        last_seen_at TEXT NOT NULL
                    );
                `);
            }

            ensureIndex(db, 'idx_sessions_expires_at', 'CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)');
        }
    },
    {
        id: '002_redaction_and_pack_metadata',
        description: 'Add encrypted execution storage, redaction metadata, and pack metadata',
        up(db) {
            ensureColumn(db, 'commands', 'exec_command', 'ALTER TABLE commands ADD COLUMN exec_command TEXT');
            ensureColumn(db, 'commands', 'exec_args', 'ALTER TABLE commands ADD COLUMN exec_args TEXT');
            ensureColumn(db, 'commands', 'exec_metadata', 'ALTER TABLE commands ADD COLUMN exec_metadata TEXT');
            ensureColumn(db, 'commands', 'redaction_summary', 'ALTER TABLE commands ADD COLUMN redaction_summary TEXT');
            ensureColumn(db, 'commands', 'redacted', 'ALTER TABLE commands ADD COLUMN redacted INTEGER DEFAULT 0');

            ensureColumn(db, 'audit_log', 'redaction_summary', 'ALTER TABLE audit_log ADD COLUMN redaction_summary TEXT');
            ensureColumn(db, 'audit_log', 'redacted', 'ALTER TABLE audit_log ADD COLUMN redacted INTEGER DEFAULT 0');

            ensureColumn(db, 'rules', 'managed_by_pack', 'ALTER TABLE rules ADD COLUMN managed_by_pack TEXT');
            ensureColumn(db, 'rules', 'managed_by_pack_rule_id', 'ALTER TABLE rules ADD COLUMN managed_by_pack_rule_id TEXT');
            ensureColumn(db, 'rules', 'managed_by_pack_version', 'ALTER TABLE rules ADD COLUMN managed_by_pack_version TEXT');

            ensureIndex(
                db,
                'idx_rules_managed_pack',
                'CREATE INDEX idx_rules_managed_pack ON rules(managed_by_pack, managed_by_pack_rule_id)'
            );
        }
    }
];

function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    `);

    const applied = new Set(
        db.prepare('SELECT id FROM schema_migrations ORDER BY applied_at ASC').all().map(row => row.id)
    );

    for (const migration of MIGRATIONS) {
        if (applied.has(migration.id)) {
            continue;
        }

        const applyMigration = db.transaction(() => {
            migration.up(db);
            db.prepare(`
                INSERT INTO schema_migrations (id, description, applied_at)
                VALUES (?, ?, ?)
            `).run(migration.id, migration.description, new Date().toISOString());
        });

        applyMigration();
    }
}

function hasTable(db, tableName) {
    return Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
    );
}

function hasColumn(db, tableName, columnName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some(column => column.name === columnName);
}

function hasIndex(db, indexName) {
    return Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
    );
}

function ensureColumn(db, tableName, columnName, sql) {
    if (!hasColumn(db, tableName, columnName)) {
        db.exec(sql);
    }
}

function ensureIndex(db, indexName, sql) {
    if (!hasIndex(db, indexName)) {
        db.exec(sql);
    }
}

module.exports = {
    runMigrations
};
