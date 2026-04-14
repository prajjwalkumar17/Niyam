/**
 * Command API - Submission, status, and history endpoints
 */

const { v4: uuidv4 } = require('uuid');
const PolicyEngine = require('../policy/engine');
const { calculateTimeout } = require('../policy/risk-classifier');
const { logger, maybeAlertForAuditEvent, metrics } = require('../observability');
function createCommandsRouter(db, broadcast, hooks = {}) {
    const router = require('express').Router();
    const policyEngine = new PolicyEngine(db);

    // Submit a new command for governance
    router.post('/', (req, res) => {
        const { command, args, metadata, timeoutHours, workingDir } = req.body;
        
        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        const requester = req.principal.identifier;
        const requesterType = req.principal.type;
        
        const now = new Date().toISOString();
        
        // Evaluate command against policy
        const evaluation = policyEngine.evaluate(command, args);
        
        if (!evaluation.allowed) {
            // Log the blocked command
            logAudit(db, 'command_blocked', 'command', null, requester, {
                command, args, reason: evaluation.reason
            });
            
            return res.status(403).json({
                error: 'Command blocked by policy',
                reason: evaluation.reason,
                riskLevel: evaluation.riskLevel
            });
        }
        
        const commandId = uuidv4();
        const timeoutAt = calculateTimeout(evaluation.riskLevel, timeoutHours);
        
        // Determine initial status
        let status = 'pending';
        if (evaluation.autoApproved) {
            status = 'approved';
        }
        
        const stmt = db.prepare(`
            INSERT INTO commands (
                id, command, args, requester, requester_type,
                risk_level, status, created_at, updated_at,
                timeout_at, approval_count, required_approvals,
                rationale_required, metadata, working_dir, execution_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            commandId,
            command,
            JSON.stringify(args || []),
            requester,
            requesterType || 'agent',
            evaluation.riskLevel,
            status,
            now,
            now,
            timeoutAt,
            0,
            evaluation.threshold.requiredApprovals,
            evaluation.threshold.rationaleRequired ? 1 : 0,
            JSON.stringify(metadata || {}),
            workingDir || null,
            evaluation.executionMode
        );
        
        // Log the submission
        logAudit(db, 'command_submitted', 'command', commandId, requester, {
            command, args, riskLevel: evaluation.riskLevel,
            risk_level: evaluation.riskLevel,
            executionMode: evaluation.executionMode,
            autoApproved: evaluation.autoApproved,
            matchedRules: evaluation.matchedRules.map(r => r.name)
        });
        
        const commandData = {
            id: commandId,
            command,
            args: args || [],
            requester,
            riskLevel: evaluation.riskLevel,
            executionMode: evaluation.executionMode,
            status,
            autoApproved: evaluation.autoApproved,
            timeoutAt,
            threshold: evaluation.threshold
        };
        
        // Broadcast real-time update
        if (broadcast) {
            broadcast('command_submitted', commandData);
        }
        
        // If auto-approved, execute immediately
        if (evaluation.autoApproved) {
            if (broadcast) {
                broadcast('command_auto_approved', { id: commandId, command });
            }
            if (hooks.onApproved) {
                hooks.onApproved(commandId);
            }
        }
        
        res.status(201).json(commandData);
    });

    // Get command by ID
    router.get('/:id', (req, res) => {
        const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id);
        if (!cmd) {
            return res.status(404).json({ error: 'Command not found' });
        }
        
        // Parse JSON fields
        cmd.args = JSON.parse(cmd.args || '[]');
        cmd.metadata = JSON.parse(cmd.metadata || '{}');
        
        // Get approvals for this command
        cmd.approvals = db.prepare('SELECT * FROM approvals WHERE command_id = ?').all(req.params.id);
        
        res.json(cmd);
    });

    // List commands with filtering
    router.get('/', (req, res) => {
        const { status, riskLevel, requester, limit, offset } = req.query;
        
        let query = 'SELECT * FROM commands WHERE 1=1';
        const params = [];
        
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        if (riskLevel) {
            query += ' AND risk_level = ?';
            params.push(riskLevel);
        }
        if (requester) {
            query += ' AND requester = ?';
            params.push(requester);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const limitVal = parseInt(limit) || 50;
        const offsetVal = parseInt(offset) || 0;
        query += ' LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);
        
        const commands = db.prepare(query).all(...params);
        
        // Parse JSON fields
        commands.forEach(cmd => {
            cmd.args = JSON.parse(cmd.args || '[]');
            cmd.metadata = JSON.parse(cmd.metadata || '{}');
        });
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM commands WHERE 1=1';
        const countParams = [];
        if (status) {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        if (riskLevel) {
            countQuery += ' AND risk_level = ?';
            countParams.push(riskLevel);
        }
        if (requester) {
            countQuery += ' AND requester = ?';
            countParams.push(requester);
        }
        const { total } = db.prepare(countQuery).get(...countParams);
        
        res.json({
            commands,
            total,
            limit: limitVal,
            offset: offsetVal
        });
    });

    // Get command statistics
    router.get('/stats/summary', (req, res) => {
        const stats = {
            total: db.prepare('SELECT COUNT(*) as count FROM commands').get().count,
            pending: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'pending'").get().count,
            approved: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'approved'").get().count,
            rejected: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'rejected'").get().count,
            executing: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'executing'").get().count,
            completed: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'completed'").get().count,
            failed: db.prepare("SELECT COUNT(*) as count FROM commands WHERE status = 'failed'").get().count,
            byRiskLevel: {
                HIGH: db.prepare("SELECT COUNT(*) as count FROM commands WHERE risk_level = 'HIGH'").get().count,
                MEDIUM: db.prepare("SELECT COUNT(*) as count FROM commands WHERE risk_level = 'MEDIUM'").get().count,
                LOW: db.prepare("SELECT COUNT(*) as count FROM commands WHERE risk_level = 'LOW'").get().count,
            }
        };
        res.json(stats);
    });

    return router;
}

function logAudit(db, eventType, entityType, entityId, actor, details) {
    const stmt = db.prepare(`
        INSERT INTO audit_log (id, event_type, entity_type, entity_id, actor, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        uuidv4(),
        eventType,
        entityType,
        entityId,
        actor,
        JSON.stringify(details || {}),
        new Date().toISOString()
    );
    logger.info('audit_event', {
        eventType,
        entityType,
        entityId,
        actor,
        details
    });
    metrics.incCounter('niyam_audit_events_total', {
        event_type: eventType,
        entity_type: entityType || 'unknown'
    }, 1, 'Audit events');
    maybeAlertForAuditEvent(eventType, actor, details || {});
}

module.exports = { createCommandsRouter, logAudit };
