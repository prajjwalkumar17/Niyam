/**
 * Agent Client - Integration client for Forger and other agents
 */

const http = require('http');

class AgentClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'http://localhost:3000';
        this.agentName = options.agentName || 'niyam-agent';
        this.apiToken = options.apiToken || process.env.NIYAM_AGENT_TOKEN || '';
        this.timeout = options.timeout || 10000;
    }

    /**
     * Submit a command for governance
     * @param {string} command - The command to execute
     * @param {Array} args - Command arguments
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Submission result
     */
    async submitCommand(command, args = [], metadata = {}) {
        return this._request('POST', '/api/commands', {
            command,
            args,
            requester: this.agentName,
            requesterType: 'agent',
            metadata
        });
    }

    /**
     * Simulate a command before submission.
     * @param {string} command - The command to evaluate
     * @param {Array} args - Command arguments
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Simulation result
     */
    async simulateCommand(command, args = [], metadata = {}) {
        return this._request('POST', '/api/policy/simulate', {
            command,
            args,
            metadata
        });
    }

    /**
     * Get command status
     * @param {string} commandId - Command ID
     * @returns {Promise<Object>} Command status
     */
    async getCommandStatus(commandId) {
        return this._request('GET', `/api/commands/${commandId}`);
    }

    /**
     * Wait for command completion with polling
     * @param {string} commandId - Command ID
     * @param {Object} options - Polling options
     * @returns {Promise<Object>} Final command result
     */
    async waitForCompletion(commandId, options = {}) {
        const interval = options.interval || 2000;
        const maxWait = options.maxWait || 300000; // 5 minutes default
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
            const status = await this.getCommandStatus(commandId);
            
            if (['completed', 'failed', 'rejected', 'timeout'].includes(status.status)) {
                return status;
            }
            
            await this._sleep(interval);
        }
        
        throw new Error(`Command ${commandId} did not complete within ${maxWait}ms`);
    }

    /**
     * Submit and wait for a command to complete (convenience method)
     * @param {string} command - The command
     * @param {Array} args - Arguments
     * @param {Object} metadata - Metadata
     * @returns {Promise<Object>} Command result
     */
    async submitAndWait(command, args = [], metadata = {}) {
        const submission = await this.submitCommand(command, args, metadata);
        
        if (submission.status === 'rejected') {
            return submission;
        }
        
        if (submission.autoApproved) {
            return this.waitForCompletion(submission.id);
        }
        
        // Return submission - approval is pending
        return {
            ...submission,
            message: 'Command submitted and awaiting approval'
        };
    }

    /**
     * Approve a command (if the agent is an authorized approver)
     * @param {string} commandId - Command ID
     * @param {string} rationale - Approval rationale
     * @returns {Promise<Object>} Approval result
     */
    async approveCommand(commandId, rationale) {
        return this._request('POST', `/api/approvals/${commandId}/approve`, {
            approver: this.agentName,
            rationale
        });
    }

    /**
     * Reject a command
     * @param {string} commandId - Command ID
     * @param {string} rationale - Rejection rationale
     * @returns {Promise<Object>} Rejection result
     */
    async rejectCommand(commandId, rationale) {
        return this._request('POST', `/api/approvals/${commandId}/reject`, {
            approver: this.agentName,
            rationale
        });
    }

    /**
     * Get pending commands
     * @returns {Promise<Array>} Pending commands
     */
    async getPendingCommands() {
        return this._request('GET', '/api/approvals');
    }

    /**
     * Get dashboard stats
     * @returns {Promise<Object>} Dashboard statistics
     */
    async getStats() {
        return this._request('GET', '/api/commands/stats/summary');
    }

    /**
     * Create a shell dispatch record for interactive CLI governance.
     * @param {Object} payload - CLI dispatch payload
     * @returns {Promise<Object>} Dispatch response
     */
    async createCliDispatch(payload) {
        return this._request('POST', '/api/cli/dispatches', payload);
    }

    /**
     * Report completion for a local passthrough dispatch.
     * @param {string} dispatchId - Dispatch ID
     * @param {Object} payload - Completion payload
     * @returns {Promise<Object>} Updated dispatch
     */
    async completeCliDispatch(dispatchId, payload) {
        return this._request('POST', `/api/cli/dispatches/${dispatchId}/complete`, payload);
    }

    /**
     * Returns the authenticated principal for the current token.
     * @returns {Promise<Object>} Principal info
     */
    async getCurrentPrincipal() {
        return this._request('GET', '/api/auth/me');
    }

    /**
     * Returns the health payload for the current Niyam instance.
     * @returns {Promise<Object>} Health info
     */
    async getHealth() {
        return this._request('GET', '/api/health');
    }

    /**
     * Make an HTTP request
     */
    _request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeout
            };

            if (this.apiToken) {
                options.headers.Authorization = `Bearer ${this.apiToken}`;
            }
            
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            const error = new Error(parsed.error || `HTTP ${res.statusCode}`);
                            error.statusCode = res.statusCode;
                            reject(error);
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error(`Invalid response: ${data.substring(0, 200)}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                error.isReachabilityError = true;
                reject(error);
            });
            req.on('timeout', () => {
                req.destroy();
                const error = new Error('Request timeout');
                error.isReachabilityError = true;
                reject(error);
            });
            
            if (body) {
                req.write(JSON.stringify(body));
            }
            
            req.end();
        });
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AgentClient;
