const {
    applyPackUpgrade,
    getPack,
    installPack,
    listPacks,
    previewPackUpgrade
} = require('../policy/packs');
const { logAudit } = require('../services/audit-log');
const { validatePackActionBody, validationError } = require('./validation');

function createRulePacksRouter(db) {
    const router = require('express').Router();

    router.get('/', (req, res) => {
        res.json(listPacks(db));
    });

    router.get('/:packId', (req, res) => {
        try {
            res.json(getPack(db, req.params.packId));
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    router.post('/:packId/install', (req, res) => {
        try {
            const bodyValidation = validatePackActionBody(req.body);
            if (!bodyValidation.valid) {
                return validationError(res, bodyValidation.errors);
            }
            const result = installPack(db, req.params.packId, bodyValidation.value.mode);
            logAudit(db, 'rule_pack_installed', 'rule_pack', req.params.packId, req.actor, {
                packId: req.params.packId,
                inserted: result.inserted.length,
                skipped: result.skipped.length
            });
            res.status(201).json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    router.post('/:packId/upgrade-preview', (req, res) => {
        try {
            const result = previewPackUpgrade(db, req.params.packId);
            logAudit(db, 'rule_pack_upgrade_previewed', 'rule_pack', req.params.packId, req.actor, {
                packId: req.params.packId,
                upgradable: result.upgradable_rules.length,
                conflicts: result.local_conflicts.length
            });
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    router.post('/:packId/upgrade', (req, res) => {
        try {
            const result = applyPackUpgrade(db, req.params.packId);
            logAudit(db, 'rule_pack_upgraded', 'rule_pack', req.params.packId, req.actor, {
                packId: req.params.packId,
                applied: result.applied.length,
                inserted: result.inserted.length,
                conflicts: result.local_conflicts.length
            });
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    return router;
}

module.exports = {
    createRulePacksRouter
};
