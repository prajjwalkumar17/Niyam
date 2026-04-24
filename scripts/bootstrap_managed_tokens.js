#!/usr/bin/env node

const Database = require('better-sqlite3');

const { config } = require('../config');
const { createTokensService } = require('../services/tokens');

function main(argv) {
    const options = parseArgs(argv);
    const labels = String(options.labels || process.env.NIYAM_BOOTSTRAP_TOKEN_LABELS || '')
        .split(',')
        .map(label => label.trim())
        .filter(Boolean);

    if (labels.length === 0) {
        process.stdout.write(`${JSON.stringify({ ok: true, tokens: [] })}\n`);
        return;
    }

    const db = new Database(config.DB_PATH);
    db.pragma('foreign_keys = ON');

    try {
        const tokensService = createTokensService(db);
        const createdBy = options['created-by'] || process.env.NIYAM_BOOTSTRAP_CREATED_BY || 'system:bootstrap';
        const tokens = labels.map(label => {
            const created = tokensService.createManagedToken({
                label,
                subjectType: 'standalone',
                principalIdentifier: label,
                principalDisplayName: label,
                metadata: {
                    source: 'bootstrap_script'
                }
            }, createdBy);

            return {
                ...created.token,
                plainTextToken: created.plainTextToken
            };
        });

        process.stdout.write(`${JSON.stringify({ ok: true, tokens }, null, 2)}\n`);
    } finally {
        db.close();
    }
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith('--')) {
            continue;
        }

        const key = value.slice(2);
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
            options[key] = next;
            index += 1;
        } else {
            options[key] = true;
        }
    }
    return options;
}

main(process.argv.slice(2));
