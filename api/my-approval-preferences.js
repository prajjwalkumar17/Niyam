const { config } = require('../config');
const { logAudit } = require('../services/audit-log');
const { createApprovalPreferencesService } = require('../services/approval-preferences');
const { validateAutoApprovalPreferencePayload, validationError } = require('./validation');

function createMyApprovalPreferencesRouter(db) {
    const router = require('express').Router();
    const approvalPreferences = createApprovalPreferencesService(db);

    router.post('/', (req, res) => {
        if (config.PRODUCT_MODE === 'individual') {
            return res.status(403).json({ error: 'User auto-approval preferences are unavailable in individual mode' });
        }

        const validation = validateAutoApprovalPreferencePayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        try {
            const user = approvalPreferences.setUserAutoApprovalPreference(
                req.principal.userId,
                validation.value.autoApprovalMode
            );
            logAudit(db, 'auto_approval_preference_changed', 'user', user.id, req.actor, {
                scope: 'user',
                enabled: user.autoApprovalEnabled,
                mode: user.autoApprovalMode,
                subject: user.username,
                subjectType: 'user',
                changedBy: req.actor
            });
            return res.json({
                autoApprovalEnabled: user.autoApprovalEnabled,
                autoApprovalMode: user.autoApprovalMode,
                scope: 'user'
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
    createMyApprovalPreferencesRouter
};
