import { Authenticate, generateJWTToken, resetPassword, requireAuth, authenticateAPIKey, listUsers, createUser, updateUser, deleteUser, listApiKeys, createApiKey, revokeApiKey, recordSubscriptionAccess, getSubscriptionStats, resetSubscriptionStats, createBackup, restoreBackup } from "@auth";
import { getDataset, updateDataset } from "@kv";
import { setSettings } from "@init";
import { getClNormalConfig, getClWarpConfig } from "@clash/configs";
import { getSbCustomConfig, getSbWarpConfig } from "@sing-box/configs";
import { getXrCustomConfigs, getXrWarpConfigs } from "@xray/configs";
import { fetchWarpAccounts } from "@warp";
import { VlOverWSHandler } from "@vless";
import { TrOverWSHandler } from "@trojan";
import {
    base64DecodeUtf8,
    base64EncodeUtf8,
    escapeHtml,
    HttpStatus,
    respond,
    safeErrorMessage,
    SECURITY_HEADERS,
    CORS_HEADERS,
    performHealthCheck
} from "@common";
import {
    generateRemark,
    generateWsPath,
    getConfigAddresses,
    getProtocols,
    isDomain,
    isIPv4,
    isIPv6,
    parseHostPort,
    randomUpperCase,
    resolveDNS
} from "@utils";
import JSZip from "jszip";

const PAGE_HEADERS: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    ...SECURITY_HEADERS
};

const SUBSCRIPTION_HEADERS: Record<string, string> = {
    'Content-Type': 'text/plain;charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'CDN-Cache-Control': 'no-store'
};

function pageResponse(body: BodyInit | null, status = HttpStatus.OK, extraHeaders: Record<string, string> = {}): Response {
    return new Response(body, {
        status,
        headers: {
            ...PAGE_HEADERS,
            ...extraHeaders
        }
    });
}

function apiResponse(body: unknown): Response {
    return new Response(JSON.stringify(body, null, 4), {
        status: HttpStatus.OK,
        headers: SUBSCRIPTION_HEADERS
    });
}

function clearSessionCookie(request: Request): string {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `jwtToken=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

function isValidIPAddress(value: string): boolean {
    if (isIPv4(value)) return true;
    return isIPv6(value) || isIPv6(`[${value}]`);
}

export async function handleWebsocket(request: Request): Promise<Response> {
    const { pathName } = globalThis.globalConfig;
    const encodedPathConfig = pathName.replace(/^\/+/, '');

    try {
        const parsed = JSON.parse(base64DecodeUtf8(encodedPathConfig));
        const protocol = parsed.protocol === 'tr' ? 'tr' : parsed.protocol === 'vl' ? 'vl' : '';
        const proxyMode = parsed.mode === 'prefix' ? 'prefix' : 'proxyip';
        const panelIPs = Array.isArray(parsed.panelIPs)
            ? parsed.panelIPs.filter((item: unknown): item is string => typeof item === 'string').slice(0, 200)
            : [];

        if (!protocol) {
            throw new Error('Unsupported WebSocket protocol.');
        }

        globalThis.wsConfig = {
            ...globalThis.wsConfig,
            wsProtocol: protocol,
            proxyMode,
            panelIPs
        };

        return protocol === 'vl'
            ? await VlOverWSHandler(request)
            : await TrOverWSHandler(request);
    } catch {
        return new Response('Failed to parse WebSocket path config', {
            status: HttpStatus.BAD_REQUEST,
            headers: SECURITY_HEADERS
        });
    }
}

export async function handlePanel(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;

    switch (pathName) {
        case '/panel':
            return await renderPanel(request, env);

        case '/panel/settings':
            return await getSettings(request, env);

        case '/panel/update-settings':
            return await updateSettings(request, env);

        case '/panel/reset-settings':
            return await resetSettings(request, env);

        case '/panel/reset-password':
            return await resetPassword(request, env);

        case '/panel/my-ip':
            return await getMyIP(request, env);

        case '/panel/update-warp':
            return await updateWarpConfigs(request, env);

        case '/panel/get-warp-configs':
            return await getWarpConfigs(request, env);

        case '/panel/logout':
            return logout(request);

        case '/panel/health':
            return await getSystemHealth(env);

        case '/panel/backup':
            return await handleBackup(request, env);

        default:
            return await fallback(request);
    }
}

export async function handleProxyIPs(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);

    if (!auth) {
        const { urlOrigin } = globalThis.httpConfig;
        return Response.redirect(`${urlOrigin}/login`, 302);
    }

    const { pathName } = globalThis.globalConfig;

    switch (pathName) {
        case '/proxy-ip':
            return await renderProxyIPs();

        case '/proxy-ip/get':
        case '/proxy-ip/generate':
            return await getProxyIPsInfo(env);

        default:
            return await fallback(request);
    }
}

export async function renderError(error: any): Promise<Response> {
    const html = await decompressHtml(__ERROR_HTML_CONTENT__, true) as string;
    const errorPage = html.replace('__ERROR_MESSAGE__', escapeHtml(safeErrorMessage(error)));

    return pageResponse(errorPage, HttpStatus.INTERNAL_SERVER_ERROR);
}

async function renderProxyIPs() {
    const html = await decompressHtml(__PROXY_IP_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderSupport() {
    const html = await decompressHtml(__SUPPORT_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderAnalytics(): Promise<Response> {
    const html = await decompressHtml(__ANALYTICS_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderUsers(): Promise<Response> {
    const html = await decompressHtml(__USERS_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderApiKeys(): Promise<Response> {
    const html = await decompressHtml(__APIKEYS_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderHealth(): Promise<Response> {
    const html = await decompressHtml(__HEALTH_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderBackup(): Promise<Response> {
    const html = await decompressHtml(__BACKUP_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function renderSecrets(): Promise<Response> {
    const html = await decompressHtml(__SECRETS_HTML_CONTENT__, false);
    return pageResponse(html);
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;

    if (pathName === '/login') {
        return await renderLogin(request, env);
    }

    if (pathName === '/login/authenticate') {
        return await generateJWTToken(request, env);
    }

    return await fallback(request);
}

export function logout(request: Request): Response {
    return respond(true, HttpStatus.OK, 'Successfully logged out!', null, {
        'Set-Cookie': clearSessionCookie(request),
        'Cache-Control': 'no-store'
    });
}

/* Admin API: Users */

async function handleUsers(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'GET') {
        const users = await listUsers(env);
        return respond(true, HttpStatus.OK, undefined, users);
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json() as Partial<PanelUser>;
            const user = await createUser(env, body);
            return respond(true, HttpStatus.CREATED, 'User created.', user);
        } catch (error) {
            return respond(false, HttpStatus.BAD_REQUEST, safeErrorMessage(error));
        }
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

async function handleUserById(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'PUT') {
        try {
            const body = await request.json() as Partial<PanelUser>;
            const user = await updateUser(env, id, body);
            if (!user) {
                return respond(false, HttpStatus.NOT_FOUND, 'User not found.');
            }
            return respond(true, HttpStatus.OK, 'User updated.', user);
        } catch (error) {
            return respond(false, HttpStatus.BAD_REQUEST, safeErrorMessage(error));
        }
    }

    if (request.method === 'DELETE') {
        const deleted = await deleteUser(env, id);
        if (!deleted) {
            return respond(false, HttpStatus.NOT_FOUND, 'User not found.');
        }
        return respond(true, HttpStatus.OK, 'User deleted.');
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

/* Admin API: API Keys */

async function handleApiKeys(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'GET') {
        const keys = await listApiKeys(env);
        return respond(true, HttpStatus.OK, undefined, keys);
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json() as Partial<ApiKey>;
            const key = await createApiKey(env, body);
            return respond(true, HttpStatus.CREATED, 'API key created.', key);
        } catch (error) {
            return respond(false, HttpStatus.BAD_REQUEST, safeErrorMessage(error));
        }
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

async function handleApiKeyById(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'DELETE') {
        const revoked = await revokeApiKey(env, id);
        if (!revoked) {
            return respond(false, HttpStatus.NOT_FOUND, 'API key not found.');
        }
        return respond(true, HttpStatus.OK, 'API key revoked.');
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

/* Admin API: Analytics & Stats */

async function handleStats(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'GET') {
        const stats = await getSubscriptionStats(env);
        return respond(true, HttpStatus.OK, undefined, stats);
    }

    if (request.method === 'DELETE') {
        await resetSubscriptionStats(env);
        return respond(true, HttpStatus.OK, 'Statistics reset.');
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

/* Admin API: Health */

async function getSystemHealth(env: Env): Promise<Response> {
    const health = await performHealthCheck(env, env.kv);
    return respond(true, HttpStatus.OK, 'System health retrieved.', health);
}

/* Admin API: Backup & Restore */

async function handleBackup(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method === 'GET') {
        const backup = await createBackup(env);
        return respond(true, HttpStatus.OK, 'Backup created.', backup);
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json() as BackupData;
            await restoreBackup(env, body);
            return respond(true, HttpStatus.OK, 'Backup restored successfully.');
        } catch (error) {
            return respond(false, HttpStatus.BAD_REQUEST, safeErrorMessage(error));
        }
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

/* Subscriptions with auth + stats tracking */

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    await setSettings(request, env);
    const {
        globalConfig: { pathName },
        httpConfig: { client, subPath }
    } = globalThis;

    const match = pathName.match(/^\/sub\/(\w+)\/([^/]+)$/);
    if (!match) return await fallback(request);

    const [, subType, subPathParam] = match;
    const isAuthenticated = await requireAuth(request, env);

    if (subType === 'normal') {
        switch (client) {
            case 'xray':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'xray');
                return await getXrCustomConfigs(false);
            case 'sing-box':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'sing-box');
                return await getSbCustomConfig(false);
            case 'clash':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'clash');
                return await getClNormalConfig();
            default:
                return await fallback(request);
        }
    }

    if (subType === 'raw') {
        if (client === 'xray' || client === 'sing-box') {
            if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, client);
            return await getURLConfigs();
        }
        return await fallback(request);
    }

    if (subType === 'fragment') {
        switch (client) {
            case 'xray':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'xray');
                return await getXrCustomConfigs(true);
            case 'sing-box':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'sing-box');
                return await getSbCustomConfig(true);
            default:
                return await fallback(request);
        }
    }

    if (subType === 'warp') {
        switch (client) {
            case 'xray':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'xray');
                return await getXrWarpConfigs(request, env, false, false);
            case 'sing-box':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'sing-box');
                return await getSbWarpConfig(request, env);
            case 'clash':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'clash');
                return await getClWarpConfig(request, env, false);
            default:
                return await fallback(request);
        }
    }

    if (subType === 'warp-pro') {
        switch (client) {
            case 'xray':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'xray');
                return await getXrWarpConfigs(request, env, true, false);
            case 'xray-knocker':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'xray-knocker');
                return await getXrWarpConfigs(request, env, true, true);
            case 'clash':
                if (isAuthenticated) await recordSubscriptionAccess(env, subPathParam, 'clash');
                return await getClWarpConfig(request, env, true);
            default:
                return await fallback(request);
        }
    }

    return await fallback(request);
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const auth = await requireAuth(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        const proxySettings = await updateDataset(request, env);
        return respond(true, HttpStatus.OK, 'Settings saved successfully.', proxySettings);
    } catch (error) {
        console.error(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while updating settings: ${safeErrorMessage(error)}`);
    }
}

async function resetSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed!');
    }

    const auth = await requireAuth(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        const { settings } = globalThis;
        await env.kv.put("proxySettings", JSON.stringify(settings));
        return respond(true, HttpStatus.OK, 'Settings reset to defaults.', settings);
    } catch (error) {
        console.error(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while resetting settings: ${safeErrorMessage(error)}`);
    }
}

async function getSettings(request: Request, env: Env): Promise<Response> {
    const isPassSet = Boolean(await env.kv.get('pwd'));
    const auth = isPassSet ? await requireAuth(request, env) : false;

    if (isPassSet && !auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.', { isPassSet });
    }

    try {
        const dataset = await getDataset(request, env);
        const { subPath } = globalThis.httpConfig;

        const data = {
            proxySettings: dataset.settings,
            isPassSet,
            subPath,
            version: __VERSION__
        };

        return respond(true, HttpStatus.OK, undefined, data);
    } catch (error) {
        console.error(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while fetching settings: ${safeErrorMessage(error)}`);
    }
}

export async function fallback(request: Request): Promise<Response> {
    const { fallbackDomain } = globalThis.globalConfig;
    const { url, method, headers } = request;
    const currentURL = new URL(url);

    if (currentURL.hostname === fallbackDomain) {
        return pageResponse('Not found', HttpStatus.NOT_FOUND);
    }

    const newURL = new URL(url);
    newURL.hostname = fallbackDomain;
    newURL.protocol = 'https:';

    const forwardedHeaders = new Headers(headers);
    [
        'host',
        'content-length',
        'connection',
        'cf-connecting-ip',
        'cf-ipcountry',
        'cf-ray',
        'cf-visitor',
        'x-forwarded-for',
        'x-forwarded-proto',
        'x-real-ip'
    ].forEach(header => forwardedHeaders.delete(header));

    const hasBody = !['GET', 'HEAD'].includes(method);

    try {
        return await fetch(new Request(newURL.toString(), {
            method,
            headers: forwardedHeaders,
            body: hasBody ? request.body : undefined,
            redirect: 'manual'
        }));
    } catch (error) {
        console.error('Fallback request failed:', safeErrorMessage(error));
        return pageResponse('Bad gateway', HttpStatus.BAD_GATEWAY);
    }
}

async function getMyIP(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const ip = (await request.text()).trim();

    if (!ip || ip.length > 64 || !isValidIPAddress(ip)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A valid IPv4 or IPv6 address is required.');
    }

    try {
        const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?nocache=${Date.now()}`, {
            signal: AbortSignal.timeout(8000)
        });
        const geoLocation = await response.json();
        return respond(true, HttpStatus.OK, '', geoLocation);
    } catch (error) {
        console.error('Error fetching IP address:', error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error fetching IP address: ${safeErrorMessage(error)}`);
    }
}

async function getWarpConfigs(request: Request, env: Env): Promise<Response> {
    const {
        httpConfig: { client },
        dict: { _project_ }
    } = globalThis;

    const isPro = client === 'amnezia';
    const auth = await requireAuth(request, env);

    if (!auth) {
        return new Response('Unauthorized or expired session.', {
            status: HttpStatus.UNAUTHORIZED,
            headers: SECURITY_HEADERS
        });
    }

    try {
        const { warpAccounts, settings } = await getDataset(request, env);
        const account = warpAccounts[0];

        if (!account) {
            throw new Error('No WARP account is available.');
        }

        const { warpIPv6, publicKey, privateKey } = account;
        const {
            warpEndpoints,
            warpRemoteDNS,
            amneziaNoiseCount,
            amneziaNoiseSizeMin,
            amneziaNoiseSizeMax
        } = settings;

        const zip = new JSZip();
        const trimLines = (str: string) => str.split("\n").map(line => line.trim()).join("\n");

        warpEndpoints?.forEach((endpoint, index) => {
            const config =
                `[Interface]
PrivateKey = ${privateKey}
Address = 172.16.0.2/32, ${warpIPv6}
DNS = ${warpRemoteDNS}
MTU = 1280
${isPro ?
                `Jc = ${amneziaNoiseCount}
Jmin = ${amneziaNoiseSizeMin}
Jmax = ${amneziaNoiseSizeMax}
S1 = 0
S2 = 0
H1 = 0
H2 = 0
H3 = 0
H4 = 0`
                : ''
            }
[Peer]
PublicKey = ${publicKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${endpoint}
PersistentKeepalive = 25`;

            zip.file(`${_project_}-Warp-${index + 1}.conf`, trimLines(config));
        });

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const arrayBuffer = await zipBlob.arrayBuffer();

        return new Response(arrayBuffer, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${_project_}-Warp-${isPro ? "Pro-" : ""}configs.zip"`,
                'Cache-Control': 'no-store',
                ...SECURITY_HEADERS
            },
        });
    } catch (error) {
        console.error(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error generating ZIP file: ${safeErrorMessage(error)}`);
    }
}

async function getProxyIPsInfo(env: Env): Promise<Response> {
    let storedProxyIPs: string[] = [];
    try {
        const storedSettings = await env.kv.get('proxySettings', { type: 'json' }) as Partial<Settings> | null;
        storedProxyIPs = Array.isArray(storedSettings?.proxyIPs) ? storedSettings.proxyIPs : [];
    } catch (error) {
        console.warn('Stored Proxy IP settings unavailable; using environment sources.', safeErrorMessage(error));
    }

    const configured = [
        ...storedProxyIPs,
        ...(env.PROXY_IP ? env.PROXY_IP.split(/[\s,\n]+/).filter(Boolean) : []),
        globalThis.dict._public_proxy_ip_
    ];
    const addresses = new Set<string>();

    for (const entry of configured) {
        const value = entry.trim();
        if (!value) continue;

        const parsed = parseHostPort(value, false);
        const rawHost = parsed.host || value;
        const host = rawHost.replace(/^\[|\]$/g, '');

        if (isIPv4(host) || isIPv6(`[${host}]`)) {
            addresses.add(host);
            continue;
        }

        if (!isDomain(host)) continue;

        try {
            const resolved = await resolveDNS(host, true);
            resolved.ipv4.forEach(ip => addresses.add(ip));
        } catch (error) {
            console.warn(`Proxy IP DNS source skipped: ${host}`, safeErrorMessage(error));
        }
    }

    const ipList = [...addresses].slice(0, 500);
    if (!ipList.length) {
        return respond(true, HttpStatus.OK, 'No Proxy IP records are currently available.', []);
    }

    try {
        const geoLocInfo = await geoLookupBatch(ipList);
        const known = new Set(geoLocInfo.map(item => item.ip));
        const fallbackRows = ipList
            .filter(ip => !known.has(ip))
            .map(ip => ({ ip, city: '-', country: '-', countryCode: '', isp: '-' }));
        return respond(true, HttpStatus.OK, undefined, [...geoLocInfo, ...fallbackRows]);
    } catch (error) {
        console.warn('Proxy IP geo lookup unavailable; returning raw addresses.', safeErrorMessage(error));
        return respond(true, HttpStatus.OK, 'Geo data is temporarily unavailable.', ipList.map(ip => ({
            ip, city: '-', country: '-', countryCode: '', isp: '-'
        })));
    }
}

export async function serveIcon(): Promise<Response> {
    const faviconBase64 = __ICON__;
    const body = Uint8Array.from(atob(faviconBase64), c => c.charCodeAt(0));

    return new Response(body, {
        headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=86400, immutable',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

async function renderPanel(request: Request, env: Env): Promise<Response> {
    const pwd = await env.kv.get('pwd');

    if (pwd) {
        const auth = await requireAuth(request, env);
        if (!auth) {
            const { urlOrigin } = globalThis.httpConfig;
            return Response.redirect(`${urlOrigin}/login`, 302);
        }
    }

    const html = await decompressHtml(__PANEL_HTML_CONTENT__, false);
    return pageResponse(html);
}

async function renderLogin(request: Request, env: Env): Promise<Response> {
    const auth = await requireAuth(request, env);
    if (auth) {
        const { urlOrigin } = globalThis.httpConfig;
        return Response.redirect(`${urlOrigin}/panel`, 302);
    }

    const html = await decompressHtml(__LOGIN_HTML_CONTENT__, false);
    return pageResponse(html);
}

async function updateWarpConfigs(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const auth = await requireAuth(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    }

    try {
        await fetchWarpAccounts(env);
        return respond(true, HttpStatus.OK, 'Warp configs updated successfully!');
    } catch (error) {
        console.error(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `An error occurred while updating Warp configs: ${safeErrorMessage(error)}`);
    }
}

async function decompressHtml(content: string, asString: boolean): Promise<string | ReadableStream<Uint8Array>> {
    try {
        const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));

        if (asString) {
            const decompressedArrayBuffer = await new Response(stream).arrayBuffer();
            return new TextDecoder().decode(decompressedArrayBuffer);
        }

        return stream;
    } catch (error) {
        throw new Error(`Unable to render page: ${safeErrorMessage(error)}`);
    }
}

export async function handleDoH(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { subPath } = globalThis.httpConfig;
    const { dohURL } = globalThis.globalConfig;
    const decodedPath = (() => {
        try {
            return decodeURIComponent(url.pathname);
        } catch {
            return url.pathname;
        }
    })();

    if (decodedPath !== `/dns-query/${subPath}`) {
        return fallback(request);
    }

    if (!['GET', 'POST'].includes(request.method)) {
        return new Response('Method not allowed', {
            status: HttpStatus.METHOD_NOT_ALLOWED,
            headers: SECURITY_HEADERS
        });
    }

    const targetURL = new URL(dohURL);
    url.searchParams.forEach((value, key) => {
        targetURL.searchParams.set(key, value);
    });

    const headers = new Headers();
    const accept = request.headers.get('accept');
    const contentType = request.headers.get('content-type');
    if (accept) headers.set('accept', accept);
    if (contentType) headers.set('content-type', contentType);

    try {
        return await fetch(targetURL.toString(), {
            method: request.method,
            headers,
            body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
            signal: AbortSignal.timeout(10000)
        });
    } catch (error) {
        return new Response(`DoH upstream error: ${safeErrorMessage(error)}`, {
            status: HttpStatus.BAD_GATEWAY,
            headers: SECURITY_HEADERS
        });
    }
}

interface IpApiBatchResponse {
    query: string;
    city?: string;
    country?: string;
    countryCode?: string;
    isp?: string;
    status: "success" | "fail";
    message?: string;
}

interface GeoResult {
    ip: string;
    city?: string;
    country?: string;
    countryCode?: string;
    isp?: string;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }

    return chunks;
}

async function geoLookupBatch(ipList: string[]): Promise<GeoResult[]> {
    const batches = chunkArray(ipList, 100);
    const results: GeoResult[] = [];

    for (const batch of batches) {
        const res = await fetch(
            "http://ip-api.com/batch?fields=query,city,country,countryCode,isp,status",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(batch),
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!res.ok) {
            throw new Error(`ip-api request failed: ${res.status}`);
        }

        const data: IpApiBatchResponse[] = await res.json();

        for (const item of data) {
            if (item.status === "success") {
                results.push({
                    ip: item.query,
                    city: item.city,
                    country: item.country,
                    countryCode: item.countryCode,
                    isp: item.isp,
                });
            }
        }
    }

    return results;
}

export async function getURLConfigs() {
    const {
        globalConfig: { userID, TrPass },
        httpConfig: { defaultHttpsPorts, client, hostName },
        dict: { _VL_, _TR_ },
        settings: {
            fingerprint,
            ports: configuredPorts,
            customCdnAddrs,
            customCdnHost,
            customCdnSni,
            outProxy,
            remoteDNS,
            customConfigs,
            customSubs,
            upstreamParams: { upstreamServer, upstreamPort }
        }
    } = globalThis;

    const buildConfig = (protocol: string, addr: string, port: number, host: string, sni: string, remark: string) => {
        const isTLS = defaultHttpsPorts.includes(port) || addr === upstreamServer;
        const security = isTLS ? 'tls' : 'none';
        const config = new URL(`${protocol}://config`);

        if (protocol === _VL_) {
            config.username = userID;
            config.searchParams.append('encryption', 'none');
        } else {
            config.username = TrPass;
        }

        const path = generateWsPath(protocol);
        config.hostname = addr;
        config.port = port.toString();
        config.searchParams.append('host', host);
        config.searchParams.append('type', 'ws');
        config.searchParams.append('security', security);
        config.hash = remark;

        if (client === 'sing-box') {
            config.searchParams.append('eh', 'Sec-WebSocket-Protocol');
            config.searchParams.append('ed', '2560');
            config.searchParams.append('path', path);
        } else {
            config.searchParams.append('path', `${path}?ed=2560`);
        }

        if (isTLS) {
            config.searchParams.append('sni', sni);
            config.searchParams.append('fp', fingerprint);
            config.searchParams.append('alpn', 'http/1.1');
        }

        return config.href;
    }

    let VLConfs = '', TRConfs = '', chainProxy = '';
    let proxyIndex = 1;
    const addrs = await getConfigAddresses(false);
    const ports = [...configuredPorts];

    if (upstreamServer && upstreamPort) {
        ports.unshift(upstreamPort);
        if (!addrs.includes(upstreamServer)) addrs.unshift(upstreamServer);
    }

    const protocols = getProtocols();
    const seen = new Set<string>();

    for (const port of ports) {
        for (const addr of addrs) {
            if ((port === upstreamPort) !== (addr === upstreamServer)) continue;

            const key = `${addr}:${port}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const isCustomAddr = customCdnAddrs.includes(addr);
            const sni = isCustomAddr ? customCdnSni : randomUpperCase(hostName);
            const host = isCustomAddr ? customCdnHost : hostName;

            for (const protocol of protocols) {
                const remark = generateRemark(proxyIndex, port, addr, protocol, false, false);
                const config = buildConfig(protocol, addr, port, host, sni, remark);

                if (protocol === _VL_) VLConfs += `${config}\n`;
                if (protocol === _TR_) TRConfs += `${config}\n`;
            }

            proxyIndex++;
        }
    }

    if (outProxy) {
        const chainRemark = `#${encodeURIComponent('Technamooz Chain Proxy')}`;
        if (outProxy.startsWith('socks') || outProxy.startsWith('http')) {
            const regex = /^(?:socks|http):\/\/([^@]+)@/;
            const userPass = outProxy.match(regex)?.[1];
            chainProxy = userPass
                ? outProxy.replace(userPass, btoa(userPass)) + chainRemark
                : outProxy + chainRemark;
        } else {
            chainProxy = outProxy.split('#')[0] + chainRemark;
        }
    }

    const customConfs = [...customConfigs, await fetchCustomSubs(customSubs)]
        .filter(Boolean)
        .join("\n");
    const configs = base64EncodeUtf8(VLConfs + TRConfs + chainProxy + customConfs);

    return new Response(configs, {
        status: HttpStatus.OK,
        headers: {
            ...SUBSCRIPTION_HEADERS,
            'Profile-Title': `base64:${base64EncodeUtf8('Technamooz Raw')}`,
            'DNS': remoteDNS
        }
    });
}

async function fetchCustomSubs(subs: string[]): Promise<string> {
    const results = await Promise.all(
        subs.slice(0, 50).map(async (url) => {
            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) return "";

                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Technamooz-Panel/1.0' },
                    signal: AbortSignal.timeout(10000)
                });
                if (!res.ok) return "";

                const text = (await res.text()).trim();
                if (!text) return "";

                if (isBase64(text)) {
                    try {
                        return base64DecodeUtf8(text);
                    } catch {
                        return text;
                    }
                }

                return text;
            } catch {
                return "";
            }
        })
    );

    return results
        .filter(Boolean)
        .join("\n");
}

function isBase64(str: string): boolean {
    const compact = str.replace(/\s+/g, '');
    if (!compact || compact.length < 16) return false;
    return /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact);
}

/* Admin API Route Handler */

export async function handleAdminAPI(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;

    if (!pathName.startsWith('/admin')) {
        return await fallback(request);
    }

    const segments = pathName.split('/').filter(Boolean);

    if (segments[1] === 'users') {
        if (segments.length === 2) {
            return await handleUsers(request, env);
        }
        if (segments.length === 3) {
            return await handleUserById(request, env, segments[2]);
        }
    }

    if (segments[1] === 'api-keys') {
        if (segments.length === 2) {
            return await handleApiKeys(request, env);
        }
        if (segments.length === 3) {
            return await handleApiKeyById(request, env, segments[2]);
        }
    }

    if (segments[1] === 'stats') {
        return await handleStats(request, env);
    }

    return respond(false, HttpStatus.NOT_FOUND, 'Admin endpoint not found.');
}