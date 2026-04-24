const { AUTO_APPROVAL_MODE_OFF, buildAutoApprovalProfile } = require('./auto-approval-modes');
const { createTokensService } = require('./tokens');
const { createUsersService } = require('./users');

function createApprovalPreferencesService(db) {
    const users = createUsersService(db);
    const tokens = createTokensService(db);

    function resolveAutoApprovalPreference({ principal, authentication }) {
        if (!principal || !authentication) {
            return buildAutoApprovalProfile(AUTO_APPROVAL_MODE_OFF, 'none');
        }

        if (authentication.mode === 'session' && principal.type === 'user' && principal.userId) {
            const user = users.getUserById(principal.userId);
            return buildAutoApprovalProfile(user && user.autoApprovalMode, 'user');
        }

        if (authentication.mode === 'managed_token' && authentication.credentialId) {
            const token = tokens.getTokenById(authentication.credentialId);
            if (!token) {
                return buildAutoApprovalProfile(AUTO_APPROVAL_MODE_OFF, 'none');
            }

            if (token.subjectType === 'user') {
                return buildAutoApprovalProfile(token.derivedAutoApprovalMode, 'user');
            }

            return buildAutoApprovalProfile(token.autoApprovalMode, 'token');
        }

        return buildAutoApprovalProfile(AUTO_APPROVAL_MODE_OFF, 'none');
    }

    function setUserAutoApprovalPreference(userId, enabled) {
        return users.setAutoApprovalPreference(userId, enabled);
    }

    function setStandaloneTokenAutoApprovalPreference(tokenId, enabled) {
        return tokens.setStandaloneAutoApprovalPreference(tokenId, enabled);
    }

    return {
        resolveAutoApprovalPreference,
        setStandaloneTokenAutoApprovalPreference,
        setUserAutoApprovalPreference
    };
}

module.exports = {
    createApprovalPreferencesService
};
