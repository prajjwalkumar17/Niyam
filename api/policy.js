const PolicyEngine = require('../policy/engine');
const { validateCommandPayload, validationError } = require('./validation');

function createPolicyRouter(db) {
    const router = require('express').Router();
    const policyEngine = new PolicyEngine(db);

    router.post('/simulate', (req, res) => {
        const validation = validateCommandPayload(req.body);
        if (!validation.valid) {
            return validationError(res, validation.errors);
        }
        const { command, args, metadata, workingDir } = validation.value;

        const simulation = policyEngine.simulate({
            command,
            args,
            metadata,
            workingDir: workingDir || null
        });

        res.json(simulation);
    });

    return router;
}

module.exports = {
    createPolicyRouter
};
