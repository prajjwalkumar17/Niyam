/**
 * Command Runner - argv-safe execution wrapper with output capture
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { logAudit } = require('../api/commands');
const { config } = require('../config');
const { decryptJson } = require('../security/crypto');
const { buildRedactionSummary, redactExecutionOutput } = require('../security/redaction');
const { logger, metrics } = require('../observability');

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
        const executionMode = String(cmd.execution_mode || config.EXEC_DEFAULT_MODE).toUpperCase();
        metrics.incCounter('niyam_command_execution_started_total', {
            risk_level: cmd.risk_level,
            execution_mode: executionMode
        }, 1, 'Command executions started');
        
        if (this.broadcast) {
            this.broadcast('command_executing', { id: commandId, command: cmd.command });
        }
        
        this.runningCommands.set(commandId, null);
        
        try {
            const result = await this._runCommand(cmd);
            const combinedRedactionSummary = buildRedactionSummary(
                parseJson(cmd.redaction_summary, {}),
                result.redactionSummary
            );
            
            // Update with result
            const now = new Date().toISOString();
            this.db.prepare(`
                UPDATE commands SET 
                    status = 'completed', 
                    output = ?, 
                    error = ?,
                    exit_code = ?,
                    executed_at = ?,
                    updated_at = ?,
                    redaction_summary = ?,
                    redacted = ?
                WHERE id = ?
            `).run(
                result.stdout || '',
                result.stderr || null,
                result.exitCode,
                now,
                now,
                JSON.stringify(combinedRedactionSummary),
                hasRedaction(combinedRedactionSummary) ? 1 : 0,
                commandId
            );
            
            logAudit(this.db, 'command_executed', 'command', commandId, 'system', {
                exitCode: result.exitCode,
                outputLength: (result.stdout || '').length
            });
            metrics.incCounter('niyam_command_execution_completed_total', {
                status: 'completed',
                risk_level: cmd.risk_level,
                execution_mode: executionMode
            }, 1, 'Command execution completions');
            logger.info('command_execution_completed', {
                commandId,
                command: cmd.command,
                exitCode: result.exitCode,
                riskLevel: cmd.risk_level,
                executionMode
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
                error: result.stderr || null
            };
            
        } catch (error) {
            const combinedRedactionSummary = buildRedactionSummary(
                parseJson(cmd.redaction_summary, {}),
                error.redactionSummary
            );
            const now = new Date().toISOString();
            this.db.prepare(`
                UPDATE commands SET 
                    status = 'failed', 
                    output = ?,
                    error = ?, 
                    exit_code = ?,
                    executed_at = ?,
                    updated_at = ?,
                    redaction_summary = ?,
                    redacted = ?
                WHERE id = ?
            `).run(
                error.stdout || '',
                error.stderr || error.message,
                error.exitCode || 1,
                now,
                now,
                JSON.stringify(combinedRedactionSummary),
                hasRedaction(combinedRedactionSummary) ? 1 : 0,
                commandId
            );
            
            logAudit(this.db, 'command_failed', 'command', commandId, 'system', {
                error: error.message,
                exitCode: error.exitCode || 1
            });
            metrics.incCounter('niyam_command_execution_completed_total', {
                status: 'failed',
                risk_level: cmd.risk_level,
                execution_mode: executionMode
            }, 1, 'Command execution completions');
            logger.error('command_execution_failed', {
                commandId,
                command: cmd.command,
                error: error.message,
                exitCode: error.exitCode || 1,
                riskLevel: cmd.risk_level,
                executionMode
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
                exitCode: error.exitCode || 1,
                output: error.stdout || '',
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
            const rawCommand = cmd.exec_command
                ? decryptJson(cmd.exec_command, config.EXEC_DATA_KEY)
                : cmd.command;
            const rawArgs = cmd.exec_args
                ? decryptJson(cmd.exec_args, config.EXEC_DATA_KEY)
                : parseJson(cmd.args, []);
            const { file, args } = this._resolveCommand(rawCommand, rawArgs);
            const cwd = this._resolveWorkingDirectory(cmd.working_dir);
            const executionMode = String(cmd.execution_mode || config.EXEC_DEFAULT_MODE).toUpperCase();
            const spawnPlan = this._buildSpawnPlan(file, args, executionMode);

            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let outputLimitExceeded = false;

            const proc = spawn(spawnPlan.file, spawnPlan.args, {
                cwd,
                env: this._buildExecutionEnv(),
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.runningCommands.set(cmd.id, proc);

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGKILL');
            }, config.EXEC_TIMEOUT_MS);

            proc.on('error', (error) => {
                clearTimeout(timeoutHandle);
                const wrapped = new Error(`Failed to start command: ${error.message}`);
                wrapped.exitCode = 1;
                const outputRedaction = redactExecutionOutput({ stdout, stderr });
                wrapped.stdout = outputRedaction.stdout;
                wrapped.stderr = outputRedaction.stderr;
                wrapped.redactionSummary = outputRedaction.summary;
                reject(wrapped);
            });

            proc.stdout.on('data', (chunk) => {
                const next = appendOutput(stdout, chunk);
                stdout = next.value;
                if (next.exceeded && !outputLimitExceeded) {
                    outputLimitExceeded = true;
                    proc.kill('SIGKILL');
                }
            });

            proc.stderr.on('data', (chunk) => {
                const next = appendOutput(stderr, chunk);
                stderr = next.value;
                if (next.exceeded && !outputLimitExceeded) {
                    outputLimitExceeded = true;
                    proc.kill('SIGKILL');
                }
            });

            proc.on('close', (exitCode) => {
                clearTimeout(timeoutHandle);

                if (outputLimitExceeded) {
                    const error = new Error(`Command output exceeded ${config.EXEC_OUTPUT_LIMIT_BYTES} bytes`);
                    error.exitCode = exitCode || 1;
                    const outputRedaction = redactExecutionOutput({ stdout, stderr });
                    error.stdout = outputRedaction.stdout;
                    error.stderr = outputRedaction.stderr;
                    error.redactionSummary = outputRedaction.summary;
                    reject(error);
                    return;
                }

                if (timedOut) {
                    const error = new Error(`Command timed out after ${config.EXEC_TIMEOUT_MS}ms`);
                    error.exitCode = exitCode || 124;
                    const outputRedaction = redactExecutionOutput({ stdout, stderr });
                    error.stdout = outputRedaction.stdout;
                    error.stderr = outputRedaction.stderr;
                    error.redactionSummary = outputRedaction.summary;
                    reject(error);
                    return;
                }

                if (exitCode !== 0) {
                    const outputRedaction = redactExecutionOutput({ stdout, stderr });
                    const error = new Error(outputRedaction.stderr || `Command exited with code ${exitCode}`);
                    error.exitCode = exitCode || 1;
                    error.stdout = outputRedaction.stdout;
                    error.stderr = outputRedaction.stderr;
                    error.redactionSummary = outputRedaction.summary;
                    reject(error);
                    return;
                }

                const outputRedaction = redactExecutionOutput({ stdout, stderr });
                resolve({
                    exitCode: exitCode || 0,
                    stdout: outputRedaction.stdout,
                    stderr: outputRedaction.stderr,
                    redactionSummary: outputRedaction.summary
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

    kill(commandId) {
        const proc = this.runningCommands.get(commandId);
        if (!proc) {
            return { success: false, reason: 'Command is not currently executing' };
        }

        proc.kill('SIGTERM');
        metrics.incCounter('niyam_command_kills_total', {}, 1, 'Killed command executions');
        return { success: true };
    }

    _resolveCommand(command, rawArgs) {
        const parsedArgs = Array.isArray(rawArgs)
            ? rawArgs.map(value => String(value))
            : JSON.parse(rawArgs || '[]').map(value => String(value));

        if (parsedArgs.length > 0) {
            return {
                file: command,
                args: parsedArgs
            };
        }

        const tokens = tokenizeCommand(command);
        if (tokens.length === 0) {
            throw new Error('Command is empty');
        }

        return {
            file: tokens[0],
            args: tokens.slice(1)
        };
    }

    _resolveWorkingDirectory(workingDir) {
        const cwd = workingDir || process.cwd();
        let resolvedCwd;
        try {
            resolvedCwd = fs.realpathSync(path.resolve(cwd));
        } catch (error) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }

        if (!fs.statSync(resolvedCwd).isDirectory()) {
            throw new Error(`Working directory does not exist: ${resolvedCwd}`);
        }
        if (config.EXEC_REQUIRE_ALLOWED_ROOT && !isPathWithinRoots(resolvedCwd, config.EXEC_ALLOWED_ROOTS)) {
            throw new Error(`Working directory is outside allowed roots: ${resolvedCwd}`);
        }
        return resolvedCwd;
    }

    _buildExecutionEnv() {
        return config.EXEC_ENV_ALLOWLIST.reduce((env, key) => {
            if (process.env[key] !== undefined) {
                env[key] = process.env[key];
            }
            return env;
        }, {});
    }

    _buildSpawnPlan(file, args, executionMode) {
        if (executionMode === 'WRAPPER') {
            if (config.EXEC_WRAPPER.length === 0) {
                throw new Error('Command requires WRAPPER execution mode but NIYAM_EXEC_WRAPPER is not configured');
            }
            return {
                file: config.EXEC_WRAPPER[0],
                args: [...config.EXEC_WRAPPER.slice(1), file, ...args]
            };
        }

        return { file, args };
    }
}

module.exports = CommandRunner;

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    if (Array.isArray(value)) {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function hasRedaction(summary) {
    return Boolean(
        summary &&
        (
            summary.command ||
            summary.args ||
            summary.metadata ||
            summary.output ||
            summary.error ||
            (Array.isArray(summary.metadataPaths) && summary.metadataPaths.length > 0)
        )
    );
}

function appendOutput(current, chunk) {
    const chunkText = String(chunk);
    const next = current + chunkText;
    if (Buffer.byteLength(next, 'utf8') > config.EXEC_OUTPUT_LIMIT_BYTES) {
        return {
            value: next.slice(-config.EXEC_OUTPUT_LIMIT_BYTES),
            exceeded: true
        };
    }

    return {
        value: next,
        exceeded: false
    };
}

function tokenizeCommand(commandLine) {
    const input = String(commandLine || '').trim();
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '\'' || char === '"') {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
}

function isPathWithinRoots(targetPath, allowedRoots) {
    const normalizedTarget = `${targetPath}${path.sep}`;

    return allowedRoots.some(root => {
        let resolvedRoot;
        try {
            resolvedRoot = fs.realpathSync(path.resolve(root));
        } catch (error) {
            return false;
        }
        return normalizedTarget.startsWith(`${resolvedRoot}${path.sep}`) || targetPath === resolvedRoot;
    });
}
