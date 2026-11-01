import { SignJWT, jwtVerify } from 'jose';
import { HttpStatus, respond, safeErrorMessage, clientAddress, isSecureRequest, generateApiKey, constantTimeEqual } from '@common';

const SESSION_COOKIE = 'jwtToken';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_PREFIX = 'pbkdf2-sha256';

interface LoginAttempt {
    count: number;
    blockedUntil: number;
    windowStart: number;
}

interface AdminSession {
    userID: string;
    role: 'admin';
    authenticatedAt: number;
}

function sessionCookie(token: string | null, secure: boolean): string {
    if (!token) {
        return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
    }

    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function apiKeyCookie(token: string | null, secure: boolean): string {
    if (!token) {
        return `tk_api_key=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
    }

    return `tk_api_key=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const saltBytes = new Uint8Array(salt.length);
    saltBytes.set(salt);

    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        },
        material,
        256
    );

    return bytesToBase64(new Uint8Array(bits));
}

async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);

    return `${PASSWORD_PREFIX}$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; needsRehash: boolean }> {
    if (stored.startsWith(`${PASSWORD_PREFIX}$`)) {
        const [, iterationsText, saltText, hash] = stored.split('$');
        const iterations = Number(iterationsText);

        if (!Number.isInteger(iterations) || iterations < 10_000 || !saltText || !hash) {
            return { valid: false, needsRehash: false };
        }

        const candidate = await derivePasswordHash(password, base64ToBytes(saltText), iterations);
        return {
            valid: constantTimeEqual(candidate, hash),
            needsRehash: iterations < PASSWORD_ITERATIONS
        };
    }

    return {
        valid: constantTimeEqual(password, stored),
        needsRehash: true
    };
}

async function readLoginAttempt(env: Env, address: string): Promise<LoginAttempt | null> {
    try {
        return await env.kv.get(`loginAttempts:${address}`, { type: 'json' }) as LoginAttempt | null;
    } catch {
        return null;
    }
}

async function writeLoginAttempt(env: Env, address: string, attempt: LoginAttempt): Promise<void> {
    try {
        await env.kv.put(`loginAttempts:${address}`, JSON.stringify(attempt), {
            expirationTtl: LOGIN_WINDOW_SECONDS
        });
    } catch (error) {
        console.warn('Unable to persist login throttling state:', safeErrorMessage(error));
    }
}

async function readPanelUsers(env: Env): Promise<PanelUser[]> {
    try {
        const data = await env.kv.get('panelUsers', { type: 'json' }) as PanelUser[] | null;
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function writePanelUsers(env: Env, users: PanelUser[]): Promise<void> {
    await env.kv.put('panelUsers', JSON.stringify(users));
}

async function readApiKeys(env: Env): Promise<ApiKey[]> {
    try {
        const data = await env.kv.get('apiKeys', { type: 'json' }) as ApiKey[] | null;
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function writeApiKeys(env: Env, keys: ApiKey[]): Promise<void> {
    await env.kv.put('apiKeys', JSON.stringify(keys));
}

async function readSubscriptionStats(env: Env): Promise<SubscriptionStat[]> {
    try {
        const data = await env.kv.get('subscriptionStats', { type: 'json' }) as SubscriptionStat[] | null;
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function writeSubscriptionStats(env: Env, stats: SubscriptionStat[]): Promise<void> {
    await env.kv.put('subscriptionStats', JSON.stringify(stats));
}

export async function generateJWTToken(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const password = (await request.text()).trim();

    if (!password || password.length > 512) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Please enter a valid password.');
    }

    const address = clientAddress(request);
    const attempt = await readLoginAttempt(env, address);
    const now = Date.now();

    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
        return respond(
            false,
            HttpStatus.TOO_MANY_REQUESTS,
            'Too many login attempts. Please try again later.'
        );
    }

    const savedPass = await env.kv.get('pwd');

    if (!savedPass) {
        return respond(false, HttpStatus.BAD_REQUEST, 'No panel password has been set yet.');
    }

    const { valid, needsRehash } = await verifyPassword(password, savedPass);

    if (!valid) {
        const nextAttempt: LoginAttempt = {
            count: (attempt?.count ?? 0) + 1,
            blockedUntil: 0,
            windowStart: attempt?.windowStart ?? now
        };

        if (nextAttempt.count >= MAX_LOGIN_ATTEMPTS) {
            nextAttempt.blockedUntil = now + LOGIN_WINDOW_SECONDS * 1000;
        }

        await writeLoginAttempt(env, address, nextAttempt);

        return respond(
            false,
            nextAttempt.blockedUntil
                ? HttpStatus.TOO_MANY_REQUESTS
                : HttpStatus.UNAUTHORIZED,
            nextAttempt.blockedUntil
                ? 'Too many login attempts. Please try again later.'
                : 'Wrong password.'
        );
    }

    if (needsRehash) {
        await env.kv.put('pwd', await hashPassword(password));
    }

    await env.kv.delete(`loginAttempts:${address}`);

    let secretKey = await env.kv.get('secretKey');

    if (!secretKey) {
        secretKey = generateSecretKey();
        await env.kv.put('secretKey', secretKey);
    }

    const secret = new TextEncoder().encode(secretKey);
    const { userID } = globalThis.globalConfig;

    const jwtToken = await new SignJWT({ userID, role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
        .sign(secret);

    const users = await readPanelUsers(env);
    const adminUser = users.find(u => u.role === 'admin');
    if (adminUser) {
        adminUser.lastLogin = new Date().toISOString();
        await writePanelUsers(env, users);
    }

    return respond(true, HttpStatus.OK, 'Successfully authenticated', null, {
        'Set-Cookie': sessionCookie(jwtToken, isSecureRequest(request)),
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
    });
}

function generateSecretKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function Authenticate(request: Request, env: Env): Promise<boolean> {
    try {
        const secretKey = await env.kv.get('secretKey');

        if (!secretKey) return false;

        const secret = new TextEncoder().encode(secretKey);
        const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)jwtToken=([^;]*)/);
        const token = cookie ? cookie[1] : null;

        if (!token) return false;

        const { payload } = await jwtVerify(token, secret, {
            algorithms: ['HS256']
        });

        return payload.userID === globalThis.globalConfig.userID && (payload.role === 'admin' || payload.role === 'user');
    } catch {
        return false;
    }
}

export async function authenticateAPIKey(request: Request, env: Env): Promise<boolean> {
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey) return false;

    try {
        const keys = await readApiKeys(env);
        const key = keys.find(k => k.key === apiKey && k.isActive);

        if (!key) return false;

        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
            return false;
        }

        key.lastUsed = new Date().toISOString();
        await writeApiKeys(env, keys);
        return true;
    } catch {
        return false;
    }
}

export async function requireAuth(request: Request, env: Env): Promise<boolean> {
    const isAPI = request.headers.get('X-API-Key') !== null;
    if (isAPI) {
        return await authenticateAPIKey(request, env);
    }
    return await Authenticate(request, env);
}

export async function resetPassword(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const oldPwd = await env.kv.get('pwd');
    const auth = oldPwd ? await Authenticate(request, env) : false;

    if (oldPwd && !auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    const newPwd = (await request.text()).trim();

    if (newPwd.length < 8 || newPwd.length > 128) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Password must be between 8 and 128 characters.');
    }

    if (!/[A-Z]/.test(newPwd) || !/[a-z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            'Password must include uppercase and lowercase letters and at least one number.'
        );
    }

    if (oldPwd && await verifyPassword(newPwd, oldPwd).then(result => result.valid)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Please enter a new password.');
    }

    await env.kv.put('pwd', await hashPassword(newPwd));
    await env.kv.delete('secretKey');

    return respond(true, HttpStatus.OK, 'Password updated successfully. Please sign in again.', null, {
        'Set-Cookie': sessionCookie(null, isSecureRequest(request)),
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
    });
}

/* User Management */

export async function listUsers(env: Env): Promise<PanelUser[]> {
    return await readPanelUsers(env);
}

export async function createUser(env: Env, body: Partial<PanelUser>): Promise<PanelUser> {
    const users = await readPanelUsers(env);

    if (users.find(u => u.username === body.username)) {
        throw new Error('Username already exists.');
    }

    const user: PanelUser = {
        id: crypto.randomUUID(),
        username: body.username || 'user',
        email: body.email,
        role: body.role || 'user',
        status: body.status || 'active',
        createdAt: new Date().toISOString(),
        subscriptionCount: 0,
        apiKey: body.apiKey
    };

    users.push(user);
    await writePanelUsers(env, users);
    return user;
}

export async function updateUser(env: Env, id: string, updates: Partial<PanelUser>): Promise<PanelUser | null> {
    const users = await readPanelUsers(env);
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return null;

    users[index] = { ...users[index], ...updates };
    await writePanelUsers(env, users);
    return users[index];
}

export async function deleteUser(env: Env, id: string): Promise<boolean> {
    const users = await readPanelUsers(env);
    const filtered = users.filter(u => u.id !== id);
    if (filtered.length === users.length) return false;
    await writePanelUsers(env, filtered);
    return true;
}

/* API Key Management */

export async function listApiKeys(env: Env): Promise<ApiKey[]> {
    return await readApiKeys(env);
}

export async function createApiKey(env: Env, body: Partial<ApiKey>): Promise<ApiKey> {
    const keys = await readApiKeys(env);
    const key = generateApiKey();
    const prefix = key.slice(0, 8);

    const apiKey: ApiKey = {
        id: crypto.randomUUID(),
        name: body.name || 'API Key',
        key,
        prefix,
        scopes: body.scopes || ['read'],
        createdAt: new Date().toISOString(),
        isActive: body.isActive !== false,
        expiresAt: body.expiresAt
    };

    keys.push(apiKey);
    await writeApiKeys(env, keys);
    return apiKey;
}

export async function revokeApiKey(env: Env, id: string): Promise<boolean> {
    const keys = await readApiKeys(env);
    const key = keys.find(k => k.id === id);
    if (!key) return false;
    key.isActive = false;
    await writeApiKeys(env, keys);
    return true;
}

/* Subscription Statistics */

export async function recordSubscriptionAccess(env: Env, path: string, client: string): Promise<void> {
    try {
        const stats = await readSubscriptionStats(env);
        const now = new Date().toISOString();

        const existing = stats.find(s => s.path === path && s.client === client);
        if (existing) {
            existing.downloads += 1;
            existing.lastAccessed = now;
        } else {
            stats.push({
                path,
                client,
                downloads: 1,
                lastAccessed: now,
                createdAt: now
            });
        }

        await writeSubscriptionStats(env, stats);
    } catch {
        // Non-critical: analytics failure should not block subscriptions
    }
}

export async function getSubscriptionStats(env: Env): Promise<SubscriptionStat[]> {
    return await readSubscriptionStats(env);
}

export async function resetSubscriptionStats(env: Env): Promise<void> {
    await writeSubscriptionStats(env, []);
}

/* Backup & Restore */

export async function createBackup(env: Env): Promise<BackupData> {
    const users = await readPanelUsers(env);
    const apiKeys = await readApiKeys(env);
    const subscriptions = await readSubscriptionStats(env);

    return {
        version: __VERSION__,
        exportedAt: new Date().toISOString(),
        settings: globalThis.settings,
        users,
        apiKeys,
        subscriptions
    };
}

export async function restoreBackup(env: Env, data: BackupData): Promise<void> {
    await writePanelUsers(env, data.users || []);
    await writeApiKeys(env, data.apiKeys || []);
    await writeSubscriptionStats(env, data.subscriptions || []);
    if (data.settings) {
        await env.kv.put("proxySettings", JSON.stringify(data.settings));
    }
}