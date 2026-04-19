const { config } = require('../config');
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

    router.get('/', (req, res) => {
        const principal = req.principal;
        const dashboardUrl = buildDashboardUrl(req);
        const isAdmin = Boolean(principal && Array.isArray(principal.roles) && principal.roles.includes('admin'));
        const currentUser = principal && principal.type === 'user'
            ? users.getUserByUsername(principal.identifier)
            : null;
        const bootstrapAdmin = users.getUserByUsername(config.ADMIN_USERNAME);
        const teamModeDescription = config.ENABLE_SELF_SIGNUP
            ? 'enabled (self-signup requests require admin approval)'
            : 'disabled (admin-created users only)';
        const envFile = config.ENV_FILE || null;
        const startLaterCommand = envFile
            ? `set -a; source ${shellQuote(envFile)}; set +a; npm start`
            : 'npm start';
        const installBaseCommand = `cd ${shellQuote(config.ROOT_DIR)}`;

        res.json({
            runtime: {
                profile: config.PROFILE,
                port: config.PORT,
                dashboardUrl,
                teamMode: config.ENABLE_SELF_SIGNUP,
                teamModeDescription,
                executionMode: config.EXEC_DEFAULT_MODE
            },
            currentAccess: {
                username: principal.identifier,
                displayName: principal.displayName || principal.identifier,
                principalType: principal.type,
                roleContext: buildRoleContext(principal),
                canChangePassword: principal.type === 'user',
                passwordMessage: principal.type === 'user'
                    ? 'Password is managed as a local Niyam account. Use Change Password, or ask an admin to reset it.'
                    : 'This identity uses a bearer token. Tokens are not displayed in the dashboard.',
                bootstrapAdmin: Boolean(currentUser && currentUser.metadata && currentUser.metadata.bootstrap)
            },
            bootstrapAccess: {
                username: config.ADMIN_USERNAME,
                passwordSource: isAdmin && envFile ? `${envFile} (NIYAM_ADMIN_PASSWORD)` : null,
                canRevealPasswordSource: isAdmin
            },
            commands: {
                startLater: isAdmin ? startLaterCommand : null,
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
                cliCurrentShellOff: 'niyam-off',
                cliCurrentShellOn: 'niyam-on'
            },
            instance: isAdmin ? {
                envFile,
                dataDir: config.DATA_DIR,
                allowedRoots: [...config.EXEC_ALLOWED_ROOTS],
                executionMode: config.EXEC_DEFAULT_MODE,
                rootDir: config.ROOT_DIR,
                dbPath: config.DB_PATH
            } : null,
            team: {
                selfSignupEnabled: config.ENABLE_SELF_SIGNUP,
                canManageUsers: isAdmin,
                hasBootstrapAdmin: Boolean(bootstrapAdmin)
            }
        });
    });

    return router;
}

module.exports = {
    buildWorkspaceRouter
};
