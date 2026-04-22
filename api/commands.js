/**
 * Command API - Submission, status, and history endpoints
 */

const { redactCommandInput } = require('../security/redaction');
const { logAudit } = require('../services/audit-log');
const { persistCommandSubmission, prepareCommandSubmission } = require('../services/command-submissions');
const { shapeCommandRecord } = require('../services/record-shaping');
const { validateCommandPayload, validationError } = require('./validation');

function createCommandsRouter(db, broadcast, hooks = {}) {
    const router = require('express').Router();

    router.post('/', (req, res) => {
        const validation = validateCommandPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }
        const { command, args, metadata, timeoutHours, workingDir } = validation.value;
        const requester = req.principal.identifier;
        const requesterType = req.principal.type;
        const prepared = prepareCommandSubmission(db, {
            command,
            args,
            metadata
        });
        const { evaluation, redactedInput } = prepared;

        if (!evaluation.allowed) {
            const blockedInput = redactCommandInput({
                command,
                args,
                metadata
            });
            logAudit(db, 'command_blocked', 'command', null, requester, {
                command: blockedInput.command,
                args: blockedInput.args,
                reason: evaluation.reason
            });

            return res.status(403).json({
                error: 'Command blocked by policy',
                reason: evaluation.reason,
                riskLevel: evaluation.riskLevel
            });
        }

        const commandData = persistCommandSubmission({
            db,
            broadcast,
            onApproved: hooks.onApproved,
            requester,
            requesterType,
            command,
            args,
            metadata,
            timeoutHours,
            workingDir,
            evaluation,
            redactedInput
        });

        res.status(201).json(commandData);
    });

    router.get('/:id', (req, res) => {
        const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id);
        if (!cmd) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const shaped = shapeCommandRecord(cmd);
        const approvals = db.prepare('SELECT * FROM approvals WHERE command_id = ? ORDER BY created_at ASC').all(req.params.id);
        shaped.approvals = approvals;
        applyApprovalSummary(shaped, approvals);
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
        enrichCommandsWithApprovals(db, commands);

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

    router.get('/stats/summary', (_req, res) => {
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

module.exports = {
    createCommandsRouter
};

function enrichCommandsWithApprovals(db, commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return;
    }

    const ids = commands.map(command => command.id);
    const placeholders = ids.map(() => '?').join(', ');
    const approvals = db.prepare(`
        SELECT *
        FROM approvals
        WHERE command_id IN (${placeholders})
        ORDER BY created_at ASC
    `).all(...ids);

    const approvalMap = new Map();
    approvals.forEach(approval => {
        if (!approvalMap.has(approval.command_id)) {
            approvalMap.set(approval.command_id, []);
        }
        approvalMap.get(approval.command_id).push(approval);
    });

    commands.forEach(command => {
        applyApprovalSummary(command, approvalMap.get(command.id) || []);
    });
}

function applyApprovalSummary(command, approvals) {
    const approvedBy = approvals
        .filter(approval => approval.decision === 'approved')
        .map(approval => approval.approver);
    const rejectedDecision = approvals.find(approval => approval.decision === 'rejected');
    const distinctApprovers = [...new Set(approvedBy.filter(approver => approver !== command.requester))];
    const twoPersonSatisfied = command.risk_level !== 'HIGH' || distinctApprovers.length >= 2;
    const approvalCount = approvedBy.length;

    command.approvedBy = approvedBy;
    command.rejectedBy = rejectedDecision ? rejectedDecision.approver : null;
    command.approvalProgress = {
        count: approvalCount,
        required: Number(command.required_approvals || 0),
        remaining: Math.max(0, Number(command.required_approvals || 0) - approvalCount),
        twoPersonSatisfied
    };
    command.approval_count = approvalCount;
}
