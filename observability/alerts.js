const http = require('http');
const https = require('https');

const { config } = require('../config');
const { logger } = require('./logger');
const { metrics } = require('./metrics');

const SEVERITY_RANK = {
    info: 10,
    warn: 20,
    error: 30,
    critical: 40
};

function shouldAlert(event, severity) {
    if (!config.ALERT_WEBHOOK_URL) {
        return false;
    }

    if ((SEVERITY_RANK[severity] || 0) < (SEVERITY_RANK[config.ALERT_MIN_SEVERITY] || SEVERITY_RANK.error)) {
        return false;
    }

    return config.ALERT_EVENTS.length === 0 || config.ALERT_EVENTS.includes(event);
}

function sendAlert({ event, severity = 'error', message, details = {} }) {
    if (!shouldAlert(event, severity)) {
        return;
    }

    const payload = JSON.stringify({
        service: 'niyam',
        env: config.NODE_ENV,
        event,
        severity,
        message,
        details,
        timestamp: new Date().toISOString()
    });

    const url = new URL(config.ALERT_WEBHOOK_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        },
        timeout: config.ALERT_TIMEOUT_MS
    }, (response) => {
        response.resume();
        if (response.statusCode >= 400) {
            logger.error('alert_delivery_failed', {
                event,
                statusCode: response.statusCode
            });
            metrics.incCounter('niyam_alert_delivery_failures_total', { event }, 1, 'Failed alert deliveries');
            return;
        }

        metrics.incCounter('niyam_alerts_sent_total', { event, severity }, 1, 'Sent alerts');
    });

    request.on('timeout', () => {
        request.destroy(new Error('Alert request timed out'));
    });

    request.on('error', (error) => {
        logger.error('alert_delivery_failed', {
            event,
            error: error.message
        });
        metrics.incCounter('niyam_alert_delivery_failures_total', { event }, 1, 'Failed alert deliveries');
    });

    request.write(payload);
    request.end();
}

function maybeAlertForAuditEvent(eventType, actor, details) {
    const baseDetails = { actor, ...details };

    if (eventType === 'command_failed') {
        sendAlert({
            event: 'command_failed',
            severity: 'error',
            message: 'Command execution failed',
            details: baseDetails
        });
        return;
    }

    if (eventType === 'command_timeout') {
        sendAlert({
            event: 'command_timeout',
            severity: 'error',
            message: 'Command approval timed out',
            details: baseDetails
        });
        return;
    }

    if (eventType === 'command_rejected') {
        sendAlert({
            event: 'command_rejected',
            severity: 'warn',
            message: 'Command was rejected',
            details: baseDetails
        });
        return;
    }

    if (eventType === 'command_submitted' && (details.riskLevel === 'HIGH' || details.risk_level === 'HIGH')) {
        sendAlert({
            event: 'high_risk_submission',
            severity: 'warn',
            message: 'High-risk command submitted',
            details: baseDetails
        });
    }
}

module.exports = {
    maybeAlertForAuditEvent,
    sendAlert
};
