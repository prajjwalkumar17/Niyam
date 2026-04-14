const crypto = require('crypto');

const { config } = require('../config');
const { validateLoginBody, validationError } = require('../api/validation');

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

function buildPrincipal(type, identifier, roles) {
    return { type, identifier, roles };
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function createAuth(db) {
    const insertSession = db.prepare(`
        INSERT INTO sessions (id, token_hash, identifier, roles, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const findSession = db.prepare(`
        SELECT identifier, roles, expires_at
        FROM sessions
        WHERE token_hash = ?
    `);
    const touchSession = db.prepare(`
        UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?
    `);
    const deleteSession = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
    const deleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);

    function createSession(identifier) {
        const rawToken = crypto.randomBytes(24).toString('hex');
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + config.SESSION_TTL_MS).toISOString();
        insertSession.run(
            crypto.randomUUID(),
            hashSessionToken(rawToken),
            identifier,
            JSON.stringify(['admin', 'approver']),
            now,
            expiresAt,
            now
        );
        return rawToken;
    }

    function getSessionPrincipal(sessionToken) {
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

        touchSession.run(new Date().toISOString(), tokenHash);
        return buildPrincipal('user', session.identifier, JSON.parse(session.roles || '[]'));
    }

    function getAgentPrincipal(authorizationHeader) {
        const token = String(authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
        if (!token) {
            return null;
        }

        const match = Object.entries(config.AGENT_TOKENS).find(([, value]) => value === token);
        if (!match) {
            return null;
        }

        return buildPrincipal('agent', match[0], ['agent', 'submitter']);
    }

    function authenticateRequestHeaders(headers) {
        const agentPrincipal = getAgentPrincipal(headers.authorization);
        if (agentPrincipal) {
            return agentPrincipal;
        }

        const cookies = parseCookies(headers.cookie);
        return getSessionPrincipal(cookies[config.SESSION_COOKIE_NAME]);
    }

    function authMiddleware(req, _res, next) {
        req.principal = authenticateRequestHeaders(req.headers);
        req.actor = req.principal ? req.principal.identifier : 'anonymous';
        next();
    }

    function requireAuth(req, res, next) {
        if (!req.principal) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.principal) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!req.principal.roles.includes('admin')) {
            return res.status(403).json({ error: 'Admin access required' });
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

    function issueSession(res, identifier) {
        const token = createSession(identifier);
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

        router.post('/login', (req, res) => {
            const validation = validateLoginBody(req.body);
            if (!validation.valid) {
                return validationError(res, validation.errors);
            }
            const { username, password } = validation.value;

            if (username !== config.ADMIN_USERNAME || password !== config.ADMIN_PASSWORD) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            issueSession(res, config.ADMIN_IDENTIFIER);
            res.json({
                authenticated: true,
                principal: buildPrincipal('user', config.ADMIN_IDENTIFIER, ['admin', 'approver'])
            });
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
                return res.status(401).json({ error: 'Authentication required' });
            }

            res.json({
                authenticated: true,
                principal: req.principal
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
        requireAuth
    };
}

module.exports = {
    createAuth
};
