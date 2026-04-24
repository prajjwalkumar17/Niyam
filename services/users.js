const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const {
    AUTO_APPROVAL_MODE_OFF,
    autoApprovalModeFromStored,
    isAutoApprovalEnabled,
    normalizeAutoApprovalMode
} = require('./auto-approval-modes');
const { parseJson } = require('./record-shaping');

const PASSWORD_SCHEME = 'scrypt-v1';
const PASSWORD_KEY_LENGTH = 64;
const ALLOWED_ROLES = ['admin'];
const SIGNUP_STATUSES = ['pending', 'approved', 'rejected'];

function createUsersService(db) {
    const statements = {
        getUserById: db.prepare('SELECT * FROM local_users WHERE id = ?'),
        getUserByUsername: db.prepare('SELECT * FROM local_users WHERE username = ?'),
        listUsers: db.prepare('SELECT * FROM local_users ORDER BY created_at ASC'),
        getUserApprover: db.prepare("SELECT * FROM approvers WHERE type = 'user' AND identifier = ?"),
        getAgentApprover: db.prepare("SELECT * FROM approvers WHERE identifier = ?"),
        insertUser: db.prepare(`
            INSERT INTO local_users (
                id, username, display_name, password_hash, enabled, auto_approval_enabled, auto_approval_mode,
                roles, last_login_at, created_at, updated_at, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        updateAutoApprovalMode: db.prepare(`
            UPDATE local_users SET
                auto_approval_enabled = ?,
                auto_approval_mode = ?,
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
        listSignupRequests: db.prepare(`
            SELECT *
            FROM signup_requests
            ORDER BY
                CASE status
                    WHEN 'pending' THEN 0
                    WHEN 'approved' THEN 1
                    ELSE 2
                END,
                requested_at DESC
        `),
        getSignupRequestById: db.prepare('SELECT * FROM signup_requests WHERE id = ?'),
        getPendingSignupByUsername: db.prepare(`
            SELECT *
            FROM signup_requests
            WHERE username = ? AND status = 'pending'
            ORDER BY requested_at DESC
            LIMIT 1
        `),
        insertSignupRequest: db.prepare(`
            INSERT INTO signup_requests (
                id, username, display_name, password_hash, status,
                decision_reason, requested_at, updated_at, reviewed_at,
                reviewed_by, user_id, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateSignupRequestDecision: db.prepare(`
            UPDATE signup_requests SET
                status = ?,
                decision_reason = ?,
                updated_at = ?,
                reviewed_at = ?,
                reviewed_by = ?,
                user_id = ?,
                metadata = ?
            WHERE id = ?
        `),
        disableLegacyDashboardUserApprover: db.prepare("DELETE FROM approvers WHERE identifier = 'user'"),
        deleteAllSessions: db.prepare('DELETE FROM sessions'),
        deleteSessionsByUserId: db.prepare('DELETE FROM sessions WHERE user_id = ?')
    };

    function createUserRecord(payload) {
        if (statements.getUserByUsername.get(payload.username)) {
            const error = new Error('Username already exists');
            error.code = 'duplicate_username';
            throw error;
        }

        const now = new Date().toISOString();
        const userId = uuidv4();
        const normalizedRoles = normalizeRoles(payload.roles || []);
        const metadata = payload.metadata || {};
        const passwordHash = payload.passwordHash || hashPassword(payload.password);
        const autoApprovalMode = normalizeAutoApprovalMode(payload.autoApprovalMode, payload.autoApprovalEnabled ? 'normal' : AUTO_APPROVAL_MODE_OFF);

        statements.insertUser.run(
            userId,
            payload.username,
            payload.displayName || null,
            passwordHash,
            payload.enabled ? 1 : 0,
            isAutoApprovalEnabled(autoApprovalMode) ? 1 : 0,
            autoApprovalMode,
            JSON.stringify(normalizedRoles),
            null,
            now,
            now,
            JSON.stringify(metadata)
        );

        const userRow = statements.getUserById.get(userId);
        syncApproverForUser(userRow, payload.approvalCapabilities);
        return userRow;
    }

    const txCreateUser = db.transaction((payload) => createUserRecord(payload));

    const txSetPassword = db.transaction((userId, password) => {
        const current = getUserRecordById(userId);
        if (!current) {
            const error = new Error('User not found');
            error.code = 'not_found';
            throw error;
        }

        const now = new Date().toISOString();
        statements.updatePassword.run(hashPassword(password), now, userId);
        statements.deleteSessionsByUserId.run(userId);
        return statements.getUserById.get(userId);
    });

    const txCreateSignupRequest = db.transaction((payload, metadata) => {
        if (statements.getUserByUsername.get(payload.username)) {
            const error = new Error('Username already exists');
            error.code = 'duplicate_username';
            throw error;
        }

        if (statements.getPendingSignupByUsername.get(payload.username)) {
            const error = new Error('A signup request for this username is already pending');
            error.code = 'duplicate_signup_request';
            throw error;
        }

        const now = new Date().toISOString();
        const requestId = uuidv4();
        statements.insertSignupRequest.run(
            requestId,
            payload.username,
            payload.displayName || null,
            hashPassword(payload.password),
            'pending',
            null,
            now,
            now,
            null,
            null,
            null,
            JSON.stringify(metadata || {})
        );

        return statements.getSignupRequestById.get(requestId);
    });

    const txApproveSignupRequest = db.transaction((requestId, actor, payload) => {
        const request = statements.getSignupRequestById.get(requestId);
        if (!request) {
            const error = new Error('Signup request not found');
            error.code = 'not_found';
            throw error;
        }

        if (request.status !== 'pending') {
            const error = new Error(`Signup request is already ${request.status}`);
            error.code = 'signup_request_closed';
            throw error;
        }

        const userRow = createUserRecord({
            username: request.username,
            displayName: Object.prototype.hasOwnProperty.call(payload, 'displayName') ? payload.displayName : request.display_name,
            passwordHash: request.password_hash,
            enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : true,
            roles: payload.roles || [],
            approvalCapabilities: payload.approvalCapabilities || {
                canApproveMedium: false,
                canApproveHigh: false
            },
            metadata: {
                ...(parseJson(request.metadata, {})),
                source: 'signup_request',
                signupRequestId: request.id
            }
        });

        const now = new Date().toISOString();
        const nextMetadata = {
            ...(parseJson(request.metadata, {})),
            approvedUserId: userRow.id
        };
        statements.updateSignupRequestDecision.run(
            'approved',
            null,
            now,
            now,
            actor,
            userRow.id,
            JSON.stringify(nextMetadata),
            request.id
        );

        return {
            request: statements.getSignupRequestById.get(request.id),
            user: userRow
        };
    });

    const txRejectSignupRequest = db.transaction((requestId, actor, rationale) => {
        const request = statements.getSignupRequestById.get(requestId);
        if (!request) {
            const error = new Error('Signup request not found');
            error.code = 'not_found';
            throw error;
        }

        if (request.status !== 'pending') {
            const error = new Error(`Signup request is already ${request.status}`);
            error.code = 'signup_request_closed';
            throw error;
        }

        const now = new Date().toISOString();
        statements.updateSignupRequestDecision.run(
            'rejected',
            rationale || null,
            now,
            now,
            actor,
            null,
            request.metadata || JSON.stringify({}),
            request.id
        );

        return statements.getSignupRequestById.get(request.id);
    });

    function listUsers() {
        const users = statements.listUsers.all();
        const approverMap = loadUserApproverMap(users.map(user => user.username));
        return users.map(user => shapeLocalUser(user, approverMap.get(user.username) || null));
    }

    function listSignupRequests() {
        return statements.listSignupRequests.all().map(shapeSignupRequest);
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

    function getSignupRequestById(requestId) {
        const request = statements.getSignupRequestById.get(requestId);
        return request ? shapeSignupRequest(request) : null;
    }

    function createUser(payload) {
        return getUserById(txCreateUser(payload).id);
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
        return getUserById(txSetPassword(userId, password).id);
    }

    function setAutoApprovalPreference(userId, mode) {
        const current = getUserRecordById(userId);
        if (!current) {
            const error = new Error('User not found');
            error.code = 'not_found';
            throw error;
        }

        const normalizedMode = normalizeAutoApprovalMode(mode);
        statements.updateAutoApprovalMode.run(
            isAutoApprovalEnabled(normalizedMode) ? 1 : 0,
            normalizedMode,
            new Date().toISOString(),
            userId
        );
        return getUserById(userId);
    }

    function changeOwnPassword(userId, currentPassword, nextPassword) {
        const current = getUserRecordById(userId);
        if (!current) {
            const error = new Error('User not found');
            error.code = 'not_found';
            throw error;
        }

        if (!verifyPassword(currentPassword, current.password_hash)) {
            const error = new Error('Current password is incorrect');
            error.code = 'invalid_credentials';
            throw error;
        }

        return getUserById(txSetPassword(userId, nextPassword).id);
    }

    function createSignupRequest(payload, metadata = {}) {
        return shapeSignupRequest(txCreateSignupRequest(payload, metadata));
    }

    function approveSignupRequest(requestId, actor, payload = {}) {
        const result = txApproveSignupRequest(requestId, actor, payload);
        return {
            request: shapeSignupRequest(result.request),
            user: getUserById(result.user.id)
        };
    }

    function rejectSignupRequest(requestId, actor, rationale) {
        return shapeSignupRequest(txRejectSignupRequest(requestId, actor, rationale));
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
            userId: user.id,
            identifier: user.username,
            displayName: user.display_name || user.username,
            roles,
            approvalCapabilities,
            autoApprovalEnabled: isAutoApprovalEnabled(autoApprovalModeFromStored(user.auto_approval_mode, user.auto_approval_enabled)),
            autoApprovalMode: autoApprovalModeFromStored(user.auto_approval_mode, user.auto_approval_enabled)
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
                autoApprovalMode: AUTO_APPROVAL_MODE_OFF,
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
        approveSignupRequest,
        buildAgentPrincipal,
        buildUserPrincipal,
        changeOwnPassword,
        createSignupRequest,
        createUser,
        ensureBootstrapAdminUser,
        getApprovalCapabilitiesForIdentifier,
        getSignupRequestById,
        getUserById,
        getUserByUsername,
        getUserRecordById,
        invalidateAllSessions,
        listSignupRequests,
        listUsers,
        rejectSignupRequest,
        setAutoApprovalPreference,
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
        autoApprovalEnabled: isAutoApprovalEnabled(autoApprovalModeFromStored(userRow.auto_approval_mode, userRow.auto_approval_enabled)),
        autoApprovalMode: autoApprovalModeFromStored(userRow.auto_approval_mode, userRow.auto_approval_enabled),
        roles: normalizeRoles(parseRoles(userRow.roles)),
        approvalCapabilities: shapeApprovalCapabilities(approverRow),
        lastLoginAt: userRow.last_login_at || null,
        createdAt: userRow.created_at,
        updatedAt: userRow.updated_at,
        metadata: parseJson(userRow.metadata, {})
    };
}

function shapeSignupRequest(requestRow) {
    const status = SIGNUP_STATUSES.includes(requestRow.status) ? requestRow.status : 'pending';
    return {
        id: requestRow.id,
        username: requestRow.username,
        displayName: requestRow.display_name || requestRow.username,
        status,
        decisionReason: requestRow.decision_reason || null,
        requestedAt: requestRow.requested_at,
        updatedAt: requestRow.updated_at,
        reviewedAt: requestRow.reviewed_at || null,
        reviewedBy: requestRow.reviewed_by || null,
        userId: requestRow.user_id || null,
        metadata: parseJson(requestRow.metadata, {})
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
