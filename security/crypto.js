const crypto = require('crypto');

const ENCRYPTION_PREFIX = 'v1';
const IV_BYTES = 12;

function deriveKey(secret) {
    if (!secret) {
        throw new Error('NIYAM_EXEC_DATA_KEY is required');
    }

    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptBytes(buffer, secret) {
    if (buffer === undefined || buffer === null) {
        return null;
    }

    const key = deriveKey(secret);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
        ENCRYPTION_PREFIX,
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64')
    ].join(':');
}

function decryptBytes(payload, secret) {
    if (!payload) {
        return null;
    }

    const [prefix, ivEncoded, tagEncoded, encryptedEncoded] = String(payload).split(':');
    if (prefix !== ENCRYPTION_PREFIX || !ivEncoded || !tagEncoded || !encryptedEncoded) {
        throw new Error('Invalid encrypted payload format');
    }

    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivEncoded, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedEncoded, 'base64')),
        decipher.final()
    ]);
}

function encryptJson(value, secret) {
    if (value === undefined || value === null) {
        return null;
    }

    return encryptBytes(Buffer.from(JSON.stringify(value), 'utf8'), secret);
}

function decryptJson(payload, secret) {
    if (!payload) {
        return null;
    }

    return JSON.parse(decryptBytes(payload, secret).toString('utf8'));
}

function fingerprintSecret(secret) {
    return crypto.createHash('sha256').update(String(secret || '')).digest('hex').slice(0, 16);
}

module.exports = {
    decryptBytes,
    decryptJson,
    encryptBytes,
    encryptJson,
    fingerprintSecret
};
