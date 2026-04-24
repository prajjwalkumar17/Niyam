const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const { encryptJson } = require('../security/crypto');
const { buildRedactionSummary, redactCommandInput } = require('../security/redaction');
const PolicyEngine = require('../policy/engine');
const {
    hasShellSyntax,
    isBlankCommand,
    isCommentOnlyCommand,
    isLikelyInteractiveCommand,
    parseSimpleCommand,
    tokenizeCommand
} = require('../lib/command-line');
const { addAuthDetails, buildAuthenticationContext, toAuthColumns } = require('./auth-context');
const { logAudit } = require('./audit-log');
const { persistCommandSubmission, prepareCommandSubmission } = require('./command-submissions');
const { shapeCliDispatchRecord } = require('./record-shaping');

const ROUTES = new Set(['REMOTE_EXEC', 'LOCAL_PASSTHROUGH', 'BLOCKED', 'SKIPPED']);
const FIRST_TOKEN_TYPES = new Set(['external', 'builtin', 'alias', 'function', 'keyword', 'unknown']);
const PASSTHROUGH_REASONS = new Set(['builtin', 'alias', 'function', 'shell_syntax', 'interactive_tty', 'unknown']);

function createCliDispatchService(db, options = {}) {
    const policyEngine = new PolicyEngine(db);
    const broadcast = options.broadcast;
    const onApproved = options.onApproved;

    function createDispatch(payload, principal, authentication) {
        const rawCommand = String(payload.rawCommand || '').trim();
        if (isBlankCommand(rawCommand) || isCommentOnlyCommand(rawCommand)) {
            return {
                statusCode: 200,
                body: {
                    dispatchId: null,
                    route: 'SKIPPED',
                    reason: 'Command is intentionally skipped',
                    riskLevel: 'LOW',
                    executionMode: config.EXEC_DEFAULT_MODE,
                    threshold: {
                        requiredApprovals: 0,
                        rationaleRequired: false
                    },
                    matchedRules: [],
                    commandId: null,
                    redactionSummary: {
                        command: false,
                        args: false,
                        metadata: false,
                        output: false,
                        error: false,
                        metadataPaths: []
                    }
                }
            };
        }

        const metadata = payload.metadata || {};
        const workingDir = payload.workingDir || null;
        const firstTokenType = normalizeFirstTokenType(payload.firstTokenType);
        const tokens = tokenizeCommand(rawCommand);
        const parsedCommand = parseSimpleCommand(rawCommand);
        const firstToken = payload.firstToken || (tokens.length > 0 ? tokens[0] : null);
        const shellSyntax = Boolean(payload.hasShellSyntax) || hasShellSyntax(rawCommand);
        const interactiveHint = Boolean(payload.interactiveHint) || isLikelyInteractiveCommand(rawCommand);
        const simulation = policyEngine.simulate({
            command: rawCommand,
            args: [],
            metadata,
            workingDir
        });
        const redactedInput = redactCommandInput({
            command: rawCommand,
            args: [],
            metadata
        });
        const routeResult = determineDispatchRoute({
            allowed: simulation.allowed,
            reason: simulation.reason,
            firstTokenType,
            shellSyntax,
            interactiveHint,
            parsedCommand
        });
        const dispatchId = uuidv4();
        const now = new Date().toISOString();
        const redactionSummary = buildRedactionSummary(redactedInput.summary);
        const authColumns = toAuthColumns(authentication);
        const authenticationContext = buildAuthenticationContext(authentication);

        db.prepare(`
            INSERT INTO cli_dispatches (
                id, command, requester, requester_type, auth_mode, auth_credential_id, auth_credential_label, metadata, exec_command, working_dir,
                shell, session_id, first_token, first_token_type, has_shell_syntax,
                interactive_hint, route, reason, passthrough_reason, risk_level,
                execution_mode, status, command_id, local_exit_code, local_signal,
                duration_ms, completed_at, redaction_summary, redacted, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            dispatchId,
            redactedInput.command,
            principal.identifier,
            principal.type,
            authColumns.authMode,
            authColumns.authCredentialId,
            authColumns.authCredentialLabel,
            JSON.stringify(redactedInput.metadata || {}),
            encryptJson(rawCommand, config.EXEC_DATA_KEY),
            workingDir,
            payload.shell || 'unknown',
            payload.sessionId || null,
            firstToken,
            firstTokenType,
            shellSyntax ? 1 : 0,
            interactiveHint ? 1 : 0,
            routeResult.route,
            routeResult.reason,
            routeResult.passthroughReason,
            simulation.riskLevel,
            simulation.executionMode,
            routeResult.status,
            null,
            null,
            null,
            null,
            null,
            JSON.stringify(redactionSummary),
            redactedInput.redacted ? 1 : 0,
            now,
            now
        );

        logAudit(db, 'cli_dispatch_created', 'cli_dispatch', dispatchId, principal.identifier, {
            ...addAuthDetails({
                command: redactedInput.command,
                route: routeResult.route,
                riskLevel: simulation.riskLevel,
                executionMode: simulation.executionMode,
                shell: payload.shell || 'unknown'
            }, authentication)
        });
        if (broadcast) {
            broadcast('cli_dispatch_created', {
                id: dispatchId,
                route: routeResult.route,
                riskLevel: simulation.riskLevel,
                authenticationContext
            });
        }

        if (routeResult.route === 'BLOCKED') {
            logAudit(db, 'cli_dispatch_blocked', 'cli_dispatch', dispatchId, principal.identifier, {
                ...addAuthDetails({
                    command: redactedInput.command,
                    reason: routeResult.reason,
                    riskLevel: simulation.riskLevel
                }, authentication)
            });

            return {
                statusCode: 200,
                body: buildDispatchResponse({
                    dispatchId,
                    route: routeResult.route,
                    reason: routeResult.reason,
                    simulation,
                    redactionSummary,
                    commandId: null,
                    authenticationContext
                })
            };
        }

        if (routeResult.route === 'REMOTE_EXEC') {
            const prepared = prepareCommandSubmission(db, {
                command: parsedCommand.command,
                args: parsedCommand.args,
                metadata
            });

            if (!prepared.evaluation.allowed) {
                db.prepare(`
                    UPDATE cli_dispatches
                    SET route = 'BLOCKED', reason = ?, status = 'blocked', updated_at = ?
                    WHERE id = ?
                `).run(prepared.evaluation.reason, new Date().toISOString(), dispatchId);

                logAudit(db, 'cli_dispatch_blocked', 'cli_dispatch', dispatchId, principal.identifier, {
                    ...addAuthDetails({
                        command: redactedInput.command,
                        reason: prepared.evaluation.reason,
                        riskLevel: prepared.evaluation.riskLevel
                    }, authentication)
                });

                return {
                    statusCode: 200,
                    body: buildDispatchResponse({
                        dispatchId,
                        route: 'BLOCKED',
                        reason: prepared.evaluation.reason,
                        simulation,
                        redactionSummary,
                        commandId: null,
                        authenticationContext
                    })
                };
            }

            const commandData = persistCommandSubmission({
                db,
                broadcast,
                onApproved,
                principal,
                requester: principal.identifier,
                requesterType: principal.type,
                command: parsedCommand.command,
                args: parsedCommand.args,
                metadata,
                timeoutHours: null,
                workingDir,
                evaluation: prepared.evaluation,
                redactedInput: prepared.redactedInput,
                authentication
            });

            db.prepare(`
                UPDATE cli_dispatches
                SET status = 'linked_command', command_id = ?, updated_at = ?
                WHERE id = ?
            `).run(commandData.id, new Date().toISOString(), dispatchId);

            logAudit(db, 'cli_dispatch_linked_command', 'cli_dispatch', dispatchId, principal.identifier, {
                ...addAuthDetails({
                    commandId: commandData.id,
                    route: 'REMOTE_EXEC',
                    riskLevel: commandData.riskLevel
                }, authentication)
            });
            if (broadcast) {
                broadcast('cli_dispatch_linked_command', {
                    id: dispatchId,
                    commandId: commandData.id,
                    authenticationContext
                });
            }

            return {
                statusCode: 201,
                body: buildDispatchResponse({
                    dispatchId,
                    route: routeResult.route,
                    reason: routeResult.reason,
                    simulation,
                    redactionSummary,
                    commandId: commandData.id,
                    authenticationContext
                })
            };
        }

        return {
            statusCode: 201,
            body: buildDispatchResponse({
                dispatchId,
                route: routeResult.route,
                reason: routeResult.reason,
                simulation,
                redactionSummary,
                commandId: null,
                authenticationContext
            })
        };
    }

    function completeDispatch(dispatchId, payload, principal, authentication) {
        const row = db.prepare('SELECT * FROM cli_dispatches WHERE id = ?').get(dispatchId);
        if (!row) {
            return { statusCode: 404, body: { error: 'CLI dispatch not found' } };
        }

        if (!canAccessDispatch(row, principal, authentication)) {
            return { statusCode: 403, body: { error: 'Not authorized for this CLI dispatch' } };
        }

        if (row.route !== 'LOCAL_PASSTHROUGH') {
            return { statusCode: 400, body: { error: 'Only local passthrough dispatches can be completed' } };
        }

        if (!['created', 'local_failed', 'local_completed'].includes(row.status)) {
            return { statusCode: 400, body: { error: `CLI dispatch is ${row.status}, not completable` } };
        }

        const nextStatus = Number(payload.exitCode) === 0 ? 'local_completed' : 'local_failed';
        db.prepare(`
            UPDATE cli_dispatches
            SET local_exit_code = ?, local_signal = ?, duration_ms = ?, completed_at = ?, status = ?, updated_at = ?
            WHERE id = ?
        `).run(
            payload.exitCode,
            payload.signal || null,
            payload.durationMs,
            payload.completedAt,
            nextStatus,
            new Date().toISOString(),
            dispatchId
        );

        logAudit(db, nextStatus === 'local_completed' ? 'cli_dispatch_local_completed' : 'cli_dispatch_local_failed', 'cli_dispatch', dispatchId, principal.identifier, {
            ...addAuthDetails({
                exitCode: payload.exitCode,
                durationMs: payload.durationMs,
                signal: payload.signal || null
            }, authentication || buildAuthenticationContext(row))
        });
        if (broadcast) {
            broadcast('cli_dispatch_updated', {
                id: dispatchId,
                status: nextStatus,
                localExitCode: payload.exitCode,
                authenticationContext: buildAuthenticationContext(row)
            });
        }

        const updated = db.prepare('SELECT * FROM cli_dispatches WHERE id = ?').get(dispatchId);
        return { statusCode: 200, body: shapeCliDispatchRecord(updated) };
    }

    function listDispatches(query = {}) {
        let sql = 'SELECT * FROM cli_dispatches WHERE 1=1';
        let countSql = 'SELECT COUNT(*) AS total FROM cli_dispatches WHERE 1=1';
        const params = [];
        const countParams = [];

        if (query.route && ROUTES.has(query.route)) {
            sql += ' AND route = ?';
            countSql += ' AND route = ?';
            params.push(query.route);
            countParams.push(query.route);
        }
        if (query.status) {
            sql += ' AND status = ?';
            countSql += ' AND status = ?';
            params.push(query.status);
            countParams.push(query.status);
        }
        if (query.requester) {
            sql += ' AND requester = ?';
            countSql += ' AND requester = ?';
            params.push(query.requester);
            countParams.push(query.requester);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        const limit = Number.isFinite(Number(query.limit)) ? Number(query.limit) : 50;
        const offset = Number.isFinite(Number(query.offset)) ? Number(query.offset) : 0;
        params.push(limit, offset);

        return {
            dispatches: db.prepare(sql).all(...params).map(shapeCliDispatchRecord),
            total: db.prepare(countSql).get(...countParams).total,
            limit,
            offset
        };
    }

    function getDispatch(dispatchId) {
        const dispatch = db.prepare('SELECT * FROM cli_dispatches WHERE id = ?').get(dispatchId);
        return dispatch ? shapeCliDispatchRecord(dispatch) : null;
    }

    return {
        completeDispatch,
        createDispatch,
        getDispatch,
        listDispatches
    };
}

function determineDispatchRoute(options) {
    if (!options.allowed) {
        return {
            route: 'BLOCKED',
            status: 'blocked',
            reason: options.reason,
            passthroughReason: null
        };
    }

    if (!options.parsedCommand) {
        return {
            route: 'LOCAL_PASSTHROUGH',
            status: 'created',
            reason: 'Command could not be tokenized safely',
            passthroughReason: 'unknown'
        };
    }

    if (options.firstTokenType !== 'external') {
        return {
            route: 'LOCAL_PASSTHROUGH',
            status: 'created',
            reason: `First token resolves to ${options.firstTokenType}, so the command must execute locally`,
            passthroughReason: mapPassthroughReason(options.firstTokenType)
        };
    }

    if (options.shellSyntax) {
        return {
            route: 'LOCAL_PASSTHROUGH',
            status: 'created',
            reason: 'Shell syntax requires local execution in the active shell',
            passthroughReason: 'shell_syntax'
        };
    }

    if (options.interactiveHint) {
        return {
            route: 'LOCAL_PASSTHROUGH',
            status: 'created',
            reason: 'Interactive or TTY-dependent commands require local execution',
            passthroughReason: 'interactive_tty'
        };
    }

    return {
        route: 'REMOTE_EXEC',
        status: 'linked_command',
        reason: 'Command is eligible for governed remote execution',
        passthroughReason: null
    };
}

function buildDispatchResponse({ dispatchId, route, reason, simulation, redactionSummary, commandId, authenticationContext }) {
    return {
        dispatchId,
        route,
        reason,
        riskLevel: simulation.riskLevel,
        executionMode: simulation.executionMode,
        threshold: simulation.threshold,
        matchedRules: simulation.matchedRules,
        commandId,
        redactionSummary,
        authenticationContext
    };
}

function normalizeFirstTokenType(value) {
    const normalized = String(value || 'unknown').trim().toLowerCase();
    return FIRST_TOKEN_TYPES.has(normalized) ? normalized : 'unknown';
}

function mapPassthroughReason(firstTokenType) {
    if (PASSTHROUGH_REASONS.has(firstTokenType)) {
        return firstTokenType;
    }
    if (firstTokenType === 'keyword') {
        return 'shell_syntax';
    }
    return 'unknown';
}

function canAccessDispatch(row, principal, authentication) {
    if (!principal) {
        return false;
    }

    if (authentication && authentication.mode === 'session' && Array.isArray(principal.roles) && principal.roles.includes('admin')) {
        return true;
    }

    return row.requester === principal.identifier;
}

module.exports = {
    createCliDispatchService
};
