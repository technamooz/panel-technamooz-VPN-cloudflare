/* Technamooz Panel — health controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        healthOverallBadge: document.getElementById('healthOverallBadge'),
        healthKV: document.getElementById('healthKV'),
        healthDNS: document.getElementById('healthDNS'),
        healthSystem: document.getElementById('healthSystem'),
        healthKVStatus: document.getElementById('healthKVStatus'),
        healthDNSStatus: document.getElementById('healthDNSStatus'),
        healthSystemStatus: document.getElementById('healthSystemStatus'),
        healthKVMeta: document.getElementById('healthKVMeta'),
        healthDNSMeta: document.getElementById('healthDNSMeta'),
        healthSystemMeta: document.getElementById('healthSystemMeta'),
        healthChecks: document.getElementById('healthChecks'),
        refreshBtn1: document.getElementById('refreshHealth'),
        refreshBtn2: document.getElementById('refreshHealth2')
    };

    const state = { loading: false };

    function setBusy(busy) {
        state.loading = busy;
        [elements.refreshBtn1, elements.refreshBtn2].forEach(btn => {
            if (!btn) return;
            if (busy) {
                btn.dataset.idleHtml = btn.dataset.idleHtml || btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `${UI.icon('refresh', 'spin')} بررسی…`;
            } else {
                if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
                btn.disabled = false;
            }
        });
    }

    function statusElement(container, ok, latency) {
        container.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = `status-dot ${ok ? '' : 'warning'}`;
        dot.style.background = ok ? 'var(--success)' : 'var(--warning)';
        container.appendChild(dot);
        const label = document.createElement('span');
        label.textContent = ok ? (latency !== undefined ? `${latency}ms` : 'سالم') : 'خطا';
        container.appendChild(label);
    }

    async function api(url) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });
        const payload = await response.json();
        if (!payload.success) throw new Error(payload.message || `HTTP ${response.status}`);
        return payload.body;
    }

    async function loadHealth() {
        setBusy(true);
        try {
            const health = await api('/panel/health');

            if (elements.healthOverallBadge) {
                const ok = health.status === 'healthy';
                const dot = elements.healthOverallBadge.querySelector('.status-dot');
                if (dot) {
                    dot.className = `status-dot ${ok ? '' : 'warning'}`;
                    dot.style.background = ok ? 'var(--success)' : 'var(--warning)';
                }
                const label = elements.healthOverallBadge.querySelector('span:last-child');
                if (label) label.textContent = ok ? 'سیستم سالم' : health.status === 'degraded' ? 'ضعیف' : 'نا سالم';
            }

            const checks = health.checks || {};
            renderCheck('healthKV', checks.kv, elements.healthKV, elements.healthKVStatus, elements.healthKVMeta);
            renderCheck('healthDNS', checks.dns, elements.healthDNS, elements.healthDNSStatus, elements.healthDNSMeta);

            if (elements.healthSystem) {
                const sysOk = health.status === 'healthy';
                elements.healthSystem.textContent = sysOk ? 'سالم' : health.status;
                statusElement(elements.healthSystemStatus, sysOk);
                elements.healthSystemMeta.textContent = `آخرین بررسی: ${new Date(health.timestamp).toLocaleString('fa-IR')}`;
            }

            renderDetails(checks);
        } catch (error) {
            UI.toast(error.message || 'Unable to load health.', 'error', { title: 'Health' });
            if (elements.healthOverallBadge) {
                elements.healthOverallBadge.innerHTML = '<span class="status-dot warning"></span> خطا در بررسى';
            }
        } finally {
            setBusy(false);
        }
    }

    function renderCheck(id, check, valueEl, statusEl, metaEl) {
        const ok = check && check.ok;
        if (valueEl) valueEl.textContent = ok ? (check.latency !== undefined ? `${check.latency}ms` : 'سالم') : 'خطا';
        if (statusEl) statusEl.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = `status-dot ${ok ? '' : 'warning'}`;
        dot.style.background = ok ? 'var(--success)' : 'var(--danger)';
        if (statusEl) statusEl.appendChild(dot);
        const label = document.createElement('span');
        label.textContent = ok ? 'سالم' : 'خطا';
        if (statusEl) statusEl.appendChild(label);
        if (metaEl) {
            metaEl.textContent = check && check.error ? check.error : (ok ? 'بخش respond داد' : 'pas respond نداد');
        }
    }

    function renderDetails(checks) {
        if (!elements.healthChecks) return;
        const items = Object.entries(checks || {});
        if (!items.length) {
            elements.healthChecks.innerHTML = '<p class="muted">جزئیاتی ثبت نشده است.</p>';
            return;
        }
        elements.healthChecks.innerHTML = items.map(([name, check]) => `
            <div class="health-detail-item">
                <div>
                    <strong>${UI.escapeHtml(name)}</strong>
                    <small>${check && check.ok ? 'answered' : 'failed'} ${check && check.latency !== undefined ? `(${check.latency}ms)` : ''}</small>
                </div>
                <span class="badge ${check && check.ok ? 'badge-success' : 'badge-danger'}">${check && check.ok ? 'OK' : 'ERROR'}</span>
                ${check && check.error ? `<div class="health-error">${UI.escapeHtml(check.error)}</div>` : ''}
            </div>`).join('');
    }

    [elements.refreshBtn1, elements.refreshBtn2].forEach(btn => {
        if (btn) btn.addEventListener('click', () => { setBusy(true); loadHealth().finally(() => setBusy(false)); });
    });

    UI.ready(() => loadHealth());
}());