const { v4: uuidv4 } = require('uuid');

const { addAuthDetails } = require('./auth-context');
const { logAudit } = require('./audit-log');

const AUTO_APPROVER_IDENTIFIER = 'niyam-auto-approver';
const AUTO_APPROVER_AUTHENTICATION = {
    mode: 'system',
    credentialId: null,
    credentialLabel: null,
    subjectType: 'agent'
};

function applyAutoApprovalIfEligible(options) {
    const {
        db,
        broadcast,
        onApproved,
        commandData,
        evaluation,
        authentication,
        preference
    } = options;

    const resolvedPreference = preference || {
        autoApprovalEnabled: false,
        autoApprovalMode: 'off',
        scope: 'none',
        autoApprovesMedium: false,
        assistsHighRisk: false,
        autoApprovesHigh: false
    };
    const riskLevel = evaluation.riskLevel;
    const baseMode = commandData.autoApproved
        ? 'policy_auto'
        : commandData.approvalMode;

    const withContext = {
        ...commandData,
        approvalMode: baseMode,
        approvalAutomationEnabled: Boolean(resolvedPreference.autoApprovalEnabled),
        autoApprovalMode: resolvedPreference.autoApprovalMode || 'off',
        approvalAutomationScope: resolvedPreference.scope || 'none'
    };

    if (commandData.autoApproved) {
        return withContext;
    }

    if (!['MEDIUM', 'HIGH'].includes(riskLevel)) {
        return withContext;
    }

    if (riskLevel === 'MEDIUM' && !resolvedPreference.autoApprovesMedium) {
        return withContext;
    }

    if (riskLevel === 'HIGH' && !resolvedPreference.assistsHighRisk) {
        return withContext;
    }

    const existingAutoApproval = db.prepare(`
        SELECT 1
        FROM approvals
        WHERE command_id = ? AND approver = ? AND decision = 'approved'
        LIMIT 1
    `).get(commandData.id, AUTO_APPROVER_IDENTIFIER);

    if (existingAutoApproval) {
        return withContext;
    }

    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO approvals (
            id, command_id, approver, auth_mode, auth_credential_id, auth_credential_label, decision, rationale, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `).run(
        uuidv4(),
        commandData.id,
        AUTO_APPROVER_IDENTIFIER,
        AUTO_APPROVER_AUTHENTICATION.mode,
        null,
        null,
        null,
        now
    );

    if (riskLevel === 'MEDIUM' || (riskLevel === 'HIGH' && resolvedPreference.autoApprovesHigh)) {
        db.prepare(`
            UPDATE commands
            SET status = 'approved', approval_count = 1, required_approvals = 1, updated_at = ?
            WHERE id = ?
        `).run(now, commandData.id);

        logAudit(db, 'command_approved', 'command', commandData.id, AUTO_APPROVER_IDENTIFIER, {
            ...addAuthDetails({
                command: commandData.command,
                args: commandData.args,
                approvalCount: 1,
                requiredApprovals: evaluation.threshold.requiredApprovals,
                approver: AUTO_APPROVER_IDENTIFIER,
                autoApproval: true,
                approvalMode: 'auto_agent',
                autoApprovalMode: resolvedPreference.autoApprovalMode || 'off',
                approvedBy: [AUTO_APPROVER_IDENTIFIER]
            }, authentication)
        });

        if (broadcast) {
            broadcast('command_approved', {
                id: commandData.id,
                command: commandData.command,
                args: commandData.args,
                approvals: 1
            });
        }
        if (onApproved) {
            onApproved(commandData.id);
        }

        return {
            ...withContext,
            status: 'approved',
            autoApproved: true,
            approval_count: 1,
            approvedBy: [AUTO_APPROVER_IDENTIFIER],
            approvalMode: 'auto_agent_approved'
        };
    }

    db.prepare(`
        UPDATE commands
        SET approval_count = 1, updated_at = ?
        WHERE id = ?
    `).run(now, commandData.id);

    logAudit(db, 'approval_granted', 'command', commandData.id, AUTO_APPROVER_IDENTIFIER, {
        ...addAuthDetails({
            command: commandData.command,
            args: commandData.args,
            approvalCount: 1,
            requiredApprovals: evaluation.threshold.requiredApprovals,
            approver: AUTO_APPROVER_IDENTIFIER,
            autoApproval: true,
            approvalMode: 'auto_agent',
            autoApprovalMode: resolvedPreference.autoApprovalMode || 'off',
            stillPending: true,
            pendingReason: 'Waiting for one human approver after auto-approval assist'
        }, authentication)
    });

    if (broadcast) {
        broadcast('approval_granted', {
            id: commandData.id,
            command: commandData.command,
            approvals: 1,
            required: evaluation.threshold.requiredApprovals
        });
    }

    return {
        ...withContext,
        status: 'pending',
        autoApproved: false,
        approval_count: 1,
        approvedBy: [AUTO_APPROVER_IDENTIFIER],
        approvalMode: 'auto_agent_pending'
    };
}

module.exports = {
    applyAutoApprovalIfEligible,
    AUTO_APPROVER_AUTHENTICATION,
    AUTO_APPROVER_IDENTIFIER
};
