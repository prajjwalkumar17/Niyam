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
    },
    {
        id: '003_cli_dispatches',
        description: 'Add CLI dispatch tracking for interactive shell governance',
        up(db) {
            if (!hasTable(db, 'cli_dispatches')) {
                db.exec(`
                    CREATE TABLE cli_dispatches (
                        id TEXT PRIMARY KEY,
                        command TEXT NOT NULL,
                        requester TEXT NOT NULL,
                        requester_type TEXT DEFAULT 'agent',
                        metadata TEXT,
                        exec_command TEXT,
                        working_dir TEXT,
                        shell TEXT,
                        session_id TEXT,
                        first_token TEXT,
                        first_token_type TEXT,
                        has_shell_syntax INTEGER DEFAULT 0,
                        interactive_hint INTEGER DEFAULT 0,
                        route TEXT NOT NULL,
                        reason TEXT,
                        passthrough_reason TEXT,
                        risk_level TEXT NOT NULL,
                        execution_mode TEXT,
                        status TEXT NOT NULL,
                        command_id TEXT,
                        local_exit_code INTEGER,
                        local_signal TEXT,
                        duration_ms INTEGER,
                        completed_at TEXT,
                        redaction_summary TEXT,
                        redacted INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE SET NULL
                    );
                `);
            }

            ensureIndex(db, 'idx_cli_dispatches_route', 'CREATE INDEX idx_cli_dispatches_route ON cli_dispatches(route)');
            ensureIndex(db, 'idx_cli_dispatches_status', 'CREATE INDEX idx_cli_dispatches_status ON cli_dispatches(status)');
            ensureIndex(db, 'idx_cli_dispatches_requester', 'CREATE INDEX idx_cli_dispatches_requester ON cli_dispatches(requester)');
            ensureIndex(db, 'idx_cli_dispatches_command_id', 'CREATE INDEX idx_cli_dispatches_command_id ON cli_dispatches(command_id)');
            ensureIndex(db, 'idx_cli_dispatches_created_at', 'CREATE INDEX idx_cli_dispatches_created_at ON cli_dispatches(created_at)');
        }
    },
    {
        id: '004_local_users',
        description: 'Add managed local dashboard users and bind sessions to user ids',
        up(db) {
            if (!hasTable(db, 'local_users')) {
                db.exec(`
                    CREATE TABLE local_users (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT,
                        password_hash TEXT NOT NULL,
                        enabled INTEGER DEFAULT 1,
                        roles TEXT NOT NULL,
                        last_login_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        metadata TEXT
                    );
                `);
            }

            ensureColumn(db, 'sessions', 'user_id', 'ALTER TABLE sessions ADD COLUMN user_id TEXT');
            db.exec(`DELETE FROM sessions`);
            db.exec(`DELETE FROM approvers WHERE identifier = 'user'`);

            ensureIndex(db, 'idx_local_users_enabled', 'CREATE INDEX idx_local_users_enabled ON local_users(enabled)');
        }
    },
    {
        id: '005_signup_requests',
        description: 'Add optional self-signup request workflow for team deployments',
        up(db) {
            if (!hasTable(db, 'signup_requests')) {
                db.exec(`
                    CREATE TABLE signup_requests (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL,
                        display_name TEXT,
                        password_hash TEXT NOT NULL,
                        status TEXT NOT NULL,
                        decision_reason TEXT,
                        requested_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        reviewed_at TEXT,
                        reviewed_by TEXT,
                        user_id TEXT,
                        metadata TEXT,
                        FOREIGN KEY (user_id) REFERENCES local_users(id) ON DELETE SET NULL
                    );
                `);
            }

            ensureIndex(db, 'idx_signup_requests_status', 'CREATE INDEX idx_signup_requests_status ON signup_requests(status)');
            ensureIndex(db, 'idx_signup_requests_username', 'CREATE INDEX idx_signup_requests_username ON signup_requests(username)');
            ensureIndex(db, 'idx_signup_requests_requested_at', 'CREATE INDEX idx_signup_requests_requested_at ON signup_requests(requested_at)');
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
