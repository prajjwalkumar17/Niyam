const { test, expect } = require('@playwright/test');

async function openNav(page, testId, expectedTitle) {
    await page.getByTestId(testId).click();
    await expect(page.locator('#page-title')).toHaveText(expectedTitle);
}

test('dashboard auth and primary navigation smoke', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#login-overlay')).toBeVisible();
    await page.getByTestId('login-username').fill('admin');
    await page.getByTestId('login-password').fill('admin');
    await page.getByTestId('login-submit').click();

    await expect(page.locator('#session-pill')).toContainText('admin');
    await expect(page.locator('#page-title')).toHaveText('Dashboard');

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

    await openNav(page, 'nav-audit', 'Audit Log');
    await expect(page.getByRole('button', { name: 'Event Key' })).toBeVisible();

    await openNav(page, 'nav-workspace', 'Workspace');
    await expect(page.getByText(/Runtime context, access posture, and shell setup in one place/i)).toBeVisible();

    await openNav(page, 'nav-users', 'Tokens');
    await expect(page.locator('.card-title').filter({ hasText: 'Managed Tokens' }).first()).toBeVisible();
});
