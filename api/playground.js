const { createPlaygroundService } = require('../services/playground');

function createPlaygroundRouter(db, broadcast) {
    const router = require('express').Router();
    const playground = createPlaygroundService(db, { broadcast });

    router.post('/runs', (req, res) => {
        const result = playground.createRun(req.body || {}, req.principal, req.authentication);
        res.status(result.statusCode).json(result.body);
    });

    router.post('/simulate', (req, res) => {
        const result = playground.simulateCommand(req.body || {});
        res.status(result.statusCode).json(result.body);
    });

    router.get('/runs', (req, res) => {
        res.json(playground.listRuns(req.query || {}));
    });

    router.get('/runs/:id', (req, res) => {
        const run = playground.getRun(req.params.id);
        if (!run) {
            return res.status(404).json({ error: 'Playground run not found' });
        }
        res.json({ run });
    });

    return router;
}

module.exports = {
    createPlaygroundRouter
};
