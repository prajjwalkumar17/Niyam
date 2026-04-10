/**
 * Rationale Validation - Ensures mandatory rationale for critical operations
 */

const MIN_RATIONALE_LENGTH = 10;
const MAX_RATIONALE_LENGTH = 1000;

/**
 * Validate a rationale string
 * @param {string} rationale - The rationale text to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateRationale(rationale, options = {}) {
    const minLength = options.minLength || MIN_RATIONALE_LENGTH;
    const maxLength = options.maxLength || MAX_RATIONALE_LENGTH;
    
    if (!rationale || typeof rationale !== 'string') {
        return {
            valid: false,
            error: 'Rationale is required for this operation'
        };
    }
    
    const trimmed = rationale.trim();
    
    if (trimmed.length < minLength) {
        return {
            valid: false,
            error: `Rationale must be at least ${minLength} characters (got ${trimmed.length})`
        };
    }
    
    if (trimmed.length > maxLength) {
        return {
            valid: false,
            error: `Rationale must not exceed ${maxLength} characters (got ${trimmed.length})`
        };
    }
    
    // Check for meaningful content (not just repeated characters or filler)
    if (isFillerText(trimmed)) {
        return {
            valid: false,
            error: 'Rationale appears to be filler text. Please provide a meaningful reason.'
        };
    }
    
    return { valid: true, error: null };
}

/**
 * Check if text appears to be filler/non-meaningful
 */
function isFillerText(text) {
    // Check for repeated characters (e.g., "aaaaaa", "......")
    if (/^(.)\1+$/.test(text)) return true;
    
    // Check for common filler phrases
    const fillerPhrases = [
        /^n\/a$/i,
        /^na$/i,
        /^none$/i,
        /^nothing$/i,
        /^no reason$/i,
        /^because$/i,
        /^just because$/i,
        /^todo$/i,
        /^fix$/i,
        /^test$/i,
    ];
    
    for (const pattern of fillerPhrases) {
        if (pattern.test(text.trim())) return true;
    }
    
    // Check for low information content (too many repeated words)
    const words = text.toLowerCase().split(/\s+/);
    if (words.length > 3) {
        const uniqueWords = new Set(words);
        const ratio = uniqueWords.size / words.length;
        if (ratio < 0.3) return true; // More than 70% repeated words
    }
    
    return false;
}

/**
 * Generate rationale prompt based on risk level
 * @param {string} riskLevel - HIGH, MEDIUM, or LOW
 * @returns {string} Prompt message for rationale input
 */
function getRationalePrompt(riskLevel) {
    switch (riskLevel) {
        case 'HIGH':
            return 'This is a HIGH risk operation. Please provide a detailed rationale explaining why this command must be executed and what precautions have been considered.';
        case 'MEDIUM':
            return 'Please briefly explain why this command is needed.';
        case 'LOW':
            return 'Rationale is optional for low-risk operations.';
        default:
            return 'Please provide a rationale.';
    }
}

module.exports = { validateRationale, getRationalePrompt, isFillerText };
