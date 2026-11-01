/* Technamooz Panel — Proxy IP directory controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        body: document.getElementById('geoTableBody'),
        refreshButton: document.getElementById('refreshBtn'),
        status: document.getElementById('result-status'),
        statusText: document.getElementById('resultStatusText'),
        count: document.getElementById('resultCount'),
        updated: document.getElementById('resultUpdated'),
        visibleCount: document.getElementById('visibleCount'),
        search: document.getElementById('searchInput')
    };

    const state = {
        rows: [],
        loading: false,
        loadedAt: null,
        searchTerm: ''
    };

    const timeFormat = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });

    function normaliseRow(item) {
        const value = key => {
            const raw = item?.[key];
            return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
        };

        return {
            ip: value('ip'),
            country: value('country'),
            countryCode: value('countryCode').toUpperCase(),
            city: value('city'),
            isp: value('isp')
        };
    }

    function isIPv6(address) {
        return address.includes(':');
    }

    function recordLabel(count) {
        return `${count} ${count === 1 ? 'record' : 'records'}`;
    }

    function setStatus(label, stateName) {
        elements.status.className = `status-line is-${stateName}`;
        elements.statusText.textContent = label;
    }

    function setBusy(busy) {
        const button = elements.refreshButton;
        if (!button) return;

        if (busy) {
            button.dataset.idleHtml = button.dataset.idleHtml || button.innerHTML;
            button.disabled = true;
            button.innerHTML = `${UI.icon('refresh', 'spin')}<span>Resolving addresses…</span>`;
        } else {
            if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
            button.disabled = false;
        }
    }

    function renderState(options) {
        const row = document.createElement('tr');
        row.className = `state-row${options.type === 'error' ? ' is-error' : ''}`;

        const cell = document.createElement('td');
        cell.colSpan = 6;

        const mark = document.createElement('span');
        mark.className = 'state-mark';
        mark.innerHTML = UI.icon(options.icon || 'info', options.spin ? 'spin' : '');

        const copy = document.createElement('span');
        const title = document.createElement('strong');
        const detail = document.createElement('small');
        title.textContent = options.title;
        detail.textContent = options.detail || '';

        copy.append(title, detail);
        cell.append(mark, copy);
        row.append(cell);
        elements.body.replaceChildren(row);
    }

    function updateCounts(visible) {
        const total = state.rows.length;
        elements.count.textContent = total ? String(total) : '0';

        if (!total) {
            elements.visibleCount.textContent = '— records';
        } else if (state.searchTerm) {
            elements.visibleCount.textContent = `${visible} of ${total}`;
        } else {
            elements.visibleCount.textContent = recordLabel(total);
        }
    }

    function renderRows(rows) {
        if (!rows.length) {
            if (state.searchTerm) {
                renderState({
                    title: 'No matching addresses',
                    detail: 'Try another IP, country, city or provider.',
                    icon: 'search'
                });
            } else {
                renderState({
                    title: 'No Proxy IP records yet',
                    detail: 'Add a source in Configuration or generate the directory again.',
                    icon: 'database'
                });
            }
            updateCounts(0);
            return;
        }

        const fragment = document.createDocumentFragment();

        rows.forEach(row => {
            const tableRow = document.createElement('tr');

            const indexCell = document.createElement('td');
            indexCell.className = 'index-cell';
            indexCell.textContent = String(row.originalIndex + 1).padStart(2, '0');

            const ipCell = document.createElement('td');
            const ipWrap = document.createElement('span');
            ipWrap.className = 'ip-cell';
            const code = document.createElement('code');
            code.textContent = row.ip;
            ipWrap.append(code);
            if (isIPv6(row.ip)) {
                const version = document.createElement('span');
                version.className = 'ip-version';
                version.textContent = 'IPv6';
                ipWrap.append(version);
            }
            ipCell.append(ipWrap);

            const countryCell = document.createElement('td');
            const countryWrap = document.createElement('span');
            countryWrap.className = 'country-cell';
            const countryName = document.createElement('span');
            countryName.textContent = row.country || '—';
            countryWrap.append(countryName);
            if (row.countryCode) {
                const countryCode = document.createElement('span');
                countryCode.className = 'country-code';
                countryCode.textContent = row.countryCode.slice(0, 3);
                countryWrap.append(countryCode);
            }
            countryCell.append(countryWrap);

            const cityCell = document.createElement('td');
            cityCell.className = 'city-cell';
            cityCell.textContent = row.city || '—';

            const ispCell = document.createElement('td');
            ispCell.className = 'isp-cell';
            ispCell.textContent = row.isp || '—';
            ispCell.title = row.isp || '';

            const actionCell = document.createElement('td');
            const copyButton = document.createElement('button');
            copyButton.className = 'row-copy';
            copyButton.type = 'button';
            copyButton.dataset.copy = row.ip;
            copyButton.title = `Copy ${row.ip}`;
            copyButton.setAttribute('aria-label', `Copy ${row.ip}`);
            copyButton.innerHTML = UI.icon('copy');
            actionCell.append(copyButton);

            tableRow.append(indexCell, ipCell, countryCell, cityCell, ispCell, actionCell);
            fragment.append(tableRow);
        });

        elements.body.replaceChildren(fragment);
        updateCounts(rows.length);
    }

    function applyFilter() {
        const term = state.searchTerm;

        if (!term) {
            renderRows(state.rows);
            return;
        }

        const filtered = state.rows.filter(row => {
            const haystack = [row.ip, row.country, row.countryCode, row.city, row.isp].join(' ').toLowerCase();
            return haystack.includes(term);
        });

        renderRows(filtered);
    }

    function markUpdated() {
        state.loadedAt = new Date();
        elements.updated.textContent = timeFormat.format(state.loadedAt);
        elements.updated.title = state.loadedAt.toLocaleString();
    }

    function isLoginRedirect(response) {
        if (response.redirected) return true;
        try {
            return new URL(response.url, window.location.origin).pathname === '/login';
        } catch {
            return false;
        }
    }

    async function loadDirectory(generate) {
        if (state.loading) return;

        state.loading = true;
        setBusy(true);
        setStatus(generate ? 'Generating directory' : 'Resolving sources', 'loading');

        if (!state.rows.length) {
            renderState({
                title: generate ? 'Generating Proxy IPs' : 'Loading Proxy IP directory',
                detail: 'Resolving configured sources at the edge…',
                icon: 'refresh',
                spin: true
            });
        }

        try {
            const response = await fetch(generate ? '/proxy-ip/generate' : '/proxy-ip/get', {
                method: generate ? 'POST' : 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });

            if (isLoginRedirect(response)) {
                window.location.assign('/login');
                return;
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error(`Unexpected response from the Proxy IP service (HTTP ${response.status}).`);
            }

            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || `Proxy IP lookup failed with HTTP ${response.status}.`);
            }

            const rows = Array.isArray(payload.body) ? payload.body : [];
            state.rows = rows
                .map(normaliseRow)
                .filter((row, index) => {
                    row.originalIndex = index;
                    return Boolean(row.ip);
                });

            markUpdated();

            if (!state.rows.length) {
                setStatus('No records', 'limited');
                applyFilter();
                if (generate) {
                    UI.toast(payload.message || 'No Proxy IP addresses were resolved from the configured sources.', 'warning', {
                        title: 'Directory is empty'
                    });
                }
                return;
            }

            applyFilter();
            setStatus(payload.message ? 'Geo data limited' : 'Directory ready', payload.message ? 'limited' : 'success');

            if (generate) {
                UI.toast(`${recordLabel(state.rows.length)} refreshed from the edge.`, 'success', {
                    title: 'Proxy IP directory updated',
                    duration: 3600
                });
            }
        } catch (error) {
            state.rows = [];
            state.loadedAt = null;
            elements.updated.textContent = '—';
            setStatus('Resolver error', 'error');
            renderState({
                title: 'Directory unavailable',
                detail: error.message || 'The Proxy IP service did not respond. Try again in a moment.',
                icon: 'alert',
                type: 'error'
            });
            updateCounts(0);
            UI.toast(error.message || 'Unable to reach the Proxy IP service.', 'error', {
                title: 'Proxy IP lookup failed'
            });
        } finally {
            state.loading = false;
            setBusy(false);
        }
    }

    elements.body?.addEventListener('click', async event => {
        const button = event.target.closest('[data-copy]');
        if (!button) return;

        const address = button.dataset.copy;
        const idleHtml = button.innerHTML;

        try {
            await UI.copy(address);
            button.classList.add('is-copied');
            button.innerHTML = UI.icon('check');
            UI.toast(`${address} is on your clipboard.`, 'success', {
                title: 'Address copied',
                duration: 2600
            });
            window.setTimeout(() => {
                button.classList.remove('is-copied');
                button.innerHTML = idleHtml;
            }, 1600);
        } catch (error) {
            UI.toast(error.message || 'Clipboard access is unavailable.', 'error', {
                title: 'Copy failed'
            });
        }
    });

    elements.refreshButton?.addEventListener('click', () => loadDirectory(true));

    elements.search?.addEventListener('input', event => {
        state.searchTerm = event.target.value.trim().toLowerCase();
        applyFilter();
    });

    UI.ready(() => loadDirectory(false));
}());
