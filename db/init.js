/**
 * Database initialization and seed data for Niyam
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const { runMigrations } = require('./migrations');

const DB_PATH = config.DB_PATH;
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function initializeDatabase() {
    const db = new Database(DB_PATH);
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Read and execute schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    runMigrations(db);
    
    console.log('Database schema initialized');
    
    // Seed initial data
    seedRules(db);
    seedApprovers(db);
    
    db.close();
    console.log('Database initialization complete');
    console.log(`Database location: ${DB_PATH}`);
}

function seedRules(db) {
    const now = new Date().toISOString();
    
    const defaultRules = [
        // High-risk patterns
        {
            id: uuidv4(),
            name: 'Force Push Detection',
            description: 'Detect force push operations',
            rule_type: 'pattern',
            pattern: 'push\\s+.*--force',
            risk_level: 'HIGH',
            priority: 100
        },
        {
            id: uuidv4(),
            name: 'PR Merge Detection',
            description: 'Detect PR merge operations',
            rule_type: 'pattern',
            pattern: 'pr\\s+merge',
            risk_level: 'HIGH',
            priority: 100
        },
        {
            id: uuidv4(),
            name: 'Branch Delete Detection',
            description: 'Detect branch deletion operations',
            rule_type: 'pattern',
            pattern: 'branch\\s+delete|branch\\s+-D|branch\\s+-d\\s+',
            risk_level: 'HIGH',
            priority: 100
        },
        {
            id: uuidv4(),
            name: 'Repo Delete Detection',
            description: 'Detect repository deletion',
            rule_type: 'pattern',
            pattern: 'repo\\s+delete|repo\\s+remove',
            risk_level: 'HIGH',
            priority: 100
        },
        {
            id: uuidv4(),
            name: 'Workflow Run Detection',
            description: 'Detect workflow execution',
            rule_type: 'pattern',
            pattern: 'workflow\\s+run|workflow\\s+dispatch',
            risk_level: 'HIGH',
            priority: 100
        },
        {
            id: uuidv4(),
            name: 'Secret Set Detection',
            description: 'Detect secret setting operations',
            rule_type: 'pattern',
            pattern: 'secret\\s+set|secrets\\s+set',
            risk_level: 'HIGH',
            priority: 100
        },
        // Medium-risk patterns
        {
            id: uuidv4(),
            name: 'PR Create Detection',
            description: 'Detect PR creation',
            rule_type: 'pattern',
            pattern: 'pr\\s+create',
            risk_level: 'MEDIUM',
            priority: 90
        },
        {
            id: uuidv4(),
            name: 'Issue Close Detection',
            description: 'Detect issue closure',
            rule_type: 'pattern',
            pattern: 'issue\\s+close',
            risk_level: 'MEDIUM',
            priority: 90
        },
        {
            id: uuidv4(),
            name: 'Branch Create Detection',
            description: 'Detect branch creation',
            rule_type: 'pattern',
            pattern: 'branch\\s+create',
            risk_level: 'MEDIUM',
            priority: 90
        },
        {
            id: uuidv4(),
            name: 'Repo Edit Detection',
            description: 'Detect repository editing',
            rule_type: 'pattern',
            pattern: 'repo\\s+edit',
            risk_level: 'MEDIUM',
            priority: 90
        },
        // Low-risk patterns (read operations)
        {
            id: uuidv4(),
            name: 'View Operations',
            description: 'Read-only view operations',
            rule_type: 'pattern',
            pattern: '(pr|issue|repo|branch|workflow)\\s+(view|list)',
            risk_level: 'LOW',
            priority: 80
        },
        {
            id: uuidv4(),
            name: 'Sample Wrapper Rule',
            description: 'Example execution_mode rule. Disabled by default; enable and adapt the pattern to force wrapper mode for matched commands.',
            rule_type: 'execution_mode',
            pattern: 'rm\\s+-rf',
            execution_mode: 'WRAPPER',
            enabled: 0,
            priority: 110
        }
    ];
    
    const existingNames = new Set(db.prepare('SELECT name FROM rules').all().map(rule => rule.name));
    const insertRule = db.prepare(`
        INSERT INTO rules (id, name, description, rule_type, pattern, risk_level, execution_mode, enabled, priority, created_at, updated_at)
        VALUES (@id, @name, @description, @rule_type, @pattern, @risk_level, @execution_mode, @enabled, @priority, ?, ?)
    `);
    
    for (const rule of defaultRules) {
        if (existingNames.has(rule.name)) {
            continue;
        }
        if (rule.enabled === undefined) {
            rule.enabled = 1;
        }
        if (!('risk_level' in rule)) {
            rule.risk_level = null;
        }
        if (!('execution_mode' in rule)) {
            rule.execution_mode = null;
        }
        insertRule.run(rule, now, now);
    }
    
    console.log(`Seeded ${defaultRules.length} default rules`);
}

function seedApprovers(db) {
    const now = new Date().toISOString();
    
    const defaultApprovers = [
        {
            id: uuidv4(),
            name: 'Default Agent',
            type: 'agent',
            identifier: Object.keys(config.AGENT_TOKENS)[0] || 'forger',
            can_approve_high: 1,
            can_approve_medium: 1
        },
        {
            id: uuidv4(),
            name: 'Dashboard Admin',
            type: 'role',
            identifier: config.ADMIN_IDENTIFIER,
            can_approve_high: 1,
            can_approve_medium: 1
        },
        {
            id: uuidv4(),
            name: 'Dashboard User',
            type: 'role',
            identifier: 'user',
            can_approve_high: 0,
            can_approve_medium: 1
        }
    ];
    
    const existingIdentifiers = new Set(db.prepare('SELECT identifier FROM approvers').all().map(approver => approver.identifier));
    const insertApprover = db.prepare(`
        INSERT INTO approvers (id, name, type, identifier, enabled, can_approve_high, can_approve_medium, created_at)
        VALUES (@id, @name, @type, @identifier, 1, @can_approve_high, @can_approve_medium, ?)
    `);
    
    for (const approver of defaultApprovers) {
        if (existingIdentifiers.has(approver.identifier)) {
            continue;
        }
        insertApprover.run(approver, now);
    }
    
    console.log(`Seeded ${defaultApprovers.length} default approvers`);
}

// Run if called directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase, DB_PATH };
