const os = require('os');
const { spawn } = require('child_process');

const { logger } = require('../observability');
const { shapeCommandRecord } = require('./record-shaping');
const { createTokensService } = require('./tokens');

const NATIVE_NOTIFICATIONS_ENABLED_KEY = 'native_notifications_enabled';
const RECENT_EVENT_LIMIT = 240;

function createNativeNotificationService(db, options = {}) {
    const platform = options.platform || os.platform();
    const spawnCommand = options.spawn || spawn;
    const disabled = options.disabled === undefined
        ? process.env.NIYAM_NATIVE_NOTIFICATIONS_DISABLED === 'true'
        : Boolean(options.disabled);
    const recentEvents = [];
    const recentEventSet = new Set();

    const getSetting = db.prepare('SELECT value FROM runtime_settings WHERE key = ?');
    const writeSetting = db.prepare(`
        INSERT INTO runtime_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    function isSupported() {
        return !disabled && ['darwin', 'linux', 'win32'].includes(platform);
    }

    function getPlatform() {
        return platform;
    }

    function isEnabled() {
        const row = getSetting.get(NATIVE_NOTIFICATIONS_ENABLED_KEY);
        return row ? row.value === 'true' : false;
    }

    function setEnabled(enabled) {
        const value = enabled && isSupported();
        writeSetting.run(NATIVE_NOTIFICATIONS_ENABLED_KEY, value ? 'true' : 'false', new Date().toISOString());
        return value;
    }

    function sendTest(actor) {
        return notify('Niyam notifications enabled', `System approval notifications are on for ${actor || 'this browser'}.`, {
            tag: 'niyam-native-test'
        });
    }

    function handleEvent(eventType, data = {}) {
        if (!isEnabled() || !isSupported()) {
            return false;
        }

        if (!isApprovalNotificationEvent(eventType)) {
            return false;
        }

        const eventId = data.id || data.commandId;
        const eventKey = `${eventType}:${eventId || ''}:${data.approvals || ''}:${data.required || ''}`;
        if (!rememberEvent(eventKey)) {
            return false;
        }

        const commandData = resolveCommandData(data);
        if (!commandData || commandData.approvalNotificationsEnabled === false) {
            return false;
        }

        if (eventType === 'command_submitted') {
            if (!shouldNotifyPendingApproval(commandData)) {
                return false;
            }
            return notifyPendingApproval(commandData);
        }

        return notifyApprovalUpdate(eventType, commandData);
    }

    function rememberEvent(eventKey) {
        if (recentEventSet.has(eventKey)) {
            return false;
        }

        recentEventSet.add(eventKey);
        recentEvents.push(eventKey);

        while (recentEvents.length > RECENT_EVENT_LIMIT) {
            const oldKey = recentEvents.shift();
            recentEventSet.delete(oldKey);
        }

        return true;
    }

    function resolveCommandData(data = {}) {
        const commandId = data.id || data.commandId;
        let resolved = data;

        if (commandId && needsCommandLookup(data)) {
            const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
            if (row) {
                resolved = {
                    ...shapeCommandRecord(row),
                    ...data
                };
            }
        }

        return applyTokenNotificationPreference(resolved);
    }

    function needsCommandLookup(data = {}) {
        return data.approvalNotificationsEnabled === undefined ||
            !data.authenticationContext ||
            data.requester === undefined ||
            data.riskLevel === undefined;
    }

    function applyTokenNotificationPreference(commandData = {}) {
        const authenticationContext = commandData.authenticationContext || {};
        if (commandData.approvalNotificationsEnabled !== undefined) {
            return commandData;
        }

        if (authenticationContext.mode !== 'managed_token' || !authenticationContext.credentialId) {
            return {
                ...commandData,
                approvalNotificationsEnabled: true,
                approvalNotificationPreferenceScope: 'session'
            };
        }

        const token = createTokensService(db).getTokenById(authenticationContext.credentialId);
        return {
            ...commandData,
            approvalNotificationsEnabled: token ? token.approvalNotificationsEnabled : true,
            approvalNotificationPreferenceScope: 'token'
        };
    }

    function notifyPendingApproval(commandData) {
        const commandLine = truncateNotificationText(buildCommandLineDisplay(commandData), 120);
        const riskLevel = commandData.riskLevel || commandData.risk_level || 'Risk pending';
        const requester = commandData.requester || 'unknown requester';
        return notify('Niyam approval needed', `${riskLevel}: ${commandLine} from ${requester}`, {
            tag: `niyam-approval-${commandData.id || commandLine}`
        });
    }

    function notifyApprovalUpdate(eventType, commandData) {
        const commandLine = truncateNotificationText(buildCommandLineDisplay(commandData), 120);
        const riskLevel = commandData.riskLevel || commandData.risk_level || 'Risk pending';
        const requester = commandData.requester || 'unknown requester';
        const title = eventType === 'approval_granted'
            ? 'Niyam approval progress'
            : 'Niyam approval recorded';

        return notify(title, `${riskLevel}: ${commandLine} for ${requester}`, {
            tag: `niyam-${eventType}-${commandData.id || commandLine}`
        });
    }

    function notify(title, body, details = {}) {
        if (!isSupported()) {
            return false;
        }

        try {
            const child = spawnNativeNotification(title, body, details);
            if (!child) {
                return false;
            }
            if (typeof child.on === 'function') {
                child.on('error', error => {
                    logger.warn('native_notification_failed', {
                        platform,
                        error: error.message
                    });
                });
            }
            if (typeof child.unref === 'function') {
                child.unref();
            }
            return true;
        } catch (error) {
            logger.warn('native_notification_failed', {
                platform,
                error: error.message
            });
            return false;
        }
    }

    function spawnNativeNotification(title, body, details = {}) {
        if (platform === 'darwin') {
            const script = [
                'display notification',
                appleScriptString(body),
                'with title',
                appleScriptString(title),
                'sound name',
                appleScriptString('Glass')
            ].join(' ');
            return spawnCommand('/usr/bin/osascript', ['-e', script], {
                detached: true,
                stdio: 'ignore'
            });
        }

        if (platform === 'linux') {
            return spawnCommand('notify-send', ['--app-name=Niyam', title, body], {
                detached: true,
                stdio: 'ignore'
            });
        }

        if (platform === 'win32') {
            const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; New-BurntToastNotification -Text ${powershellString(title)}, ${powershellString(body)}`;
            return spawnCommand('powershell.exe', ['-NoProfile', '-Command', script], {
                detached: true,
                stdio: 'ignore'
            });
        }

        return null;
    }

    return {
        getPlatform,
        handleEvent,
        isEnabled,
        isSupported,
        notify,
        sendTest,
        setEnabled
    };
}

function isApprovalNotificationEvent(eventType) {
    return ['command_submitted', 'command_auto_approved', 'command_approved', 'approval_granted'].includes(eventType);
}

function shouldNotifyPendingApproval(data = {}) {
    if (!data.id) {
        return false;
    }
    if (data.status && data.status !== 'pending') {
        return false;
    }
    if (data.autoApproved) {
        return false;
    }
    if (['policy_auto', 'auto_agent_approved'].includes(data.approvalMode)) {
        return false;
    }
    return true;
}

function buildCommandLineDisplay(data = {}) {
    const command = String(data.command || '').trim();
    const args = Array.isArray(data.args) ? data.args : [];
    return [command, ...args].filter(Boolean).join(' ') || 'Command approval updated';
}

function truncateNotificationText(value, maxLength) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function appleScriptString(value) {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function powershellString(value) {
    return `'${String(value || '').replace(/'/g, "''").replace(/\r?\n/g, ' ')}'`;
}

module.exports = {
    createNativeNotificationService,
    NATIVE_NOTIFICATIONS_ENABLED_KEY
};
