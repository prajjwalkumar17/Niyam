/**
 * Execution Guard - Enforces approval before execution
 */

const CommandRunner = require('./runner');

class ExecutionGuard {
    constructor(db, broadcast) {
        this.db = db;
        this.runner = new CommandRunner(db, broadcast);
        this.broadcast = broadcast;
    }

    /**
     * Attempt to execute a command after verifying all conditions
     * @param {string} commandId - Command ID to execute
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Execution result or rejection reason
     */
    async execute(commandId, options = {}) {
        const cmd = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        
        if (!cmd) {
            return { allowed: false, reason: 'Command not found' };
        }
        
        // Verify status
        if (cmd.status === 'completed') {
            return { allowed: false, reason: 'Command already executed' };
        }
        if (cmd.status === 'failed') {
            return { allowed: false, reason: 'Command previously failed' };
        }
        if (cmd.status === 'rejected') {
            return { allowed: false, reason: 'Command was rejected' };
        }
        if (cmd.status === 'timeout') {
            return { allowed: false, reason: 'Command approval window expired' };
        }
        if (cmd.status === 'executing') {
            return { allowed: false, reason: 'Command is currently executing' };
        }
        
        // Must be in approved state
        if (cmd.status !== 'approved') {
            return { allowed: false, reason: `Command requires approval first (current: ${cmd.status})` };
        }
        
        // Verify all required approvals are present
        const approvals = this.db.prepare(
            "SELECT * FROM approvals WHERE command_id = ? AND decision = 'approved'"
        ).all(commandId);
        
        if (approvals.length < cmd.required_approvals) {
            return {
                allowed: false,
                reason: `Insufficient approvals: ${approvals.length}/${cmd.required_approvals}`
            };
        }
        
        // Verify no rejections
        const rejections = this.db.prepare(
            "SELECT * FROM approvals WHERE command_id = ? AND decision = 'rejected'"
        ).all(commandId);
        
        if (rejections.length > 0) {
            return { allowed: false, reason: 'Command has been rejected' };
        }
        
        // All checks passed, execute
        try {
            const result = await this.runner.execute(commandId);
            return { allowed: true, result };
        } catch (error) {
            return { allowed: false, reason: error.message };
        }
    }

    /**
     * Get the execution status of a command
     */
    getStatus(commandId) {
        const cmd = this.db.prepare('SELECT id, command, status, exit_code, error, executed_at FROM commands WHERE id = ?').get(commandId);
        if (!cmd) return null;
        return cmd;
    }

    /**
     * Cancel a pending command
     */
    cancel(commandId, cancelledBy = 'system') {
        const cmd = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        if (!cmd) return { success: false, reason: 'Command not found' };
        
        if (cmd.status !== 'pending') {
            return { success: false, reason: `Cannot cancel command in ${cmd.status} state` };
        }
        
        this.db.prepare(`
            UPDATE commands SET status = 'rejected', updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), commandId);
        
        if (this.broadcast) {
            this.broadcast('command_cancelled', { id: commandId, cancelledBy });
        }
        
        return { success: true };
    }
}

module.exports = ExecutionGuard;
