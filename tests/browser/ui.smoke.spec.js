const { test, expect } = require('@playwright/test');

async function openNav(page, testId, expectedTitle) {
    await page.getByTestId(testId).click();
    await expect(page.locator('#page-title')).toHaveText(expectedTitle);
}

async function loginAdmin(page) {
    await page.goto('/');
    await expect(page.locator('#login-overlay')).toBeVisible();
    await page.getByTestId('login-username').fill('admin');
    await page.getByTestId('login-password').fill('admin');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('nav-account')).toBeVisible();
    await expect(page.getByTestId('nav-playground')).toBeVisible();
}

test('dashboard auth and primary navigation smoke', async ({ page }) => {
    await page.addInitScript(() => {
        const createdNotifications = [];
        const fakeRegistration = {
            showNotification: async (title, options = {}) => {
                createdNotifications.push({
                    title,
                    options,
                    delivery: 'service-worker'
                });
            }
        };
        function FakeNotification(title, options = {}) {
            this.title = title;
            this.options = options;
            this.delivery = 'browser-api';
            this.closed = false;
            this.close = () => {
                this.closed = true;
            };
            createdNotifications.push(this);
        }
        FakeNotification.permission = 'default';
        FakeNotification.requestPermission = async () => {
            FakeNotification.permission = 'granted';
            return 'granted';
        };
        Object.defineProperty(window, 'Notification', {
            configurable: true,
            value: FakeNotification
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                register: async () => fakeRegistration,
                ready: Promise.resolve(fakeRegistration)
            }
        });
        Object.defineProperty(window, '__niyamBrowserNotifications', {
            configurable: true,
            value: createdNotifications
        });
    });

    await page.goto('/');

    await expect(page.locator('#login-overlay')).toBeVisible();
    await page.getByTestId('login-username').fill('admin');
    await page.getByTestId('login-password').fill('admin');
    await page.getByTestId('login-submit').click();

    await expect(page.locator('#page-title')).toHaveText('Dashboard');
    await expect(page.locator('#auto-refresh-toggle')).toHaveCount(0);
    await expect(page.locator('#logout-btn')).toHaveCount(0);
    await expect(page.locator('#change-password-btn')).toHaveCount(0);
    await expect(page.locator('#submit-command-btn')).toHaveCount(0);
    await expect(page.getByTestId('browser-notifications-toggle')).toHaveCount(0);
    await expect(page.getByTestId('topbar-live-status')).toBeVisible();
    await openNav(page, 'nav-playground', 'Playground');
    await expect(page.getByText('Command Playground')).toBeVisible();
    await expect(page.locator('#playground-selected-title')).toHaveText('Dashboard Request');
    await page.getByTestId('playground-run').click();
    await expect(page.getByText('Playground run created')).toBeVisible();
    await expect(page.locator('#playground-active-run')).toContainText(/Policy/i);
    await expect(page.locator('#playground-recent-runs')).toContainText('Dashboard Request');
    await page.getByTestId('nav-account').click();
    await expect(page.locator('#page-title')).toHaveText('Account');
    await expect(page.getByTestId('account-session-summary')).toContainText('admin');
    await expect(page.getByTestId('account-change-password')).toBeVisible();
    await expect(page.getByTestId('account-sign-out')).toBeVisible();
    await expect(page.getByTestId('browser-notifications-toggle')).toContainText('Notify: Off');
    await page.getByTestId('browser-notifications-toggle').click();
    await expect(page.getByTestId('browser-notifications-toggle')).toContainText('Notify: On');
    await expect(page.getByText('Notification setting saved. Test browser notification sent.')).toBeVisible();
    await expect(page.getByTestId('browser-notifications-toggle')).toHaveAttribute('data-tooltip', /Delivery: service-worker/);

    const browserNotificationResult = await page.evaluate(async () => {
        window.handleWebSocketMessage({
            type: 'command_submitted',
            data: {
                id: 'browser-notify-1',
                command: 'mkdir',
                args: ['txt'],
                requester: 'June',
                riskLevel: 'MEDIUM',
                status: 'pending',
                autoApproved: false,
                approvalNotificationsEnabled: true,
                approvalMode: 'manual_pending'
            }
        });
        window.handleWebSocketMessage({
            type: 'command_submitted',
            data: {
                id: 'browser-notify-2',
                command: 'mkdir',
                args: ['quiet'],
                requester: 'June',
                riskLevel: 'MEDIUM',
                status: 'pending',
                autoApproved: false,
                approvalNotificationsEnabled: false,
                approvalMode: 'manual_pending'
            }
        });
        window.handleWebSocketMessage({
            type: 'command_submitted',
            data: {
                id: 'browser-notify-3',
                command: 'echo',
                args: ['auto'],
                requester: 'June',
                riskLevel: 'MEDIUM',
                status: 'pending',
                autoApproved: false,
                approvalNotificationsEnabled: true,
                approvalMode: 'auto_agent_approved'
            }
        });
        window.handleWebSocketMessage({
            type: 'command_approved',
            data: {
                id: 'browser-approved-1',
                command: 'rm',
                args: ['-rf', 'txt'],
                requester: 'May',
                riskLevel: 'HIGH',
                status: 'completed',
                approvalNotificationsEnabled: true,
                approvalMode: 'auto_agent_approved'
            }
        });
        window.handleWebSocketMessage({
            type: 'command_approved',
            data: {
                id: 'browser-approved-2',
                command: 'rm',
                args: ['-rf', 'quiet'],
                requester: 'May',
                riskLevel: 'HIGH',
                status: 'completed',
                approvalNotificationsEnabled: false,
                approvalMode: 'auto_agent_approved'
            }
        });
        await new Promise(resolve => setTimeout(resolve, 20));
        const approvalNotification = window.__niyamBrowserNotifications.find(notification => (
            notification.title === 'Niyam approval needed' &&
            notification.options.tag === 'niyam-approval-browser-notify-1'
        ));
        const recordedNotification = window.__niyamBrowserNotifications.find(notification => (
            notification.title === 'Niyam approval recorded' &&
            notification.options.tag === 'niyam-command_approved-browser-approved-1'
        ));
        if (approvalNotification && approvalNotification.onclick) {
            approvalNotification.onclick();
        }
        return {
            count: window.__niyamBrowserNotifications.length,
            hasEnabledNotification: window.__niyamBrowserNotifications.some(notification => notification.title === 'Niyam notifications enabled'),
            title: approvalNotification ? approvalNotification.title : '',
            body: approvalNotification ? approvalNotification.options.body : '',
            delivery: approvalNotification ? approvalNotification.delivery : '',
            targetHash: approvalNotification ? approvalNotification.options.data.targetHash : '',
            recordedTitle: recordedNotification ? recordedNotification.title : '',
            recordedBody: recordedNotification ? recordedNotification.options.body : '',
            recordedDelivery: recordedNotification ? recordedNotification.delivery : '',
            recordedTargetHash: recordedNotification ? recordedNotification.options.data.targetHash : '',
            hash: window.location.hash,
            closed: approvalNotification ? approvalNotification.closed : false
        };
    });
    expect(browserNotificationResult.count).toBe(3);
    expect(browserNotificationResult).toMatchObject({
        hasEnabledNotification: true,
        title: 'Niyam approval needed',
        delivery: 'service-worker',
        targetHash: '#pending',
        recordedTitle: 'Niyam approval recorded',
        recordedDelivery: 'service-worker',
        recordedTargetHash: '#history'
    });
    expect(browserNotificationResult.body).toContain('mkdir txt');
    expect(browserNotificationResult.recordedBody).toContain('rm -rf txt');
    await openNav(page, 'nav-pending', 'Pending Approvals');

    await openNav(page, 'nav-history', 'Activity');
    await page.evaluate(async () => {
        await fetch('/api/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Browser Badge Echo',
                description: 'Force one pending approval for badge refresh coverage',
                rule_type: 'pattern',
                pattern: 'echo\\s+browser-badge-pending',
                risk_level: 'MEDIUM',
                priority: 930
            })
        });
        await fetch('/api/commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command: 'echo',
                args: ['browser-badge-pending']
            })
        });
        await window.updatePendingBadge();
    });
    await expect(page.locator('#pending-badge')).toBeVisible();
    await expect(page.locator('#pending-badge')).toHaveText(/[1-9]\d*/);
    await page.reload();
    await expect(page.getByTestId('nav-account')).toBeVisible();
    await expect(page.locator('#page-title')).toHaveText('Activity');
    await expect(page.locator('#pending-badge')).toBeVisible();
    await expect(page.locator('#pending-badge')).toHaveText(/[1-9]\d*/);
    await openNav(page, 'nav-dashboard', 'Dashboard');

    const realtimeRefresh = await page.evaluate(async () => {
        const calls = [];
        const originals = {
            navigateTo: window.navigateTo,
            updatePendingBadge: window.updatePendingBadge,
            loadDashboardStats: window.loadDashboardStats,
            loadRecentActivity: window.loadRecentActivity,
            loadPendingPreview: window.loadPendingPreview
        };

        window.navigateTo = (...args) => {
            calls.push(['navigateTo', ...args]);
        };
        window.updatePendingBadge = () => {
            calls.push(['updatePendingBadge']);
            return Promise.resolve();
        };
        window.loadDashboardStats = () => {
            calls.push(['loadDashboardStats']);
            return Promise.resolve();
        };
        window.loadRecentActivity = () => {
            calls.push(['loadRecentActivity']);
            return Promise.resolve();
        };
        window.loadPendingPreview = () => {
            calls.push(['loadPendingPreview']);
            return Promise.resolve();
        };

        try {
            window.handleWebSocketMessage({
                type: 'command_approved',
                data: {
                    id: 'test-command',
                    command: 'ls',
                    args: ['public'],
                    approvals: 1
                }
            });

            await new Promise(resolve => setTimeout(resolve, 300));
        } finally {
            Object.assign(window, originals);
        }
        return calls;
    });

    expect(realtimeRefresh.some(([name]) => name === 'navigateTo')).toBe(false);
    expect(realtimeRefresh.map(([name]) => name)).toEqual(expect.arrayContaining([
        'updatePendingBadge',
        'loadDashboardStats',
        'loadRecentActivity',
        'loadPendingPreview'
    ]));

    await openNav(page, 'nav-pending', 'Pending Approvals');
    await expect(page.getByText(/Review pending commands/i)).toBeVisible();

    await openNav(page, 'nav-history', 'Activity');
    await expect(page.getByRole('button', { name: /Show Guide/i })).toBeVisible();

    await openNav(page, 'nav-rules', 'Policy Rules');
    await expect(page.getByTestId('rules-fab')).toBeVisible();
    const packToggle = page.getByTestId('rule-packs-toggle');
    await expect(packToggle).toHaveText(/Show Pack Library/i);
    await packToggle.click();
    await expect(packToggle).toHaveText(/Hide Pack Library/i);
    const defaultPack = page.locator('.pack-panel').filter({ hasText: 'Default Rules' });
    await expect(defaultPack.getByRole('button', { name: 'Uninstall' })).toBeVisible();

    await openNav(page, 'nav-audit', 'Audit Log');
    await expect(page.getByRole('button', { name: 'Event Key' })).toBeVisible();

    await openNav(page, 'nav-workspace', 'Workspace');
    await expect(page.getByText(/Runtime context, access posture, and shell setup in one place/i)).toBeVisible();

    const tokenLabel = `Browser Auto Token ${Date.now()}`;
    await page.evaluate(async label => {
        const response = await fetch('/api/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label,
                subjectType: 'standalone',
                principalIdentifier: label.toLowerCase().replace(/\s+/g, '-')
            })
        });
        if (!response.ok) {
            throw new Error('Failed to create browser token');
        }
    }, tokenLabel);

    await openNav(page, 'nav-users', 'Tokens');
    await expect(page.locator('.card-title').filter({ hasText: 'Managed Tokens' }).first()).toBeVisible();
    const browserTokenCard = page.locator('.command-stream-card').filter({ hasText: tokenLabel }).first();
    await expect(browserTokenCard).toContainText('Approval Notifications · On');
    await browserTokenCard.locator('.token-auto-approval-mode').selectOption('normal');
    await expect(browserTokenCard).toContainText('Approval Notifications · Off');
    await expect(browserTokenCard.getByRole('button', { name: 'Notify Off' })).toBeVisible();
});

test('browser notifications fall back to direct Notification API when service worker delivery is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        const createdNotifications = [];
        function FakeNotification(title, options = {}) {
            this.title = title;
            this.options = options;
            this.delivery = 'browser-api';
            this.closed = false;
            this.close = () => {
                this.closed = true;
            };
            createdNotifications.push(this);
        }
        FakeNotification.permission = 'default';
        FakeNotification.requestPermission = async () => {
            FakeNotification.permission = 'granted';
            return 'granted';
        };
        Object.defineProperty(window, 'Notification', {
            configurable: true,
            value: FakeNotification
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                register: async () => ({})
            }
        });
        Object.defineProperty(window, '__niyamBrowserNotifications', {
            configurable: true,
            value: createdNotifications
        });
    });

    await loginAdmin(page);
    await page.getByTestId('nav-account').click();
    await expect(page.locator('#page-title')).toHaveText('Account');
    await page.getByTestId('browser-notifications-toggle').click();
    await expect(page.getByTestId('browser-notifications-toggle')).toContainText('Notify: On');
    await expect(page.getByText('Notification setting saved. Test browser notification sent.')).toBeVisible();
    await expect(page.getByTestId('browser-notifications-toggle')).toHaveAttribute('data-tooltip', /Delivery: browser-api/);

    const result = await page.evaluate(async () => {
        window.handleWebSocketMessage({
            type: 'command_submitted',
            data: {
                id: 'browser-api-fallback-approval',
                command: 'mkdir',
                args: ['fallback'],
                requester: 'June',
                riskLevel: 'MEDIUM',
                status: 'pending',
                autoApproved: false,
                approvalNotificationsEnabled: true,
                approvalMode: 'manual_pending'
            }
        });
        await new Promise(resolve => setTimeout(resolve, 40));
        const approvalNotification = window.__niyamBrowserNotifications.find(notification => (
            notification.title === 'Niyam approval needed' &&
            notification.options.tag === 'niyam-approval-browser-api-fallback-approval'
        ));
        if (approvalNotification && approvalNotification.onclick) {
            approvalNotification.onclick();
        }
        return {
            count: window.__niyamBrowserNotifications.length,
            delivery: approvalNotification ? approvalNotification.delivery : '',
            hash: window.location.hash,
            closed: approvalNotification ? approvalNotification.closed : false
        };
    });

    expect(result).toMatchObject({
        count: 2,
        delivery: 'browser-api',
        hash: '#pending',
        closed: true
    });
});

test('browser notification toggle reports delivery failure when browser and system paths are unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        function ThrowingNotification() {
            throw new Error('display failed');
        }
        ThrowingNotification.permission = 'default';
        ThrowingNotification.requestPermission = async () => {
            ThrowingNotification.permission = 'granted';
            return 'granted';
        };
        Object.defineProperty(window, 'Notification', {
            configurable: true,
            value: ThrowingNotification
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                register: async () => ({})
            }
        });
    });

    await loginAdmin(page);
    await page.getByTestId('nav-account').click();
    await expect(page.locator('#page-title')).toHaveText('Account');
    await page.getByTestId('browser-notifications-toggle').click();
    await expect(page.getByText('Browser accepted permission but did not display notifications.')).toBeVisible();
    await expect(page.getByTestId('browser-notifications-toggle')).toContainText('Notify: Off');
    await expect(page.getByTestId('browser-notifications-toggle')).toHaveAttribute('data-tooltip', /Delivery: unavailable/);
});
