/**
 * Rule Definitions - Allowlist, denylist, and pattern matching
 */

/**
 * Match a command against a set of rules
 * @param {string} command - Full command string
 * @param {Array} rules - Array of rule objects from database
 * @returns {Array} Matched rules
 */
function matchRules(command, rules) {
    const matched = [];
    
    for (const rule of rules) {
        if (isMatch(command, rule)) {
            matched.push(rule);
        }
    }
    
    return matched;
}

/**
 * Check if a command matches a specific rule
 * @param {string} command - Full command string
 * @param {Object} rule - Rule object
 * @returns {boolean}
 */
function isMatch(command, rule) {
    switch (rule.rule_type) {
        case 'pattern':
            return matchPattern(command, rule.pattern);
        case 'allowlist':
            return matchAllowlist(command, rule.pattern);
        case 'denylist':
            return matchDenylist(command, rule.pattern);
        case 'risk_override':
            return matchPattern(command, rule.pattern);
        default:
            return false;
    }
}

/**
 * Match against a regex pattern
 */
function matchPattern(command, pattern) {
    if (!pattern) return false;
    try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(command);
    } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e.message);
        return false;
    }
}

/**
 * Match against allowlist (exact or glob)
 */
function matchAllowlist(command, pattern) {
    if (!pattern) return false;
    // For allowlist, support glob-style matching
    const globRegex = globToRegex(pattern);
    try {
        return globRegex.test(command);
    } catch (e) {
        return false;
    }
}

/**
 * Match against denylist (exact or glob)
 */
function matchDenylist(command, pattern) {
    if (!pattern) return false;
    const globRegex = globToRegex(pattern);
    try {
        return globRegex.test(command);
    } catch (e) {
        return false;
    }
}

/**
 * Convert glob pattern to regex
 * Supports * (any chars) and ? (single char)
 */
function globToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Validate a rule before saving
 * @param {Object} rule - Rule object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateRule(rule) {
    const errors = [];
    
    if (!rule.name || rule.name.trim().length === 0) {
        errors.push('Rule name is required');
    }
    
    if (!['allowlist', 'denylist', 'pattern', 'risk_override'].includes(rule.rule_type)) {
        errors.push(`Invalid rule type: ${rule.rule_type}`);
    }
    
    if (rule.rule_type === 'risk_override' && !['HIGH', 'MEDIUM', 'LOW'].includes(rule.risk_level)) {
        errors.push('Risk override rules must specify a valid risk_level');
    }
    
    if (rule.pattern) {
        try {
            new RegExp(rule.pattern, 'i');
        } catch (e) {
            errors.push(`Invalid regex pattern: ${e.message}`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    matchRules,
    isMatch,
    validateRule,
    globToRegex
};
