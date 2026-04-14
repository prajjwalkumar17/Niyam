function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateLoginBody(body) {
    const value = isPlainObject(body) ? body : {};
    const username = typeof value.username === 'string' ? value.username.trim() : '';
    const password = typeof value.password === 'string' ? value.password : '';
    const errors = [];

    if (!username) {
        errors.push('Username is required');
    }
    if (!password) {
        errors.push('Password is required');
    }
    if (username.length > 128) {
        errors.push('Username is too long');
    }
    if (password.length > 4096) {
        errors.push('Password is too long');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: { username, password }
    };
}

function validateCommandPayload(body, options = {}) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};
    const requireCommand = options.requireCommand !== false;

    if (requireCommand || Object.prototype.hasOwnProperty.call(value, 'command')) {
        const command = typeof value.command === 'string' ? value.command.trim() : '';
        if (!command) {
            errors.push('Command is required');
        } else if (command.length > 512) {
            errors.push('Command is too long');
        } else {
            normalized.command = command;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'args')) {
        if (!Array.isArray(value.args)) {
            errors.push('Args must be an array of strings');
        } else if (value.args.length > 128) {
            errors.push('Args must not exceed 128 items');
        } else {
            const args = [];
            for (const arg of value.args) {
                if (typeof arg !== 'string') {
                    errors.push('Args must be an array of strings');
                    break;
                }
                if (arg.length > 2048) {
                    errors.push('Each arg must be 2048 characters or fewer');
                    break;
                }
                args.push(arg);
            }
            normalized.args = args;
        }
    } else if (requireCommand) {
        normalized.args = [];
    }

    if (Object.prototype.hasOwnProperty.call(value, 'metadata')) {
        if (!isPlainObject(value.metadata)) {
            errors.push('Metadata must be an object');
        } else {
            normalized.metadata = value.metadata;
        }
    } else {
        normalized.metadata = {};
    }

    if (Object.prototype.hasOwnProperty.call(value, 'workingDir')) {
        if (value.workingDir !== null && typeof value.workingDir !== 'string') {
            errors.push('Working directory must be a string');
        } else if (typeof value.workingDir === 'string' && value.workingDir.length > 1024) {
            errors.push('Working directory is too long');
        } else {
            normalized.workingDir = typeof value.workingDir === 'string' ? value.workingDir.trim() : null;
        }
    } else if (Object.prototype.hasOwnProperty.call(value, 'working_dir')) {
        if (value.working_dir !== null && typeof value.working_dir !== 'string') {
            errors.push('Working directory must be a string');
        } else if (typeof value.working_dir === 'string' && value.working_dir.length > 1024) {
            errors.push('Working directory is too long');
        } else {
            normalized.workingDir = typeof value.working_dir === 'string' ? value.working_dir.trim() : null;
        }
    } else {
        normalized.workingDir = null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'timeoutHours')) {
        const timeoutHours = Number(value.timeoutHours);
        if (!Number.isFinite(timeoutHours) || timeoutHours <= 0 || timeoutHours > 168) {
            errors.push('Timeout hours must be a number between 0 and 168');
        } else {
            normalized.timeoutHours = timeoutHours;
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateApprovalPayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    if (Object.prototype.hasOwnProperty.call(value, 'rationale')) {
        if (value.rationale !== null && typeof value.rationale !== 'string') {
            errors.push('Rationale must be a string');
        } else if (typeof value.rationale === 'string' && value.rationale.length > 4000) {
            errors.push('Rationale is too long');
        } else {
            normalized.rationale = typeof value.rationale === 'string' ? value.rationale.trim() : null;
        }
    } else {
        normalized.rationale = null;
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateRulePayload(body, options = {}) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};
    const partial = Boolean(options.partial);

    validateOptionalString(value, 'name', normalized, errors, { maxLength: 128, required: !partial });
    validateOptionalString(value, 'description', normalized, errors, { maxLength: 512, allowEmpty: true });
    validateOptionalString(value, 'pattern', normalized, errors, { maxLength: 2048, allowEmpty: true });

    if (!partial || Object.prototype.hasOwnProperty.call(value, 'rule_type')) {
        const allowed = ['allowlist', 'denylist', 'pattern', 'risk_override', 'execution_mode'];
        if (!allowed.includes(value.rule_type)) {
            errors.push('Rule type is invalid');
        } else {
            normalized.rule_type = value.rule_type;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'risk_level')) {
        if (value.risk_level !== null && !['HIGH', 'MEDIUM', 'LOW'].includes(value.risk_level)) {
            errors.push('Risk level must be HIGH, MEDIUM, LOW, or null');
        } else {
            normalized.risk_level = value.risk_level;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'execution_mode')) {
        if (value.execution_mode !== null && !['DIRECT', 'WRAPPER'].includes(value.execution_mode)) {
            errors.push('Execution mode must be DIRECT, WRAPPER, or null');
        } else {
            normalized.execution_mode = value.execution_mode;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'priority')) {
        const priority = Number.parseInt(value.priority, 10);
        if (!Number.isFinite(priority) || priority < -100000 || priority > 100000) {
            errors.push('Priority must be an integer between -100000 and 100000');
        } else {
            normalized.priority = priority;
        }
    } else if (!partial) {
        normalized.priority = 0;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'enabled')) {
        if (![0, 1, true, false].includes(value.enabled)) {
            errors.push('Enabled must be a boolean or 0/1');
        } else {
            normalized.enabled = value.enabled === true || value.enabled === 1 ? 1 : 0;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'metadata')) {
        if (!isPlainObject(value.metadata)) {
            errors.push('Metadata must be an object');
        } else {
            normalized.metadata = value.metadata;
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validatePackActionBody(body) {
    const value = isPlainObject(body) ? body : {};
    const mode = value.mode === undefined ? 'install_if_missing' : value.mode;

    if (mode !== 'install_if_missing') {
        return {
            valid: false,
            errors: ['Mode must be install_if_missing'],
            value: { mode: 'install_if_missing' }
        };
    }

    return {
        valid: true,
        errors: [],
        value: { mode }
    };
}

function validationError(res, errors) {
    return res.status(400).json({
        error: 'Validation failed',
        details: errors
    });
}

function validateOptionalString(source, key, target, errors, options = {}) {
    const required = Boolean(options.required);
    const allowEmpty = Boolean(options.allowEmpty);
    const maxLength = options.maxLength || 1024;

    if (!Object.prototype.hasOwnProperty.call(source, key)) {
        if (required) {
            errors.push(`${readableKey(key)} is required`);
        }
        return;
    }

    if (source[key] === null && !required) {
        target[key] = null;
        return;
    }

    if (typeof source[key] !== 'string') {
        errors.push(`${readableKey(key)} must be a string`);
        return;
    }

    const trimmed = allowEmpty ? source[key] : source[key].trim();
    if (!allowEmpty && !trimmed) {
        errors.push(`${readableKey(key)} is required`);
        return;
    }
    if (trimmed.length > maxLength) {
        errors.push(`${readableKey(key)} is too long`);
        return;
    }

    target[key] = trimmed;
}

function readableKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

module.exports = {
    validationError,
    validateApprovalPayload,
    validateCommandPayload,
    validateLoginBody,
    validatePackActionBody,
    validateRulePayload
};
