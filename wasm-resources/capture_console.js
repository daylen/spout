#!/usr/bin/env node
// Headless browser console capture for WASM debugging.
// Usage: node wasm-resources/capture_console.js [url] [timeout_ms]
// Defaults: url=http://localhost:1234  timeout=10000

const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:1234';
const timeout = parseInt(process.argv[3] || '10000', 10);

// Errors that are documented as benign (see _context/wasm-debugging.md).
const BENIGN_PAGEERRORS = [
    // winit intentionally throws this JS exception to exit its event loop.
    'Using exceptions for control flow',
    // headless Chromium has no WebGPU; expected in CI without a real GPU.
    'No available adapters',
];

(async () => {
    const browser = await chromium.launch({
        args: [
            // Enable WebGPU with the Vulkan/SwiftShader software backend so
            // validation errors show up even without a real GPU.
            '--enable-features=WebGPU,Vulkan,UseSkiaRenderer',
            '--enable-unsafe-webgpu',
            '--use-angle=swiftshader',
            '--use-vulkan=swiftshader',
            '--disable-vulkan-fallback-to-gl-for-testing',
        ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    let hasRealError = false;

    page.on('console', msg => {
        const type = msg.type().toUpperCase().padEnd(5);
        console.log(`[${type}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        const isBenign = BENIGN_PAGEERRORS.some(s => err.message.includes(s));
        if (isBenign) {
            console.log(`[BENIGN] ${err.message.split('\n')[0]}`);
        } else {
            hasRealError = true;
            console.error(`[PAGEERROR] ${err.message}`);
            if (err.stack) console.error(err.stack);
        }
    });

    page.on('requestfailed', req => {
        // Favicon 404s are cosmetic; ignore them.
        if (req.url().includes('favicon')) return;
        hasRealError = true;
        console.error(`[REQFAIL] ${req.url()} — ${req.failure()?.errorText}`);
    });

    console.log(`Navigating to ${url} (waiting ${timeout}ms for output)...`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
    } catch (e) {
        if (!e.message.includes('Timeout')) {
            console.error(`[NAV ERROR] ${e.message}`);
            hasRealError = true;
        }
    }

    await new Promise(r => setTimeout(r, timeout));
    await browser.close();

    if (hasRealError) {
        console.error('\n✗ Real errors detected.');
        process.exit(1);
    } else {
        console.log('\n✓ No real errors.');
        process.exit(0);
    }
})();
