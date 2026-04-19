/**
 * Niyam - CLI Command Governance System
 * Main server with Express + WebSocket
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { config, validateConfig } = require('./config');
const { initializeDatabase } = require('./db/init');
const { createAuth } = require('./auth');
const { createCommandsRouter } = require('./api/commands');
const { createApprovalsRouter } = require('./api/approvals');
const { createRulesRouter } = require('./api/rules');
const { createRulePacksRouter } = require('./api/rule-packs');
const { createPolicyRouter } = require('./api/policy');
const { createAuditRouter } = require('./api/audit');
const { createCliRouter } = require('./api/cli');
const { broadcastManager, broadcast } = require('./ws/broadcast');
const ExecutionGuard = require('./executor/guard');
const { createRequestLogger, logger, metrics } = require('./observability');

validateConfig();

// Ensure data directory exists
if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

// Initialize database
initializeDatabase();

// Open database connection
const db = new Database(config.DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Create Express app
const app = express();
const server = http.createServer(app);
const auth = createAuth(db);

// Middleware
app.use(createRequestLogger(metrics));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

// Minimal CORS support for explicitly allowed browser origins.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Initialize WebSocket
broadcastManager.init(server, {
    authenticate: auth.authenticateWebSocketRequest
});

// Initialize execution guard
const guard = new ExecutionGuard(db, broadcast);
const queueExecution = (commandId) => {
    setImmediate(async () => {
        try {
            await guard.execute(commandId);
        } catch (error) {
            logger.error('command_auto_execute_failed', {
                commandId,
                error: error.message
            });
        }
    });
};

// Public API routes
app.use('/api', auth.authMiddleware);
app.use('/api/auth', auth.createAuthRouter());

app.get('/api/metrics', auth.authMiddleware, (req, res) => {
    if (config.METRICS_TOKEN) {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (token !== config.METRICS_TOKEN) {
            return res.status(401).send('Unauthorized');
        }
    } else if (!req.principal || !req.principal.roles.includes('admin')) {
        return res.status(403).send('Forbidden');
    }

    metrics.setGauge('niyam_process_uptime_seconds', {}, Math.floor(process.uptime()), 'Process uptime in seconds');
    metrics.setGauge('niyam_websocket_clients', {}, broadcastManager.getConnectedCount(), 'Connected websocket clients');
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.renderPrometheus());
});

// Command execution endpoint
app.post('/api/execute/:commandId', auth.requireAdmin, async (req, res) => {
    try {
        const result = await guard.execute(req.params.commandId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/commands/:commandId/kill', auth.requireAdmin, (req, res) => {
    const result = guard.kill(req.params.commandId, req.actor);
    if (!result.success) {
        return res.status(400).json({ error: result.reason });
    }

    res.json(result);
});

// Health check
app.get('/api/health', (req, res) => {
    const stats = {
        status: 'ok',
        uptime: process.uptime(),
        websocketClients: broadcastManager.getConnectedCount(),
        env: config.NODE_ENV,
        timestamp: new Date().toISOString()
    };
    res.json(stats);
});

// Authenticated API routes
app.use('/api/commands', auth.requireAuth, createCommandsRouter(db, broadcast, { onApproved: queueExecution }));
app.use('/api/approvals', auth.requireAuth, createApprovalsRouter(db, broadcast, { onApproved: queueExecution }));
app.use('/api/policy', auth.requireAuth, createPolicyRouter(db));
app.use('/api/cli', auth.requireAuth, createCliRouter(db, broadcast, auth, { onApproved: queueExecution }));
app.use('/api/rules', auth.requireAdmin, createRulesRouter(db, broadcast));
app.use('/api/rule-packs', auth.requireAdmin, createRulePacksRouter(db));
app.use('/api/audit', auth.requireAdmin, createAuditRouter(db));

// Serve static dashboard
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Timeout checker - runs every 60 seconds
setInterval(() => {
    const guardRunner = require('./executor/runner');
    const runner = new guardRunner(db, broadcast);
    runner.checkTimeouts();
}, 60000);

setInterval(() => {
    const deletedSessions = auth.cleanupExpiredSessions();
    if (deletedSessions > 0) {
        logger.info('session_cleanup', { deletedSessions });
    }
}, config.SESSION_CLEANUP_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('server_shutdown', { signal: 'SIGTERM' });
    broadcastManager.close();
    db.close();
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('server_shutdown', { signal: 'SIGINT' });
    broadcastManager.close();
    db.close();
    server.close();
    process.exit(0);
});

// Start server
server.listen(config.PORT, () => {
    logger.info('server_started', {
        port: config.PORT,
        env: config.NODE_ENV,
        dataDir: config.DATA_DIR
    });
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║   Niyam - Command Governance System      ║`);
    console.log(`║   Dashboard: http://localhost:${config.PORT}        ║`);
    console.log(`║   API:        http://localhost:${config.PORT}/api   ║`);
    console.log(`║   WebSocket:  ws://localhost:${config.PORT}/ws      ║`);
    console.log(`╚══════════════════════════════════════════╝`);
});

module.exports = { app, server, db };
