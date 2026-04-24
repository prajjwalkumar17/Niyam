function buildAuthenticationContext(input) {
    if (!input) {
        return null;
    }

    const mode = input.mode || input.auth_mode || null;
    const credentialId = input.credentialId || input.auth_credential_id || null;
    const credentialLabel = input.credentialLabel || input.auth_credential_label || null;
    const subjectType = input.subjectType || input.subject_type || null;

    if (!mode && !credentialId && !credentialLabel && !subjectType) {
        return null;
    }

    return {
        mode,
        credentialId,
        credentialLabel,
        subjectType
    };
}

function toAuthColumns(authentication) {
    const context = buildAuthenticationContext(authentication);
    return {
        authMode: context ? context.mode : null,
        authCredentialId: context ? context.credentialId : null,
        authCredentialLabel: context ? context.credentialLabel : null
    };
}

function addAuthDetails(details, authentication) {
    const context = buildAuthenticationContext(authentication);
    if (!context) {
        return details || {};
    }

    return {
        ...(details || {}),
        authMode: context.mode || null,
        credentialId: context.credentialId || null,
        credentialLabel: context.credentialLabel || null,
        subjectType: context.subjectType || null
    };
}

module.exports = {
    addAuthDetails,
    buildAuthenticationContext,
    toAuthColumns
};
