const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const { config } = require('../../config');
const { runMigrations } = require('../../db/migrations');
const { decryptBytes, encryptBytes } = require('../../security/crypto');

const gzip = buffer => new Promise((resolve, reject) => {
    zlib.gzip(buffer, (error, result) => {
        if (error) {
            reject(error);
            return;
        }
        resolve(result);
    });
});

const gunzip = buffer => new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (error, result) => {
        if (error) {
            reject(error);
            return;
        }
        resolve(result);
    });
});

function resolveDbPath() {
    return path.resolve(config.DB_PATH);
}

function resolveBackupDir() {
    return path.resolve(config.BACKUP_DIR);
}

function readPackageVersion() {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(config.ROOT_DIR, 'package.json'), 'utf8')
    );
    return packageJson.version;
}

function timestampForPath(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

async function ensureDir(dirPath) {
    await fsPromises.mkdir(dirPath, { recursive: true });
}

function fileSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readPassphraseFile(filePath) {
    const resolved = path.resolve(filePath || '');
    if (!resolved) {
        throw new Error('Backup passphrase file is required when backup encryption is enabled');
    }

    const value = fs.readFileSync(resolved, 'utf8').trim();
    if (!value) {
        throw new Error(`Backup passphrase file is empty: ${resolved}`);
    }
    return value;
}

function listMigrationIds(db) {
    const hasSchemaMigrations = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get();

    if (!hasSchemaMigrations) {
        return [];
    }

    return db.prepare('SELECT id FROM schema_migrations ORDER BY id ASC').all().map(row => row.id);
}

function resolveSnapshotDir(snapshotPath) {
    const resolved = path.resolve(snapshotPath);
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
        return resolved;
    }
    if (path.basename(resolved) === 'metadata.json') {
        return path.dirname(resolved);
    }
    throw new Error(`Expected a backup directory or metadata.json path: ${resolved}`);
}

async function pruneBackups(backupDir, retentionDays) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        return [];
    }

    const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const pruned = [];
    const entries = await fsPromises.readdir(backupDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const fullPath = path.join(backupDir, entry.name);
        const stats = await fsPromises.stat(fullPath);
        if (stats.mtimeMs < cutoffMs) {
            await fsPromises.rm(fullPath, { recursive: true, force: true });
            pruned.push(fullPath);
        }
    }

    return pruned;
}

async function createDatabaseBackup(options = {}) {
    const dbPath = path.resolve(options.dbPath || resolveDbPath());
    const backupDir = path.resolve(options.backupDir || resolveBackupDir());
    const compress = options.compress ?? config.BACKUP_COMPRESS;
    const encrypt = options.encrypt ?? config.BACKUP_ENCRYPT;
    const retentionDays = options.retentionDays ?? config.BACKUP_RETENTION_DAYS;
    const label = options.label || 'manual';
    const passphraseFile = options.passphraseFile || config.BACKUP_PASSPHRASE_FILE;

    if (!fs.existsSync(dbPath)) {
        throw new Error(`Database not found: ${dbPath}`);
    }

    await ensureDir(backupDir);

    const snapshotDir = path.join(backupDir, timestampForPath());
    await ensureDir(snapshotDir);

    const tempDbPath = path.join(snapshotDir, 'niyam.db');
    const sourceDb = new Database(dbPath, { fileMustExist: true });
    let migrationIds = [];

    try {
        await sourceDb.backup(tempDbPath);
        migrationIds = listMigrationIds(sourceDb);
    } finally {
        sourceDb.close();
    }

    let payload = await fsPromises.readFile(tempDbPath);
    let payloadFile = 'niyam.db';
    let compression = 'none';
    let encryption = 'none';

    if (compress) {
        payload = await gzip(payload);
        payloadFile += '.gz';
        compression = 'gzip';
    }

    if (encrypt) {
        const passphrase = readPassphraseFile(passphraseFile);
        payload = Buffer.from(encryptBytes(payload, passphrase), 'utf8');
        payloadFile += '.enc';
        encryption = 'aes-256-gcm';
    }

    if (payloadFile !== 'niyam.db') {
        await fsPromises.writeFile(path.join(snapshotDir, payloadFile), payload);
        await fsPromises.rm(tempDbPath, { force: true });
    }

    const payloadPath = path.join(snapshotDir, payloadFile);
    if (payloadFile === 'niyam.db') {
        payload = await fsPromises.readFile(payloadPath);
    }

    const metadata = {
        label,
        createdAt: new Date().toISOString(),
        appVersion: readPackageVersion(),
        sourceDbPath: dbPath,
        payloadFile,
        payloadSha256: fileSha256(payload),
        payloadBytes: payload.length,
        compression,
        encryption,
        migrationIds
    };

    await fsPromises.writeFile(
        path.join(snapshotDir, 'metadata.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8'
    );

    const pruned = await pruneBackups(backupDir, retentionDays);

    return {
        snapshotDir,
        metadata,
        pruned
    };
}

async function loadBackupSnapshot(snapshotPath, options = {}) {
    const snapshotDir = resolveSnapshotDir(snapshotPath);
    const metadata = JSON.parse(
        await fsPromises.readFile(path.join(snapshotDir, 'metadata.json'), 'utf8')
    );
    const payloadPath = path.join(snapshotDir, metadata.payloadFile);

    let payload = await fsPromises.readFile(payloadPath);
    const payloadSha = fileSha256(payload);
    if (payloadSha !== metadata.payloadSha256) {
        throw new Error('Backup checksum mismatch');
    }

    if (metadata.encryption !== 'none') {
        const passphraseFile = options.passphraseFile || config.BACKUP_PASSPHRASE_FILE;
        const passphrase = readPassphraseFile(passphraseFile);
        payload = decryptBytes(payload.toString('utf8'), passphrase);
    }

    if (metadata.compression === 'gzip') {
        payload = await gunzip(payload);
    }

    return {
        snapshotDir,
        metadata,
        dbBuffer: payload
    };
}

async function restoreDatabase(snapshotPath, options = {}) {
    const targetDbPath = path.resolve(options.dbPath || resolveDbPath());
    const restoreDir = path.dirname(targetDbPath);
    const skipPreBackup = Boolean(options.skipPreBackup);
    const preRestoreLabel = options.preRestoreLabel || 'pre-restore';
    const loaded = await loadBackupSnapshot(snapshotPath, options);

    await ensureDir(restoreDir);

    let preBackup = null;
    if (!skipPreBackup && fs.existsSync(targetDbPath)) {
        preBackup = await createDatabaseBackup({
            dbPath: targetDbPath,
            backupDir: options.backupDir || resolveBackupDir(),
            label: preRestoreLabel,
            compress: options.compressBackup ?? config.BACKUP_COMPRESS,
            encrypt: options.encryptBackup ?? config.BACKUP_ENCRYPT,
            passphraseFile: options.passphraseFile || config.BACKUP_PASSPHRASE_FILE
        });
    }

    const tempRestorePath = path.join(
        restoreDir,
        `.restore-${Date.now()}-${path.basename(targetDbPath)}`
    );

    await fsPromises.writeFile(tempRestorePath, loaded.dbBuffer);

    const db = new Database(tempRestorePath);
    try {
        const integrityCheck = db.prepare('PRAGMA integrity_check').get();
        const integrityValue = integrityCheck ? Object.values(integrityCheck)[0] : 'ok';
        if (integrityValue !== 'ok') {
            throw new Error(`SQLite integrity check failed: ${integrityValue}`);
        }
        runMigrations(db);
    } finally {
        db.close();
    }

    for (const suffix of ['', '-shm', '-wal']) {
        await fsPromises.rm(`${targetDbPath}${suffix}`, { force: true });
    }

    await fsPromises.rename(tempRestorePath, targetDbPath);

    return {
        restoredDbPath: targetDbPath,
        snapshotDir: loaded.snapshotDir,
        metadata: loaded.metadata,
        preBackup: preBackup ? preBackup.snapshotDir : null
    };
}

module.exports = {
    createDatabaseBackup,
    ensureDir,
    loadBackupSnapshot,
    readPassphraseFile,
    resolveBackupDir,
    resolveDbPath,
    restoreDatabase,
    timestampForPath
};
