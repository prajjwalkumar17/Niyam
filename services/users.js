const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const { parseJson } = require('./record-shaping');

const PASSWORD_SCHEME = 'scrypt-v1';
const PASSWORD_KEY_LENGTH = 64;
const ALLOWED_ROLES = ['admin'];

function createUsersService(db) {
    const statements = {
        getUserById: db.prepare('SELECT * FROM local_users WHERE id = ?'),
        getUserByUsername: db.prepare('SELECT * FROM local_users WHERE username = ?'),
        listUsers: db.prepare('SELECT * FROM local_users ORDER BY created_at ASC'),
        getUserApprover: db.prepare("SELECT * FROM approvers WHERE type = 'user' AND identifier = ?"),
        getAgentApprover: db.prepare("SELECT * FROM approvers WHERE identifier = ?"),
        insertUser: db.prepare(`
            INSERT INTO local_users (
                id, username, display_name, password_hash, enabled,
                roles, last_login_at, created_at, updated_at, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateUser: db.prepare(`
            UPDATE local_users SET
                display_name = ?,
                enabled = ?,
                roles = ?,
                updated_at = ?,
                metadata = ?
            WHERE id = ?
        `),
        updatePassword: db.prepare(`
            UPDATE local_users SET
                password_hash = ?,
                updated_at = ?
            WHERE id = ?
        `),
        updateLastLoginAt: db.prepare(`
            UPDATE local_users SET
                last_login_at = ?,
                updated_at = ?
            WHERE id = ?
        `),
        insertApprover: db.prepare(`
            INSERT INTO approvers (
                id, name, type, identifier, enabled,
                can_approve_high, can_approve_medium, created_at, metadata
            ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)
        `),
        updateApprover: db.prepare(`
            UPDATE approvers SET
                name = ?,
                enabled = ?,
                can_approve_high = ?,
                can_approve_medium = ?,
                metadata = ?
            WHERE id = ?
        `),
        disableLegacyDashboardUserApprover: db.prepare("DELETE FROM approvers WHERE identifier = 'user'"),
        deleteAllSessions: db.prepare('DELETE FROM sessions')
    };

    function listUsers() {
        const users = statements.listUsers.all();
        const approverMap = loadUserApproverMap(users.map(user => user.username));
        return users.map(user => shapeLocalUser(user, approverMap.get(user.username) || null));
    }

    function getUserById(userId) {
        const user = statements.getUserById.get(userId);
        return user ? shapeLocalUser(user, statements.getUserApprover.get(user.username)) : null;
    }

    function getUserRecordById(userId) {
        return statements.getUserById.get(userId) || null;
    }

    function getUserByUsername(username) {
        const user = statements.getUserByUsername.get(username);
        return user ? shapeLocalUser(user, statements.getUserApprover.get(user.username)) : null;
    }

    function getUserRecordByUsername(username) {
        return statements.getUserByUsername.get(username) || null;
    }

    function createUser(payload) {
        const username = payload.username;
        if (statements.getUserByUsername.get(username)) {
            const error = new Error('Username already exists');
            error.code = 'duplicate_username';
            throw error;
        }

        const now = new Date().toISOString();
        const userId = uuidv4();
        const normalizedRoles = normalizeRoles(payload.roles || []);
        const metadata = payload.metadata || {};

        statements.insertUser.run(
            userId,
            username,
            payload.displayName || null,
            hashPassword(payload.password),
            payload.enabled ? 1 : 0,
            JSON.stringify(normalizedRoles),
            null,
            now,
            now,
            JSON.stringify(metadata)
        );

        const userRow = statements.getUserById.get(userId);
        syncApproverForUser(userRow, payload.approvalCapabilities);
        return getUserById(userId);
    }

    function updateUser(userId, payload) {
        const current = getUserRecordById(userId);
        if (!current) {
            const error = new Error('User not found');
            error.code = 'not_found';
            throw error;
        }

        const currentRoles = parseRoles(current.roles);
        const nextRoles = payload.roles !== undefined ? normalizeRoles(payload.roles) : currentRoles;
        const nextEnabled = payload.enabled !== undefined ? Boolean(payload.enabled) : Boolean(current.enabled);

        assertCanMutateUser(current.id, currentRoles, nextRoles, nextEnabled);

        const now = new Date().toISOString();
        const nextDisplayName = Object.prototype.hasOwnProperty.call(payload, 'displayName')
            ? (payload.displayName || null)
            : current.display_name;
        const nextMetadata = Object.prototype.hasOwnProperty.call(payload, 'metadata')
            ? (payload.metadata || {})
            : parseJson(current.metadata, {});

        statements.updateUser.run(
            nextDisplayName,
            nextEnabled ? 1 : 0,
            JSON.stringify(nextRoles),
            now,
            JSON.stringify(nextMetadata),
            userId
        );

        const nextUser = getUserRecordById(userId);
        syncApproverForUser(nextUser, payload.approvalCapabilities);
        return getUserById(userId);
    }

    function setPassword(userId, password) {
        const current = getUserRecordById(userId);
        if (!current) {
            const error = new Error('User not found');
            error.code = 'not_found';
            throw error;
        }

        const now = new Date().toISOString();
        statements.updatePassword.run(hashPassword(password), now, userId);
        return getUserById(userId);
    }

    function authenticateLocalUser(username, password) {
        const user = getUserRecordByUsername(username);
        if (!user) {
            return { ok: false, error: 'invalid_credentials' };
        }

        if (!Boolean(user.enabled)) {
            return { ok: false, error: 'account_disabled' };
        }

        if (!verifyPassword(password, user.password_hash)) {
            return { ok: false, error: 'invalid_credentials' };
        }

        const now = new Date().toISOString();
        statements.updateLastLoginAt.run(now, now, user.id);
        return { ok: true, user: getUserRecordById(user.id) };
    }

    function buildUserPrincipal(userOrId) {
        const user = typeof userOrId === 'string' ? getUserRecordById(userOrId) : userOrId;
        if (!user || !Boolean(user.enabled)) {
            return null;
        }

        const approver = statements.getUserApprover.get(user.username);
        const approvalCapabilities = shapeApprovalCapabilities(approver);
        const baseRoles = normalizeRoles(parseRoles(user.roles));
        const roles = [...baseRoles];
        if ((approvalCapabilities.canApproveMedium || approvalCapabilities.canApproveHigh) && !roles.includes('approver')) {
            roles.push('approver');
        }

        return {
            type: 'user',
            identifier: user.username,
            displayName: user.display_name || user.username,
            roles,
            approvalCapabilities
        };
    }

    function buildAgentPrincipal(identifier) {
        const approver = statements.getAgentApprover.get(identifier);
        const approvalCapabilities = shapeApprovalCapabilities(approver);
        const roles = ['agent', 'submitter'];
        if ((approvalCapabilities.canApproveMedium || approvalCapabilities.canApproveHigh) && !roles.includes('approver')) {
            roles.push('approver');
        }

        return {
            type: 'agent',
            identifier,
            displayName: identifier,
            roles,
            approvalCapabilities
        };
    }

    function ensureBootstrapAdminUser() {
        const adminUsers = statements.listUsers.all().filter(user => parseRoles(user.roles).includes('admin'));
        if (adminUsers.length === 0) {
            createUser({
                username: config.ADMIN_USERNAME,
                displayName: 'Admin',
                password: config.ADMIN_PASSWORD,
                enabled: true,
                roles: ['admin'],
                approvalCapabilities: {
                    canApproveMedium: true,
                    canApproveHigh: true
                },
                metadata: {
                    bootstrap: true
                }
            });
        } else {
            syncAllLocalUserApprovers();
        }
    }

    function syncAllLocalUserApprovers() {
        statements.disableLegacyDashboardUserApprover.run();
        const users = statements.listUsers.all();
        users.forEach(user => {
            const approver = statements.getUserApprover.get(user.username);
            syncApproverForUser(user, approver ? shapeApprovalCapabilities(approver) : defaultCapabilitiesForUser(user));
        });
    }

    function getApprovalCapabilitiesForIdentifier(identifier) {
        return shapeApprovalCapabilities(statements.getAgentApprover.get(identifier));
    }

    function invalidateAllSessions() {
        statements.deleteAllSessions.run();
    }

    function syncApproverForUser(userRow, approvalCapabilities) {
        if (!userRow) {
            return;
        }

        const currentApprover = statements.getUserApprover.get(userRow.username);
        const nextCapabilities = {
            ...(currentApprover ? shapeApprovalCapabilities(currentApprover) : defaultCapabilitiesForUser(userRow)),
            ...(approvalCapabilities || {})
        };
        const enabled = Boolean(userRow.enabled) ? 1 : 0;
        const now = new Date().toISOString();
        const metadata = JSON.stringify({
            managedBy: 'local_user'
        });
        const displayName = userRow.display_name || userRow.username;

        if (!currentApprover) {
            statements.insertApprover.run(
                uuidv4(),
                displayName,
                userRow.username,
                enabled,
                nextCapabilities.canApproveHigh ? 1 : 0,
                nextCapabilities.canApproveMedium ? 1 : 0,
                now,
                metadata
            );
            return;
        }

        statements.updateApprover.run(
            displayName,
            enabled,
            nextCapabilities.canApproveHigh ? 1 : 0,
            nextCapabilities.canApproveMedium ? 1 : 0,
            metadata,
            currentApprover.id
        );
    }

    function assertCanMutateUser(userId, currentRoles, nextRoles, nextEnabled) {
        const nextIsAdmin = nextRoles.includes('admin') && Boolean(nextEnabled);
        if (!currentRoles.includes('admin')) {
            return;
        }

        if (nextIsAdmin) {
            return;
        }

        const enabledAdmins = statements.listUsers.all().filter(user => {
            if (user.id === userId) {
                return false;
            }
            return Boolean(user.enabled) && parseRoles(user.roles).includes('admin');
        });

        if (enabledAdmins.length === 0) {
            const error = new Error('Cannot disable or demote the last enabled admin');
            error.code = 'last_admin';
            throw error;
        }
    }

    function defaultCapabilitiesForUser(userRow) {
        const roles = parseRoles(userRow.roles);
        if (roles.includes('admin')) {
            return {
                canApproveMedium: true,
                canApproveHigh: true
            };
        }

        return {
            canApproveMedium: false,
            canApproveHigh: false
        };
    }

    function loadUserApproverMap(usernames) {
        if (!Array.isArray(usernames) || usernames.length === 0) {
            return new Map();
        }

        const placeholders = usernames.map(() => '?').join(', ');
        const rows = db.prepare(`
            SELECT *
            FROM approvers
            WHERE type = 'user' AND identifier IN (${placeholders})
        `).all(...usernames);

        return new Map(rows.map(row => [row.identifier, row]));
    }

    return {
        authenticateLocalUser,
        buildAgentPrincipal,
        buildUserPrincipal,
        createUser,
        ensureBootstrapAdminUser,
        getApprovalCapabilitiesForIdentifier,
        getUserById,
        getUserByUsername,
        getUserRecordById,
        invalidateAllSessions,
        listUsers,
        setPassword,
        syncAllLocalUserApprovers,
        updateUser
    };
}

function normalizeRoles(input) {
    return [...new Set(parseRoles(input).filter(role => ALLOWED_ROLES.includes(role)))];
}

function parseRoles(value) {
    if (Array.isArray(value)) {
        return value.map(role => String(role || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        const parsed = parseJson(value, []);
        return Array.isArray(parsed)
            ? parsed.map(role => String(role || '').trim()).filter(Boolean)
            : [];
    }

    return [];
}

function shapeApprovalCapabilities(approverRow) {
    return {
        canApproveMedium: Boolean(approverRow && approverRow.enabled && approverRow.can_approve_medium),
        canApproveHigh: Boolean(approverRow && approverRow.enabled && approverRow.can_approve_high)
    };
}

function shapeLocalUser(userRow, approverRow) {
    return {
        id: userRow.id,
        username: userRow.username,
        displayName: userRow.display_name || userRow.username,
        enabled: Boolean(userRow.enabled),
        roles: normalizeRoles(parseRoles(userRow.roles)),
        approvalCapabilities: shapeApprovalCapabilities(approverRow),
        lastLoginAt: userRow.last_login_at || null,
        createdAt: userRow.created_at,
        updatedAt: userRow.updated_at,
        metadata: parseJson(userRow.metadata, {})
    };
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH);
    return `${PASSWORD_SCHEME}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
    if (typeof storedHash !== 'string') {
        return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== PASSWORD_SCHEME) {
        return false;
    }

    const salt = Buffer.from(parts[1], 'hex');
    const hash = Buffer.from(parts[2], 'hex');
    const derived = crypto.scryptSync(password, salt, hash.length);
    if (derived.length !== hash.length) {
        return false;
    }

    return crypto.timingSafeEqual(hash, derived);
}

module.exports = {
    createUsersService,
    hashPassword,
    normalizeRoles,
    parseRoles,
    verifyPassword
};
