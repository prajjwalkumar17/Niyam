const crypto = require('crypto');

const { config } = require('../config');

const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

class Logger {
    constructor() {
        this.threshold = LEVELS[config.LOG_LEVEL] || LEVELS.info;
    }

    debug(event, fields) {
        this.log('debug', event, fields);
    }

    info(event, fields) {
        this.log('info', event, fields);
    }

    warn(event, fields) {
        this.log('warn', event, fields);
    }

    error(event, fields) {
        this.log('error', event, fields);
    }

    log(level, event, fields = {}) {
        if ((LEVELS[level] || LEVELS.info) < this.threshold) {
            return;
        }

        const entry = {
            timestamp: new Date().toISOString(),
            level,
            event,
            service: 'niyam',
            env: config.NODE_ENV,
            ...fields
        };
        const line = JSON.stringify(entry);

        if (level === 'error') {
            console.error(line);
            return;
        }

        console.log(line);
    }
}

function createRequestLogger(metrics) {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        req.requestId = crypto.randomUUID();
        res.setHeader('X-Request-ID', req.requestId);

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
            const route = getRouteLabel(req);
            logger.info('http_request', {
                requestId: req.requestId,
                method: req.method,
                route,
                statusCode: res.statusCode,
                durationMs: Number(durationMs.toFixed(3)),
                actor: req.actor || 'anonymous',
                ip: req.ip
            });
            metrics.incCounter('niyam_http_requests_total', {
                method: req.method,
                route,
                status: String(res.statusCode)
            });
            metrics.observeSummary('niyam_http_request_duration_ms', {
                method: req.method,
                route
            }, durationMs);
        });

        next();
    };
}

function getRouteLabel(req) {
    if (req.baseUrl && req.route && req.route.path) {
        return `${req.baseUrl}${req.route.path}`;
    }

    if (req.route && req.route.path) {
        return req.route.path;
    }

    return req.path || 'unknown';
}

const logger = new Logger();

module.exports = {
    createRequestLogger,
    logger
};
