const { createCliDispatchService } = require('../services/cli-dispatches');
const {
    validateCliDispatchCompletionPayload,
    validateCliDispatchPayload,
    validationError
} = require('./validation');

function createCliRouter(db, broadcast, auth, hooks = {}) {
    const router = require('express').Router();
    const service = createCliDispatchService(db, {
        broadcast,
        onApproved: hooks.onApproved
    });

    router.post('/dispatches', (req, res) => {
        const validation = validateCliDispatchPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const result = service.createDispatch(validation.value, req.principal);
        res.status(result.statusCode).json(result.body);
    });

    router.post('/dispatches/:id/complete', (req, res) => {
        const validation = validateCliDispatchCompletionPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }

        const result = service.completeDispatch(req.params.id, validation.value, req.principal);
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

    return router;
}

module.exports = {
    createCliRouter
};
