import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname as pathDirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { minify as jsMinify } from 'terser';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);
const ROOT = join(__dirname, '..');
const ASSET_PATH = join(ROOT, 'src/assets');
const DIST_PATH = join(ROOT, 'dist');
const VENDOR_QR_PATH = join(ROOT, 'node_modules/qrcode-generator/dist/qrcode.js');

const PAGES = ['panel', 'login', 'secrets', 'proxy-ip', 'support', 'error', 'analytics', 'users', 'apikeys', 'health', 'backup'];

const green = '\x1b[32m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const success = `${green}✔${reset}`;
const failure = `${red}✗${reset}`;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

function readAsset(...parts) {
    return readFileSync(join(ASSET_PATH, ...parts), 'utf8');
}

function escapeInlineCode(code, tagName) {
    return code.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);
}

async function minifyCss(css) {
    const result = await transform(css, {
        loader: 'css',
        minify: true,
        target: ['chrome100', 'firefox100', 'safari15']
    });
    return result.code;
}

async function minifyJs(js) {
    const result = await transform(js, {
        loader: 'js',
        minify: true,
        target: 'es2020',
        legalComments: 'none'
    });
    return result.code;
}

async function processPages() {
    const themeCss = readAsset('theme.css');
    const icons = readAsset('icons.svg').trim();
    const themeBoot = readAsset('theme-boot.js');
    const uiJs = readAsset('ui.js');
    const vendorQr = existsSync(VENDOR_QR_PATH) ? readFileSync(VENDOR_QR_PATH, 'utf8') : '';
    const pages = {};

    if (!vendorQr) {
        throw new Error('qrcode-generator is not installed. Run npm ci before building.');
    }

    for (const page of PAGES) {
        const pageDir = join(ASSET_PATH, page);
        const htmlPath = join(pageDir, 'index.html');
        const stylePath = join(pageDir, 'style.css');
        const scriptPath = join(pageDir, 'script.js');

        if (!existsSync(htmlPath) || !existsSync(stylePath) || !existsSync(scriptPath)) {
            throw new Error(`Page "${page}" is missing index.html, style.css or script.js.`);
        }

        const template = readFileSync(htmlPath, 'utf8');
        const pageCss = readFileSync(stylePath, 'utf8');
        const pageJs = readFileSync(scriptPath, 'utf8');

        const [css, script, vendor] = await Promise.all([
            minifyCss(`${themeCss}\n${pageCss}`),
            minifyJs(`${uiJs}\n${pageJs}`),
            minifyJs(vendorQr)
        ]);

        let html = template.replaceAll('__VERSION__', version);
        html = html
            .replaceAll('__THEME_BOOT__', escapeInlineCode(themeBoot, 'script'))
            .replaceAll('__STYLE__', `<style>${escapeInlineCode(css, 'style')}</style>`)
            .replaceAll('__ICONS__', icons)
            .replaceAll('__VENDOR__', escapeInlineCode(vendor, 'script'))
            .replaceAll('__SCRIPT__', escapeInlineCode(script, 'script'));

        const unresolved = html.match(/__(?:THEME_BOOT|STYLE|ICONS|VENDOR|SCRIPT)__/g);
        if (unresolved) {
            throw new Error(`Page "${page}" has unresolved template tokens: ${[...new Set(unresolved)].join(', ')}`);
        }

        const compressed = gzipSync(html);
        pages[page] = JSON.stringify(compressed.toString('base64'));
        console.log(`${success} ${page.padEnd(9)} ${dim}${(compressed.length / 1024).toFixed(1)} KiB gzip${reset}`);
    }

    return pages;
}

async function buildWorker() {
    const pages = await processPages();
    const faviconBase64 = readFileSync(join(ASSET_PATH, 'favicon.ico')).toString('base64');

    const result = await build({
        entryPoints: [join(ROOT, 'src/worker.ts')],
        bundle: true,
        format: 'esm',
        write: false,
        external: ['cloudflare:sockets'],
        platform: 'browser',
        target: 'esnext',
        loader: { '.ts': 'ts' },
        define: {
            __PANEL_HTML_CONTENT__: pages.panel,
            __LOGIN_HTML_CONTENT__: pages.login,
            __ERROR_HTML_CONTENT__: pages.error,
            __SECRETS_HTML_CONTENT__: pages.secrets,
            __PROXY_IP_HTML_CONTENT__: pages['proxy-ip'],
            __SUPPORT_HTML_CONTENT__: pages.support,
            __ANALYTICS_HTML_CONTENT__: pages.analytics,
            __USERS_HTML_CONTENT__: pages.users,
            __APIKEYS_HTML_CONTENT__: pages.apikeys,
            __HEALTH_HTML_CONTENT__: pages.health,
            __BACKUP_HTML_CONTENT__: pages.backup,
            __ICON__: JSON.stringify(faviconBase64),
            __VERSION__: JSON.stringify(version)
        }
    });

    if (!result.outputFiles?.length) {
        throw new Error('esbuild produced no Worker output.');
    }

    const bundled = result.outputFiles[0].text;
    const minified = await jsMinify(bundled, {
        module: true,
        ecma: 2020,
        compress: {
            passes: 2,
            dead_code: false,
            unused: false
        },
        mangle: true,
        format: {
            comments: false
        }
    });

    if (!minified.code) {
        throw new Error('Terser produced an empty Worker bundle.');
    }

    console.log(`${success} Worker bundled and minified`);

    const finalCode = minified.code;

    if (!/(?:export\s+default|export\s*\{[^}]*\bdefault\b)/.test(finalCode)) {
        throw new Error('Worker output is missing its default export.');
    }

    const buildTimestamp = new Date().toISOString();
    const banner = `// Technamooz Panel v${version} · build ${buildTimestamp}\n`;
    const worker = `${banner}// @ts-nocheck\n${finalCode}`;
    const sizeKb = (Buffer.byteLength(worker) / 1024).toFixed(1);

    mkdirSync(DIST_PATH, { recursive: true });
    writeFileSync(join(DIST_PATH, 'worker.js'), worker, 'utf8');

    const zip = new JSZip();
    zip.file('_worker.js', worker);
    const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    });
    writeFileSync(join(DIST_PATH, 'worker.zip'), zipBuffer);

    console.log(`${success} dist/worker.js ${dim}(${sizeKb} KiB, minified)${reset}`);
    console.log(`${success} dist/worker.zip ${dim}(${(zipBuffer.length / 1024).toFixed(1)} KiB)${reset}`);
    console.log(`${success} Build complete`);
}

buildWorker().catch(error => {
    console.error(`${failure} Build failed:`, error);
    process.exit(1);
});
