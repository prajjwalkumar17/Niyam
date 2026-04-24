const crypto = require('crypto');

const { config } = require('../config');
const {
    validateLoginBody,
    validatePasswordChangePayload,
    validationError
} = require('../api/validation');
const { createApprovalPreferencesService } = require('../services/approval-preferences');
const { logAudit } = require('../services/audit-log');
const { buildAuthenticationContext } = require('../services/auth-context');
const { createTokensService } = require('../services/tokens');
const { createUsersService } = require('../services/users');

function parseMetadata(value) {
    if (!value) {
        return {};
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function isBootstrapAdminUser(user) {
    if (!user) {
        return false;
    }

    const metadata = parseMetadata(user.metadata);
    return user.username === config.ADMIN_USERNAME && Boolean(metadata.bootstrap);
}

function parseCookies(cookieHeader) {
    return String(cookieHeader || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separatorIndex = part.indexOf('=');
            if (separatorIndex === -1) {
                return cookies;
            }

            const key = part.slice(0, separatorIndex).trim();
            const value = decodeURIComponent(part.slice(separatorIndex + 1));
            cookies[key] = value;
            return cookies;
        }, {});
}

function serializeCookie(name, value, options = {}) {
    const segments = [`${name}=${encodeURIComponent(value)}`];

    if (options.httpOnly) segments.push('HttpOnly');
    if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
    if (options.path) segments.push(`Path=${options.path}`);
    if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
    if (options.secure) segments.push('Secure');

    return segments.join('; ');
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function createAuth(db) {
    const usersService = createUsersService(db);
    const tokensService = createTokensService(db);
    const approvalPreferences = createApprovalPreferencesService(db);
    const insertSession = db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, identifier, roles, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findSession = db.prepare(`
        SELECT user_id, identifier, roles, expires_at
        FROM sessions
        WHERE token_hash = ?
    `);
    const touchSession = db.prepare(`
        UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?
    `);
    const deleteSession = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
    const deleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);

    function createSession(user) {
        const rawToken = crypto.randomBytes(24).toString('hex');
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + config.SESSION_TTL_MS).toISOString();
        const principal = usersService.buildUserPrincipal(user);
        insertSession.run(
            crypto.randomUUID(),
            user.id,
            hashSessionToken(rawToken),
            principal.identifier,
            JSON.stringify(principal.roles || []),
            now,
            expiresAt,
            now
        );
        return rawToken;
    }

    function getSessionAuthentication(sessionToken) {
        if (!sessionToken) {
            return null;
        }

        const tokenHash = hashSessionToken(sessionToken);
        const session = findSession.get(tokenHash);
        if (!session) {
            return null;
        }

        if (new Date(session.expires_at).getTime() <= Date.now()) {
            deleteSession.run(tokenHash);
            return null;
        }

        if (!session.user_id) {
            deleteSession.run(tokenHash);
            return null;
        }

        const user = usersService.getUserRecordById(session.user_id);
        if (!user || !Boolean(user.enabled)) {
            deleteSession.run(tokenHash);
            return null;
        }

        if (config.PRODUCT_MODE === 'individual' && !isBootstrapAdminUser(user)) {
            deleteSession.run(tokenHash);
            return null;
        }

        touchSession.run(new Date().toISOString(), tokenHash);
        return {
            principal: usersService.buildUserPrincipal(user),
            authentication: {
                mode: 'session',
                credentialId: null,
                credentialLabel: null,
                subjectType: 'user'
            }
        };
    }

    function getManagedTokenAuthentication(authorizationHeader) {
        const token = String(authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
        if (!token) {
            return null;
        }

        const authenticated = tokensService.authenticateManagedTokenDetailed(token);
        if (!authenticated.ok) {
            if (authenticated.error === 'blocked') {
                return {
                    principal: null,
                    authentication: null,
                    errorMessage: 'Managed token is blocked. Create a new token from the dashboard.'
                };
            }
            return null;
        }
        const managedToken = authenticated.token;

        if (config.PRODUCT_MODE === 'individual' && managedToken.subjectType !== 'standalone') {
            return null;
        }

        return {
            principal: tokensService.buildPrincipalFromManagedToken(managedToken),
            authentication: {
                mode: 'managed_token',
                credentialId: managedToken.id,
                credentialLabel: managedToken.label,
                subjectType: managedToken.subjectType
            }
        };
    }

    function authenticateRequestHeaders(headers) {
        const managedToken = getManagedTokenAuthentication(headers.authorization);
        if (managedToken && (managedToken.principal || managedToken.errorMessage)) {
            return managedToken;
        }

        const cookies = parseCookies(headers.cookie);
        return getSessionAuthentication(cookies[config.SESSION_COOKIE_NAME]);
    }

    function authMiddleware(req, _res, next) {
        const authenticated = authenticateRequestHeaders(req.headers);
        req.principal = authenticated ? authenticated.principal : null;
        req.authentication = authenticated ? buildAuthenticationContext(authenticated.authentication) : null;
        req.authFailureMessage = authenticated ? authenticated.errorMessage || null : null;
        req.actor = req.principal ? req.principal.identifier : 'anonymous';
        next();
    }

    function requireAuth(req, res, next) {
        if (!req.principal) {
            return res.status(401).json({ error: req.authFailureMessage || 'Authentication required' });
        }

        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.principal) {
            return res.status(401).json({ error: req.authFailureMessage || 'Authentication required' });
        }

        if (!req.authentication || req.authentication.mode !== 'session') {
            return res.status(403).json({ error: 'Admin session required' });
        }

        if (!req.principal.roles.includes('admin')) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        next();
    }

    function requireUserSession(req, res, next) {
        if (!req.principal) {
            return res.status(401).json({ error: req.authFailureMessage || 'Authentication required' });
        }

        if (!req.authentication || req.authentication.mode !== 'session' || req.principal.type !== 'user') {
            return res.status(403).json({ error: 'Local user session required' });
        }

        next();
    }

    function clearSession(res) {
        res.setHeader('Set-Cookie', serializeCookie(config.SESSION_COOKIE_NAME, '', {
            httpOnly: true,
            maxAge: 0,
            path: '/',
            sameSite: 'Strict',
            secure: config.IS_PRODUCTION
        }));
    }

    function issueSession(res, user) {
        const token = createSession(user);
        res.setHeader('Set-Cookie', serializeCookie(config.SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            maxAge: Math.floor(config.SESSION_TTL_MS / 1000),
            path: '/',
            sameSite: 'Strict',
            secure: config.IS_PRODUCTION
        }));
    }

    function createAuthRouter() {
        const router = require('express').Router();

        router.get('/config', (_req, res) => {
            res.json({
                allowSelfSignup: config.ENABLE_SELF_SIGNUP,
                productMode: config.PRODUCT_MODE,
                profile: config.PROFILE
            });
        });

        router.post('/login', (req, res) => {
            const validation = validateLoginBody(req.body);
            if (!validation.valid) {
                return validationError(res, validation.errors);
            }
            const { username, password } = validation.value;

            const authenticated = usersService.authenticateLocalUser(username, password);
            if (!authenticated.ok) {
                const statusCode = authenticated.error === 'account_disabled' ? 403 : 401;
                const message = authenticated.error === 'account_disabled'
                    ? 'Account disabled'
                    : 'Invalid credentials';
                return res.status(statusCode).json({ error: message });
            }

            if (config.PRODUCT_MODE === 'individual' && !isBootstrapAdminUser(authenticated.user)) {
                return res.status(403).json({ error: 'Local user login is unavailable in individual mode' });
            }

            issueSession(res, authenticated.user);
            const principal = usersService.buildUserPrincipal(authenticated.user);
            res.json({
                authenticated: true,
                principal,
                authentication: {
                    mode: 'session',
                    credentialId: null,
                    credentialLabel: null,
                    subjectType: 'user'
                },
                approvalPreferences: approvalPreferences.resolveAutoApprovalPreference({
                    principal,
                    authentication: {
                        mode: 'session',
                        subjectType: 'user'
                    }
                })
            });
        });

        router.post('/change-password', requireUserSession, (req, res) => {
            const validation = validatePasswordChangePayload(req.body);
            if (!validation.valid) {
                return validationError(res, validation.errors);
            }

            try {
                const currentUser = usersService.getUserByUsername(req.principal.identifier);
                if (!currentUser) {
                    return res.status(404).json({ error: 'User not found' });
                }

                const user = usersService.changeOwnPassword(
                    currentUser.id,
                    validation.value.currentPassword,
                    validation.value.newPassword
                );
                issueSession(res, usersService.getUserRecordById(user.id));
                logAudit(db, 'password_changed', 'user', user.id, req.actor, {
                    username: user.username
                });
                return res.json({
                    passwordChanged: true,
                    principal: usersService.buildUserPrincipal(user.id)
                });
            } catch (error) {
                if (error.code === 'invalid_credentials') {
                    return res.status(401).json({ error: error.message });
                }
                if (error.code === 'not_found') {
                    return res.status(404).json({ error: error.message });
                }
                throw error;
            }
        });

        router.post('/logout', (req, res) => {
            const cookies = parseCookies(req.headers.cookie);
            const sessionToken = cookies[config.SESSION_COOKIE_NAME];
            if (sessionToken) {
                deleteSession.run(hashSessionToken(sessionToken));
            }

            clearSession(res);
            res.json({ authenticated: false });
        });

        router.get('/me', (req, res) => {
            if (!req.principal) {
                return res.status(401).json({ error: req.authFailureMessage || 'Authentication required' });
            }

            res.json({
                authenticated: true,
                principal: req.principal,
                authentication: req.authentication,
                approvalPreferences: approvalPreferences.resolveAutoApprovalPreference({
                    principal: req.principal,
                    authentication: req.authentication
                })
            });
        });

        return router;
    }

    function cleanupExpiredSessions() {
        return deleteExpiredSessions.run(new Date().toISOString()).changes;
    }

    return {
        authMiddleware,
        authenticateWebSocketRequest: (req) => authenticateRequestHeaders(req.headers),
        cleanupExpiredSessions,
        createAuthRouter,
        requireAdmin,
        requireAuth,
        requireUserSession
    };
}

module.exports = {
    createAuth
};
