/* Technamooz Panel — API keys management controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        tableBody: document.getElementById('keysTableBody'),
        addKeyModal: document.getElementById('addKeyModal'),
        addKeyForm: document.getElementById('addKeyForm'),
        addKeyError: document.getElementById('addKeyError'),
        openAddKey: document.getElementById('openAddKey'),
        revealKeyModal: document.getElementById('revealKeyModal'),
        revealKeyValue: document.getElementById('revealKeyValue'),
        copyKeyValue: document.getElementById('copyKeyValue')
    };

    const state = {
        keys: [],
        loading: false
    };

    function setBusy(busy) {
        state.loading = busy;
        if (elements.openAddKey) elements.openAddKey.disabled = busy;
    }

    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json();
        if (!payload.success) throw new Error(payload.message || `HTTP ${response.status}`);
        return payload.body;
    }

    async function loadKeys() {
        setBusy(true);
        try {
            const keys = await api('/panel/api-keys');
            state.keys = keys;
            render();
        } catch (error) {
            UI.toast(error.message || 'Unable to load API keys.', 'error', { title: 'API Keys' });
            renderEmpty(error.message);
        } finally {
            setBusy(false);
        }
    }

    function renderEmpty(message) {
        if (!elements.tableBody) return;
        elements.tableBody.innerHTML = `
            <tr class="state-row is-error">
                <td colspan="7">
                    <span class="state-mark"><svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg></span>
                    <span><strong>خطا در بارگذاری</strong><small>${UI.escapeHtml(message || 'خطای نامشخص')}</small></span>
                </td>
            </tr>`;
    }

    function scopeLabel(s) {
        const map = { read: 'خواندن', write: 'نوشتن', admin: 'مدیریت' };
        return map[s] || s;
    }

    function render() {
        if (!elements.tableBody) return;

        if (!state.keys.length) {
            elements.tableBody.innerHTML = `
                <tr class="state-row">
                    <td colspan="7">
                        <span class="state-mark"><svg class="icon" aria-hidden="true"><use href="#i-key"></use></svg></span>
                        <span><strong>هیچ کلیدی یافت نشد</strong><small>یک کلید جدید ایجاد کنید.</small></span>
                    </td>
                </tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        state.keys.forEach((key, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="index-cell">${String(index + 1).padStart(2, '0')}</td>
                <td>
                    <div class="key-cell">
                        <span class="key-name">${UI.escapeHtml(key.name)}</span>
                        <span class="key-prefix mono">${UI.escapeHtml(key.prefix)}...</span>
                    </div>
                </td>
                <td>
                    <span class="key-value">${UI.escapeHtml(key.key.slice(0, 12))}…${UI.escapeHtml(key.key.slice(-8))}</span>
                </td>
                <td class="mono small">${(key.scopes || []).map(scopeLabel).join('، ')}</td>
                <td>
                    <span class="badge ${key.isActive ? 'badge-success' : 'badge-danger'}">${key.isActive ? 'فعال' : 'غیرفعال'}</span>
                </td>
                <td class="mono small">${new Date(key.createdAt).toLocaleString('fa-IR')}</td>
                <td class="col-action">
                    <button class="icon-btn row-action reveal" type="button" data-id="${key.id}" title="نمایش مقدار">${UI.icon('eye')}</button>
                    <button class="icon-btn row-action danger" type="button" data-action="revoke" data-id="${key.id}" title="لغو">${UI.icon('trash')}</button>
                </td>
            `;
            fragment.appendChild(tr);
        });
        elements.tableBody.replaceChildren(fragment);
    }

    function initTableActions() {
        elements.tableBody?.addEventListener('click', async event => {
            const btn = event.target.closest('.row-action');
            if (!btn) return;

            if (btn.classList.contains('reveal')) {
                const id = btn.dataset.id;
                const key = state.keys.find(k => k.id === id);
                if (!key) return;
                if (elements.revealKeyValue) elements.revealKeyValue.value = key.key;
                UI.openModal(elements.revealKeyModal);
                return;
            }

            if (btn.dataset.action === 'revoke') {
                const id = btn.dataset.id;
                const key = state.keys.find(k => k.id === id);
                if (!key) return;
                const confirmed = await UI.confirmDialog({
                    title: 'لغو کلید API؟',
                    message: `کلید "${UI.escapeHtml(key.name)}" دائمی غیرفعال می‌شود.`,
                    confirmLabel: 'لغو',
                    danger: true
                });
                if (!confirmed) return;
                try {
                    await api(`/panel/api-keys/${id}`, { method: 'DELETE' });
                    state.keys = state.keys.filter(k => k.id !== id);
                    render();
                    UI.toast('کلید API با موفقیت لغو شد.', 'success');
                } catch (error) {
                    UI.toast(error.message || 'Unable to revoke key.', 'error');
                }
            }
        });
    }

    elements.openAddKey?.addEventListener('click', () => {
        if (elements.addKeyForm) elements.addKeyForm.reset();
        if (elements.addKeyError) elements.addKeyError.textContent = '';
        UI.openModal(elements.addKeyModal);
    });

    elements.addKeyForm?.addEventListener('submit', async event => {
        event.preventDefault();
        if (elements.addKeyError) elements.addKeyError.textContent = '';

        const formData = new FormData(elements.addKeyForm);
        const scopes = formData.getAll('scopes') || [];
        const body = {
            name: formData.get('name'),
            scopes,
            isActive: formData.get('isActive') === 'on',
            expiresAt: formData.get('expiresAt') || undefined
        };

        try {
            setBusy(true);
            const key = await api('/panel/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            state.keys.unshift(key);
            render();

            if (elements.revealKeyValue) elements.revealKeyValue.value = key.key;
            UI.openModal(elements.revealKeyModal);
            UI.toast('کلید API با موفقیت ایجاد شد.', 'success');
        } catch (error) {
            if (elements.addKeyError) elements.addKeyError.textContent = error.message || 'Unable to create key.';
            elements.addKeyError?.classList.toggle('is-visible', true);
        } finally {
            setBusy(false);
        }
    });

    elements.copyKeyValue?.addEventListener('click', async () => {
        if (!elements.revealKeyValue) return;
        try {
            await UI.copy(elements.revealKeyValue.value);
            UI.toast('مقدار کلید کپی شد.', 'success');
        } catch (error) {
            UI.toast(error.message || 'Clipboard unavailable.', 'error');
        }
    });

    UI.ready(() => {
        initTableActions();
        loadKeys();
    });
}());