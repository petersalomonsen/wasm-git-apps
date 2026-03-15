import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 60000,
    use: {
        baseURL: 'http://localhost:8080',
    },
    webServer: {
        command: 'node serve.mjs',
        url: 'http://localhost:8080/ping',
        reuseExistingServer: true,
    },
});
