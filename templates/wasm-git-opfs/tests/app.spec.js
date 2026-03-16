import { test, expect } from '@playwright/test';

test.describe('wasm-git OPFS app', () => {
    test('demo completes all operations successfully', async ({ page }) => {
        const repo = `app-spec-${Date.now()}.git`;
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', err => errors.push(err.message));

        await page.goto(`/?repo=${repo}`);

        await page.waitForSelector('#demo-complete, #demo-error', { timeout: 60000 });

        if (errors.length) {
            console.log('Console errors:', errors);
        }

        const statusEl = page.locator('#demo-complete');
        await expect(statusEl).toBeVisible();
    });
});
