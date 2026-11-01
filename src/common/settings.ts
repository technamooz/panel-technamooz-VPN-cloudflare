import { isDomain, isIPv4, isIPv6, parseHostPort } from '@utils';

const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized'] as const;
const LOG_LEVELS = ['none', 'warning', 'error', 'info', 'debug'] as const;
const PROXY_MODES = ['proxyip', 'prefix'] as const;
const FRAGMENT_MODES = ['custom', 'low', 'medium', 'high', 'severe'] as const;
const FRAGMENT_PACKETS = ['tlshello', '1-1', '1-2', '1-3', '1-5'] as const;
const NOISE_TYPES = ['rand', 'str', 'base64', 'hex', 'array'] as const;

function hasOwn(value: unknown, key: string): boolean {
    return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

function pick<T>(input: Record<string, any> | null, current: Record<string, any> | null, defaults: Settings, key: keyof Settings): T {
    if (hasOwn(input, key as string)) return input?.[key as string] as T;
    if (hasOwn(current, key as string)) return current?.[key as string] as T;
    return defaults[key] as T;
}

function bool(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

function text(value: unknown, fallback: string, maxLength = 512): string {
    if (typeof value !== 'string') return fallback;
    return value.trim().slice(0, maxLength);
}

function stringList(value: unknown, fallback: string[], maxItems = 500, maxLength = 512): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function isDnsAddress(value: string): boolean {
    if (!value) return false;

    try {
        const url = new URL(value);
        if (!['tcp:', 'https:', 'tls:'].includes(url.protocol)) return false;
        return Boolean(url.hostname);
    } catch {
        return false;
    }
}

function hostOnly(value: string): string {
    try {
        return new URL(value).hostname;
    } catch {
        return value;
    }
}

function isValidHost(value: string): boolean {
    if (!value) return false;
    return isIPv4(value) || isIPv6(value) || isDomain(value);
}

function normalizeNoises(value: unknown, fallback: XrUdpNoise[]): XrUdpNoise[] {
    if (!Array.isArray(value)) return fallback;

    const noises = value
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map(item => {
            const type = oneOf(item.type, NOISE_TYPES, 'rand');
            const packet = text(item.packet, '50-100', 2048);
            const delay = /^\d+-\d+$/.test(String(item.delay)) ? String(item.delay) : '1-1';
            const count = num(item.count, 5, 1, 100);

            if (type === 'rand') {
                const range = packet.match(/^(\d+)-(\d+)$/);
                if (!range || Number(range[1]) > Number(range[2])) {
                    return { type, packet: '50-100', delay, count } satisfies XrUdpNoise;
                }
            }

            if (type === 'hex' && (!/^(?:[0-9a-fA-F]{2})+$/.test(packet) || packet.length > 2048)) {
                return { type, packet: 'deadbeef', delay, count } satisfies XrUdpNoise;
            }

            if (type === 'array') {
                const valid = packet.split(',').every(part => /^\d{1,3}$/.test(part.trim()) && Number(part) <= 255);
                if (!valid) return { type, packet: '0,1,2,3', delay, count } satisfies XrUdpNoise;
            }

            if (type === 'base64' && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packet) || packet.length > 2048)) {
                return { type, packet: 'VGVjaG5hbW9veg==', delay, count } satisfies XrUdpNoise;
            }

            return { type, packet, delay, count } satisfies XrUdpNoise;
        })
        .slice(0, 30);

    return noises.length ? noises : fallback;
}

function normalizePorts(value: unknown, fallback: number[]): number[] {
    if (!Array.isArray(value)) return [...fallback];

    const ports = [...new Set(value
        .map(Number)
        .filter(port => Number.isInteger(port) && port >= 1 && port <= 65535))];

    return ports.length ? ports : [...fallback];
}

function normalizeCustomConfigs(value: unknown, fallback: string[]): string[] {
    const configs = stringList(value, fallback, 500, 8192);

    return configs.filter(config => {
        if (/^(vless|trojan|vmess|ss|socks|http):\/\//i.test(config)) return true;
        return false;
    });
}

function normalizeSubs(value: unknown, fallback: string[]): string[] {
    return stringList(value, fallback, 50, 2048).filter(url => {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    });
}

/**
 * Sanitizes settings coming from KV or from the panel API before they are stored.
 * It is intentionally forgiving: invalid values fall back to safe defaults so a stale
 * KV entry can never break the configuration generators or the Worker runtime.
 */
export function normalizeSettings(
    input: unknown,
    current: unknown,
    defaults: Settings
): Settings {
    const incoming = typeof input === 'object' && input !== null ? input as Record<string, any> : null;
    const existing = typeof current === 'object' && current !== null ? current as Record<string, any> : null;
    const read = <T>(key: keyof Settings) => pick<T>(incoming, existing, defaults, key);

    const localDNS = text(read('localDNS'), defaults.localDNS, 255);
    const remoteDNS = text(read('remoteDNS'), defaults.remoteDNS, 2048);
    const antiSanctionDNS = text(read('antiSanctionDNS'), defaults.antiSanctionDNS, 2048);
    const warpRemoteDNS = text(read('warpRemoteDNS'), defaults.warpRemoteDNS, 255);
    const proxyIPMode = oneOf(read('proxyIPMode'), PROXY_MODES, defaults.proxyIPMode);
    const fragmentMode = oneOf(read('fragmentMode'), FRAGMENT_MODES, defaults.fragmentMode);
    const fragmentPackets = oneOf(read('fragmentPackets'), FRAGMENT_PACKETS, defaults.fragmentPackets);
    const fingerprint = oneOf(read('fingerprint'), FINGERPRINTS, defaults.fingerprint);
    const logLevel = oneOf(read('logLevel'), LOG_LEVELS, defaults.logLevel);
    const knockerNoiseMode = text(read('knockerNoiseMode'), defaults.knockerNoiseMode, 64);

    const safeRemoteDNS = isDnsAddress(remoteDNS) ? remoteDNS : defaults.remoteDNS;
    const safeLocalDNS = localDNS === 'localhost' || isIPv4(localDNS) ? localDNS : defaults.localDNS;
    const safeSanctionDNS = isValidHost(hostOnly(antiSanctionDNS)) ? antiSanctionDNS : defaults.antiSanctionDNS;
    const safeWarpDNS = isIPv4(warpRemoteDNS) ? warpRemoteDNS : defaults.warpRemoteDNS;

    const requestedEndpoints = stringList(read('warpEndpoints'), defaults.warpEndpoints, 100, 255);
    const warpEndpoints = requestedEndpoints.filter(endpoint => {
        const { host, port } = parseHostPort(endpoint, true);
        return Boolean(host && port > 0 && port <= 65535 && isValidHost(host));
    });

    const requestedUpstream = text(read('upstreamProxy'), defaults.upstreamProxy, 255);
    const upstreamHostPort = requestedUpstream ? parseHostPort(requestedUpstream, true) : { host: '', port: 0 };
    const upstreamProxy = requestedUpstream && upstreamHostPort.host && upstreamHostPort.port > 0
        ? requestedUpstream
        : '';

    const requestedOutProxy = text(read('outProxy'), defaults.outProxy, 4096);
    let outProxy = '';
    if (requestedOutProxy) {
        try {
            const parsed = new URL(requestedOutProxy);
            if (['http:', 'socks:', 'socks5:', 'vless:', 'vmess:', 'trojan:', 'ss:'].includes(parsed.protocol)) {
                outProxy = requestedOutProxy;
            }
        } catch {
            outProxy = '';
        }
    }

    const customCdnAddrs = stringList(read('customCdnAddrs'), defaults.customCdnAddrs, 100, 255);
    const customCdnHost = text(read('customCdnHost'), defaults.customCdnHost, 255);
    const customCdnSni = text(read('customCdnSni'), defaults.customCdnSni, 255);
    const hasPartialCustomCdn = Boolean(customCdnAddrs.length || customCdnHost || customCdnSni)
        && !(customCdnAddrs.length && customCdnHost && customCdnSni);

    const echServerName = text(read('echServerName'), defaults.echServerName, 255);
    const safeEchServerName = !echServerName || isDomain(echServerName) ? echServerName : '';

    const ports = normalizePorts(read('ports'), defaults.ports);
    const VLConfigs = bool(read('VLConfigs'), defaults.VLConfigs);
    const TRConfigs = bool(read('TRConfigs'), defaults.TRConfigs);

    return {
        localDNS: safeLocalDNS,
        antiSanctionDNS: safeSanctionDNS,
        fakeDNS: bool(read('fakeDNS'), defaults.fakeDNS),
        enableIPv6: bool(read('enableIPv6'), defaults.enableIPv6),
        allowLANConnection: bool(read('allowLANConnection'), defaults.allowLANConnection),
        logLevel,
        remoteDNS: safeRemoteDNS,
        remoteDnsHost: read<DnsHost>('remoteDnsHost') ?? defaults.remoteDnsHost,
        proxyIPMode,
        proxyIPs: stringList(read('proxyIPs'), defaults.proxyIPs, 200, 255),
        prefixes: stringList(read('prefixes'), defaults.prefixes, 100, 128).filter(prefix => isIPv6(prefix)),
        upstreamProxy,
        upstreamParams: read<UpstreamProxy>('upstreamParams') ?? defaults.upstreamParams,
        outProxy,
        outProxyParams: read<any>('outProxyParams') ?? defaults.outProxyParams,
        cleanIPs: stringList(read('cleanIPs'), defaults.cleanIPs, 200, 255),
        customCdnAddrs: hasPartialCustomCdn ? defaults.customCdnAddrs : customCdnAddrs,
        customCdnHost: hasPartialCustomCdn ? defaults.customCdnHost : customCdnHost,
        customCdnSni: hasPartialCustomCdn ? defaults.customCdnSni : customCdnSni,
        bestVLTRInterval: num(read('bestVLTRInterval'), defaults.bestVLTRInterval, 10, 3600),
        VLConfigs: VLConfigs || !TRConfigs,
        TRConfigs: TRConfigs || !VLConfigs,
        ports,
        fingerprint,
        enableTFO: bool(read('enableTFO'), defaults.enableTFO),
        fragmentMode,
        fragmentLengthMin: num(read('fragmentLengthMin'), defaults.fragmentLengthMin, 1, 500),
        fragmentLengthMax: num(read('fragmentLengthMax'), defaults.fragmentLengthMax, 1, 500),
        fragmentIntervalMin: num(read('fragmentIntervalMin'), defaults.fragmentIntervalMin, 1, 60),
        fragmentIntervalMax: num(read('fragmentIntervalMax'), defaults.fragmentIntervalMax, 1, 60),
        fragmentMaxSplitMin: (() => {
            const value = read<unknown>('fragmentMaxSplitMin');
            return value === undefined || value === null || value === '' ? undefined : num(value, 2, 2, 100);
        })(),
        fragmentMaxSplitMax: (() => {
            const value = read<unknown>('fragmentMaxSplitMax');
            return value === undefined || value === null || value === '' ? undefined : num(value, 2, 2, 100);
        })(),
        fragmentPackets,
        enableECH: bool(read('enableECH'), defaults.enableECH),
        echServerName: safeEchServerName,
        bypassIran: bool(read('bypassIran'), defaults.bypassIran),
        bypassChina: bool(read('bypassChina'), defaults.bypassChina),
        bypassRussia: bool(read('bypassRussia'), defaults.bypassRussia),
        bypassOpenAi: bool(read('bypassOpenAi'), defaults.bypassOpenAi),
        bypassGoogleAi: bool(read('bypassGoogleAi'), defaults.bypassGoogleAi),
        bypassMicrosoft: bool(read('bypassMicrosoft'), defaults.bypassMicrosoft),
        bypassOracle: bool(read('bypassOracle'), defaults.bypassOracle),
        bypassDocker: bool(read('bypassDocker'), defaults.bypassDocker),
        bypassAdobe: bool(read('bypassAdobe'), defaults.bypassAdobe),
        bypassEpicGames: bool(read('bypassEpicGames'), defaults.bypassEpicGames),
        bypassIntel: bool(read('bypassIntel'), defaults.bypassIntel),
        bypassAmd: bool(read('bypassAmd'), defaults.bypassAmd),
        bypassNvidia: bool(read('bypassNvidia'), defaults.bypassNvidia),
        bypassAsus: bool(read('bypassAsus'), defaults.bypassAsus),
        bypassHp: bool(read('bypassHp'), defaults.bypassHp),
        bypassLenovo: bool(read('bypassLenovo'), defaults.bypassLenovo),
        blockAds: bool(read('blockAds'), defaults.blockAds),
        blockPorn: bool(read('blockPorn'), defaults.blockPorn),
        blockUDP443: bool(read('blockUDP443'), defaults.blockUDP443),
        blockMalware: bool(read('blockMalware'), defaults.blockMalware),
        blockPhishing: bool(read('blockPhishing'), defaults.blockPhishing),
        blockCryptominers: bool(read('blockCryptominers'), defaults.blockCryptominers),
        customBypassRules: stringList(read('customBypassRules'), defaults.customBypassRules, 1000, 255),
        customBlockRules: stringList(read('customBlockRules'), defaults.customBlockRules, 1000, 255),
        customBypassSanctionRules: stringList(read('customBypassSanctionRules'), defaults.customBypassSanctionRules, 1000, 255),
        warpRemoteDNS: safeWarpDNS,
        warpEndpoints: warpEndpoints.length ? warpEndpoints : defaults.warpEndpoints,
        bestWarpInterval: num(read('bestWarpInterval'), defaults.bestWarpInterval, 10, 3600),
        xrayUdpNoises: normalizeNoises(read('xrayUdpNoises'), defaults.xrayUdpNoises),
        knockerNoiseMode: /^(none|quic|random|[0-9A-Fa-f]+)$/.test(knockerNoiseMode) ? knockerNoiseMode : defaults.knockerNoiseMode,
        noiseCountMin: num(read('noiseCountMin'), defaults.noiseCountMin, 1, 100),
        noiseCountMax: num(read('noiseCountMax'), defaults.noiseCountMax, 1, 100),
        noiseSizeMin: num(read('noiseSizeMin'), defaults.noiseSizeMin, 1, 1500),
        noiseSizeMax: num(read('noiseSizeMax'), defaults.noiseSizeMax, 1, 1500),
        noiseDelayMin: num(read('noiseDelayMin'), defaults.noiseDelayMin, 0, 1000),
        noiseDelayMax: num(read('noiseDelayMax'), defaults.noiseDelayMax, 0, 1000),
        amneziaNoiseCount: num(read('amneziaNoiseCount'), defaults.amneziaNoiseCount, 1, 100),
        amneziaNoiseSizeMin: num(read('amneziaNoiseSizeMin'), defaults.amneziaNoiseSizeMin, 1, 1500),
        amneziaNoiseSizeMax: num(read('amneziaNoiseSizeMax'), defaults.amneziaNoiseSizeMax, 1, 1500),
        customSubs: normalizeSubs(read('customSubs'), defaults.customSubs),
        customConfigs: normalizeCustomConfigs(read('customConfigs'), defaults.customConfigs),
        panelVersion: text(read('panelVersion'), defaults.panelVersion, 64)
    };
}
