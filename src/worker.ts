import { init, initHttp, initWs } from '@init';
import {
    fallback,
    serveIcon,
    renderSecrets,
    renderSupport,
    renderAnalytics,
    renderUsers,
    renderApiKeys,
    renderHealth,
    renderBackup,
    handlePanel,
    handleSubscriptions,
    handleLogin,
    logout,
    renderError,
    handleWebsocket,
    handleDoH,
    handleProxyIPs,
    handleAdminAPI
} from '@handlers';

export default {
	async fetch(request: Request, env: Env) {
		try {
			const upgradeHeader = request.headers.get('Upgrade');
			init(request, env);

			if (upgradeHeader === 'websocket') {
				initWs(env);
				return await handleWebsocket(request);
			} else {
				initHttp(request, env);
				const { pathName } = globalThis.globalConfig;
				const path = pathName.split('/')[1];

				switch (path) {
					case 'panel':
						return await handlePanel(request, env);

					case 'sub':
						return await handleSubscriptions(request, env);

					case 'login':
						return await handleLogin(request, env);

					case 'logout':
						return logout(request);

					case 'admin':
						return await handleAdminAPI(request, env);

					case 'analytics':
						return await renderAnalytics();

					case 'users':
						return await renderUsers();

					case 'apikeys':
						return await renderApiKeys();

					case 'health':
						return await renderHealth();

					case 'backup':
						return await renderBackup();

					case 'secrets':
						return await renderSecrets();

					case 'support':
						return await renderSupport();

					case 'favicon.ico':
						return await serveIcon();

					case 'dns-query':
						return await handleDoH(request);

					case 'proxy-ip':
						return await handleProxyIPs(request, env);

					default:
						return await fallback(request);
				}
			}
		} catch (error) {
			return await renderError(error);
		}
	}
}
