/**
 * Risk Classifier - Classifies commands into HIGH/MEDIUM/LOW risk levels
 */

// Built-in risk patterns
const RISK_PATTERNS = {
    HIGH: [
        /\bpr\s+merge\b/i,
        /\bpush\s+.*--force\b/i,
        /\bpush\s+.*-f\b/i,
        /\bbranch\s+delete\b/i,
        /\bbranch\s+-[dD]\s+\S+/i,
        /\brepo\s+delete\b/i,
        /\brepo\s+remove\b/i,
        /\bworkflow\s+run\b/i,
        /\bworkflow\s+dispatch\b/i,
        /\bsecret\s+set\b/i,
        /\bsecrets\s+set\b/i,
        /\brm\s+-rf/i,
        /\bdelete\s+--force/i,
        /\bdd\s+/i,
        /\bchmod\s+777/i,
        /\bchown\s+/i,
    ],
    MEDIUM: [
        /\bpr\s+create\b/i,
        /\bpr\s+close\b/i,
        /\bissue\s+close\b/i,
        /\bbranch\s+create\b/i,
        /\brepo\s+edit\b/i,
        /\brepo\s+create\b/i,
        /\bpush\s+/i,
        /\bmerge\b/i,
        /\brebase\b/i,
        /\bdeploy\b/i,
        /\brelease\s+create\b/i,
        /\btag\s+create\b/i,
    ],
    LOW: [
        /\bpr\s+view\b/i,
        /\bpr\s+list\b/i,
        /\bpr\s+checks\b/i,
        /\bissue\s+view\b/i,
        /\bissue\s+list\b/i,
        /\brepo\s+view\b/i,
        /\brepo\s+list\b/i,
        /\brepo\s+clone\b/i,
        /\bbranch\s+list\b/i,
        /\bbranch\s+view\b/i,
        /\bworkflow\s+list\b/i,
        /\bworkflow\s+view\b/i,
        /\bgit\s+status/i,
        /\bgit\s+log/i,
        /\bgit\s+diff/i,
        /\bgit\s+fetch/i,
        /\bgit\s+pull/i,
        /\bls\b/i,
        /\bcat\b/i,
        /\bgrep\b/i,
        /\bfind\b/i,
    ]
};

// Approval thresholds by risk level
const APPROVAL_THRESHOLDS = {
    HIGH: {
        requiredApprovals: 2,
        defaultTimeoutHours: 10,
        rationaleRequired: true
    },
    MEDIUM: {
        requiredApprovals: 1,
        defaultTimeoutHours: 10,
        rationaleRequired: false
    },
    LOW: {
        requiredApprovals: 0,
        defaultTimeoutHours: 10,
        rationaleRequired: false
    }
};

/**
 * Classify the risk level of a command
 * @param {string} command - The full command string
 * @param {Array} matchedRules - Rules matched by the command
 * @returns {Object} Classification result
 */
function classifyRisk(command, matchedRules = []) {
    // Check for risk overrides from custom rules first
    const overrideRule = matchedRules.find(r => r.rule_type === 'risk_override');
    if (overrideRule && overrideRule.risk_level) {
        return {
            riskLevel: overrideRule.risk_level,
            source: 'rule_override',
            confidence: 'high'
        };
    }

    // Check patterns from highest to lowest risk
    for (const level of ['HIGH', 'MEDIUM', 'LOW']) {
        for (const pattern of RISK_PATTERNS[level]) {
            if (pattern.test(command)) {
                return {
                    riskLevel: level,
                    source: 'pattern_match',
                    matchedPattern: pattern.source,
                    confidence: 'high'
                };
            }
        }
    }

    // Default to MEDIUM if no pattern matches (safer default)
    return {
        riskLevel: 'MEDIUM',
        source: 'default',
        confidence: 'low'
    };
}

/**
 * Get approval threshold for a risk level
 * @param {string} riskLevel - HIGH, MEDIUM, or LOW
 * @returns {Object} Threshold configuration
 */
function getApprovalThreshold(riskLevel) {
    return APPROVAL_THRESHOLDS[riskLevel] || APPROVAL_THRESHOLDS.MEDIUM;
}

/**
 * Calculate timeout timestamp for a given risk level
 * @param {string} riskLevel - HIGH, MEDIUM, or LOW
 * @param {number} [customTimeoutHours] - Optional custom timeout in hours
 * @returns {string} ISO timestamp when approval window expires
 */
function calculateTimeout(riskLevel, customTimeoutHours) {
    const threshold = getApprovalThreshold(riskLevel);
    const hours = customTimeoutHours != null ? customTimeoutHours : threshold.defaultTimeoutHours;
    const timeout = new Date();
    timeout.setHours(timeout.getHours() + hours);
    return timeout.toISOString();
}

module.exports = {
    classifyRisk,
    getApprovalThreshold,
    calculateTimeout,
    RISK_PATTERNS,
    APPROVAL_THRESHOLDS
};
