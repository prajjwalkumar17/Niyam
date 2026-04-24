const { config } = require('../config');
const { logAudit } = require('../services/audit-log');
const { createUsersService } = require('../services/users');
const {
    validateUserPasswordPayload,
    validateUserPayload,
    validationError
} = require('./validation');

function createUsersRouter(db) {
    const router = require('express').Router();
    const users = createUsersService(db);

    function rejectInIndividualMode(res) {
        return res.status(403).json({ error: 'Local user management is unavailable in individual mode' });
    }

    router.get('/', (_req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        res.json({ users: users.listUsers() });
    });

    router.post('/', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        const validation = validateUserPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const user = users.createUser(validation.value);
            logAudit(db, 'user_created', 'user', user.id, req.actor, {
                username: user.username,
                displayName: user.displayName,
                enabled: user.enabled,
                roles: user.roles,
                approvalCapabilities: user.approvalCapabilities
            });
            res.status(201).json(user);
        } catch (error) {
            if (error.code === 'duplicate_username') {
                return res.status(409).json({ error: error.message });
            }
            throw error;
        }
    });

    router.put('/:id', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        const validation = validateUserPayload(req.body, { partial: true });
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const user = users.updateUser(req.params.id, validation.value);
            logAudit(db, 'user_updated', 'user', user.id, req.actor, {
                username: user.username,
                changes: req.body
            });
            res.json(user);
        } catch (error) {
            if (error.code === 'not_found') {
                return res.status(404).json({ error: error.message });
            }
            if (error.code === 'last_admin') {
                return res.status(400).json({ error: error.message });
            }
            throw error;
        }
    });

    router.post('/:id/password', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        const validation = validateUserPasswordPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const user = users.setPassword(req.params.id, validation.value.password);
            logAudit(db, 'user_password_reset', 'user', user.id, req.actor, {
                username: user.username
            });
            res.json({
                id: user.id,
                username: user.username,
                passwordUpdated: true
            });
        } catch (error) {
            if (error.code === 'not_found') {
                return res.status(404).json({ error: error.message });
            }
            throw error;
        }
    });

    return router;
}

module.exports = {
    createUsersRouter
};
