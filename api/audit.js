/**
 * Audit API - Audit log retrieval, filtering, and export
 */

function createAuditRouter(db) {
    const router = require('express').Router();

    // List audit log entries
    router.get('/', (req, res) => {
        const { eventType, entityType, entityId, actor, startDate, endDate, limit, offset } = req.query;
        
        let query = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        
        if (eventType) {
            query += ' AND event_type = ?';
            params.push(eventType);
        }
        if (entityType) {
            query += ' AND entity_type = ?';
            params.push(entityType);
        }
        if (entityId) {
            query += ' AND entity_id = ?';
            params.push(entityId);
        }
        if (actor) {
            query += ' AND actor = ?';
            params.push(actor);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const limitVal = parseInt(limit) || 100;
        const offsetVal = parseInt(offset) || 0;
        query += ' LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);
        
        const entries = hydrateAuditEntries(db, db.prepare(query).all(...params));
        
        res.json({
            entries,
            limit: limitVal,
            offset: offsetVal
        });
    });

    // Get audit stats
    router.get('/stats', (req, res) => {
        const eventTypes = db.prepare(`
            SELECT event_type, COUNT(*) as count 
            FROM audit_log 
            GROUP BY event_type 
            ORDER BY count DESC
        `).all();
        
        const recentActivity = db.prepare(`
            SELECT event_type, COUNT(*) as count 
            FROM audit_log 
            WHERE created_at >= datetime('now', '-24 hours')
            GROUP BY event_type 
            ORDER BY count DESC
        `).all();
        
        const topActors = db.prepare(`
            SELECT actor, COUNT(*) as count 
            FROM audit_log 
            GROUP BY actor 
            ORDER BY count DESC 
            LIMIT 10
        `).all();
        
        res.json({ eventTypes, recentActivity, topActors });
    });

    // Export audit log as JSON
    router.get('/export', (req, res) => {
        const { startDate, endDate, format } = req.query;
        
        let query = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }
        
        query += ' ORDER BY created_at ASC';
        
        const entries = hydrateAuditEntries(db, db.prepare(query).all(...params));
        
        if (format === 'csv') {
            // Simple CSV export
            const headers = ['id', 'event_type', 'entity_type', 'entity_id', 'actor', 'details', 'created_at'];
            const csvRows = [headers.join(',')];
            
            for (const entry of entries) {
                csvRows.push(headers.map(h => {
                    const val = h === 'details' ? JSON.stringify(entry[h]) : entry[h];
                    return `"${String(val || '').replace(/"/g, '""')}"`;
                }).join(','));
            }
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=niyam-audit.csv');
            return res.send(csvRows.join('\n'));
        }
        
        res.setHeader('Content-Disposition', 'attachment; filename=niyam-audit.json');
        res.json(entries);
    });

    return router;
}

module.exports = { createAuditRouter };

function hydrateAuditEntries(db, rows) {
    const entries = (rows || []).map(row => ({
        ...row,
        details: parseJson(row.details, {}),
        redaction_summary: parseJson(row.redaction_summary, {}),
        redacted: Boolean(row.redacted)
    }));

    enrichCommandAuditDetails(db, entries);
    enrichCliDispatchAuditDetails(db, entries);

    return entries;
}

function enrichCommandAuditDetails(db, entries) {
    const commandIds = [...new Set(entries
        .filter(entry => entry.entity_type === 'command' && entry.entity_id && !entry.details.command)
        .map(entry => entry.entity_id))];

    if (commandIds.length === 0) {
        return;
    }

    const placeholders = commandIds.map(() => '?').join(', ');
    const commands = db.prepare(`
        SELECT id, command, args
        FROM commands
        WHERE id IN (${placeholders})
    `).all(...commandIds);
    const commandMap = new Map(commands.map(command => [
        command.id,
        {
            command: command.command,
            args: parseJson(command.args, [])
        }
    ]));

    entries.forEach(entry => {
        if (entry.entity_type !== 'command' || entry.details.command || !entry.entity_id) {
            return;
        }

        const command = commandMap.get(entry.entity_id);
        if (!command) {
            return;
        }

        entry.details.command = command.command;
        if (!Array.isArray(entry.details.args) || entry.details.args.length === 0) {
            entry.details.args = command.args;
        }
    });
}

function enrichCliDispatchAuditDetails(db, entries) {
    const dispatchIds = [...new Set(entries
        .filter(entry => entry.entity_type === 'cli_dispatch' && entry.entity_id && !entry.details.command)
        .map(entry => entry.entity_id))];

    if (dispatchIds.length === 0) {
        return;
    }

    const placeholders = dispatchIds.map(() => '?').join(', ');
    const dispatches = db.prepare(`
        SELECT id, command
        FROM cli_dispatches
        WHERE id IN (${placeholders})
    `).all(...dispatchIds);
    const dispatchMap = new Map(dispatches.map(dispatch => [dispatch.id, dispatch.command]));

    entries.forEach(entry => {
        if (entry.entity_type !== 'cli_dispatch' || entry.details.command || !entry.entity_id) {
            return;
        }

        const command = dispatchMap.get(entry.entity_id);
        if (!command) {
            return;
        }

        entry.details.command = command;
    });
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}
