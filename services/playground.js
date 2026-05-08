const { v4: uuidv4 } = require('uuid');

const { buildAutoApprovalProfile, normalizeAutoApprovalMode } = require('./auto-approval-modes');
const { createCliDispatchService } = require('./cli-dispatches');
const { persistCommandSubmission, prepareCommandSubmission } = require('./command-submissions');
const { buildAuthenticationContext } = require('./auth-context');
const { parseJson, shapeCliDispatchRecord, shapeCommandRecord } = require('./record-shaping');

const PLAYGROUND_SCENARIOS = {
    dashboard_medium: {
        label: 'Dashboard Request',
        source: 'dashboard',
        command: 'gh',
        args: ['pr', 'create', '--title', 'playground-demo'],
        rawCommand: 'gh pr create --title playground-demo'
    },
    dashboard_high: {
        label: 'High Risk Approval',
        source: 'dashboard',
        command: 'gh',
        args: ['pr', 'merge', '42'],
        rawCommand: 'gh pr merge 42'
    },
    wrapper_remote: {
        label: 'Wrapper Remote Exec',
        source: 'wrapper',
        rawCommand: 'git status',
        firstToken: 'git',
        firstTokenType: 'external'
    },
    wrapper_local: {
        label: 'Wrapper Local Passthrough',
        source: 'wrapper',
        rawCommand: 'cd public',
        firstToken: 'cd',
        firstTokenType: 'builtin'
    },
    wrapper_blocked: {
        label: 'Wrapper Blocked',
        source: 'wrapper',
        rawCommand: 'playground-blocked --demo',
        firstToken: 'playground-blocked',
        firstTokenType: 'external'
    },
    custom: {
        label: 'Custom Safe Run',
        source: 'dashboard',
        command: 'echo',
        args: ['playground'],
        rawCommand: 'echo playground'
    }
};

const PLAYGROUND_BLOCK_RULE_ID = 'playground-demo-block-rule';

function createPlaygroundService(db, options = {}) {
    const broadcast = options.broadcast;
    const cliDispatches = createCliDispatchService(db, { broadcast });

    function createRun(payload = {}, principal = {}, authentication = null) {
        const scenarioId = normalizeScenario(payload.scenario);
        const scenario = PLAYGROUND_SCENARIOS[scenarioId];
        const approvalMode = normalizeAutoApprovalMode(payload.approvalMode || payload.autoApprovalMode || 'off');
        const safeLifecycle = payload.safeLifecycle !== false;

        if (!safeLifecycle) {
            return {
                statusCode: 400,
                body: { error: 'Playground real execution is not enabled. Use safe lifecycle mode.' }
            };
        }

        ensurePlaygroundRules();

        const runId = uuidv4();
        const now = new Date().toISOString();
        const demoIdentity = buildDemoIdentity(approvalMode);
        const commandSpec = buildCommandSpec(scenarioId, scenario, payload);
        const metadata = {
            ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
            source: 'playground',
            safeLifecycle: true,
            playgroundRunId: runId,
            playgroundScenario: scenarioId,
            playgroundApprovalMode: approvalMode
        };

        insertRun({
            id: runId,
            scenario: scenarioId,
            approvalMode,
            command: commandSpec.rawCommand,
            status: 'created',
            route: null,
            commandId: null,
            dispatchId: null,
            requester: demoIdentity.principal.identifier,
            requesterType: demoIdentity.principal.type,
            safeLifecycle,
            createdBy: principal.identifier || 'unknown',
            metadata: {
                label: scenario.label,
                source: scenario.source
            },
            now
        });

        let outcome;
        if (scenario.source === 'wrapper') {
            outcome = runWrapperScenario({
                runId,
                scenarioId,
                scenario,
                commandSpec,
                metadata,
                demoIdentity,
                approvalMode
            });
        } else {
            outcome = runDashboardScenario({
                runId,
                scenarioId,
                commandSpec,
                metadata,
                demoIdentity,
                approvalMode
            });
        }

        const shaped = getRun(runId);
        return {
            statusCode: 201,
            body: {
                run: shaped,
                outcome
            }
        };
    }

    function runDashboardScenario({ runId, scenarioId, commandSpec, metadata, demoIdentity, approvalMode }) {
        const prepared = prepareCommandSubmission(db, {
            command: commandSpec.command,
            args: commandSpec.args,
            metadata
        });

        if (!prepared.evaluation.allowed) {
            updateRun(runId, {
                status: 'blocked',
                route: 'BLOCKED',
                metadata: {
                    reason: prepared.evaluation.reason,
                    riskLevel: prepared.evaluation.riskLevel
                }
            });
            return {
                route: 'BLOCKED',
                reason: prepared.evaluation.reason,
                riskLevel: prepared.evaluation.riskLevel
            };
        }

        const commandData = persistCommandSubmission({
            db,
            broadcast,
            principal: demoIdentity.principal,
            requester: demoIdentity.principal.identifier,
            requesterType: demoIdentity.principal.type,
            command: commandSpec.command,
            args: commandSpec.args,
            metadata,
            timeoutHours: commandSpec.timeoutHours || null,
            workingDir: commandSpec.workingDir || null,
            evaluation: prepared.evaluation,
            redactedInput: prepared.redactedInput,
            authentication: demoIdentity.authentication,
            approvalPreference: buildAutoApprovalProfile(approvalMode, 'playground')
        });

        updateRun(runId, {
            status: commandData.status,
            route: 'DASHBOARD',
            commandId: commandData.id,
            metadata: {
                scenario: scenarioId,
                riskLevel: commandData.riskLevel,
                approvalMode: commandData.approvalMode,
                executionMode: commandData.executionMode
            }
        });

        return {
            route: 'DASHBOARD',
            commandId: commandData.id,
            riskLevel: commandData.riskLevel,
            status: commandData.status,
            approvalMode: commandData.approvalMode
        };
    }

    function runWrapperScenario({ runId, scenarioId, scenario, commandSpec, metadata, demoIdentity, approvalMode }) {
        const response = cliDispatches.createDispatch({
            rawCommand: commandSpec.rawCommand,
            workingDir: commandSpec.workingDir || process.cwd(),
            shell: commandSpec.shell || 'zsh',
            sessionId: `playground-${runId}`,
            firstToken: scenario.firstToken,
            firstTokenType: scenario.firstTokenType,
            hasShellSyntax: Boolean(commandSpec.hasShellSyntax),
            interactiveHint: Boolean(commandSpec.interactiveHint),
            metadata
        }, demoIdentity.principal, demoIdentity.authentication, {
            approvalPreference: buildAutoApprovalProfile(approvalMode, 'playground')
        });

        let dispatchRecord = getDispatchRecord(response.body.dispatchId);
        if (response.body.route === 'LOCAL_PASSTHROUGH' && response.body.dispatchId) {
            cliDispatches.completeDispatch(response.body.dispatchId, {
                exitCode: 0,
                durationMs: 42,
                completedAt: new Date().toISOString()
            }, demoIdentity.principal, demoIdentity.authentication);
            dispatchRecord = getDispatchRecord(response.body.dispatchId);
        }

        const commandRecord = response.body.commandId ? getCommandRecord(response.body.commandId) : null;
        updateRun(runId, {
            status: commandRecord?.status || dispatchRecord?.status || String(response.body.route).toLowerCase(),
            route: response.body.route,
            commandId: response.body.commandId || null,
            dispatchId: response.body.dispatchId || null,
            metadata: {
                scenario: scenarioId,
                riskLevel: response.body.riskLevel,
                reason: response.body.reason,
                executionMode: response.body.executionMode,
                approvalMode: commandRecord?.metadata?.playgroundApprovalMode || approvalMode
            }
        });

        return {
            route: response.body.route,
            dispatchId: response.body.dispatchId,
            commandId: response.body.commandId || null,
            riskLevel: response.body.riskLevel,
            status: commandRecord?.status || dispatchRecord?.status || response.body.route
        };
    }

    function listRuns(query = {}) {
        const limitParsed = Number.parseInt(query.limit, 10);
        const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 50) : 10;
        const rows = db.prepare(`
            SELECT *
            FROM playground_runs
            ORDER BY created_at DESC
            LIMIT ?
        `).all(limit);

        return {
            runs: rows.map(shapeRun),
            limit
        };
    }

    function getRun(runId) {
        const row = db.prepare('SELECT * FROM playground_runs WHERE id = ?').get(runId);
        if (!row) {
            return null;
        }

        const shaped = shapeRun(row);
        shaped.commandRecord = shaped.commandId ? getCommandRecord(shaped.commandId) : null;
        shaped.dispatchRecord = shaped.dispatchId ? getDispatchRecord(shaped.dispatchId) : null;
        return shaped;
    }

    function ensurePlaygroundRules() {
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT id FROM rules WHERE id = ?').get(PLAYGROUND_BLOCK_RULE_ID);
        if (existing) {
            db.prepare(`
                UPDATE rules
                SET pattern = ?, enabled = 1, updated_at = ?
                WHERE id = ?
            `).run('playground-blocked*', now, PLAYGROUND_BLOCK_RULE_ID);
            return;
        }

        db.prepare(`
            INSERT INTO rules (
                id, name, description, rule_type, pattern, risk_level, execution_mode,
                enabled, priority, created_at, updated_at, metadata
            ) VALUES (?, ?, ?, 'denylist', ?, NULL, NULL, 1, 980, ?, ?, ?)
        `).run(
            PLAYGROUND_BLOCK_RULE_ID,
            'Playground Blocked Command',
            'Deterministic blocked route used by the command playground.',
            'playground-blocked*',
            now,
            now,
            JSON.stringify({ source: 'playground', managedBy: 'system' })
        );
    }

    function insertRun(run) {
        db.prepare(`
            INSERT INTO playground_runs (
                id, scenario, approval_mode, command, status, route, command_id, dispatch_id,
                requester, requester_type, safe_lifecycle, created_by, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            run.id,
            run.scenario,
            run.approvalMode,
            run.command,
            run.status,
            run.route,
            run.commandId,
            run.dispatchId,
            run.requester,
            run.requesterType,
            run.safeLifecycle ? 1 : 0,
            run.createdBy,
            JSON.stringify(run.metadata || {}),
            run.now,
            run.now
        );
    }

    function updateRun(runId, patch) {
        const current = db.prepare('SELECT * FROM playground_runs WHERE id = ?').get(runId);
        if (!current) {
            return;
        }
        const metadata = {
            ...parseJson(current.metadata, {}),
            ...(patch.metadata || {})
        };
        db.prepare(`
            UPDATE playground_runs
            SET status = ?, route = ?, command_id = ?, dispatch_id = ?, metadata = ?, updated_at = ?
            WHERE id = ?
        `).run(
            patch.status || current.status,
            patch.route !== undefined ? patch.route : current.route,
            patch.commandId !== undefined ? patch.commandId : current.command_id,
            patch.dispatchId !== undefined ? patch.dispatchId : current.dispatch_id,
            JSON.stringify(metadata),
            new Date().toISOString(),
            runId
        );
    }

    function getCommandRecord(commandId) {
        const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        return row ? shapeCommandRecord(row) : null;
    }

    function getDispatchRecord(dispatchId) {
        const row = db.prepare('SELECT * FROM cli_dispatches WHERE id = ?').get(dispatchId);
        return row ? shapeCliDispatchRecord(row) : null;
    }

    return {
        createRun,
        getRun,
        listRuns
    };
}

function normalizeScenario(value) {
    const scenario = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(PLAYGROUND_SCENARIOS, scenario) ? scenario : 'dashboard_medium';
}

function buildDemoIdentity(approvalMode) {
    const labels = {
        off: 'Playground Off',
        normal: 'Playground Normal',
        all: 'Playground All'
    };
    const label = labels[approvalMode] || labels.off;
    const identifier = label.toLowerCase().replace(/\s+/g, '-');
    return {
        principal: {
            type: 'agent',
            identifier,
            displayName: label,
            roles: ['agent', 'submitter'],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        },
        authentication: buildAuthenticationContext({
            mode: 'playground',
            credentialId: null,
            credentialLabel: label,
            subjectType: 'agent'
        })
    };
}

function buildCommandSpec(scenarioId, scenario, payload) {
    if (scenarioId !== 'custom') {
        return {
            command: scenario.command,
            args: scenario.args || [],
            rawCommand: scenario.rawCommand,
            workingDir: payload.workingDir || null,
            shell: payload.shell || 'zsh'
        };
    }

    const rawCommand = String(payload.rawCommand || payload.command || scenario.rawCommand).trim() || scenario.rawCommand;
    const parts = rawCommand.split(/\s+/).filter(Boolean);
    return {
        command: parts[0] || scenario.command,
        args: parts.slice(1),
        rawCommand,
        workingDir: payload.workingDir || null,
        shell: payload.shell || 'zsh'
    };
}

function shapeRun(row) {
    return {
        id: row.id,
        scenario: row.scenario,
        approvalMode: row.approval_mode,
        command: row.command,
        status: row.status,
        route: row.route,
        commandId: row.command_id,
        dispatchId: row.dispatch_id,
        requester: row.requester,
        requesterType: row.requester_type,
        safeLifecycle: Boolean(row.safe_lifecycle),
        createdBy: row.created_by,
        metadata: parseJson(row.metadata, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

module.exports = {
    PLAYGROUND_SCENARIOS,
    createPlaygroundService
};
