const { v4: uuidv4 } = require('uuid');

const { calculateTimeout } = require('../policy/risk-classifier');
const { config } = require('../config');
const { encryptJson } = require('../security/crypto');
const { buildRedactionSummary, redactCommandInput } = require('../security/redaction');
const PolicyEngine = require('../policy/engine');
const { logAudit } = require('./audit-log');

function prepareCommandSubmission(db, { command, args = [], metadata = {} }) {
    const policyEngine = new PolicyEngine(db);
    const evaluation = policyEngine.evaluate(command, args);
    const redactedInput = redactCommandInput({
        command,
        args,
        metadata
    });

    return {
        evaluation,
        redactedInput
    };
}

function persistCommandSubmission(options) {
    const {
        db,
        broadcast,
        onApproved,
        requester,
        requesterType,
        command,
        args = [],
        metadata = {},
        timeoutHours,
        workingDir = null,
        evaluation,
        redactedInput
    } = options;
    const commandId = uuidv4();
    const timeoutAt = calculateTimeout(evaluation.riskLevel, timeoutHours);
    const status = evaluation.autoApproved ? 'approved' : 'pending';
    const redactionSummary = buildRedactionSummary(redactedInput.summary);
    const now = new Date().toISOString();

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
        encryptJson(args, config.EXEC_DATA_KEY),
        encryptJson(metadata, config.EXEC_DATA_KEY)
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
        if (onApproved) {
            onApproved(commandId);
        }
    }

    return commandData;
}

module.exports = {
    persistCommandSubmission,
    prepareCommandSubmission
};
