const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const {
    AUTO_APPROVAL_MODE_OFF,
    autoApprovalModeFromStored,
    isAutoApprovalEnabled,
    normalizeAutoApprovalMode
} = require('./auto-approval-modes');
const { parseJson } = require('./record-shaping');
const { createUsersService } = require('./users');

const TOKEN_PREFIX = 'nym_';
const TOKEN_STATUS_ACTIVE = 'active';
const TOKEN_STATUS_BLOCKED = 'blocked';
const TOKEN_SUBJECT_STANDALONE = 'standalone';
const TOKEN_SUBJECT_USER = 'user';

function createTokensService(db) {
    const users = createUsersService(db);
    const statements = {
        insertToken: db.prepare(`
            INSERT INTO managed_tokens (
                id, label, subject_type, user_id, principal_identifier, principal_display_name,
                auto_approval_enabled, auto_approval_mode, token_hash, token_prefix, status, created_by, created_at, last_used_at,
                blocked_at, blocked_by, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        listTokens: db.prepare(`
            SELECT mt.*, lu.username AS user_username, lu.display_name AS user_display_name, lu.enabled AS user_enabled,
                   lu.auto_approval_enabled AS user_auto_approval_enabled,
                   lu.auto_approval_mode AS user_auto_approval_mode
            FROM managed_tokens mt
            LEFT JOIN local_users lu ON lu.id = mt.user_id
            ORDER BY
                CASE mt.status WHEN 'active' THEN 0 ELSE 1 END,
                mt.created_at DESC
        `),
        listTokensByUserId: db.prepare(`
            SELECT mt.*, lu.username AS user_username, lu.display_name AS user_display_name, lu.enabled AS user_enabled,
                   lu.auto_approval_enabled AS user_auto_approval_enabled,
                   lu.auto_approval_mode AS user_auto_approval_mode
            FROM managed_tokens mt
            LEFT JOIN local_users lu ON lu.id = mt.user_id
            WHERE mt.user_id = ?
            ORDER BY
                CASE mt.status WHEN 'active' THEN 0 ELSE 1 END,
                mt.created_at DESC
        `),
        getTokenById: db.prepare(`
            SELECT mt.*, lu.username AS user_username, lu.display_name AS user_display_name, lu.enabled AS user_enabled,
                   lu.auto_approval_enabled AS user_auto_approval_enabled,
                   lu.auto_approval_mode AS user_auto_approval_mode
            FROM managed_tokens mt
            LEFT JOIN local_users lu ON lu.id = mt.user_id
            WHERE mt.id = ?
        `),
        getTokenByHash: db.prepare(`
            SELECT mt.*, lu.username AS user_username, lu.display_name AS user_display_name, lu.enabled AS user_enabled,
                   lu.auto_approval_enabled AS user_auto_approval_enabled,
                   lu.auto_approval_mode AS user_auto_approval_mode
            FROM managed_tokens mt
            LEFT JOIN local_users lu ON lu.id = mt.user_id
            WHERE mt.token_hash = ?
        `),
        blockToken: db.prepare(`
            UPDATE managed_tokens
            SET status = ?, blocked_at = ?, blocked_by = ?, metadata = ?
            WHERE id = ?
        `),
        touchLastUsedAt: db.prepare(`
            UPDATE managed_tokens
            SET last_used_at = ?
            WHERE id = ?
        `),
        updateAutoApprovalMode: db.prepare(`
            UPDATE managed_tokens
            SET auto_approval_enabled = ?, auto_approval_mode = ?, metadata = ?
            WHERE id = ?
        `),
        getStandaloneByIdentifier: db.prepare(`
            SELECT *
            FROM managed_tokens
            WHERE subject_type = ? AND lower(principal_identifier) = lower(?)
        `)
    };

    function createManagedToken(payload, actor) {
        const subjectType = normalizeSubjectType(payload.subjectType || payload.subject_type);
        const label = normalizeLabel(payload.label);
        const now = new Date().toISOString();
        const tokenId = uuidv4();
        const metadata = payload.metadata || {};
        let userId = null;
        let principalIdentifier = null;
        let principalDisplayName = null;
        const autoApprovalMode = normalizeAutoApprovalMode(payload.autoApprovalMode, payload.autoApprovalEnabled ? 'normal' : AUTO_APPROVAL_MODE_OFF);

        if (!label) {
            const error = new Error('Label is required');
            error.code = 'validation_error';
            throw error;
        }

        if (subjectType === TOKEN_SUBJECT_STANDALONE) {
            principalIdentifier = normalizeIdentifier(payload.principalIdentifier || payload.principal_identifier);
            principalDisplayName = normalizeDisplayName(payload.principalDisplayName || payload.principal_display_name || principalIdentifier);

            if (!principalIdentifier) {
                const error = new Error('Principal identifier is required');
                error.code = 'validation_error';
                throw error;
            }

            assertStandaloneIdentifierAvailable(principalIdentifier);
        } else if (subjectType === TOKEN_SUBJECT_USER) {
            userId = String(payload.userId || payload.user_id || '').trim();
            if (!userId) {
                const error = new Error('User is required');
                error.code = 'validation_error';
                throw error;
            }

            const user = users.getUserById(userId);
            if (!user) {
                const error = new Error('User not found');
                error.code = 'not_found';
                throw error;
            }

            principalIdentifier = user.username;
            principalDisplayName = user.displayName || user.username;
        } else {
            const error = new Error('Subject type is invalid');
            error.code = 'validation_error';
            throw error;
        }

        const plainTextToken = generatePlainTextToken();
        const tokenHash = hashManagedToken(plainTextToken);

        statements.insertToken.run(
            tokenId,
            label,
            subjectType,
            userId,
            principalIdentifier,
            principalDisplayName,
            isAutoApprovalEnabled(autoApprovalMode) ? 1 : 0,
            autoApprovalMode,
            tokenHash,
            buildTokenPrefix(plainTextToken),
            TOKEN_STATUS_ACTIVE,
            actor,
            now,
            null,
            null,
            null,
            JSON.stringify(metadata)
        );

        return {
            token: getTokenById(tokenId),
            plainTextToken
        };
    }

    function listTokens(options = {}) {
        const rows = options.userId
            ? statements.listTokensByUserId.all(options.userId)
            : statements.listTokens.all();

        return rows
            .filter(row => !options.subjectType || row.subject_type === options.subjectType)
            .map(shapeManagedToken);
    }

    function getTokenById(tokenId) {
        const row = statements.getTokenById.get(tokenId);
        return row ? shapeManagedToken(row) : null;
    }

    function blockToken(tokenId, actor, options = {}) {
        const current = statements.getTokenById.get(tokenId);
        if (!current) {
            const error = new Error('Token not found');
            error.code = 'not_found';
            throw error;
        }

        if (options.userId && current.user_id !== options.userId) {
            const error = new Error('Token not found');
            error.code = 'not_found';
            throw error;
        }

        if (current.status === TOKEN_STATUS_BLOCKED) {
            const error = new Error('Token is already blocked');
            error.code = 'already_blocked';
            throw error;
        }

        const metadata = {
            ...parseJson(current.metadata, {}),
            blocked: true
        };
        statements.blockToken.run(
            TOKEN_STATUS_BLOCKED,
            new Date().toISOString(),
            actor,
            JSON.stringify(metadata),
            tokenId
        );

        return getTokenById(tokenId);
    }

    function setStandaloneAutoApprovalPreference(tokenId, mode) {
        const current = statements.getTokenById.get(tokenId);
        if (!current) {
            const error = new Error('Token not found');
            error.code = 'not_found';
            throw error;
        }

        if (current.subject_type !== TOKEN_SUBJECT_STANDALONE) {
            const error = new Error('Only standalone tokens can manage auto approval directly');
            error.code = 'validation_error';
            throw error;
        }

        const metadata = {
            ...parseJson(current.metadata, {}),
            autoApprovalScope: 'token'
        };
        const normalizedMode = normalizeAutoApprovalMode(mode);
        statements.updateAutoApprovalMode.run(
            isAutoApprovalEnabled(normalizedMode) ? 1 : 0,
            normalizedMode,
            JSON.stringify(metadata),
            tokenId
        );
        return getTokenById(tokenId);
    }

    function authenticateManagedTokenDetailed(token) {
        const normalized = String(token || '').trim();
        if (!normalized) {
            return { ok: false, error: 'missing' };
        }

        const row = statements.getTokenByHash.get(hashManagedToken(normalized));
        if (!row) {
            return { ok: false, error: 'not_found' };
        }

        if (row.status === TOKEN_STATUS_BLOCKED) {
            return { ok: false, error: 'blocked' };
        }

        if (row.status !== TOKEN_STATUS_ACTIVE) {
            return { ok: false, error: 'invalid_status' };
        }

        if (row.subject_type === TOKEN_SUBJECT_USER) {
            const user = users.getUserRecordById(row.user_id);
            if (!user || !Boolean(user.enabled)) {
                return { ok: false, error: 'user_disabled' };
            }
        }

        statements.touchLastUsedAt.run(new Date().toISOString(), row.id);
        const shaped = shapeManagedToken({
            ...row,
            last_used_at: new Date().toISOString()
        });
        return {
            ok: true,
            token: shaped
        };
    }

    function authenticateManagedToken(token) {
        const result = authenticateManagedTokenDetailed(token);
        return result.ok ? result.token : null;
    }

    function buildPrincipalFromManagedToken(token) {
        if (!token) {
            return null;
        }

        if (token.subjectType === TOKEN_SUBJECT_STANDALONE) {
            return {
                type: 'agent',
                identifier: token.principalIdentifier,
                displayName: token.principalDisplayName || token.principalIdentifier,
                roles: ['agent', 'submitter'],
                approvalCapabilities: {
                    canApproveMedium: false,
                    canApproveHigh: false
                }
            };
        }

        const user = users.getUserById(token.userId);
        if (!user) {
            return null;
        }

        return users.buildUserPrincipal(user.id);
    }

    function assertStandaloneIdentifierAvailable(identifier) {
        const normalized = String(identifier || '').trim();
        if (!normalized) {
            return;
        }

        const localUser = users.getUserByUsername(normalized);
        if (localUser) {
            const error = new Error('Identifier already exists as a local user');
            error.code = 'duplicate_identifier';
            throw error;
        }

        const existingToken = statements.getStandaloneByIdentifier.get(TOKEN_SUBJECT_STANDALONE, normalized);
        if (existingToken) {
            const error = new Error('Identifier already exists as a managed token identity');
            error.code = 'duplicate_identifier';
            throw error;
        }

    }

    return {
        authenticateManagedToken,
        authenticateManagedTokenDetailed,
        blockToken,
        buildPrincipalFromManagedToken,
        createManagedToken,
        getTokenById,
        listTokens,
        setStandaloneAutoApprovalPreference
    };
}

function normalizeSubjectType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if ([TOKEN_SUBJECT_STANDALONE, TOKEN_SUBJECT_USER].includes(normalized)) {
        return normalized;
    }
    return '';
}

function normalizeLabel(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 128) : '';
}

function normalizeIdentifier(value) {
    return String(value || '').trim().slice(0, 128);
}

function normalizeDisplayName(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 128) : null;
}

function generatePlainTextToken() {
    return `${TOKEN_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

function buildTokenPrefix(token) {
    return String(token || '').slice(0, 12);
}

function hashManagedToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function shapeManagedToken(row) {
    const userUsername = row.user_username || null;
    const userDisplayName = row.user_display_name || userUsername;
    const standaloneMode = autoApprovalModeFromStored(row.auto_approval_mode, row.auto_approval_enabled);
    const userMode = autoApprovalModeFromStored(row.user_auto_approval_mode, row.user_auto_approval_enabled);
    return {
        id: row.id,
        label: row.label,
        subjectType: row.subject_type,
        userId: row.user_id || null,
        principalIdentifier: row.subject_type === TOKEN_SUBJECT_USER
            ? (userUsername || row.principal_identifier || null)
            : (row.principal_identifier || null),
        principalDisplayName: row.subject_type === TOKEN_SUBJECT_USER
            ? (userDisplayName || row.principal_display_name || userUsername || null)
            : (row.principal_display_name || row.principal_identifier || null),
        status: row.status,
        tokenPrefix: row.token_prefix,
        autoApprovalEnabled: row.subject_type === TOKEN_SUBJECT_STANDALONE
            ? isAutoApprovalEnabled(standaloneMode)
            : isAutoApprovalEnabled(userMode),
        autoApprovalMode: row.subject_type === TOKEN_SUBJECT_STANDALONE
            ? standaloneMode
            : userMode,
        derivedAutoApprovalEnabled: row.subject_type === TOKEN_SUBJECT_USER
            ? isAutoApprovalEnabled(userMode)
            : null,
        derivedAutoApprovalMode: row.subject_type === TOKEN_SUBJECT_USER
            ? userMode
            : null,
        autoApprovalScope: row.subject_type === TOKEN_SUBJECT_STANDALONE ? 'token' : 'user',
        createdBy: row.created_by,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at || null,
        blockedAt: row.blocked_at || null,
        blockedBy: row.blocked_by || null,
        metadata: parseJson(row.metadata, {}),
        linkedUser: row.subject_type === TOKEN_SUBJECT_USER
            ? {
                id: row.user_id,
                username: userUsername,
                displayName: userDisplayName,
                enabled: Boolean(row.user_enabled)
            }
            : null
    };
}

module.exports = {
    createTokensService
};
