/**
 * Rules API - Policy rule CRUD endpoints
 */

const { v4: uuidv4 } = require('uuid');
const { validateRule } = require('../policy/rules');
const { logAudit } = require('./commands');

function createRulesRouter(db, broadcast) {
    const router = require('express').Router();

    // List all rules
    router.get('/', (req, res) => {
        const { enabled, ruleType } = req.query;
        
        let query = 'SELECT * FROM rules WHERE 1=1';
        const params = [];
        
        if (enabled !== undefined) {
            query += ' AND enabled = ?';
            params.push(enabled === 'true' ? 1 : 0);
        }
        if (ruleType) {
            query += ' AND rule_type = ?';
            params.push(ruleType);
        }
        
        query += ' ORDER BY priority DESC, created_at DESC';
        
        const rules = db.prepare(query).all(...params);
        rules.forEach(r => {
            r.metadata = JSON.parse(r.metadata || '{}');
        });
        
        res.json(rules);
    });

    // Get rule by ID
    router.get('/:id', (req, res) => {
        const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found' });
        }
        rule.metadata = JSON.parse(rule.metadata || '{}');
        res.json(rule);
    });

    // Create a new rule
    router.post('/', (req, res) => {
        const { name, description, rule_type, pattern, risk_level, priority, metadata } = req.body;
        
        const validation = validateRule({ name, rule_type, pattern, risk_level });
        if (!validation.valid) {
            return res.status(400).json({ error: 'Validation failed', details: validation.errors });
        }
        
        const now = new Date().toISOString();
        const id = uuidv4();
        
        db.prepare(`
            INSERT INTO rules (id, name, description, rule_type, pattern, risk_level, enabled, priority, created_at, updated_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
            id, name, description || null, rule_type, pattern || null,
            risk_level || null, priority || 0, now, now,
            JSON.stringify(metadata || {})
        );
        
        logAudit(db, 'rule_created', 'rule', id, req.body.actor || 'api', {
            name, rule_type, pattern, risk_level
        });
        
        if (broadcast) {
            broadcast('rule_created', { id, name, rule_type });
        }
        
        const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
        rule.metadata = JSON.parse(rule.metadata || '{}');
        
        res.status(201).json(rule);
    });

    // Update a rule
    router.put('/:id', (req, res) => {
        const { id } = req.params;
        const existing = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Rule not found' });
        }
        
        const { name, description, rule_type, pattern, risk_level, enabled, priority, metadata } = req.body;
        
        if (rule_type || pattern) {
            const validation = validateRule({
                name: name || existing.name,
                rule_type: rule_type || existing.rule_type,
                pattern: pattern || existing.pattern,
                risk_level: risk_level || existing.risk_level
            });
            if (!validation.valid) {
                return res.status(400).json({ error: 'Validation failed', details: validation.errors });
            }
        }
        
        const now = new Date().toISOString();
        db.prepare(`
            UPDATE rules SET 
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                rule_type = COALESCE(?, rule_type),
                pattern = COALESCE(?, pattern),
                risk_level = COALESCE(?, risk_level),
                enabled = COALESCE(?, enabled),
                priority = COALESCE(?, priority),
                updated_at = ?,
                metadata = COALESCE(?, metadata)
            WHERE id = ?
        `).run(
            name || null, description || null, rule_type || null,
            pattern || null, risk_level || null,
            enabled !== undefined ? enabled : null,
            priority !== undefined ? priority : null,
            now,
            metadata ? JSON.stringify(metadata) : null,
            id
        );
        
        logAudit(db, 'rule_updated', 'rule', id, req.body.actor || 'api', {
            changes: req.body
        });
        
        if (broadcast) {
            broadcast('rule_updated', { id });
        }
        
        const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
        rule.metadata = JSON.parse(rule.metadata || '{}');
        res.json(rule);
    });

    // Delete a rule
    router.delete('/:id', (req, res) => {
        const { id } = req.params;
        const existing = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Rule not found' });
        }
        
        db.prepare('DELETE FROM rules WHERE id = ?').run(id);
        
        logAudit(db, 'rule_deleted', 'rule', id, req.body?.actor || 'api', {
            name: existing.name,
            rule_type: existing.rule_type
        });
        
        if (broadcast) {
            broadcast('rule_deleted', { id, name: existing.name });
        }
        
        res.json({ message: 'Rule deleted', id });
    });

    return router;
}

module.exports = { createRulesRouter };
