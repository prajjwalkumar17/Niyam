const { config } = require('../config');

const AUTO_APPROVAL_MODE_OFF = 'off';
const AUTO_APPROVAL_MODE_NORMAL = 'normal';
const AUTO_APPROVAL_MODE_ALL = 'all';
const AUTO_APPROVAL_MODES = [
    AUTO_APPROVAL_MODE_OFF,
    AUTO_APPROVAL_MODE_NORMAL,
    AUTO_APPROVAL_MODE_ALL
];

function normalizeAutoApprovalMode(value, fallback = AUTO_APPROVAL_MODE_OFF) {
    const normalized = String(value || '').trim().toLowerCase();
    return AUTO_APPROVAL_MODES.includes(normalized) ? normalized : fallback;
}

function autoApprovalModeFromStored(modeValue, enabledValue) {
    const normalized = normalizeAutoApprovalMode(modeValue, '');
    if (normalized) {
        return normalized;
    }
    return enabledValue ? AUTO_APPROVAL_MODE_NORMAL : AUTO_APPROVAL_MODE_OFF;
}

function isAutoApprovalEnabled(mode) {
    return normalizeAutoApprovalMode(mode) !== AUTO_APPROVAL_MODE_OFF;
}

function buildAutoApprovalProfile(modeValue, scope = 'none', options = {}) {
    const mode = normalizeAutoApprovalMode(modeValue);
    const productMode = options.productMode || config.PRODUCT_MODE;
    const autoApprovesMedium = mode === AUTO_APPROVAL_MODE_NORMAL || mode === AUTO_APPROVAL_MODE_ALL;
    const assistsHighRisk = productMode === 'individual'
        || mode === AUTO_APPROVAL_MODE_NORMAL
        || mode === AUTO_APPROVAL_MODE_ALL;
    const autoApprovesHigh = mode === AUTO_APPROVAL_MODE_ALL;

    return {
        autoApprovalEnabled: isAutoApprovalEnabled(mode),
        autoApprovalMode: mode,
        scope,
        autoApprovesMedium,
        assistsHighRisk,
        autoApprovesHigh
    };
}

module.exports = {
    AUTO_APPROVAL_MODE_ALL,
    AUTO_APPROVAL_MODE_NORMAL,
    AUTO_APPROVAL_MODE_OFF,
    AUTO_APPROVAL_MODES,
    autoApprovalModeFromStored,
    buildAutoApprovalProfile,
    isAutoApprovalEnabled,
    normalizeAutoApprovalMode
};
