import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('service worker', () => {
    test('registers and activates', async ({ page, context }) => {
        const repo = `sw-register-${Date.now()}.git`;
        await page.goto(`/?repo=${repo}`);

        await expect.poll(async () => page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            return reg.active?.state;
        })).toBe('activated');
    });

    test('app works offline', async ({ page, context }) => {
        const repo = `sw-offline-${Date.now()}.git`;
        // Load the page to populate the cache
        await page.goto(`/?repo=${repo}`);

        // Wait for service worker to be active and controlling the page
        await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            // Ensure the SW is controlling this page
            if (!navigator.serviceWorker.controller) {
                await new Promise(resolve => {
                    navigator.serviceWorker.addEventListener('controllerchange', resolve);
                });
            }
        });

        // Reload once so the active SW controls the page and caches responses
        await page.reload();
        await page.evaluate(() => navigator.serviceWorker.ready);

        // Go offline
        await context.setOffline(true);

        // Reload — should serve from cache
        await page.reload();

        // Verify the page loaded (not a browser error page)
        const title = await page.title();
        expect(title).not.toBe('');
        expect(title).not.toContain('not available');

        // Verify main content is visible
        const body = await page.textContent('body');
        expect(body.length).toBeGreaterThan(0);

        await context.setOffline(false);
    });

    test('serves fresh content when online (no stale cache)', async ({ page }) => {
        const repo = `sw-fresh-${Date.now()}.git`;
        // Load the page to register the service worker
        await page.goto(`/?repo=${repo}`);
        await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
        });

        // Inject a marker into index.html on the server
        const indexPath = path.join(process.cwd(), 'public', 'index.html');
        const original = fs.readFileSync(indexPath, 'utf8');
        const marker = `sw-update-test-${Date.now()}`;
        const updated = original.replace(
            '</head>',
            `    <meta name="sw-update-test" content="${marker}">\n</head>`
        );
        fs.writeFileSync(indexPath, updated);

        try {
            // Reload — network-first should fetch the updated file
            await page.reload();

            await expect(page.locator('meta[name="sw-update-test"]')).toHaveAttribute('content', marker);
        } finally {
            // Restore original file
            fs.writeFileSync(indexPath, original);
        }
    });
});
