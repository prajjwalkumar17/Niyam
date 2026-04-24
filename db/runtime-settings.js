const { config } = require('../config');

const PRODUCT_MODE_KEY = 'product_mode';

function ensureProductModeLock(db) {
    const current = db.prepare('SELECT value FROM runtime_settings WHERE key = ?').get(PRODUCT_MODE_KEY);
    if (current) {
        return current.value;
    }

    db.prepare(`
        INSERT INTO runtime_settings (key, value, updated_at)
        VALUES (?, ?, ?)
    `).run(PRODUCT_MODE_KEY, config.PRODUCT_MODE, new Date().toISOString());
    return config.PRODUCT_MODE;
}

function assertProductModeLock(db) {
    const current = db.prepare('SELECT value FROM runtime_settings WHERE key = ?').get(PRODUCT_MODE_KEY);
    if (!current) {
        return ensureProductModeLock(db);
    }

    if (current.value !== config.PRODUCT_MODE) {
        throw new Error(
            `This database was initialized in ${current.value} mode. Clear and rebuild from scratch before switching to ${config.PRODUCT_MODE} mode.`
        );
    }

    return current.value;
}

module.exports = {
    assertProductModeLock,
    ensureProductModeLock
};
