const { config } = require('../config');

const DEFAULT_REPLACEMENT = '[REDACTED]';
const SENSITIVE_FLAG_REGEX = /^--?(?:token|password|secret|api[-_]?key|access[-_]?token|auth[-_]?token)$/i;
const GH_TOKEN_REGEX = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const OPENAI_TOKEN_REGEX = /\bsk-[A-Za-z0-9]{20,}\b/g;
const SLACK_TOKEN_REGEX = /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/g;
const AWS_ACCESS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;

function redactCommandInput({ command, args, metadata }) {
    const commandResult = redactFreeText(command);
    const argsResult = redactArgList(args);
    const metadataResult = redactObject(metadata, { path: [] });

    return {
        command: commandResult.value,
        args: argsResult.value,
        metadata: metadataResult.value,
        redacted: commandResult.changed || argsResult.changed || metadataResult.changed,
        summary: {
            command: commandResult.changed,
            args: argsResult.changed,
            metadata: metadataResult.changed,
            metadataPaths: metadataResult.paths
        }
    };
}

function redactExecutionOutput({ stdout, stderr }) {
    const stdoutResult = redactFreeText(stdout);
    const stderrResult = redactFreeText(stderr);

    return {
        stdout: stdoutResult.value,
        stderr: stderrResult.value,
        redacted: stdoutResult.changed || stderrResult.changed,
        summary: {
            output: stdoutResult.changed,
            error: stderrResult.changed
        }
    };
}

function redactAuditDetails(details) {
    const result = redactObject(details, { path: [] });
    return {
        details: result.value,
        redacted: result.changed,
        summary: {
            metadataPaths: result.paths
        }
    };
}

function redactStructuredData(value) {
    return redactUnknown(value, { path: [] }).value;
}

function redactForPreview({ command, args, metadata }) {
    const result = redactCommandInput({ command, args, metadata });
    return {
        commandChanged: result.summary.command,
        argsChanged: result.summary.args,
        metadataChanged: result.summary.metadata,
        metadataPaths: result.summary.metadataPaths
    };
}

function buildRedactionSummary(...summaries) {
    const merged = {
        command: false,
        args: false,
        metadata: false,
        output: false,
        error: false,
        metadataPaths: []
    };

    for (const summary of summaries) {
        if (!summary) {
            continue;
        }

        merged.command = merged.command || Boolean(summary.command);
        merged.args = merged.args || Boolean(summary.args);
        merged.metadata = merged.metadata || Boolean(summary.metadata);
        merged.output = merged.output || Boolean(summary.output);
        merged.error = merged.error || Boolean(summary.error);

        if (Array.isArray(summary.metadataPaths)) {
            for (const path of summary.metadataPaths) {
                if (!merged.metadataPaths.includes(path)) {
                    merged.metadataPaths.push(path);
                }
            }
        }
    }

    return merged;
}

function redactFreeText(value) {
    const text = toText(value);
    if (!config.REDACTION_ENABLED || !text) {
        return { value: text, changed: false };
    }

    let redacted = text;
    const replacement = config.REDACTION_REPLACEMENT || DEFAULT_REPLACEMENT;

    redacted = redacted.replace(/\b(Bearer)\s+([A-Za-z0-9._-]+)/gi, `$1 ${replacement}`);
    redacted = redacted.replace(
        /\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)=([^\s]+)/g,
        `$1=${replacement}`
    );
    redacted = redacted.replace(
        /(--(?:token|password|secret|api-key|api_key|apikey|access-token|auth-token))(=)([^\s]+)/gi,
        `$1$2${replacement}`
    );
    redacted = redacted.replace(
        /(--(?:token|password|secret|api-key|api_key|apikey|access-token|auth-token))(\s+)([^\s]+)/gi,
        `$1$2${replacement}`
    );
    redacted = redacted.replace(/\b(AWS_SECRET_ACCESS_KEY)([:=]\s*)([^\s]+)/gi, `$1$2${replacement}`);
    redacted = replacePattern(redacted, GH_TOKEN_REGEX, replacement);
    redacted = replacePattern(redacted, OPENAI_TOKEN_REGEX, replacement);
    redacted = replacePattern(redacted, SLACK_TOKEN_REGEX, replacement);

    if (!config.REDACTION_DISABLE_HEURISTICS) {
        redacted = replacePattern(redacted, AWS_ACCESS_KEY_REGEX, replacement);
    }

    return {
        value: redacted,
        changed: redacted !== text
    };
}

function redactArgList(args) {
    const source = Array.isArray(args) ? args : [];
    const output = [];
    let changed = false;
    let expectSensitiveValue = false;

    for (const rawArg of source) {
        const arg = toText(rawArg);

        if (expectSensitiveValue) {
            output.push(config.REDACTION_REPLACEMENT);
            changed = true;
            expectSensitiveValue = false;
            continue;
        }

        if (SENSITIVE_FLAG_REGEX.test(arg)) {
            output.push(arg);
            expectSensitiveValue = true;
            continue;
        }

        const inlineFlag = arg.match(/^(--(?:token|password|secret|api-key|api_key|apikey|access-token|auth-token))=(.+)$/i);
        if (inlineFlag) {
            output.push(`${inlineFlag[1]}=${config.REDACTION_REPLACEMENT}`);
            changed = true;
            continue;
        }

        const envAssignment = arg.match(/^([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)=(.+)$/);
        if (envAssignment) {
            output.push(`${envAssignment[1]}=${config.REDACTION_REPLACEMENT}`);
            changed = true;
            continue;
        }

        const redacted = redactFreeText(arg);
        output.push(redacted.value);
        changed = changed || redacted.changed;
    }

    return { value: output, changed };
}

function redactObject(value, options = {}) {
    const result = redactUnknown(value, options);
    return {
        value: result.value,
        changed: result.changed,
        paths: result.paths
    };
}

function redactUnknown(value, options = {}) {
    const path = options.path || [];
    const sensitive = options.sensitive || false;
    const paths = [];

    if (value === null || value === undefined) {
        return { value, changed: false, paths };
    }

    if (Array.isArray(value)) {
        let changed = false;
        const redacted = value.map((item, index) => {
            const next = redactUnknown(item, { path: [...path, String(index)], sensitive });
            changed = changed || next.changed;
            paths.push(...next.paths);
            return next.value;
        });
        return { value: redacted, changed, paths };
    }

    if (typeof value === 'object') {
        let changed = false;
        const redacted = {};

        for (const [key, item] of Object.entries(value)) {
            const itemSensitive = sensitive || isSensitiveKey(key);
            const next = redactUnknown(item, { path: [...path, key], sensitive: itemSensitive });
            redacted[key] = next.value;
            changed = changed || next.changed;
            paths.push(...next.paths);
        }

        return { value: redacted, changed, paths };
    }

    if (typeof value === 'string') {
        if (sensitive) {
            return {
                value: config.REDACTION_REPLACEMENT,
                changed: value !== config.REDACTION_REPLACEMENT,
                paths: path.length > 0 ? [path.join('.')] : []
            };
        }

        const redacted = redactFreeText(value);
        return {
            value: redacted.value,
            changed: redacted.changed,
            paths: redacted.changed && path.length > 0 ? [path.join('.')] : []
        };
    }

    return { value, changed: false, paths };
}

function isSensitiveKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return config.REDACTION_EXTRA_KEYS.some(candidate => normalized.includes(candidate));
}

function replacePattern(text, regex, replacement) {
    regex.lastIndex = 0;
    return text.replace(regex, replacement);
}

function toText(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value);
}

module.exports = {
    buildRedactionSummary,
    redactAuditDetails,
    redactCommandInput,
    redactExecutionOutput,
    redactForPreview,
    redactStructuredData
};
