/**
 * Command Runner - Secure execution wrapper with output capture
 */

const { exec } = require('child_process');
const { logAudit } = require('../api/commands');

class CommandRunner {
    constructor(db, broadcast) {
        this.db = db;
        this.broadcast = broadcast;
        this.runningCommands = new Map();
    }

    /**
     * Execute an approved command
     * @param {string} commandId - The command ID from the database
     * @returns {Promise<Object>} Execution result
     */
    async execute(commandId) {
        const cmd = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        
        if (!cmd) {
            throw new Error('Command not found');
        }
        
        if (cmd.status !== 'approved') {
            throw new Error(`Command status is '${cmd.status}', expected 'approved'`);
        }
        
        // Check if already running
        if (this.runningCommands.has(commandId)) {
            throw new Error('Command is already executing');
        }
        
        // Mark as executing
        this.db.prepare(`
            UPDATE commands SET status = 'executing', updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), commandId);
        
        if (this.broadcast) {
            this.broadcast('command_executing', { id: commandId, command: cmd.command });
        }
        
        this.runningCommands.set(commandId, true);
        
        try {
            const result = await this._runCommand(cmd);
            
            // Update with result
            const now = new Date().toISOString();
            this.db.prepare(`
                UPDATE commands SET 
                    status = 'completed', 
                    output = ?, 
                    exit_code = ?,
                    executed_at = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(result.stdout || '', result.exitCode, now, now, commandId);
            
            logAudit(this.db, 'command_executed', 'command', commandId, 'system', {
                exitCode: result.exitCode,
                outputLength: (result.stdout || '').length
            });
            
            if (this.broadcast) {
                this.broadcast('command_completed', {
                    id: commandId,
                    command: cmd.command,
                    exitCode: result.exitCode,
                    output: result.stdout
                });
            }
            
            return {
                commandId,
                status: 'completed',
                exitCode: result.exitCode,
                output: result.stdout,
                error: result.stderr
            };
            
        } catch (error) {
            const now = new Date().toISOString();
            this.db.prepare(`
                UPDATE commands SET 
                    status = 'failed', 
                    error = ?, 
                    exit_code = ?,
                    executed_at = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(error.message, error.code || 1, now, now, commandId);
            
            logAudit(this.db, 'command_failed', 'command', commandId, 'system', {
                error: error.message
            });
            
            if (this.broadcast) {
                this.broadcast('command_failed', {
                    id: commandId,
                    command: cmd.command,
                    error: error.message
                });
            }
            
            return {
                commandId,
                status: 'failed',
                error: error.message
            };
            
        } finally {
            this.runningCommands.delete(commandId);
        }
    }

    /**
     * Run a command and capture output
     */
    _runCommand(cmd) {
        return new Promise((resolve, reject) => {
            const timeout = 30000; // 30 second timeout
            
            const proc = exec(cmd.command, {
                timeout,
                maxBuffer: 1024 * 1024, // 1MB output buffer
                shell: '/bin/bash',
                cwd: process.cwd(),
                env: { ...process.env }
            }, (error, stdout, stderr) => {
                if (error && error.killed) {
                    reject(new Error(`Command timed out after ${timeout}ms`));
                    return;
                }
                
                resolve({
                    exitCode: error ? error.code || 1 : 0,
                    stdout: stdout || '',
                    stderr: stderr || ''
                });
            });
        });
    }

    /**
     * Check for timed-out commands and mark them
     */
    checkTimeouts() {
        const now = new Date().toISOString();
        const timedOut = this.db.prepare(`
            SELECT id FROM commands 
            WHERE status = 'pending' 
            AND timeout_at IS NOT NULL 
            AND timeout_at < ?
        `).all(now);
        
        for (const cmd of timedOut) {
            this.db.prepare(`
                UPDATE commands SET status = 'timeout', updated_at = ? WHERE id = ?
            `).run(now, cmd.id);
            
            logAudit(this.db, 'command_timeout', 'command', cmd.id, 'system', {
                reason: 'Approval window expired'
            });
            
            if (this.broadcast) {
                this.broadcast('command_timeout', { id: cmd.id });
            }
        }
        
        return timedOut.length;
    }
}

module.exports = CommandRunner;
