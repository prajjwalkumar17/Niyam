/**
 * Niyam - CLI Command Governance System
 * Main server with Express + WebSocket
 */

const express = require('express');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const { initializeDatabase, DB_PATH } = require('./db/init');
const { createCommandsRouter } = require('./api/commands');
const { createApprovalsRouter } = require('./api/approvals');
const { createRulesRouter } = require('./api/rules');
const { createAuditRouter } = require('./api/audit');
const { broadcastManager, broadcast } = require('./ws/broadcast');
const ExecutionGuard = require('./executor/guard');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
initializeDatabase();

// Open database connection
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for agent access
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Name');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Initialize WebSocket
broadcastManager.init(server);

// Initialize execution guard
const guard = new ExecutionGuard(db, broadcast);

// API Routes
app.use('/api/commands', createCommandsRouter(db, broadcast));
app.use('/api/approvals', createApprovalsRouter(db, broadcast));
app.use('/api/rules', createRulesRouter(db, broadcast));
app.use('/api/audit', createAuditRouter(db));

// Command execution endpoint
app.post('/api/execute/:commandId', async (req, res) => {
    try {
        const result = await guard.execute(req.params.commandId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    const stats = {
        status: 'ok',
        uptime: process.uptime(),
        websocketClients: broadcastManager.getConnectedCount(),
        timestamp: new Date().toISOString()
    };
    res.json(stats);
});

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

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    broadcastManager.close();
    db.close();
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    broadcastManager.close();
    db.close();
    server.close();
    process.exit(0);
});

// Start server
server.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║   Niyam - Command Governance System      ║`);
    console.log(`║   Dashboard: http://localhost:${PORT}        ║`);
    console.log(`║   API:        http://localhost:${PORT}/api   ║`);
    console.log(`║   WebSocket:  ws://localhost:${PORT}/ws      ║`);
    console.log(`╚══════════════════════════════════════════╝`);
});

module.exports = { app, server, db };
