const { v4: uuidv4 } = require('uuid');

const { buildAutoApprovalProfile, normalizeAutoApprovalMode } = require('./auto-approval-modes');
const { createCliDispatchService, determineDispatchRoute } = require('./cli-dispatches');
const { persistCommandSubmission, prepareCommandSubmission } = require('./command-submissions');
const { buildAuthenticationContext } = require('./auth-context');
const { parseJson, shapeCliDispatchRecord, shapeCommandRecord } = require('./record-shaping');
const PolicyEngine = require('../policy/engine');
const {
    hasShellSyntax,
    isLikelyInteractiveCommand,
    parseSimpleCommand,
    tokenizeCommand
} = require('../lib/command-line');

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
    }
};

const PLAYGROUND_BLOCK_RULE_ID = 'playground-demo-block-rule';
const SIMULATION_SOURCE_MODES = new Set(['dashboard', 'wrapper']);
const SHELL_BUILTINS = new Set([
    '.',
    ':',
    'alias',
    'bg',
    'break',
    'cd',
    'command',
    'continue',
    'dirs',
    'disown',
    'echo',
    'eval',
    'exec',
    'exit',
    'export',
    'false',
    'fg',
    'hash',
    'history',
    'jobs',
    'popd',
    'pushd',
    'pwd',
    'read',
    'return',
    'set',
    'shift',
    'source',
    'test',
    'true',
    'type',
    'ulimit',
    'unalias',
    'unset',
    'wait'
]);

function createPlaygroundService(db, options = {}) {
    const broadcast = options.broadcast;
    const cliDispatches = createCliDispatchService(db, { broadcast });

    function createRun(payload = {}, principal = {}, authentication = null) {
        if (String(payload.scenario || '').trim() === 'custom') {
            return {
                statusCode: 400,
                body: { error: 'Custom commands are simulation-only. Use /api/playground/simulate instead.' }
            };
        }

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

    function simulateCommand(payload = {}) {
        const rawCommand = String(payload.rawCommand || payload.command || '').trim();
        if (!rawCommand) {
            return {
                statusCode: 400,
                body: { error: 'Command is required for playground simulation' }
            };
        }

        const sourceMode = normalizeSimulationSourceMode(payload.sourceMode);
        const approvalMode = normalizeAutoApprovalMode(payload.approvalMode || payload.autoApprovalMode || 'off');
        const workingDir = String(payload.workingDir || '').trim() || null;

        const result = sourceMode === 'wrapper'
            ? simulateWrapperCommand({ rawCommand, approvalMode, workingDir })
            : simulateDashboardCommand({ rawCommand, approvalMode, workingDir });

        return {
            statusCode: 200,
            body: result
        };
    }

    function simulateDashboardCommand({ rawCommand, approvalMode, workingDir }) {
        const parsed = parseSimpleCommand(rawCommand);
        if (!parsed) {
            return buildSkippedSimulation({
                rawCommand,
                sourceMode: 'dashboard',
                approvalMode,
                workingDir,
                reason: 'Command could not be tokenized safely'
            });
        }

        const policyEngine = new PolicyEngine(db);
        const simulation = policyEngine.simulate({
            command: parsed.command,
            args: parsed.args,
            metadata: { source: 'playground-simulation' },
            workingDir
        });
        const approval = predictApproval(simulation, approvalMode);
        const route = simulation.allowed ? 'DASHBOARD' : 'BLOCKED';
        const predictedStatus = simulation.allowed ? approval.predictedStatus : 'blocked';
        const reason = simulation.allowed ? simulation.reason : simulation.reason || 'Command blocked by policy';

        return shapeSimulationResponse({
            rawCommand,
            command: parsed.command,
            args: parsed.args,
            sourceMode: 'dashboard',
            approvalMode,
            route,
            predictedStatus,
            simulation,
            approval,
            reason,
            workingDir
        });
    }

    function simulateWrapperCommand({ rawCommand, approvalMode, workingDir }) {
        const policyEngine = new PolicyEngine(db);
        const parsed = parseSimpleCommand(rawCommand);
        const simulation = policyEngine.simulate({
            command: rawCommand,
            args: [],
            metadata: { source: 'playground-simulation' },
            workingDir
        });
        const routeResult = determineDispatchRoute({
            allowed: simulation.allowed,
            reason: simulation.reason,
            firstTokenType: inferFirstTokenType(rawCommand),
            shellSyntax: hasShellSyntax(rawCommand),
            interactiveHint: isLikelyInteractiveCommand(rawCommand),
            parsedCommand: parsed
        });

        let commandSimulation = simulation;
        if (routeResult.route === 'REMOTE_EXEC' && parsed) {
            commandSimulation = policyEngine.simulate({
                command: parsed.command,
                args: parsed.args,
                metadata: { source: 'playground-simulation' },
                workingDir
            });
            if (!commandSimulation.allowed) {
                routeResult.route = 'BLOCKED';
                routeResult.status = 'blocked';
                routeResult.reason = commandSimulation.reason;
            }
        }

        const approval = routeResult.route === 'REMOTE_EXEC'
            ? predictApproval(commandSimulation, approvalMode)
            : {
                approvalMode: routeResult.route === 'BLOCKED' ? 'not_requested' : 'not_required',
                predictedStatus: routeResult.status,
                detail: routeResult.route === 'BLOCKED'
                    ? 'Policy blocks this shell line before approval.'
                    : 'This shell line would stay local and would not create a governed command.'
            };
        const predictedStatus = routeResult.route === 'REMOTE_EXEC'
            ? approval.predictedStatus
            : routeResult.status;

        return shapeSimulationResponse({
            rawCommand,
            command: parsed?.command || rawCommand,
            args: parsed?.args || [],
            sourceMode: 'wrapper',
            approvalMode,
            route: routeResult.route,
            predictedStatus,
            simulation: commandSimulation,
            approval,
            reason: routeResult.reason || commandSimulation.reason,
            passthroughReason: routeResult.passthroughReason,
            workingDir
        });
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
        listRuns,
        simulateCommand
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
    return {
        command: scenario.command,
        args: scenario.args || [],
        rawCommand: scenario.rawCommand,
        workingDir: payload.workingDir || null,
        shell: payload.shell || 'zsh'
    };
}

function normalizeSimulationSourceMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SIMULATION_SOURCE_MODES.has(normalized) ? normalized : 'dashboard';
}

function inferFirstTokenType(rawCommand) {
    const firstToken = tokenizeCommand(rawCommand)[0];
    if (!firstToken) {
        return 'unknown';
    }
    return SHELL_BUILTINS.has(firstToken) ? 'builtin' : 'external';
}

function predictApproval(simulation, approvalMode) {
    if (!simulation.allowed) {
        return {
            approvalMode: 'not_requested',
            predictedStatus: 'blocked',
            detail: 'Policy blocks this command before approval.'
        };
    }

    if (simulation.autoApproved) {
        return {
            approvalMode: 'policy_auto',
            predictedStatus: 'approved',
            detail: 'Low-risk policy would auto-approve this command.'
        };
    }

    const preference = buildAutoApprovalProfile(approvalMode, 'playground');
    const riskLevel = simulation.riskLevel;

    if (riskLevel === 'MEDIUM' && preference.autoApprovesMedium) {
        return {
            approvalMode: 'auto_agent_approved',
            predictedStatus: 'approved',
            detail: 'Niyam Auto Approver would approve this medium-risk command.'
        };
    }

    if (riskLevel === 'HIGH' && preference.autoApprovesHigh) {
        return {
            approvalMode: 'auto_agent_approved',
            predictedStatus: 'approved',
            detail: 'Approve Everything would approve this high-risk command.'
        };
    }

    if (riskLevel === 'HIGH' && preference.assistsHighRisk) {
        return {
            approvalMode: 'auto_agent_pending',
            predictedStatus: 'pending',
            detail: 'Niyam Auto Approver would add one approval, then a human approval would still be needed.'
        };
    }

    return {
        approvalMode: 'manual_pending',
        predictedStatus: 'pending',
        detail: `${simulation.threshold?.requiredApprovals || 1} human approval(s) would be required.`
    };
}

function buildSkippedSimulation({ rawCommand, sourceMode, approvalMode, workingDir, reason }) {
    const simulation = {
        allowed: true,
        reason,
        riskLevel: 'LOW',
        executionMode: 'DIRECT',
        threshold: {
            requiredApprovals: 0,
            rationaleRequired: false
        },
        matchedRules: [],
        redactionPreview: {
            commandChanged: false,
            argsChanged: false,
            metadataChanged: false,
            metadataPaths: []
        },
        autoApproved: true
    };
    return shapeSimulationResponse({
        rawCommand,
        command: rawCommand,
        args: [],
        sourceMode,
        approvalMode,
        route: 'LOCAL_PASSTHROUGH',
        predictedStatus: 'created',
        simulation,
        approval: {
            approvalMode: 'not_required',
            predictedStatus: 'created',
            detail: reason
        },
        reason,
        workingDir
    });
}

function shapeSimulationResponse(options) {
    const {
        rawCommand,
        command,
        args,
        sourceMode,
        approvalMode,
        route,
        predictedStatus,
        simulation,
        approval,
        reason,
        passthroughReason = null,
        workingDir = null
    } = options;
    const allowed = route !== 'BLOCKED' && simulation.allowed !== false;
    const routeDetail = route === 'DASHBOARD'
        ? 'Dashboard command request would be created.'
        : route === 'REMOTE_EXEC'
            ? 'Wrapper would create a dispatch and link a governed command.'
            : route === 'LOCAL_PASSTHROUGH'
                ? reason || 'Wrapper would leave this command in the local shell.'
                : reason || 'Policy blocks this command before execution.';

    return {
        rawCommand,
        command,
        args,
        sourceMode,
        approvalMode,
        route,
        predictedStatus,
        allowed,
        reason,
        riskLevel: simulation.riskLevel,
        executionMode: simulation.executionMode,
        threshold: simulation.threshold,
        matchedRules: simulation.matchedRules || [],
        redactionPreview: simulation.redactionPreview,
        classifier: simulation.classifier,
        autoApproved: approval.predictedStatus === 'approved',
        approvalPrediction: approval,
        passthroughReason,
        workingDir,
        timelineSteps: [
            {
                label: 'Policy',
                value: simulation.riskLevel || 'LOW',
                detail: simulation.reason || 'Evaluated by policy'
            },
            {
                label: 'Route',
                value: route,
                detail: routeDetail
            },
            {
                label: 'Approval',
                value: approval.approvalMode,
                detail: approval.detail
            },
            {
                label: 'Outcome',
                value: predictedStatus,
                detail: 'Simulation only. No command is stored or executed.'
            }
        ]
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
