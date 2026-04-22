const { config } = require('../config');
const { logAudit } = require('../services/audit-log');
const { createUsersService } = require('../services/users');
const {
    validateApprovalPayload,
    validateUserPayload,
    validationError
} = require('./validation');

function createSignupRequestsRouter(db, auth) {
    const router = require('express').Router();
    const users = createUsersService(db);

    router.post('/', (req, res) => {
        if (!config.ENABLE_SELF_SIGNUP) {
            return res.status(404).json({ error: 'Self-signup is disabled' });
        }

        const validation = validateUserPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const request = users.createSignupRequest(validation.value, {
                source: 'self_signup'
            });
            logAudit(db, 'signup_requested', 'signup_request', request.id, validation.value.username, {
                username: request.username,
                displayName: request.displayName
            });
            return res.status(201).json(request);
        } catch (error) {
            if (['duplicate_username', 'duplicate_signup_request'].includes(error.code)) {
                return res.status(409).json({ error: error.message });
            }
            throw error;
        }
    });

    router.get('/', auth.requireAdmin, (_req, res) => {
        res.json({ requests: users.listSignupRequests() });
    });

    router.post('/:id/approve', auth.requireAdmin, (req, res) => {
        const validation = validateUserPayload(req.body, { partial: true });
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const result = users.approveSignupRequest(req.params.id, req.actor, validation.value);
            logAudit(db, 'signup_approved', 'signup_request', result.request.id, req.actor, {
                username: result.request.username,
                userId: result.user.id,
                roles: result.user.roles,
                approvalCapabilities: result.user.approvalCapabilities
            });
            return res.json(result);
        } catch (error) {
            if (error.code === 'not_found') {
                return res.status(404).json({ error: error.message });
            }
            if (['signup_request_closed', 'duplicate_username'].includes(error.code)) {
                return res.status(409).json({ error: error.message });
            }
            throw error;
        }
    });

    router.post('/:id/reject', auth.requireAdmin, (req, res) => {
        const validation = validateApprovalPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const request = users.rejectSignupRequest(req.params.id, req.actor, validation.value.rationale);
            logAudit(db, 'signup_rejected', 'signup_request', request.id, req.actor, {
                username: request.username,
                rationale: validation.value.rationale || null
            });
            return res.json(request);
        } catch (error) {
            if (error.code === 'not_found') {
                return res.status(404).json({ error: error.message });
            }
            if (error.code === 'signup_request_closed') {
                return res.status(409).json({ error: error.message });
            }
            throw error;
        }
    });

    return router;
}

module.exports = {
    createSignupRequestsRouter
};
