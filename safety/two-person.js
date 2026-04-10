/**
 * Two-Person Approval - Ensures critical commands require separate approvers
 */

/**
 * Check if two-person approval requirement is satisfied
 * @param {Object} db - Database instance
 * @param {string} commandId - Command ID to check
 * @returns {Object} { satisfied: boolean, approvers: string[], reason: string }
 */
function checkTwoPersonApproval(db, commandId) {
    const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!cmd) {
        return { satisfied: false, approvers: [], reason: 'Command not found' };
    }
    
    // Only HIGH risk commands require two-person approval
    if (cmd.risk_level !== 'HIGH') {
        return { satisfied: true, approvers: [], reason: 'Two-person approval not required for this risk level' };
    }
    
    const approvals = db.prepare(
        "SELECT approver FROM approvals WHERE command_id = ? AND decision = 'approved'"
    ).all(commandId);
    
    const uniqueApprovers = [...new Set(approvals.map(a => a.approver))];
    
    // The requester cannot be one of the approvers
    const filteredApprovers = uniqueApprovers.filter(a => a !== cmd.requester);
    
    if (filteredApprovers.length >= 2) {
        return {
            satisfied: true,
            approvers: filteredApprovers,
            reason: 'Two-person approval satisfied'
        };
    }
    
    return {
        satisfied: false,
        approvers: filteredApprovers,
        reason: `Need 2 separate approvers (excluding requester). Have: ${filteredApprovers.length}/2`
    };
}

/**
 * Validate that an approver is different from the requester
 * @param {Object} db - Database instance
 * @param {string} commandId - Command ID
 * @param {string} approver - Approver identifier
 * @returns {Object} { valid: boolean, reason: string }
 */
function validateSeparateApprover(db, commandId, approver) {
    const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!cmd) {
        return { valid: false, reason: 'Command not found' };
    }
    
    if (cmd.requester === approver) {
        return {
            valid: false,
            reason: 'The requester cannot approve their own command (two-person rule)'
        };
    }
    
    return { valid: true, reason: 'Approver is separate from requester' };
}

module.exports = { checkTwoPersonApproval, validateSeparateApprover };
