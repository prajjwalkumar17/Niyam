const { config } = require('../config');
const { createApprovalPreferencesService } = require('../services/approval-preferences');
const { createUsersService } = require('../services/users');

function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function buildDashboardUrl(req) {
    const protocol = req.headers['x-forwarded-proto']
        ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
        : req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function buildRoleContext(principal) {
    if (!principal) {
        return 'guest';
    }
    if (Array.isArray(principal.roles) && principal.roles.includes('admin')) {
        return 'admin';
    }
    if (Array.isArray(principal.roles) && principal.roles.includes('approver')) {
        return 'approver';
    }
    return principal.type || 'user';
}

function buildWorkspaceRouter(db) {
    const router = require('express').Router();
    const users = createUsersService(db);
    const approvalPreferences = createApprovalPreferencesService(db);

    router.get('/', (req, res) => {
        const principal = req.principal;
        const authentication = req.authentication || null;
        const dashboardUrl = buildDashboardUrl(req);
        const isAdminSession = Boolean(
            principal
            && authentication
            && authentication.mode === 'session'
            && Array.isArray(principal.roles)
            && principal.roles.includes('admin')
        );
        const currentUser = principal && principal.type === 'user'
            ? users.getUserByUsername(principal.identifier)
            : null;
        const bootstrapAdmin = users.getUserByUsername(config.ADMIN_USERNAME);
        const approvalPreference = approvalPreferences.resolveAutoApprovalPreference({
            principal,
            authentication
        });
        const teamModeDescription = config.ENABLE_SELF_SIGNUP
            ? 'enabled (self-signup requests require admin approval)'
            : 'disabled (admin-created users only)';
        const envFile = config.ENV_FILE || null;
        const startLaterCommand = envFile
            ? `set -a; source ${shellQuote(envFile)}; set +a; npm start`
            : 'npm start';
        const installBaseCommand = `cd ${shellQuote(config.ROOT_DIR)}`;
        const canManageOwnTokens = config.PRODUCT_MODE === 'teams'
            && Boolean(authentication && authentication.mode === 'session' && principal.type === 'user');
        const passwordMessage = config.PRODUCT_MODE === 'individual' && Boolean(currentUser && currentUser.metadata && currentUser.metadata.bootstrap)
            ? 'This password is for the bootstrap admin dashboard session. Use standalone managed tokens for CLI access in individual mode.'
            : (principal.type === 'user' && authentication && authentication.mode === 'session'
                ? 'Password is managed as a local Niyam account. Use Change Password, or ask an admin to reset it.'
                : (authentication && authentication.mode === 'managed_token'
                    ? `This identity is authenticated with the managed token ${authentication.credentialLabel || 'token'}.`
                    : 'This identity uses bearer-token authentication. Tokens are not displayed in full in the dashboard.'));

        res.json({
            runtime: {
                productMode: config.PRODUCT_MODE,
                identityModel: config.PRODUCT_MODE === 'individual' ? 'standalone_tokens' : 'local_users',
                profile: config.PROFILE,
                port: config.PORT,
                dashboardUrl,
                teamMode: config.ENABLE_SELF_SIGNUP,
                teamModeDescription,
                executionMode: config.EXEC_DEFAULT_MODE
            },
            approvalAutomation: {
                modeAvailable: true,
                scope: approvalPreference.scope,
                autoApprovalEnabled: approvalPreference.autoApprovalEnabled,
                autoApprovalMode: approvalPreference.autoApprovalMode,
                availableModes: ['off', 'normal', 'all'],
                highRiskBehavior: approvalPreference.autoApprovesHigh
                    ? 'full-auto'
                    : (approvalPreference.assistsHighRisk ? 'auto-plus-one-human' : 'two-human'),
                mediumRiskBehavior: approvalPreference.autoApprovesMedium ? 'full-auto' : 'manual',
                lowRiskBehavior: 'policy-auto'
            },
            currentAccess: {
                username: principal.identifier,
                displayName: principal.displayName || principal.identifier,
                principalType: principal.type,
                roleContext: buildRoleContext(principal),
                authMode: authentication ? authentication.mode : 'unknown',
                tokenLabel: authentication && authentication.credentialLabel ? authentication.credentialLabel : null,
                autoApprovalEnabled: approvalPreference.autoApprovalEnabled,
                autoApprovalMode: approvalPreference.autoApprovalMode,
                autoApprovalScope: approvalPreference.scope,
                canChangePassword: Boolean(authentication && authentication.mode === 'session' && principal.type === 'user'),
                canManageOwnTokens,
                canManageAllTokens: isAdminSession,
                passwordMessage,
                bootstrapAdmin: Boolean(currentUser && currentUser.metadata && currentUser.metadata.bootstrap)
            },
            bootstrapAccess: {
                username: config.ADMIN_USERNAME,
                passwordSource: isAdminSession && envFile ? `${envFile} (NIYAM_ADMIN_PASSWORD)` : null,
                canRevealPasswordSource: isAdminSession
            },
            commands: {
                startLater: isAdminSession ? startLaterCommand : null,
                cliInstall: {
                    zsh: [
                        installBaseCommand,
                        'npm run cli:install',
                        'source ~/.zshrc'
                    ],
                    bash: [
                        installBaseCommand,
                        'npm run cli:install -- --shell bash',
                        'source ~/.bashrc'
                    ]
                },
                cliRemove: {
                    zsh: [
                        installBaseCommand,
                        'npm run cli:remove',
                        'source ~/.zshrc'
                    ],
                    bash: [
                        installBaseCommand,
                        'npm run cli:remove -- --shell bash',
                        'source ~/.bashrc'
                    ]
                },
                cliTokenLogin: "niyam-cli login --token '<token>'",
                cliUserLogin: config.PRODUCT_MODE === 'teams'
                    ? "niyam-cli login --username <user> --password '<password>'"
                    : null,
                cliCurrentShellOff: 'niyam-off',
                cliCurrentShellOn: 'niyam-on'
            },
            instance: isAdminSession ? {
                envFile,
                dataDir: config.DATA_DIR,
                allowedRoots: [...config.EXEC_ALLOWED_ROOTS],
                executionMode: config.EXEC_DEFAULT_MODE,
                rootDir: config.ROOT_DIR,
                dbPath: config.DB_PATH
            } : null,
            team: {
                selfSignupEnabled: config.ENABLE_SELF_SIGNUP,
                canManageUsers: isAdminSession,
                hasBootstrapAdmin: Boolean(bootstrapAdmin)
            }
        });
    });

    return router;
}

module.exports = {
    buildWorkspaceRouter
};
