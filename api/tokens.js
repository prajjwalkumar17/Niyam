const { config } = require('../config');
const { logAudit } = require('../services/audit-log');
const { createApprovalPreferencesService } = require('../services/approval-preferences');
const { createTokensService } = require('../services/tokens');
const {
    validateAutoApprovalPreferencePayload,
    validateManagedTokenPayload,
    validationError
} = require('./validation');

function createTokensRouter(db) {
    const router = require('express').Router();
    const tokens = createTokensService(db);
    const approvalPreferences = createApprovalPreferencesService(db);

    router.get('/', (_req, res) => {
        const options = config.PRODUCT_MODE === 'individual'
            ? { subjectType: 'standalone' }
            : {};
        res.json({ tokens: tokens.listTokens(options) });
    });

    router.post('/', (req, res) => {
        const validation = validateManagedTokenPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        if (config.PRODUCT_MODE === 'individual' && validation.value.subjectType !== 'standalone') {
            return res.status(403).json({ error: 'User-linked tokens are unavailable in individual mode' });
        }

        try {
            const created = tokens.createManagedToken(validation.value, req.actor);
            logAudit(db, 'token_created', 'managed_token', created.token.id, req.actor, {
                label: created.token.label,
                subjectType: created.token.subjectType,
                userId: created.token.userId,
                principalIdentifier: created.token.principalIdentifier
            });
            return res.status(201).json({
                token: created.token,
                plainTextToken: created.plainTextToken
            });
        } catch (error) {
            return handleTokenError(res, error);
        }
    });

    router.post('/:id/block', (req, res) => {
        try {
            const token = tokens.blockToken(req.params.id, req.actor);
            logAudit(db, 'token_blocked', 'managed_token', token.id, req.actor, {
                label: token.label,
                subjectType: token.subjectType,
                userId: token.userId,
                principalIdentifier: token.principalIdentifier
            });
            return res.json({ token });
        } catch (error) {
            return handleTokenError(res, error);
        }
    });

    router.post('/:id/approval-preferences', (req, res) => {
        const validation = validateAutoApprovalPreferencePayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const token = approvalPreferences.setStandaloneTokenAutoApprovalPreference(
                req.params.id,
                validation.value.autoApprovalMode
            );
            logAudit(db, 'auto_approval_preference_changed', 'managed_token', token.id, req.actor, {
                scope: 'token',
                enabled: token.autoApprovalEnabled,
                mode: token.autoApprovalMode,
                subject: token.principalIdentifier,
                subjectType: token.subjectType,
                changedBy: req.actor
            });
            return res.json({ token });
        } catch (error) {
            return handleTokenError(res, error);
        }
    });

    return router;
}

function createMyTokensRouter(db) {
    const router = require('express').Router();
    const tokens = createTokensService(db);

    function rejectInIndividualMode(res) {
        return res.status(403).json({ error: 'Personal user-linked tokens are unavailable in individual mode' });
    }

    router.get('/', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        const userId = req.principal && req.principal.userId;
        res.json({ tokens: tokens.listTokens({ userId }) });
    });

    router.post('/', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        const validation = validateManagedTokenPayload(req.body, { userSelfService: true });
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const created = tokens.createManagedToken({
                ...validation.value,
                subjectType: 'user',
                userId: req.principal.userId
            }, req.actor);
            logAudit(db, 'token_created', 'managed_token', created.token.id, req.actor, {
                label: created.token.label,
                subjectType: created.token.subjectType,
                userId: created.token.userId,
                principalIdentifier: created.token.principalIdentifier
            });
            return res.status(201).json({
                token: created.token,
                plainTextToken: created.plainTextToken
            });
        } catch (error) {
            return handleTokenError(res, error);
        }
    });

    router.post('/:id/block', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return rejectInIndividualMode(res);
        }
        try {
            const token = tokens.blockToken(req.params.id, req.actor, {
                userId: req.principal.userId
            });
            logAudit(db, 'token_blocked', 'managed_token', token.id, req.actor, {
                label: token.label,
                subjectType: token.subjectType,
                userId: token.userId,
                principalIdentifier: token.principalIdentifier
            });
            return res.json({ token });
        } catch (error) {
            return handleTokenError(res, error);
        }
    });

    return router;
}

function handleTokenError(res, error) {
    if (error.code === 'not_found') {
        return res.status(404).json({ error: error.message });
    }
    if (['duplicate_identifier', 'already_blocked'].includes(error.code)) {
        return res.status(409).json({ error: error.message });
    }
    if (error.code === 'validation_error') {
        return res.status(400).json({ error: error.message });
    }
    throw error;
}

module.exports = {
    createMyTokensRouter,
    createTokensRouter
};
