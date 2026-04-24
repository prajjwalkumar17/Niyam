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

function validateCliDispatchPayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    const rawCommand = typeof value.rawCommand === 'string' ? value.rawCommand : '';
    if (!rawCommand.trim()) {
        errors.push('Raw command is required');
    } else if (rawCommand.length > 8192) {
        errors.push('Raw command is too long');
    } else {
        normalized.rawCommand = rawCommand;
    }

    validateOptionalString(value, 'workingDir', normalized, errors, { maxLength: 1024 });
    validateOptionalString(value, 'shell', normalized, errors, { maxLength: 64 });
    validateOptionalString(value, 'sessionId', normalized, errors, { maxLength: 128 });
    validateOptionalString(value, 'firstToken', normalized, errors, { maxLength: 512 });

    if (Object.prototype.hasOwnProperty.call(value, 'firstTokenType')) {
        const allowed = ['external', 'builtin', 'alias', 'function', 'keyword', 'unknown'];
        if (!allowed.includes(value.firstTokenType)) {
            errors.push('First token type is invalid');
        } else {
            normalized.firstTokenType = value.firstTokenType;
        }
    } else {
        normalized.firstTokenType = 'unknown';
    }

    if (Object.prototype.hasOwnProperty.call(value, 'hasShellSyntax')) {
        const normalizedBoolean = normalizeBooleanLike(value.hasShellSyntax);
        if (normalizedBoolean === null) {
            errors.push('Has shell syntax must be a boolean or 0/1');
        } else {
            normalized.hasShellSyntax = normalizedBoolean;
        }
    } else {
        normalized.hasShellSyntax = false;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'interactiveHint')) {
        const normalizedBoolean = normalizeBooleanLike(value.interactiveHint);
        if (normalizedBoolean === null) {
            errors.push('Interactive hint must be a boolean or 0/1');
        } else {
            normalized.interactiveHint = normalizedBoolean;
        }
    } else {
        normalized.interactiveHint = false;
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

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateCliDispatchCompletionPayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    const exitCode = Number.parseInt(value.exitCode, 10);
    if (!Number.isFinite(exitCode) || exitCode < 0 || exitCode > 255) {
        errors.push('Exit code must be an integer between 0 and 255');
    } else {
        normalized.exitCode = exitCode;
    }

    const durationMs = Number.parseInt(value.durationMs, 10);
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 7 * 24 * 60 * 60 * 1000) {
        errors.push('Duration must be a non-negative integer no greater than seven days');
    } else {
        normalized.durationMs = durationMs;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'signal')) {
        if (value.signal !== null && typeof value.signal !== 'string') {
            errors.push('Signal must be a string or null');
        } else if (typeof value.signal === 'string' && value.signal.length > 64) {
            errors.push('Signal is too long');
        } else {
            normalized.signal = typeof value.signal === 'string' ? value.signal.trim() : null;
        }
    } else {
        normalized.signal = null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'completedAt')) {
        if (typeof value.completedAt !== 'string' || Number.isNaN(Date.parse(value.completedAt))) {
            errors.push('Completed at must be an ISO timestamp');
        } else {
            normalized.completedAt = value.completedAt;
        }
    } else {
        normalized.completedAt = new Date().toISOString();
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateCliShellLaunchPayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    const token = typeof value.token === 'string' ? value.token.trim() : '';
    if (!token) {
        errors.push('Token is required');
    } else if (token.length > 4096) {
        errors.push('Token is too long');
    } else {
        normalized.token = token;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'shell')) {
        if (typeof value.shell !== 'string') {
            errors.push('Shell must be a string');
        } else {
            const shell = value.shell.trim().toLowerCase();
            if (!['bash', 'zsh'].includes(shell)) {
                errors.push('Shell must be zsh or bash');
            } else {
                normalized.shell = shell;
            }
        }
    } else {
        normalized.shell = null;
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

function validateUserPayload(body, options = {}) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};
    const partial = Boolean(options.partial);

    if (!partial) {
        validateOptionalString(value, 'username', normalized, errors, { maxLength: 64, required: true });
        if (normalized.username && !/^[A-Za-z0-9._-]+$/.test(normalized.username)) {
            errors.push('Username may only contain letters, numbers, dots, underscores, and dashes');
        }
    }

    if (!partial) {
        if (typeof value.password !== 'string' || !value.password) {
            errors.push('Password is required');
        } else if (value.password.length > 4096) {
            errors.push('Password is too long');
        } else {
            normalized.password = value.password;
        }
    }

    if (Object.prototype.hasOwnProperty.call(value, 'displayName')) {
        if (value.displayName !== null && typeof value.displayName !== 'string') {
            errors.push('Display name must be a string or null');
        } else if (typeof value.displayName === 'string' && value.displayName.length > 128) {
            errors.push('Display name is too long');
        } else {
            normalized.displayName = typeof value.displayName === 'string' ? value.displayName.trim() : null;
        }
    } else if (!partial) {
        normalized.displayName = null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'enabled')) {
        const enabled = normalizeBooleanLike(value.enabled);
        if (enabled === null) {
            errors.push('Enabled must be a boolean or 0/1');
        } else {
            normalized.enabled = enabled;
        }
    } else if (!partial) {
        normalized.enabled = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'roles')) {
        if (!Array.isArray(value.roles) || !value.roles.every(role => typeof role === 'string')) {
            errors.push('Roles must be an array of strings');
        } else if (!value.roles.every(role => ['admin'].includes(role))) {
            errors.push('Roles may only contain admin');
        } else {
            normalized.roles = value.roles.map(role => role.trim()).filter(Boolean);
        }
    } else if (!partial) {
        normalized.roles = [];
    }

    if (Object.prototype.hasOwnProperty.call(value, 'approvalCapabilities')) {
        if (!isPlainObject(value.approvalCapabilities)) {
            errors.push('Approval capabilities must be an object');
        } else {
            const canApproveMedium = normalizeBooleanLike(value.approvalCapabilities.canApproveMedium);
            const canApproveHigh = normalizeBooleanLike(value.approvalCapabilities.canApproveHigh);
            if (canApproveMedium === null) {
                errors.push('Approval capabilities.canApproveMedium must be a boolean or 0/1');
            }
            if (canApproveHigh === null) {
                errors.push('Approval capabilities.canApproveHigh must be a boolean or 0/1');
            }
            if (canApproveMedium !== null && canApproveHigh !== null) {
                normalized.approvalCapabilities = {
                    canApproveMedium,
                    canApproveHigh
                };
            }
        }
    } else if (!partial) {
        normalized.approvalCapabilities = {
            canApproveMedium: false,
            canApproveHigh: false
        };
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateUserPasswordPayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    if (typeof value.password !== 'string' || !value.password) {
        errors.push('Password is required');
    } else if (value.password.length > 4096) {
        errors.push('Password is too long');
    } else {
        normalized.password = value.password;
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validatePasswordChangePayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    if (typeof value.currentPassword !== 'string' || !value.currentPassword) {
        errors.push('Current password is required');
    } else if (value.currentPassword.length > 4096) {
        errors.push('Current password is too long');
    } else {
        normalized.currentPassword = value.currentPassword;
    }

    if (typeof value.newPassword !== 'string' || !value.newPassword) {
        errors.push('New password is required');
    } else if (value.newPassword.length > 4096) {
        errors.push('New password is too long');
    } else {
        normalized.newPassword = value.newPassword;
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateManagedTokenPayload(body, options = {}) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};

    validateOptionalString(value, 'label', normalized, errors, { required: true, maxLength: 128 });

    if (options.userSelfService) {
        normalized.subjectType = 'user';
        return {
            valid: errors.length === 0,
            errors,
            value: normalized
        };
    }

    const subjectType = typeof value.subjectType === 'string' ? value.subjectType.trim().toLowerCase() : '';
    if (!['standalone', 'user'].includes(subjectType)) {
        errors.push('Subject type must be standalone or user');
    } else {
        normalized.subjectType = subjectType;
    }

    if (subjectType === 'standalone') {
        validateOptionalString(value, 'principalIdentifier', normalized, errors, { required: true, maxLength: 128 });
        if (Object.prototype.hasOwnProperty.call(value, 'principalDisplayName')) {
            validateOptionalString(value, 'principalDisplayName', normalized, errors, { required: false, maxLength: 128 });
        } else {
            normalized.principalDisplayName = null;
        }
    } else if (subjectType === 'user') {
        validateOptionalString(value, 'userId', normalized, errors, { required: true, maxLength: 128 });
    }

    return {
        valid: errors.length === 0,
        errors,
        value: normalized
    };
}

function validateAutoApprovalPreferencePayload(body) {
    const value = isPlainObject(body) ? body : {};
    const errors = [];
    const normalized = {};
    const mode = typeof value.autoApprovalMode === 'string' ? value.autoApprovalMode.trim().toLowerCase() : '';
    if (mode) {
        if (!['off', 'normal', 'all'].includes(mode)) {
            errors.push('Auto approval mode must be off, normal, or all');
        } else {
            normalized.autoApprovalMode = mode;
            normalized.autoApprovalEnabled = mode !== 'off';
        }
    } else {
        const enabled = normalizeBooleanLike(value.autoApprovalEnabled);
        if (enabled === null) {
            errors.push('Auto approval mode is required');
        } else {
            normalized.autoApprovalEnabled = enabled;
            normalized.autoApprovalMode = enabled ? 'normal' : 'off';
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

function normalizeBooleanLike(value) {
    if ([true, 1, '1', 'true'].includes(value)) {
        return true;
    }
    if ([false, 0, '0', 'false'].includes(value)) {
        return false;
    }
    return null;
}

function readableKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

module.exports = {
    validationError,
    validateApprovalPayload,
    validateCliDispatchCompletionPayload,
    validateCliShellLaunchPayload,
    validateCliDispatchPayload,
    validateCommandPayload,
    validateLoginBody,
    validateManagedTokenPayload,
    validateAutoApprovalPreferencePayload,
    validatePasswordChangePayload,
    validatePackActionBody,
    validateRulePayload,
    validateUserPasswordPayload,
    validateUserPayload
};
