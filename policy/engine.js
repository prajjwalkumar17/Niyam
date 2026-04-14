/**
 * Policy Engine - Core classification and rule matching
 */

const { classifyRisk, getApprovalThreshold } = require('./risk-classifier');
const { matchRules } = require('./rules');
const { config } = require('../config');
const { redactForPreview } = require('../security/redaction');

class PolicyEngine {
    constructor(db) {
        this.db = db;
    }

    /**
     * Evaluate a command against all policy rules
     * Returns classification result with risk level, matching rules, and approval requirements
     */
    evaluate(command, args = []) {
        const fullCommand = this._buildCommandString(command, args);
        
        // Get all enabled rules, sorted by priority
        const rules = this.db.prepare(`
            SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC
        `).all();
        
        // Match against rules
        const matchedRules = matchRules(fullCommand, rules);
        
        // Classify risk based on rules and built-in classifier
        const classification = classifyRisk(fullCommand, matchedRules);
        const executionModeRule = matchedRules.find(r => r.rule_type === 'execution_mode' && r.execution_mode);
        const executionMode = executionModeRule ? executionModeRule.execution_mode : config.EXEC_DEFAULT_MODE;
        
        // Get approval thresholds
        const threshold = getApprovalThreshold(classification.riskLevel);
        
        // Check for denylist blocks
        const denied = matchedRules.find(r => r.rule_type === 'denylist');
        if (denied) {
            return {
                allowed: false,
                reason: `Command blocked by denylist rule: ${denied.name}`,
                riskLevel: classification.riskLevel,
                classifier: classification,
                matchedRules,
                threshold,
                autoApproved: false,
                executionMode
            };
        }
        
        // Check for allowlist auto-approval
        const allowed = matchedRules.find(r => r.rule_type === 'allowlist');
        if (allowed && classification.riskLevel === 'LOW') {
            return {
                allowed: true,
                reason: 'Auto-approved: matches allowlist rule',
                riskLevel: classification.riskLevel,
                classifier: classification,
                matchedRules,
                threshold,
                autoApproved: true,
                executionMode
            };
        }
        
        return {
            allowed: true,
            reason: `Command classified as ${classification.riskLevel} risk`,
            riskLevel: classification.riskLevel,
            executionMode,
            classifier: classification,
            matchedRules,
            threshold,
            autoApproved: classification.riskLevel === 'LOW',
            requiresApproval: classification.riskLevel !== 'LOW'
        };
    }

    simulate({ command, args = [], metadata = {}, workingDir = null }) {
        const evaluation = this.evaluate(command, args);
        return {
            ...evaluation,
            workingDir,
            matchedRules: summarizeMatchedRules(evaluation.matchedRules),
            redactionPreview: redactForPreview({ command, args, metadata })
        };
    }

    /**
     * Get risk level for a command (shortcut method)
     */
    getRiskLevel(command, args = []) {
        const result = this.evaluate(command, args);
        return result.riskLevel;
    }

    /**
     * Check if a command requires approval
     */
    requiresApproval(command, args = []) {
        const result = this.evaluate(command, args);
        return result.requiresApproval && result.allowed;
    }

    /**
     * Build full command string from command and args
     */
    _buildCommandString(command, args) {
        if (Array.isArray(args) && args.length > 0) {
            return `${command} ${args.join(' ')}`;
        }
        return command;
    }
}

module.exports = PolicyEngine;

function summarizeMatchedRules(rules) {
    return (rules || []).map(rule => ({
        id: rule.id,
        name: rule.name,
        rule_type: rule.rule_type,
        priority: rule.priority,
        risk_level: rule.risk_level || null,
        execution_mode: rule.execution_mode || null
    }));
}
