const {
    validateNativeNotificationPreferencePayload,
    validationError
} = require('./validation');

function createNotificationsRouter(nativeNotifications) {
    const router = require('express').Router();

    router.get('/preferences', (_req, res) => {
        res.json({
            nativeNotificationsEnabled: nativeNotifications.isEnabled(),
            supported: nativeNotifications.isSupported(),
            platform: nativeNotifications.getPlatform()
        });
    });

    router.post('/preferences', (req, res) => {
        const validation = validateNativeNotificationPreferencePayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const enabled = nativeNotifications.setEnabled(validation.value.nativeNotificationsEnabled);
        res.json({
            nativeNotificationsEnabled: enabled,
            supported: nativeNotifications.isSupported(),
            platform: nativeNotifications.getPlatform()
        });
    });

    router.post('/test', (req, res) => {
        if (!nativeNotifications.isEnabled()) {
            return res.status(409).json({ error: 'Native notifications are off' });
        }

        const sent = nativeNotifications.sendTest(req.actor || 'Niyam');
        if (!sent) {
            return res.status(409).json({ error: 'Native notifications are not available on this host' });
        }

        return res.json({ sent: true });
    });

    return router;
}

module.exports = {
    createNotificationsRouter
};
