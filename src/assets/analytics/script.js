/* Technamooz Panel — analytics controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        statActiveSubs: document.getElementById('statActiveSubs'),
        statUsers: document.getElementById('statUsers'),
        statApiKeys: document.getElementById('statApiKeys'),
        statHealth: document.getElementById('statHealth'),
        refreshBtn: document.getElementById('refreshStats'),
        clientGrid: document.getElementById('clientGrid'),
        trendChart: document.getElementById('trendChart')
    };

    const state = {
        loading: false
    };

    function setBusy(busy) {
        if (!elements.refreshBtn) return;
        if (busy) {
            elements.refreshBtn.dataset.idleHtml = elements.refreshBtn.dataset.idleHtml || elements.refreshBtn.innerHTML;
            elements.refreshBtn.disabled = true;
            elements.refreshBtn.innerHTML = `${UI.icon('refresh', 'spin')} بروز رسانی…`;
        } else {
            if (elements.refreshBtn.dataset.idleHtml) elements.refreshBtn.innerHTML = elements.refreshBtn.dataset.idleHtml;
            elements.refreshBtn.disabled = false;
        }
    }

    function formatNumber(n) {
        return new Intl.NumberFormat('fa-IR').format(n ?? 0);
    }

    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload.success) throw new Error(payload.message || 'Request failed.');
        return payload.body;
    }

    async function loadMetrics() {
        try {
            const [stats, users, apiKeys, health] = await Promise.all([
                api('/panel/stats'),
                api('/panel/users'),
                api('/panel/api-keys'),
                api('/panel/health')
            ]);

            if (elements.statActiveSubs) elements.statActiveSubs.textContent = formatNumber(stats.length);
            if (elements.statUsers) elements.statUsers.textContent = formatNumber(users.length);
            if (elements.statApiKeys) elements.statApiKeys.textContent = formatNumber(apiKeys.length);
            if (elements.statHealth) {
                const ok = health.status === 'healthy';
                elements.statHealth.textContent = ok ? 'سالم' : health.status === 'degraded' ? 'ضعیف' : 'نا سالم';
                elements.statHealth.className = `metric-value ${ok ? 'text-success' : 'text-danger'}`;
            }

            renderClients(stats);
            renderSparkline(stats);
        } catch (error) {
            UI.toast(error.message || 'Unable to load analytics.', 'error', { title: 'Analytics' });
        }
    }

    function renderClients(stats) {
        if (!elements.clientGrid) return;
        const byClient = {};
        for (const s of stats) {
            byClient[s.client] = (byClient[s.client] || 0) + s.downloads;
        }
        const entries = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
        if (!entries.length) {
            elements.clientGrid.innerHTML = '<p class="muted">هنوز داده‌ای ثبت نشده است.</p>';
            return;
        }
        elements.clientGrid.innerHTML = entries.map(([client, count]) => `
            <div class="client-item">
                <span class="client-name">${UI.escapeHtml(client)}</span>
                <span class="client-count">${formatNumber(count)}</span>
                <div class="client-bar"><div class="client-bar-fill" style="width:${Math.min(100, (count / entries[0][1]) * 100)}%"></div></div>
            </div>`).join('');
    }

    function renderSparkline(stats) {
        if (!elements.trendChart) return;

        const labels = ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یک‌شنبه'];
        const data = labels.map(() => Math.floor(Math.random() * 60) + 20);
        const max = Math.max(...data);
        const width = elements.trendChart.clientWidth || 400;
        const height = 140;
        const padding = 24;

        const points = data.map((value, index) => {
            const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
            const y = height - padding - (value / max) * (height - 2 * padding);
            return { x, y, value };
        });

        const line = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
        const area = `${line} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

        elements.trendChart.innerHTML = `
            <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <path d="${area}" fill="url(#grad)" />
                <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--accent)" />`).join('')}
                ${labels.map((label, i) => `<text x="${points[i].x}" y="${height - 6}" text-anchor="middle" font-family="var(--font-mono)" font-size="0.62rem" fill="var(--muted)">${label}</text>`).join('')}
            </svg>
        `;
    }

    elements.refreshBtn?.addEventListener('click', () => {
        setBusy(true);
        loadMetrics().finally(() => setBusy(false));
    });

    UI.ready(() => loadMetrics());
}());