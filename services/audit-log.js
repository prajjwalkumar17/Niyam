const { v4: uuidv4 } = require('uuid');

const { redactAuditDetails } = require('../security/redaction');
const { logger, maybeAlertForAuditEvent, metrics } = require('../observability');

function logAudit(db, eventType, entityType, entityId, actor, details) {
    const auditRedaction = redactAuditDetails(details || {});

    db.prepare(`
        INSERT INTO audit_log (id, event_type, entity_type, entity_id, actor, details, redaction_summary, redacted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuidv4(),
        eventType,
        entityType,
        entityId,
        actor,
        JSON.stringify(auditRedaction.details),
        JSON.stringify(auditRedaction.summary),
        auditRedaction.redacted ? 1 : 0,
        new Date().toISOString()
    );

    logger.info('audit_event', {
        eventType,
        entityType,
        entityId,
        actor,
        details: auditRedaction.details
    });
    metrics.incCounter('niyam_audit_events_total', {
        event_type: eventType,
        entity_type: entityType || 'unknown'
    }, 1, 'Audit events');
    maybeAlertForAuditEvent(eventType, actor, auditRedaction.details || {});
}

module.exports = {
    logAudit
};
