interface WarpKeys {
    publicKey: string;
    privateKey: string;
}

interface WarpRegistration {
    config?: {
        client_id?: string;
        interface?: {
            addresses?: {
                v6?: string;
            };
        };
        peers?: Array<{
            public_key?: string;
        }>;
    };
}

const defaultWarpAccounts: WarpAccount[] = [
    {
        privateKey: "sBmQVHEywGAKQ8Ratzo/f5OUCa7MSozZpz1JK2PSVXE=",
        publicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
        warpIPv6: "2606:4700:110:8dd8:de5f:9a89:bfac:749c/128",
        reserved: "59nK"
    },
    {
        privateKey: "OPiD4dePq8652DICknJsTJS4UH0FoWY1ffOZzZhIsUs=",
        publicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
        warpIPv6: "2606:4700:110:8912:1225:70c8:1ad7:6ce0/128",
        reserved: "G/nh"
    }
];

function isWarpAccount(value: unknown): value is WarpAccount {
    if (typeof value !== 'object' || value === null) return false;
    const account = value as Record<string, unknown>;

    return ['privateKey', 'publicKey', 'warpIPv6', 'reserved']
        .every(key => typeof account[key] === 'string' && (account[key] as string).length > 0);
}

export async function fetchWarpAccounts(env: Env): Promise<WarpAccount[]> {
    try {
        const warpAccounts: WarpAccount[] = [];

        for (let index = 0; index < 2; index++) {
            const key = await generateKeyPair();
            warpAccounts.push(await fetchAccount(key));

            if (index === 0) await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (warpAccounts.length < 2) {
            throw new Error('WARP registration returned an incomplete account set.');
        }

        try {
            await env.kv.put('warpAccounts', JSON.stringify(warpAccounts));
        } catch (error) {
            console.warn(
                'Unable to cache WARP accounts:',
                error instanceof Error ? error.message : String(error)
            );
        }

        return warpAccounts;
    } catch (error) {
        console.error(
            'Failed to fetch new WARP accounts:',
            error instanceof Error ? error.message : String(error)
        );

        const cachedAccounts = await readCachedWarpAccounts(env);

        return cachedAccounts ?? structuredClone(defaultWarpAccounts);
    }
}

async function readCachedWarpAccounts(env: Env): Promise<WarpAccount[] | null> {
    try {
        const cached = await env.kv.get<WarpAccount[]>('warpAccounts', { type: 'json' });

        if (!Array.isArray(cached)) return null;

        const validAccounts = cached.filter(isWarpAccount).slice(0, 2);

        return validAccounts.length >= 2 ? validAccounts : null;
    } catch {
        return null;
    }
}

async function fetchAccount(key: WarpKeys): Promise<WarpAccount> {
    const response = await fetch('https://api.cloudflareclient.com/v0a4005/reg', {
        method: 'POST',
        headers: {
            'User-Agent': 'insomnia/8.6.1',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            install_id: "",
            fcm_token: "",
            tos: new Date().toISOString(),
            type: "Android",
            model: 'PC',
            locale: 'en_US',
            warp_enabled: true,
            key: key.publicKey
        }),
        signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
        throw new Error(`API returned status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as WarpRegistration;
    const warpIPv6 = data?.config?.interface?.addresses?.v6;
    const reserved = data?.config?.client_id;
    const publicKey = data?.config?.peers?.[0]?.public_key;

    if (!warpIPv6 || !reserved || !publicKey) {
        throw new Error('WARP registration returned an unexpected response shape.');
    }

    return {
        privateKey: key.privateKey,
        publicKey,
        warpIPv6: warpIPv6.includes('/') ? warpIPv6 : `${warpIPv6}/128`,
        reserved
    };
}

async function generateKeyPair(): Promise<WarpKeys> {
    const keyPair = await crypto.subtle.generateKey(
        { name: "X25519", namedCurve: "X25519" },
        true,
        ["deriveBits"]
    );

    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const privateKeyRaw = new Uint8Array(pkcs8).slice(-32);

    const publicKeyRaw = new Uint8Array(
        await crypto.subtle.exportKey("raw", keyPair.publicKey)
    );

    const base64Encode = (arr: Uint8Array) => btoa(String.fromCharCode(...arr));

    return {
        publicKey: base64Encode(publicKeyRaw),
        privateKey: base64Encode(privateKeyRaw)
    };
}
