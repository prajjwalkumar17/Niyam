/**
 * Database initialization and seed data for Niyam
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const { runMigrations } = require('./migrations');
const { ensureProductModeLock } = require('./runtime-settings');
const { createUsersService } = require('../services/users');
const { installPack } = require('../policy/packs');

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
    seedLocalUsers(db);
    seedApprovers(db);
    ensureProductModeLock(db);
    
    db.close();
    console.log('Database initialization complete');
    console.log(`Database location: ${DB_PATH}`);
}

function seedRules(db) {
    const result = installPack(db, 'default', 'install_if_missing', { adoptExisting: true });
    console.log(
        `Seeded default rule pack: ${result.inserted.length} inserted, ${result.adopted.length} adopted, ${result.skipped.length} already installed`
    );
}

function seedApprovers(db) {
    const now = new Date().toISOString();
    const usersService = createUsersService(db);
    
    const defaultApprovers = [
        {
            id: uuidv4(),
            name: 'Niyam Auto Approver',
            type: 'agent',
            identifier: 'niyam-auto-approver',
            can_approve_high: 1,
            can_approve_medium: 1,
            metadata: JSON.stringify({
                managedBy: 'system',
                purpose: 'auto_approval'
            })
        }
    ];
    
    const existingIdentifiers = new Set(db.prepare('SELECT identifier FROM approvers').all().map(approver => approver.identifier));
    const insertApprover = db.prepare(`
        INSERT INTO approvers (id, name, type, identifier, enabled, can_approve_high, can_approve_medium, created_at, metadata)
        VALUES (@id, @name, @type, @identifier, 1, @can_approve_high, @can_approve_medium, ?, @metadata)
    `);
    
    for (const approver of defaultApprovers) {
        if (existingIdentifiers.has(approver.identifier)) {
            continue;
        }
        insertApprover.run({
            ...approver,
            metadata: approver.metadata || null
        }, now);
    }
    
    console.log(`Seeded ${defaultApprovers.length} default approvers`);
    usersService.syncAllLocalUserApprovers();
}

function seedLocalUsers(db) {
    const usersService = createUsersService(db);
    usersService.ensureBootstrapAdminUser();
}

// Run if called directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase, DB_PATH };
