const path = require('path');

const { config } = require('../config');
const { createCliDispatchService } = require('../services/cli-dispatches');
const { createCliShellLauncher } = require('../services/cli-shell-launcher');
const { createTokensService } = require('../services/tokens');
const {
    validateCliDispatchCompletionPayload,
    validateCliShellLaunchPayload,
    validateCliDispatchPayload,
    validationError
} = require('./validation');

function createCliRouter(db, broadcast, auth, hooks = {}) {
    const router = require('express').Router();
    const service = createCliDispatchService(db, {
        broadcast,
        onApproved: hooks.onApproved
    });
    const tokens = createTokensService(db);
    const shellLauncher = createCliShellLauncher({
        cliBinPath: path.join(config.ROOT_DIR, 'bin', 'niyam-cli.js'),
        baseUrl: `http://127.0.0.1:${config.PORT}`
    });

    router.post('/dispatches', (req, res) => {
        const validation = validateCliDispatchPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const result = service.createDispatch(validation.value, req.principal, req.authentication);
        res.status(result.statusCode).json(result.body);
    });

    router.post('/dispatches/:id/complete', (req, res) => {
        const validation = validateCliDispatchCompletionPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const result = service.completeDispatch(req.params.id, validation.value, req.principal, req.authentication);
        res.status(result.statusCode).json(result.body);
    });

    router.get('/dispatches', auth.requireAdmin, (req, res) => {
        res.json(service.listDispatches(req.query));
    });

    router.get('/dispatches/:id', auth.requireAdmin, (req, res) => {
        const dispatch = service.getDispatch(req.params.id);
        if (!dispatch) {
            return res.status(404).json({ error: 'CLI dispatch not found' });
        }

        res.json(dispatch);
    });

    router.post('/open-shell', auth.requireUserSession, (req, res) => {
        if (config.PROFILE !== 'local') {
            return res.status(403).json({ error: 'Opening a local shell from the dashboard is only available in the local profile' });
        }

        const validation = validateCliShellLaunchPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const authenticated = tokens.authenticateManagedToken(validation.value.token);
        if (!authenticated) {
            return res.status(401).json({ error: 'Managed token authentication failed' });
        }

        try {
            const launch = shellLauncher.openShell(validation.value);
            return res.json({
                opened: true,
                shell: launch.shell,
                terminalApp: launch.terminalApp
            });
        } catch (error) {
            if (['validation_error', 'unsupported_platform', 'terminal_unavailable', 'launch_failed'].includes(error.code)) {
                return res.status(400).json({ error: error.message });
            }
            throw error;
        }
    });

    return router;
}

module.exports = {
    createCliRouter
};
