/**
 * Command API - Submission, status, and history endpoints
 */

const { v4: uuidv4 } = require('uuid');
const PolicyEngine = require('../policy/engine');
const { calculateTimeout } = require('../policy/risk-classifier');
const { config } = require('../config');
const { encryptJson } = require('../security/crypto');
const {
    buildRedactionSummary,
    redactAuditDetails,
    redactCommandInput
} = require('../security/redaction');
const { validateCommandPayload, validationError } = require('./validation');
const { logger, maybeAlertForAuditEvent, metrics } = require('../observability');

function createCommandsRouter(db, broadcast, hooks = {}) {
    const router = require('express').Router();
    const policyEngine = new PolicyEngine(db);

    router.post('/', (req, res) => {
        const validation = validateCommandPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }
        const { command, args, metadata, timeoutHours, workingDir } = validation.value;

        const rawArgs = args;
        const rawMetadata = metadata;
        const requester = req.principal.identifier;
        const requesterType = req.principal.type;
        const now = new Date().toISOString();

        const evaluation = policyEngine.evaluate(command, rawArgs);
        const redactedInput = redactCommandInput({
            command,
            args: rawArgs,
            metadata: rawMetadata
        });

        if (!evaluation.allowed) {
            logAudit(db, 'command_blocked', 'command', null, requester, {
                command: redactedInput.command,
                args: redactedInput.args,
                reason: evaluation.reason
            });

            return res.status(403).json({
                error: 'Command blocked by policy',
                reason: evaluation.reason,
                riskLevel: evaluation.riskLevel
            });
        }

        const commandId = uuidv4();
        const timeoutAt = calculateTimeout(evaluation.riskLevel, timeoutHours);
        const status = evaluation.autoApproved ? 'approved' : 'pending';
        const redactionSummary = buildRedactionSummary(redactedInput.summary);

        db.prepare(`
            INSERT INTO commands (
                id, command, args, requester, requester_type,
                risk_level, status, created_at, updated_at,
                timeout_at, approval_count, required_approvals,
                rationale_required, metadata, working_dir, execution_mode,
                redaction_summary, redacted, exec_command, exec_args, exec_metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            commandId,
            redactedInput.command,
            JSON.stringify(redactedInput.args),
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
            JSON.stringify(redactedInput.metadata || {}),
            workingDir || null,
            evaluation.executionMode,
            JSON.stringify(redactionSummary),
            redactedInput.redacted ? 1 : 0,
            encryptJson(command, config.EXEC_DATA_KEY),
            encryptJson(rawArgs, config.EXEC_DATA_KEY),
            encryptJson(rawMetadata, config.EXEC_DATA_KEY)
        );

        logAudit(db, 'command_submitted', 'command', commandId, requester, {
            command: redactedInput.command,
            args: redactedInput.args,
            riskLevel: evaluation.riskLevel,
            risk_level: evaluation.riskLevel,
            executionMode: evaluation.executionMode,
            autoApproved: evaluation.autoApproved,
            matchedRules: evaluation.matchedRules.map(rule => rule.name)
        });

        const commandData = {
            id: commandId,
            command: redactedInput.command,
            args: redactedInput.args,
            requester,
            riskLevel: evaluation.riskLevel,
            executionMode: evaluation.executionMode,
            status,
            autoApproved: evaluation.autoApproved,
            timeoutAt,
            threshold: evaluation.threshold,
            redacted: redactedInput.redacted,
            redactionSummary
        };

        if (broadcast) {
            broadcast('command_submitted', commandData);
        }

        if (evaluation.autoApproved) {
            if (broadcast) {
                broadcast('command_auto_approved', { id: commandId, command: redactedInput.command });
            }
            if (hooks.onApproved) {
                hooks.onApproved(commandId);
            }
        }

        res.status(201).json(commandData);
    });

    router.get('/:id', (req, res) => {
        const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id);
        if (!cmd) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const shaped = shapeCommandRecord(cmd);
        shaped.approvals = db.prepare('SELECT * FROM approvals WHERE command_id = ?').all(req.params.id);
        res.json(shaped);
    });

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

        const limitParsed = Number.parseInt(limit, 10);
        const offsetParsed = Number.parseInt(offset, 10);
        const limitVal = Number.isFinite(limitParsed) ? limitParsed : 50;
        const offsetVal = Number.isFinite(offsetParsed) ? offsetParsed : 0;
        query += ' LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);

        const commands = db.prepare(query).all(...params).map(shapeCommandRecord);

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
                LOW: db.prepare("SELECT COUNT(*) as count FROM commands WHERE risk_level = 'LOW'").get().count
            }
        };
        res.json(stats);
    });

    return router;
}

function logAudit(db, eventType, entityType, entityId, actor, details) {
    const auditRedaction = redactAuditDetails(details || {});

    db.prepare(`
        INSERT INTO audit_log (id, event_type, entity_type, entity_id, actor, details, redaction_summary, redacted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuidv4(),
        eventType,
        entityType,
        entityId,
        actor,
        JSON.stringify(auditRedaction.details),
        JSON.stringify(auditRedaction.summary),
        auditRedaction.redacted ? 1 : 0,
        new Date().toISOString()
    );

    logger.info('audit_event', {
        eventType,
        entityType,
        entityId,
        actor,
        details: auditRedaction.details
    });
    metrics.incCounter('niyam_audit_events_total', {
        event_type: eventType,
        entity_type: entityType || 'unknown'
    }, 1, 'Audit events');
    maybeAlertForAuditEvent(eventType, actor, auditRedaction.details || {});
}

function shapeCommandRecord(record) {
    const shaped = { ...record };
    shaped.args = parseJson(shaped.args, []);
    shaped.metadata = parseJson(shaped.metadata, {});
    shaped.redaction_summary = parseJson(shaped.redaction_summary, {});
    shaped.redacted = Boolean(shaped.redacted);
    delete shaped.exec_command;
    delete shaped.exec_args;
    delete shaped.exec_metadata;
    return shaped;
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

module.exports = {
    createCommandsRouter,
    logAudit,
    shapeCommandRecord
};
