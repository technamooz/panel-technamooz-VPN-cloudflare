export enum HttpStatus {
    OK = 200,
    CREATED = 201,
    NO_CONTENT = 204,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    METHOD_NOT_ALLOWED = 405,
    CONFLICT = 409,
    TOO_MANY_REQUESTS = 429,
    INTERNAL_SERVER_ERROR = 500,
    BAD_GATEWAY = 502,
    SERVICE_UNAVAILABLE = 503
}

export const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self' https://ipv4.geojs.io https://ipv4.icanhazip.com https://ip-api.com http://ip-api.com",
        "manifest-src 'self'"
    ].join('; ')
};

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Requested-With',
    'Access-Control-Max-Age': '86400'
};

export function base64EncodeUtf8(str: string): string {
    const bytes = new TextEncoder().encode(str);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join("");
    return btoa(binary);
}

export function base64DecodeUtf8(base64: string) {
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return new TextDecoder().decode(
        Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    );
}

export function base64UrlEncodeUtf8(str: string): string {
    return base64EncodeUtf8(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function base64UrlDecodeUtf8(base64: string): string {
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return new TextDecoder().decode(
        Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    );
}

export function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function respond(
    success: boolean,
    status: HttpStatus,
    message?: string,
    body?: any,
    customHeaders?: Record<string, string>
): Response {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS,
        ...customHeaders,
    };

    const responseBody = {
        success,
        status,
        message: message ?? null,
        body: body ?? null,
        timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify(responseBody), { status, headers });
}

export function safeErrorMessage(error: any): string {
    return error instanceof Error ? error.message : String(error);
}

export interface RateLimitEntry {
    count: number;
    blockedUntil: number;
    windowStart: number;
}

export class RateLimiter {
    private kv: KVNamespace;
    private prefix: string;
    private maxRequests: number;
    private windowSeconds: number;
    private blockSeconds: number;

    constructor(kv: KVNamespace, prefix: string, maxRequests: number, windowSeconds: number, blockSeconds: number) {
        this.kv = kv;
        this.prefix = prefix;
        this.maxRequests = maxRequests;
        this.windowSeconds = windowSeconds;
        this.blockSeconds = blockSeconds;
    }

    async check(identifier: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
        const key = `${this.prefix}:${identifier}`;
        const now = Date.now();

        try {
            const stored = await this.kv.get(key, { type: 'json' }) as RateLimitEntry | null;

            if (stored && stored.blockedUntil && stored.blockedUntil > now) {
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: stored.blockedUntil
                };
            }

            const windowStart = stored?.windowStart ?? now;
            const count = stored?.count ?? 0;

            if (now - windowStart >= this.windowSeconds * 1000) {
                await this.kv.put(key, JSON.stringify({
                    count: 1,
                    blockedUntil: 0,
                    windowStart: now
                }), { expirationTtl: this.windowSeconds + this.blockSeconds });
                return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowSeconds * 1000 };
            }

            const newCount = count + 1;
            let blockedUntil = 0;

            if (newCount >= this.maxRequests) {
                blockedUntil = now + this.blockSeconds * 1000;
            }

            await this.kv.put(key, JSON.stringify({
                count: newCount,
                blockedUntil,
                windowStart
            }), { expirationTtl: this.windowSeconds + this.blockSeconds });

            return {
                allowed: newCount < this.maxRequests,
                remaining: Math.max(0, this.maxRequests - newCount),
                resetAt: windowStart + this.windowSeconds * 1000
            };
        } catch {
            return { allowed: true, remaining: this.maxRequests, resetAt: now + this.windowSeconds * 1000 };
        }
    }
}

export function clientAddress(request: Request): string {
    return request.headers.get('cf-connecting-ip')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown';
}

export function isSecureRequest(request: Request): boolean {
    return new URL(request.url).protocol === 'https:';
}

export function generateApiKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return `tk_${Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    let mismatch = leftBytes.length ^ rightBytes.length;
    const length = Math.max(leftBytes.length, rightBytes.length);

    for (let index = 0; index < length; index++) {
        mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
    }

    return mismatch === 0;
}

export interface HealthCheckResult {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { ok: boolean; latency?: number; error?: string }>;
    timestamp: string;
}

export async function performHealthCheck(env: Env, kv: KVNamespace): Promise<HealthCheckResult> {
    const checks: Record<string, { ok: boolean; latency?: number; error?: string }> = {};
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const startKV = Date.now();
    try {
        await kv.get('__health_check__');
        checks.kv = { ok: true, latency: Date.now() - startKV };
    } catch (error) {
        checks.kv = { ok: false, error: safeErrorMessage(error) };
        overall = 'unhealthy';
    }

    const startDNS = Date.now();
    try {
        await fetch('https://1.1.1.1/dns-query?name=example.com&type=A', {
            signal: AbortSignal.timeout(5000)
        });
        checks.dns = { ok: true, latency: Date.now() - startDNS };
    } catch (error) {
        checks.dns = { ok: false, error: safeErrorMessage(error) };
        if (overall === 'healthy') overall = 'degraded';
    }

    return {
        status: overall,
        checks,
        timestamp: new Date().toISOString()
    };
}