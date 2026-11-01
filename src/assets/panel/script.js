/* Technamooz Panel — workspace controller.
 * Talks to the existing Worker API and keeps the server as the source of truth.
 */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) throw new Error('Technamooz UI helpers failed to load.');

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

    const DEFAULT_TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
    const DEFAULT_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CLOUDFLARE_DNS = new Set([
        '1.1.1.1', '1.0.0.1', '1.1.1.2', '1.0.0.2', '1.1.1.3', '1.0.0.3',
        '2606:4700:4700::1111', '2606:4700:4700::1001',
        '2606:4700:4700::1112', '2606:4700:4700::1002',
        '2606:4700:4700::1113', '2606:4700:4700::1003',
        'cloudflare-dns.com', 'security.cloudflare-dns.com',
        'family.cloudflare-dns.com', 'one.one.one.one', '1dot1dot1dot1'
    ]);
    const FRAGMENT_PRESETS = {
        low: [100, 200, 1, 1],
        medium: [50, 100, 1, 5],
        high: [10, 20, 10, 20],
        severe: [1, 5, 1, 5]
    };
    const VIEW_LABELS = {
        overview: 'Dashboard',
        configuration: 'Configuration',
        routing: 'Routing rules',
        subscriptions: 'Subscriptions',
        network: 'Network tools',
        security: 'Security'
    };
    const NOISE_TYPES = ['rand', 'str', 'base64', 'hex', 'array'];

    const elements = {
        form: $('#configForm'),
        applyButton: $('#applyButton'),
        resetSettingsBtn: $('#resetSettingsBtn'),
        saveDot: $('#saveDot'),
        saveStateLabel: $('#saveStateLabel'),
        saveStateHint: $('#saveStateHint'),
        configDirtyDot: $('#configDirtyDot'),
        passwordModal: $('#passwordModal'),
        passwordTitle: $('#passwordModalTitle'),
        passwordDescription: $('#passwordModalDescription'),
        passwordForm: $('#passwordChangeForm'),
        passwordError: $('#passwordError'),
        passwordCancel: $('#passwordCancel'),
        passwordClose: $('#passwordModalClose'),
        newPassword: $('#newPassword'),
        confirmPassword: $('#confirmPassword'),
        setupBanner: $('#setupBanner'),
        sidebar: $('#sidebar'),
        sidebarBackdrop: $('#sidebarBackdrop'),
        profileMenu: $('#profileMenu'),
        profileToggle: $('#profileToggle'),
        subscriptionGrid: $('#subscriptionGrid'),
        qrModal: $('#qrModal'),
        qrContainer: $('#qrcode-container'),
        qrTitle: $('#qrcodeTitle'),
        qrUrl: $('#qrcodeUrl'),
        commandModal: $('#commandModal'),
        commandInput: $('#commandInput'),
        commandResults: $('#commandResults'),
        ipStatusBadge: $('#ipStatusBadge')
    };

    const state = {
        settings: null,
        subPath: '',
        isPassSet: false,
        initialSnapshot: '',
        currentView: 'overview',
        currentTab: 'common',
        lastFragmentMode: 'custom',
        customFragment: [100, 200, 1, 1],
        gating: false,
        ipLoaded: false,
        qrValue: ''
    };

    class ApiError extends Error {
        constructor(message, status) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
        }
    }

    function spinner(label) {
        return `${UI.icon('refresh', 'spin')} ${UI.escapeHtml(label)}`;
    }

    function setBusy(button, busy, label = 'Working…') {
        if (!button) return;
        if (busy) {
            button.dataset.idleHtml = button.dataset.idleHtml || button.innerHTML;
            button.disabled = true;
            button.innerHTML = spinner(label);
        } else {
            if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
            button.disabled = false;
        }
    }

    function sessionExpired() {
        UI.toast('Your session has expired. Sign in again to continue.', 'warning', {
            title: 'Session expired',
            duration: 4200
        });
        window.setTimeout(() => window.location.assign('/login'), 700);
    }

    async function parseResponse(response) {
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            throw new ApiError(`Unexpected response from the server (${response.status}).`, response.status);
        }

        if (!payload || payload.success !== true) {
            const status = Number(payload?.status || response.status);
            const error = new ApiError(payload?.message || 'The server rejected this request.', status);
            error.payload = payload;
            throw error;
        }

        return payload.body;
    }

    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });

        try {
            return await parseResponse(response);
        } catch (error) {
            if (error.status === 401) sessionExpired();
            throw error;
        }
    }

    function toastError(error, fallbackTitle = 'Request failed') {
        if (error?.status === 401) return;
        UI.toast(error?.message || String(error || 'Unknown error.'), 'error', { title: fallbackTitle });
    }

    function readValue(id) {
        return document.getElementById(id)?.value?.trim() ?? '';
    }

    function readNumber(id) {
        const raw = readValue(id);
        if (raw === '') return undefined;
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }

    function readLines(id) {
        return readValue(id).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    }

    /* Settings ------------------------------------------------------------- */

    const formFields = () => $$('[name]', elements.form).filter(element => !element.disabled);

    function selectedPorts() {
        return $$('.port-checkbox:checked', elements.form)
            .map(input => Number(input.dataset.port))
            .filter(port => Number.isInteger(port))
            .sort((left, right) => left - right);
    }

    function serializeNoises() {
        return $$('.noise-item', elements.form).map(item => ({
            type: $('.noise-mode', item)?.value || 'rand',
            packet: $('.noise-packet', item)?.value.trim() || '50-100',
            delay: `${$('.noise-delay-min', item)?.value || 1}-${$('.noise-delay-max', item)?.value || 1}`,
            count: Number($('.noise-count', item)?.value || 5)
        }));
    }

    function serializeForm() {
        const data = {};

        for (const element of formFields()) {
            const name = element.name;
            if (!name) continue;

            if (element.type === 'checkbox') {
                data[name] = element.checked;
            } else if (element.type === 'number') {
                const value = element.value.trim() === '' ? undefined : Number(element.value);
                if (value === undefined || Number.isFinite(value)) data[name] = value;
            } else if (element.tagName === 'TEXTAREA') {
                data[name] = element.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            } else {
                data[name] = element.value.trim();
            }
        }

        data.ports = selectedPorts();
        data.xrayUdpNoises = serializeNoises();
        if (state.settings?.panelVersion) data.panelVersion = state.settings.panelVersion;

        return data;
    }

    function buildSettingsPayload() {
        return {
            ...(state.settings || {}),
            ...serializeForm(),
            panelVersion: state.settings?.panelVersion || readValue('panelVersion') || undefined
        };
    }

    function applySettings(settings) {
        state.settings = { ...settings };

        for (const element of formFields()) {
            const name = element.name;
            if (!name || name === 'panelVersion') continue;
            const value = settings[name];

            if (element.type === 'checkbox') {
                element.checked = Boolean(value);
            } else if (element.tagName === 'TEXTAREA') {
                element.value = Array.isArray(value) ? value.join('\n') : (value ?? '');
            } else if (element.type === 'number') {
                element.value = value === undefined || value === null || Number.isNaN(value) ? '' : value;
            } else if (element.tagName === 'SELECT') {
                element.value = value ?? '';
            } else {
                element.value = value ?? '';
            }
        }

        renderPorts(Array.isArray(settings.ports) ? settings.ports.map(Number) : []);
        renderNoises(Array.isArray(settings.xrayUdpNoises) ? settings.xrayUdpNoises : []);

        const fragmentMode = settings.fragmentMode || 'custom';
        state.lastFragmentMode = fragmentMode;
        state.customFragment = [
            settings.fragmentLengthMin ?? 100,
            settings.fragmentLengthMax ?? 200,
            settings.fragmentIntervalMin ?? 1,
            settings.fragmentIntervalMax ?? 1
        ].map(Number);
        setFragmentReadonly(fragmentMode !== 'custom');

        state.initialSnapshot = JSON.stringify(serializeForm());
        markDirty(false);
        updateDashboard();
    }

    function renderPorts(selected) {
        const tlsContainer = $('#tls-ports');
        const httpContainer = $('#non-tls-ports');
        const nonTlsField = $('#none-tls-field');
        const isWorkersDev = /\.workers\.dev$/i.test(window.location.hostname);
        const selectedSet = new Set(selected);

        if (!selectedSet.size) selectedSet.add(443);

        const card = port => `
            <label class="check-card" for="port-${port}">
                <input class="port-checkbox" type="checkbox" id="port-${port}" data-port="${port}" ${selectedSet.has(port) ? 'checked' : ''}>
                <span class="check-mark">${UI.icon('check')}</span>
                ${port}
            </label>`;

        tlsContainer.innerHTML = DEFAULT_TLS_PORTS.map(card).join('');
        httpContainer.innerHTML = isWorkersDev ? '' : DEFAULT_HTTP_PORTS.map(card).join('');
        nonTlsField.hidden = isWorkersDev;
    }

    function setFragmentReadonly(readonly) {
        ['fragmentLengthMin', 'fragmentLengthMax', 'fragmentIntervalMin', 'fragmentIntervalMax'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            if (readonly) input.setAttribute('readonly', '');
            else input.removeAttribute('readonly');
        });
    }

    function applyFragmentPreset(mode) {
        const preset = FRAGMENT_PRESETS[mode];
        if (!preset) return;
        const ids = ['fragmentLengthMin', 'fragmentLengthMax', 'fragmentIntervalMin', 'fragmentIntervalMax'];
        ids.forEach((id, index) => {
            const input = document.getElementById(id);
            if (input) input.value = preset[index];
        });
        setFragmentReadonly(true);
    }

    function currentFragmentValues() {
        return ['fragmentLengthMin', 'fragmentLengthMax', 'fragmentIntervalMin', 'fragmentIntervalMax']
            .map(id => Number(readValue(id)));
    }

    function handleFragmentModeChange() {
        const mode = readValue('fragmentMode');
        if (state.lastFragmentMode === 'custom' && mode !== 'custom') {
            state.customFragment = currentFragmentValues();
        }

        if (mode === 'custom') {
            const values = state.customFragment;
            if (values.every(Number.isFinite)) {
                ['fragmentLengthMin', 'fragmentLengthMax', 'fragmentIntervalMin', 'fragmentIntervalMax']
                    .forEach((id, index) => {
                        const input = document.getElementById(id);
                        if (input) input.value = values[index];
                    });
            }
            setFragmentReadonly(false);
        } else {
            applyFragmentPreset(mode);
        }

        state.lastFragmentMode = mode;
    }

    function markDirty(forceState) {
        let dirty;
        try {
            dirty = typeof forceState === 'boolean'
                ? forceState
                : JSON.stringify(serializeForm()) !== state.initialSnapshot;
        } catch {
            dirty = true;
        }

        if (elements.applyButton) elements.applyButton.disabled = !dirty || state.gating;
        if (elements.configDirtyDot) elements.configDirtyDot.hidden = !dirty;
        if (elements.saveDot) elements.saveDot.classList.toggle('dirty', dirty);
        if (elements.saveStateLabel) elements.saveStateLabel.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
        if (elements.saveStateHint) {
            elements.saveStateHint.textContent = dirty
                ? 'Review the form and save to publish.'
                : 'Settings are in sync with the edge.';
        }
        return dirty;
    }

    async function saveSettings() {
        if (!state.isPassSet) {
            openPasswordModal(true);
            UI.toast('Set a panel password before saving settings.', 'warning');
            return;
        }

        if (!validateSettings()) return;

        const payload = buildSettingsPayload();
        setBusy(elements.applyButton, true, 'Saving…');
        try {
            const saved = await api('/panel/update-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            applySettings(saved || payload);
            renderSubscriptions();
            markDirty(false);
            UI.toast('Settings saved. Refresh your subscriptions in clients that cache profiles.', 'success', {
                title: 'Configuration published'
            });
        } catch (error) {
            markDirty();
            toastError(error, 'Unable to save settings');
        } finally {
            setBusy(elements.applyButton, false);
            markDirty();
        }
    }

    async function resetSettings() {
        if (!state.isPassSet) {
            openPasswordModal(true);
            return;
        }

        const confirmed = await UI.confirmDialog({
            title: 'Reset panel settings?',
            message: 'Every setting returns to the Worker defaults. Existing subscriptions will keep working until clients refresh, but protocol and routing values change immediately.',
            confirmLabel: 'Reset settings',
            danger: true
        });
        if (!confirmed) return;

        setBusy(elements.resetSettingsBtn, true, 'Resetting…');
        try {
            const settings = await api('/panel/reset-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetSettings: true })
            });
            applySettings(settings || {});
            renderSubscriptions();
            UI.toast('Settings were restored to their defaults.', 'success');
        } catch (error) {
            toastError(error, 'Unable to reset settings');
        } finally {
            setBusy(elements.resetSettingsBtn, false);
        }
    }

    /* Import / export ------------------------------------------------------ */

    function encodeBase64Utf8(value) {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }

    function decodeBase64Utf8(value) {
        const binary = atob(value.replace(/\s+/g, ''));
        return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    }

    function exportSettings() {
        if (!validateSettings(true)) return;
        const payload = buildSettingsPayload();
        const encoded = encodeBase64Utf8(JSON.stringify(payload, null, 2));
        UI.downloadBlob(encoded, 'Technamooz-settings.dat', 'application/octet-stream');
        UI.toast('Settings file downloaded.', 'success');
    }

    async function importSettingsFile(file) {
        if (!file) return;
        try {
            const text = (await file.text()).trim();
            let parsed;
            try {
                parsed = JSON.parse(decodeBase64Utf8(text));
            } catch {
                parsed = JSON.parse(text);
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('The selected file does not contain a settings object.');
            }

            const confirmed = await UI.confirmDialog({
                title: 'Import settings?',
                message: 'Current form values will be replaced by this file. Nothing is stored until you press Save changes.',
                confirmLabel: 'Import values',
                danger: false
            });
            if (!confirmed) return;

            applySettings({ ...(state.settings || {}), ...parsed });
            markDirty(true);
            showView('configuration');
            UI.toast('Settings imported. Review the fields, then save.', 'info');
        } catch (error) {
            UI.toast(error.message || 'Unable to read this settings file.', 'error', { title: 'Import failed' });
        }
    }

    /* Password ------------------------------------------------------------- */

    function setPasswordError(message = '') {
        if (!elements.passwordError) return;
        elements.passwordError.textContent = message;
        elements.passwordError.classList.toggle('is-visible', Boolean(message));
    }

    function openPasswordModal(gate = !state.isPassSet) {
        state.gating = gate;
        setPasswordError('');
        if (elements.passwordForm) elements.passwordForm.reset();
        if (elements.passwordTitle) {
            elements.passwordTitle.textContent = gate ? 'Protect this panel' : 'Change panel password';
        }
        if (elements.passwordDescription) {
            elements.passwordDescription.textContent = gate
                ? 'Create a strong password before using or sharing this deployment. Every panel session starts here.'
                : 'Your current sessions will be revoked. Sign in again with the new password.';
        }
        if (elements.passwordCancel) elements.passwordCancel.hidden = gate;
        if (elements.passwordClose) elements.passwordClose.hidden = gate;

        UI.openModal(elements.passwordModal);
        window.setTimeout(() => elements.newPassword?.focus(), 80);
    }

    function closePasswordModal() {
        if (state.gating) return;
        UI.closeModal(elements.passwordModal);
    }

    function initPasswordGuard() {
        // Shared helpers close modals on backdrop/Escape. During first-run setup
        // those interactions must not dismiss the only way to secure the panel.
        elements.passwordModal?.addEventListener('click', event => {
            if (state.gating && event.target === elements.passwordModal) {
                event.stopPropagation();
            }
        }, true);

        document.addEventListener('keydown', event => {
            if (state.gating && event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);

        $$('[data-password-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const input = document.getElementById(button.dataset.passwordToggle);
                if (!input) return;
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                button.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
                button.innerHTML = UI.icon(visible ? 'eye' : 'eye-off');
            });
        });

        $$('[data-open-password]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                closeProfileMenu();
                openPasswordModal(!state.isPassSet);
            });
        });

        elements.passwordForm?.addEventListener('submit', async event => {
            event.preventDefault();
            setPasswordError('');

            const password = elements.newPassword?.value || '';
            const confirmation = elements.confirmPassword?.value || '';

            if (password !== confirmation) {
                setPasswordError('Passwords do not match.');
                return;
            }

            if (password.length < 8 || password.length > 128) {
                setPasswordError('Use between 8 and 128 characters.');
                return;
            }

            if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
                setPasswordError('Include uppercase and lowercase letters and at least one number.');
                return;
            }

            const submit = $('#changePasswordBtn');
            setBusy(submit, true, 'Saving…');
            try {
                const response = await fetch('/panel/reset-password', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'text/plain' },
                    body: password
                });
                const payload = await response.json();
                if (!payload.success) {
                    throw new ApiError(payload.message || 'Unable to update the password.', payload.status);
                }

                sessionStorage.setItem('technamooz-flash', JSON.stringify({
                    type: 'success',
                    title: state.isPassSet ? 'Password updated' : 'Panel secured',
                    message: state.isPassSet
                        ? 'Sign in again with your new password.'
                        : 'Your panel password is ready. Sign in to continue.'
                }));
                window.location.assign('/login');
            } catch (error) {
                setPasswordError(error.message || 'Unable to update the password.');
            } finally {
                setBusy(submit, false);
            }
        });
    }

    /* Navigation ----------------------------------------------------------- */

    function setActiveNav(target) {
        $$('.nav-link[data-view-target]').forEach(link => {
            link.classList.toggle('is-active', link.dataset.viewTarget === target);
        });
    }

    function activateTab(tab, updateLocation = true) {
        const target = $(`.config-tab[data-config-tab="${CSS.escape(tab)}"]`) ? tab : 'common';
        state.currentTab = target;

        $$('.config-tab', elements.form?.parentElement?.parentElement || document).forEach(button => {
            button.classList.toggle('is-active', button.dataset.configTab === target);
        });
        $$('[data-config-panel]').forEach(panel => {
            const active = panel.dataset.configPanel === target;
            panel.classList.toggle('is-active', active);
            panel.hidden = !active;
        });

        const breadcrumb = $('#breadcrumbLabel');
        if (breadcrumb) {
            breadcrumb.textContent = target === 'routing' && state.currentView === 'configuration'
                ? 'Routing rules'
                : (VIEW_LABELS[state.currentView] || 'Dashboard');
        }

        if (state.currentView === 'configuration') {
            setActiveNav(target === 'routing' ? 'routing' : 'configuration');
        }

        if (updateLocation) {
            const hash = target === 'routing' && state.currentView === 'configuration' ? '#routing' : '#configuration';
            history.replaceState(null, '', hash);
        }
    }

    function showView(view, options = {}) {
        const requested = view === 'routing' ? 'configuration' : view;
        const resolved = document.getElementById(`view-${requested}`) ? requested : 'overview';
        state.currentView = resolved;

        $$('.view').forEach(section => {
            section.classList.toggle('is-active', section.id === `view-${resolved}`);
        });

        if (view === 'routing') {
            setActiveNav('routing');
        } else {
            setActiveNav(resolved);
        }

        const breadcrumb = $('#breadcrumbLabel');
        if (breadcrumb) {
            breadcrumb.textContent = view === 'routing'
                ? 'Routing rules'
                : (VIEW_LABELS[resolved] || 'Dashboard');
        }

        if (resolved === 'configuration') {
            activateTab(options.tab || (view === 'routing' ? 'routing' : state.currentTab), false);
        }

        closeSidebar();
        closeProfileMenu();

        if (options.hash !== false) {
            const hash = view === 'routing' ? '#routing' : `#${view}`;
            if (window.location.hash !== hash) history.replaceState(null, '', hash);
        }

        if (resolved === 'subscriptions') renderSubscriptions();
        if (resolved === 'network' && !state.ipLoaded) refreshIdentity();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function openSidebar() {
        elements.sidebar?.classList.add('is-open');
        elements.sidebarBackdrop?.classList.add('is-visible');
    }

    function closeSidebar() {
        elements.sidebar?.classList.remove('is-open');
        elements.sidebarBackdrop?.classList.remove('is-visible');
    }

    function closeProfileMenu() {
        if (!elements.profileMenu) return;
        elements.profileMenu.hidden = true;
        elements.profileToggle?.setAttribute('aria-expanded', 'false');
    }

    function initNavigation() {
        document.addEventListener('click', event => {
            const trigger = event.target.closest('[data-view-target]');
            if (!trigger) return;
            event.preventDefault();

            const target = trigger.dataset.viewTarget;
            showView(target, { tab: trigger.dataset.configTarget });

            if (trigger.dataset.subAction) {
                runSubscriptionShortcut(trigger.dataset.subAction);
            }
            if (trigger.dataset.networkAction === 'refresh') {
                refreshIdentity();
            }
        });

        $$('[data-config-tab]').forEach(button => {
            button.addEventListener('click', () => {
                if (state.currentView !== 'configuration') showView('configuration', { tab: button.dataset.configTab });
                else activateTab(button.dataset.configTab);
            });
        });

        $('#sidebarToggle')?.addEventListener('click', openSidebar);
        $('#sidebarClose')?.addEventListener('click', closeSidebar);
        elements.sidebarBackdrop?.addEventListener('click', closeSidebar);

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            if (!hash) return;
            if (hash === 'routing') showView('routing', { hash: false });
            else if (VIEW_LABELS[hash]) showView(hash, { hash: false });
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && elements.sidebar?.classList.contains('is-open')) closeSidebar();
        });
    }

    function initProfileMenu() {
        elements.profileToggle?.addEventListener('click', event => {
            event.stopPropagation();
            const open = elements.profileMenu?.hidden === false;
            if (open) closeProfileMenu();
            else {
                if (elements.profileMenu) elements.profileMenu.hidden = false;
                elements.profileToggle.setAttribute('aria-expanded', 'true');
            }
        });

        document.addEventListener('click', event => {
            if (!elements.profileMenu || elements.profileMenu.hidden) return;
            if (!event.target.closest('.profile-wrap')) closeProfileMenu();
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeProfileMenu();
        });
    }

    async function logout() {
        try {
            const response = await fetch('/logout', { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json();
            if (!payload.success) throw new ApiError(payload.message || 'Logout failed.', payload.status);
            window.location.assign('/login');
        } catch (error) {
            toastError(error, 'Unable to sign out');
        }
    }

    /* Command palette ------------------------------------------------------ */

    function initCommandPalette() {
        const open = () => {
            UI.openModal(elements.commandModal);
            if (elements.commandInput) {
                elements.commandInput.value = '';
                filterCommands('');
                window.setTimeout(() => elements.commandInput?.focus(), 60);
            }
        };

        const close = () => UI.closeModal(elements.commandModal);

        $('#commandOpen')?.addEventListener('click', open);
        document.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (elements.commandModal.classList.contains('is-open')) close();
                else open();
            }
        });

        elements.commandInput?.addEventListener('input', () => filterCommands(elements.commandInput.value));
        elements.commandInput?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            const first = $$('[data-command-view]', elements.commandResults).find(button => !button.hidden);
            first?.click();
        });

        elements.commandResults?.addEventListener('click', event => {
            const button = event.target.closest('[data-command-view]');
            if (!button) return;
            close();
            showView(button.dataset.commandView, { tab: button.dataset.commandTab });
        });
    }

    function filterCommands(query) {
        const normalized = String(query || '').toLowerCase().trim();
        $$('[data-command-view]', elements.commandResults).forEach(button => {
            button.hidden = Boolean(normalized) && !button.textContent.toLowerCase().includes(normalized);
        });
    }

    /* Dashboard and snapshot ----------------------------------------------- */

    function protocolNames(settings = state.settings || {}) {
        const names = [];
        if (settings.VLConfigs) names.push('VLESS');
        if (settings.TRConfigs) names.push('Trojan');
        return names;
    }

    function updateDashboard() {
        const settings = state.settings || {};
        const protocols = protocolNames(settings);
        const ports = Array.isArray(settings.ports) ? settings.ports : [];
        const endpoints = Array.isArray(settings.warpEndpoints) ? settings.warpEndpoints : [];

        setText('heroProtocols', protocols.length || '—');
        setText('heroPorts', ports.length || '—');
        setText('heroWarp', endpoints.length ? 'Ready' : 'Off');
        setText('metricProtocols', protocols.length ? `${protocols.length} active` : 'None');
        setText('metricProtocolsHint', protocols.length
            ? `${protocols.join(' + ')} profiles enabled`
            : 'Enable at least one protocol');
        setText('metricPorts', ports.length || '—');
        setText('metricPortsHint', ports.length
            ? `${ports.slice(0, 4).join(', ')}${ports.length > 4 ? '…' : ''}`
            : 'No listeners selected');
        setText('metricProfiles', String(subscriptionCount()));
        setText('snapHost', window.location.hostname);
        setText('snapSubPath', state.subPath || '—');
        setText('snapDns', settings.remoteDNS || '—');
        setText('snapProxyMode', settings.proxyIPMode === 'prefix' ? 'NAT64 prefix' : 'Proxy IP');
        setText('snapIpv6', settings.enableIPv6 ? 'Enabled' : 'Disabled');
        setText('snapWarp', endpoints.length ? `${endpoints.length} configured` : 'Not configured');
        setText('deliveryProfileCount', String(subscriptionCount()));
        setText('deliveryWarpCount', endpoints.length ? 'Ready' : 'Off');
        setText('subPathValue', state.subPath || '—');

        const doh = state.subPath
            ? `${window.location.origin}/dns-query/${encodeURIComponent(state.subPath)}`
            : '—';
        setText('doh', doh);
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function subscriptionCount() {
        return 13;
    }

    /* Fragment and noise --------------------------------------------------- */

    function buildNoiseElement(noise, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'noise-item';
        wrapper.innerHTML = `
            <div class="noise-head">
                <span class="noise-title"><span class="noise-index">${index + 1}</span> UDP noise packet</span>
                <button class="noise-delete" type="button" aria-label="Remove noise ${index + 1}">${UI.icon('trash')}</button>
            </div>
            <div class="noise-grid">
                <div class="field">
                    <span class="field-label">Mode</span>
                    <select class="select noise-mode">
                        ${NOISE_TYPES.map(type => `<option value="${type}" ${noise.type === type ? 'selected' : ''}>${type}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <span class="field-label">Packet</span>
                    <input class="input noise-packet" type="text" spellcheck="false" autocomplete="off">
                </div>
                <div class="field">
                    <span class="field-label">Count</span>
                    <input class="input noise-count" type="number" min="1" max="100" maxlength="3">
                </div>
                <div class="field">
                    <span class="field-label">Delay range</span>
                    <div class="range-pair">
                        <input class="input noise-delay-min" type="number" min="0" max="1000" aria-label="Minimum delay">
                        <span class="range-sep">—</span>
                        <input class="input noise-delay-max" type="number" min="0" max="1000" aria-label="Maximum delay">
                    </div>
                </div>
            </div>`;

        $('.noise-packet', wrapper).value = noise.packet ?? '50-100';
        $('.noise-count', wrapper).value = Number(noise.count ?? 5);
        const [delayMin, delayMax] = String(noise.delay || '1-1').split('-');
        $('.noise-delay-min', wrapper).value = Number(delayMin || 0);
        $('.noise-delay-max', wrapper).value = Number(delayMax || 1);

        $('.noise-delete', wrapper).addEventListener('click', () => removeNoise(wrapper));
        $('.noise-mode', wrapper).addEventListener('change', event => generateNoisePacket(event.target));
        return wrapper;
    }

    function renderNoises(noises) {
        const list = $('#noises');
        if (!list) return;
        list.innerHTML = '';
        const items = noises.length ? noises : [{
            type: 'rand', packet: '50-100', delay: '1-1', count: 5
        }];
        items.forEach((noise, index) => list.appendChild(buildNoiseElement(noise, index)));
        reindexNoises();
    }

    function reindexNoises() {
        $$('.noise-item', $('#noises')).forEach((item, index) => {
            const badge = $('.noise-index', item);
            if (badge) badge.textContent = String(index + 1);
            const remove = $('.noise-delete', item);
            if (remove) remove.setAttribute('aria-label', `Remove noise ${index + 1}`);
        });
        const addButton = $('#addUdpNoiseBtn');
        if (addButton) addButton.disabled = $$('.noise-item').length >= 30;
    }

    function addNoise() {
        const list = $('#noises');
        if (!list) return;
        if ($$('.noise-item', list).length >= 30) {
            UI.toast('Up to 30 UDP noise profiles can be configured.', 'warning');
            return;
        }
        list.appendChild(buildNoiseElement({ type: 'rand', packet: '50-100', delay: '1-1', count: 5 }, $$('.noise-item', list).length));
        reindexNoises();
        markDirty();
    }

    async function removeNoise(item) {
        const list = $('#noises');
        const items = $$('.noise-item', list);
        if (items.length <= 1) {
            UI.toast('At least one UDP noise profile is required.', 'warning');
            return;
        }

        const confirmed = await UI.confirmDialog({
            title: 'Remove this noise profile?',
            message: 'The generated profile will no longer include this sequence of UDP packets.',
            confirmLabel: 'Remove',
            danger: true
        });
        if (!confirmed) return;
        item.remove();
        reindexNoises();
        markDirty();
    }

    function generateNoisePacket(select) {
        const item = select.closest('.noise-item');
        const packet = $('.noise-packet', item);
        if (!packet) return;

        const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));
        switch (select.value) {
            case 'rand':
                packet.value = '50-100';
                break;
            case 'base64': {
                const bytes = randomBytes(Math.ceil(64 * 3 / 4));
                packet.value = btoa(String.fromCharCode(...bytes)).slice(0, 64);
                break;
            }
            case 'hex':
                packet.value = [...randomBytes(32)].map(byte => byte.toString(16).padStart(2, '0')).join('');
                break;
            case 'str': {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                const bytes = randomBytes(64);
                packet.value = [...bytes].map(byte => chars[byte % chars.length]).join('');
                break;
            }
            case 'array':
                packet.value = '0,1,2,3';
                break;
        }
        markDirty();
    }

    /* Validation ----------------------------------------------------------- */

    function isDomain(value) {
        return /^(?=.{1,253}$)(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)+[a-zA-Z]{2,63}$/.test(value);
    }

    function isIPv4(value) {
        return /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(value);
    }

    function isIPv4CIDR(value) {
        return /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/.test(value);
    }

    function isIPv6(value) {
        return /^\[(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?::[a-fA-F0-9]{1,4}){1,7})\]$/.test(value);
    }

    function isIPv6CIDR(value) {
        return /^(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?::[a-fA-F0-9]{1,4}){1,7}|::)(?:\/(?:12[0-8]|1[01][0-9]|[0-9]?[0-9]))?$/.test(value);
    }

    function parseHostPort(input) {
        const match = String(input || '').trim().match(/^(?<host>\[[^\]]+\]|[^:]+)(?::(?<port>\d+))?$/);
        if (!match?.groups) return null;
        return {
            host: match.groups.host,
            port: match.groups.port ? Number(match.groups.port) : null
        };
    }

    function isValidHostName(value, requirePort = false) {
        const parsed = parseHostPort(value);
        if (!parsed) return false;
        const { host, port } = parsed;
        if (port !== null && (port < 1 || port > 65535)) return false;
        if (requirePort && !port) return false;
        return isIPv6(host) || isIPv4(host) || isDomain(host);
    }

    function failValidation(message) {
        UI.toast(message, 'error', { title: 'Check your settings' });
        return false;
    }

    function validateRemoteDns() {
        const value = readValue('remoteDNS');
        let url;
        try {
            url = new URL(value);
        } catch {
            return failValidation('Remote DNS must be a valid tcp://, https:// or tls:// URL.');
        }

        if (!['tcp:', 'https:', 'tls:'].includes(url.protocol)) {
            return failValidation('Remote DNS must use TCP, DoH (https) or DoT (tls).');
        }

        const hostname = url.hostname.toLowerCase();
        if (CLOUDFLARE_DNS.has(hostname) || hostname.endsWith('.cloudflare-dns.com')) {
            return failValidation('Cloudflare DNS is not reachable from Worker traffic. Choose Google, AdGuard or another resolver.');
        }

        return true;
    }

    function validateSanctionDns() {
        const value = readValue('antiSanctionDNS');
        let host = value;
        try {
            host = new URL(value).hostname;
        } catch {
            // Plain IP or hostname values are valid here.
        }
        const parsed = parseHostPort(host);
        return isValidHostName(parsed?.host || host)
            ? true
            : failValidation(`Invalid anti-sanction DNS value: ${value}`);
    }

    function validateLocalDns() {
        const value = readValue('localDNS');
        return value === 'localhost' || isIPv4(value)
            ? true
            : failValidation('Local DNS must be an IPv4 address or localhost.');
    }

    function validateWarpDns() {
        return isIPv4(readValue('warpRemoteDNS'))
            ? true
            : failValidation('WARP remote DNS must be an IPv4 address.');
    }

    function validateHostLists() {
        const hostFields = ['cleanIPs', 'customCdnAddrs', 'customCdnSni', 'customCdnHost', 'proxyIPs'];
        const invalid = hostFields
            .flatMap(id => readLines(id))
            .filter(value => !isValidHostName(value));

        if (invalid.length) {
            return failValidation(`Invalid IP or domain values: ${invalid.join(', ')}`);
        }
        return true;
    }

    function validatePrefixes() {
        const invalid = readLines('prefixes').filter(value => !isIPv6(value));
        return invalid.length
            ? failValidation(`NAT64 prefixes must be bracketed IPv6 addresses: ${invalid.join(', ')}`)
            : true;
    }

    function validateWarpEndpoints() {
        const invalid = readLines('warpEndpoints').filter(value => !isValidHostName(value, true));
        return invalid.length
            ? failValidation(`WARP endpoints must be host:port values: ${invalid.join(', ')}`)
            : true;
    }

    function validateRanges() {
        const fields = [
            ['fragmentLengthMin', 'fragmentLengthMax', 'Fragment length'],
            ['fragmentIntervalMin', 'fragmentIntervalMax', 'Fragment interval'],
            ['fragmentMaxSplitMin', 'fragmentMaxSplitMax', 'Fragment max split'],
            ['noiseCountMin', 'noiseCountMax', 'Noise count'],
            ['noiseSizeMin', 'noiseSizeMax', 'Noise size'],
            ['noiseDelayMin', 'noiseDelayMax', 'Noise delay'],
            ['amneziaNoiseSizeMin', 'amneziaNoiseSizeMax', 'Amnezia noise size']
        ];

        for (const [minId, maxId, label] of fields) {
            const min = readNumber(minId);
            const max = readNumber(maxId);
            if (min !== undefined && max !== undefined && min > max) {
                return failValidation(`${label}: the minimum cannot be larger than the maximum.`);
            }
        }

        const splitMin = readNumber('fragmentMaxSplitMin');
        const splitMax = readNumber('fragmentMaxSplitMax');
        if ((splitMin === undefined) !== (splitMax === undefined)) {
            return failValidation('Fragment max split requires both a minimum and a maximum, or leave both empty.');
        }

        for (const input of $$('input[type="number"]', elements.form)) {
            if (input.value === '') continue;
            const value = Number(input.value);
            if (!Number.isFinite(value)) return failValidation(`Enter a valid number for ${input.id || 'the highlighted field'}.`);
            if (input.min !== '' && value < Number(input.min)) {
                return failValidation(`${labelFor(input)} must be at least ${input.min}.`);
            }
            if (input.max !== '' && value > Number(input.max)) {
                return failValidation(`${labelFor(input)} cannot exceed ${input.max}.`);
            }
        }

        return true;
    }

    function labelFor(input) {
        const explicit = elements.form?.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        return explicit?.textContent.trim() || input.getAttribute('aria-label') || 'This value';
    }

    function validateUpstreamProxy() {
        const value = readValue('upstreamProxy');
        return !value || isValidHostName(value, true)
            ? true
            : failValidation('Upstream proxy must be an IP or domain with a port.');
    }

    function validateChainProxy() {
        const value = readValue('outProxy');
        if (!value) return true;

        if (/^vmess:\/\//i.test(value)) {
            try {
                const encoded = value.slice('vmess://'.length).split('#')[0];
                const config = JSON.parse(decodeBase64Utf8(encoded));
                if (!config?.id) throw new Error('missing id');
                return true;
            } catch {
                return failValidation('The VMess chain proxy is not a valid base64 JSON config.');
            }
        }

        let url;
        try {
            url = new URL(value);
        } catch {
            return failValidation('The chain proxy is not a valid URI.');
        }

        if (!['http:', 'socks:', 'socks5:', 'vless:', 'trojan:', 'ss:'].includes(url.protocol)) {
            return failValidation('Chain proxy protocol must be HTTP, SOCKS, VLESS, Trojan or Shadowsocks.');
        }

        if (['vless:', 'trojan:'].includes(url.protocol)) {
            if (!url.username) return failValidation('The chain proxy is missing its UUID or password.');
            const security = url.searchParams.get('security');
            const type = url.searchParams.get('type');
            if (security && !['tls', 'none', 'reality'].includes(security)) {
                return failValidation('Chain proxy security must be tls, reality or none.');
            }
            if (type && !['tcp', 'raw', 'ws', 'grpc', 'httpupgrade'].includes(type)) {
                return failValidation('Chain proxy transport must be tcp, ws, grpc or httpupgrade.');
            }
        }

        return true;
    }

    function validateCustomCdn() {
        const addresses = readLines('customCdnAddrs');
        const host = readValue('customCdnHost');
        const sni = readValue('customCdnSni');
        const any = addresses.length || host || sni;
        const complete = addresses.length && host && sni;
        return !any || complete
            ? true
            : failValidation('All three custom CDN fields must be filled together, or left empty.');
    }

    function validateKnockerNoise() {
        return /^(none|quic|random|[0-9A-Fa-f]+)$/.test(readValue('knockerNoiseMode'))
            ? true
            : failValidation('Knocker noise must be none, quic, random or a hex string.');
    }

    function validateNoises() {
        const items = $$('.noise-item', elements.form);
        if (!items.length) return failValidation('Add at least one UDP noise profile.');

        for (const [index, item] of items.entries()) {
            const type = $('.noise-mode', item)?.value || 'rand';
            const packet = $('.noise-packet', item)?.value.trim() || '';
            const count = Number($('.noise-count', item)?.value || 0);
            const delayMin = Number($('.noise-delay-min', item)?.value || 0);
            const delayMax = Number($('.noise-delay-max', item)?.value || 0);

            if (count < 1 || count > 100) return failValidation(`Noise ${index + 1}: count must be between 1 and 100.`);
            if (delayMin > delayMax) return failValidation(`Noise ${index + 1}: delay minimum exceeds maximum.`);

            if (type === 'rand' && !/^\d+-\d+$/.test(packet)) {
                return failValidation(`Noise ${index + 1}: random packets use a range such as 50-100.`);
            }
            if (type === 'rand') {
                const [min, max] = packet.split('-').map(Number);
                if (min > max) return failValidation(`Noise ${index + 1}: packet range minimum exceeds maximum.`);
            }
            if (type === 'hex' && !/^(?:[0-9A-Fa-f]{2})+$/.test(packet)) {
                return failValidation(`Noise ${index + 1}: hex packets need an even number of hex characters.`);
            }
            if (type === 'array' && !packet.split(',').every(part => /^\d{1,3}$/.test(part.trim()) && Number(part) <= 255)) {
                return failValidation(`Noise ${index + 1}: array packets are comma-separated numbers from 0 to 255.`);
            }
            if (type === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packet)) {
                return failValidation(`Noise ${index + 1}: the packet is not valid base64.`);
            }
        }

        return true;
    }

    function validateRules() {
        const invalidIp = [
            ...readLines('customBypassRules'),
            ...readLines('customBlockRules')
        ].filter(value => !isIPv4CIDR(value) && !isIPv6CIDR(value) && !isDomain(value));

        if (invalidIp.length) {
            return failValidation(`Invalid routing IPs or domains: ${invalidIp.join(', ')}`);
        }

        const invalidDomains = readLines('customBypassSanctionRules').filter(value => !isDomain(value));
        return invalidDomains.length
            ? failValidation(`Invalid sanction domains: ${invalidDomains.join(', ')}`)
            : true;
    }

    function validateEch() {
        const value = readValue('echServerName');
        return !value || isDomain(value)
            ? true
            : failValidation('The ECH server name must be a valid domain.');
    }

    function validateExternalSettings() {
        const invalidSubs = readLines('customSubs').filter(value => {
            try {
                return !['http:', 'https:'].includes(new URL(value).protocol);
            } catch {
                return true;
            }
        });
        if (invalidSubs.length) return failValidation(`External subscriptions must use HTTP or HTTPS: ${invalidSubs.join(', ')}`);

        const invalidConfigs = readLines('customConfigs').filter(value => !/^(vless|trojan|vmess|ss|socks|http):\/\//i.test(value));
        if (invalidConfigs.length) return failValidation(`Unsupported single configs: ${invalidConfigs.join(', ')}`);

        return true;
    }

    function validateProtocolsAndPorts() {
        if (!$('#VLConfigs')?.checked && !$('#TRConfigs')?.checked) {
            return failValidation('Enable at least one protocol.');
        }

        const tlsPorts = $$('#tls-ports .port-checkbox:checked').length;
        if (!tlsPorts) return failValidation('Enable at least one TLS port.');
        return true;
    }

    function validateSettings(skipDirty = false) {
        const checks = [
            validateProtocolsAndPorts,
            validateRemoteDns,
            validateSanctionDns,
            validateLocalDns,
            validateWarpDns,
            validateHostLists,
            validatePrefixes,
            validateWarpEndpoints,
            validateRanges,
            validateUpstreamProxy,
            validateChainProxy,
            validateCustomCdn,
            validateKnockerNoise,
            validateNoises,
            validateRules,
            validateEch,
            validateExternalSettings
        ];

        const valid = checks.every(check => check());
        if (!valid && !skipDirty) markDirty();
        return valid;
    }

    /* Subscriptions -------------------------------------------------------- */

    function subUrl(path, app, tag, singbox = false) {
        const url = new URL('/sub/', window.location.origin);
        url.pathname = `/sub/${path}/${encodeURIComponent(state.subPath)}`;
        if (app) url.searchParams.set('app', app);
        if (tag) url.hash = `Technamooz-${tag}`;
        if (singbox) {
            return `sing-box://import-remote-profile?url=${encodeURIComponent(url.href)}`;
        }
        return url.href;
    }

    function subscriptionCard(options) {
        const { path, app, title, description, icon, apps, tag, singbox, downloadName } = options;
        const url = subUrl(path, app, tag, singbox);
        const dataset = `data-sub-path="${path}" data-sub-app="${app || ''}" data-sub-tag="${UI.escapeHtml(tag || '')}" data-sub-singbox="${singbox ? 'true' : 'false'}" data-sub-download="${UI.escapeHtml(downloadName || '')}"`;

        return `
            <article class="sub-card card depth">
                <div class="sub-card-head">
                    <span class="sub-icon">${UI.icon(icon)}</span>
                    <div><h3>${UI.escapeHtml(title)}</h3><p>${UI.escapeHtml(description)}</p></div>
                    ${singbox ? '<span class="badge badge-accent">Deep link</span>' : ''}
                </div>
                <div class="sub-apps">${apps.map(item => `<span class="app-chip">${UI.escapeHtml(item)}</span>`).join('')}</div>
                <div class="sub-actions">
                    <button class="sub-action primary" type="button" ${dataset} data-sub-action="copy">${UI.icon('copy')} Copy URL</button>
                    <button class="sub-action" type="button" ${dataset} data-sub-action="qr">${UI.icon('qr')} QR</button>
                    ${downloadName ? `<button class="sub-action" type="button" ${dataset} data-sub-action="download">${UI.icon('download')} Download</button>` : ''}
                </div>
            </article>`;
    }

    function renderSubscriptions() {
        if (!elements.subscriptionGrid) return;
        const settings = state.settings || {};

        const cards = [
            subscriptionCard({
                path: 'normal', app: 'xray', title: 'Xray · Normal', description: 'Standard profile for v2rayNG, MahsaNG and Xray clients.',
                icon: 'layers', apps: ['v2rayNG', 'MahsaNG', 'Xray'], tag: 'Xray Normal', downloadName: 'Technamooz-Xray.json'
            }),
            subscriptionCard({
                path: 'normal', app: 'sing-box', title: 'sing-box · Normal', description: 'Native sing-box JSON profile with remote import support.',
                icon: 'zap', apps: ['sing-box', 'SFI', 'SFA'], tag: 'sing-box Normal', singbox: true, downloadName: 'Technamooz-sing-box.json'
            }),
            subscriptionCard({
                path: 'normal', app: 'clash', title: 'Clash · Normal', description: 'Mihomo / Clash Meta YAML profile for desktop and mobile.',
                icon: 'monitor', apps: ['Mihomo', 'Clash Meta', 'FlClash'], tag: 'Clash Normal', downloadName: 'Technamooz-Clash.yaml'
            }),
            subscriptionCard({
                path: 'fragment', app: 'xray', title: 'Xray · Fragment', description: 'DPI-resistant Xray profile with calibrated TLS fragmentation.',
                icon: 'shield', apps: ['v2rayNG', 'MahsaNG'], tag: 'Xray Fragment', downloadName: 'Technamooz-Xray-Fragment.json'
            }),
            subscriptionCard({
                path: 'fragment', app: 'sing-box', title: 'sing-box · Fragment', description: 'Fragment profile delivered as a sing-box import link.',
                icon: 'shield', apps: ['sing-box', 'SFI'], tag: 'sing-box Fragment', singbox: true, downloadName: 'Technamooz-sing-box-Fragment.json'
            }),
            subscriptionCard({
                path: 'raw', app: 'xray', title: 'Raw configs', description: 'Base64 collection of individual URIs for manual import.',
                icon: 'file', apps: ['v2rayNG', 'Shadowrocket'], tag: 'Raw Configs', downloadName: 'Technamooz-Raw.txt'
            }),
            subscriptionCard({
                path: 'warp', app: 'xray', title: 'Xray · WARP', description: 'Cloudflare WARP outbound for Xray clients.',
                icon: 'cloud', apps: ['v2rayNG', 'MahsaNG'], tag: 'Xray WARP', downloadName: 'Technamooz-Xray-WARP.json'
            }),
            subscriptionCard({
                path: 'warp', app: 'sing-box', title: 'sing-box · WARP', description: 'WARP profile with a native sing-box remote import link.',
                icon: 'cloud', apps: ['sing-box', 'SFI'], tag: 'sing-box WARP', singbox: true, downloadName: 'Technamooz-sing-box-WARP.json'
            }),
            subscriptionCard({
                path: 'warp', app: 'clash', title: 'Clash · WARP', description: 'Mihomo profile with WARP outbound rules.',
                icon: 'cloud', apps: ['Mihomo', 'Clash Meta'], tag: 'Clash WARP', downloadName: 'Technamooz-Clash-WARP.yaml'
            }),
            subscriptionCard({
                path: 'warp-pro', app: 'xray', title: 'Xray · WARP Pro', description: 'WARP Pro outbound with the generated UDP noise sequence.',
                icon: 'crown', apps: ['v2rayNG', 'v2rayN'], tag: 'Xray WARP Pro', downloadName: 'Technamooz-Xray-WARP-Pro.json'
            }),
            subscriptionCard({
                path: 'warp-pro', app: 'xray-knocker', title: 'MahsaNG · WARP Pro', description: 'Knocker-style WARP Pro profile tuned for MahsaNG.',
                icon: 'crown', apps: ['MahsaNG'], tag: 'MahsaNG WARP Pro', downloadName: 'Technamooz-MahsaNG-WARP-Pro.json'
            }),
            subscriptionCard({
                path: 'warp-pro', app: 'clash', title: 'Clash · WARP Pro', description: 'WARP Pro with Amnezia noise for Mihomo clients.',
                icon: 'crown', apps: ['Mihomo', 'Amnezia'], tag: 'Clash WARP Pro', downloadName: 'Technamooz-Clash-WARP-Pro.yaml'
            })
        ];

        elements.subscriptionGrid.innerHTML = `
            <div class="subscription-group">
                <div><span class="eyebrow">Core profiles</span><h2>Client-ready subscriptions</h2></div>
                <span class="badge">${cards.length} profiles</span>
            </div>
            ${cards.join('')}
            <article class="sub-card card depth wireguard-card">
                <div class="sub-card-head">
                    <span class="sub-icon">${UI.icon('server')}</span>
                    <div><h3>WireGuard config bundle</h3><p>Download every configured WARP endpoint as ready-to-import <code class="mono">.conf</code> files.</p></div>
                </div>
                <div class="sub-apps"><span class="app-chip">WireGuard</span><span class="app-chip">AmneziaWG</span><span class="app-chip">WG Tunnel</span></div>
                <div class="sub-actions">
                    <a class="sub-action primary" href="/panel/get-warp-configs" download>${UI.icon('download')} Standard ZIP</a>
                    <a class="sub-action" href="/panel/get-warp-configs?app=amnezia" download>${UI.icon('download')} Amnezia ZIP</a>
                </div>
                <p class="sub-note">Generated from ${UI.escapeHtml(String((settings.warpEndpoints || []).length))} WARP endpoint${(settings.warpEndpoints || []).length === 1 ? '' : 's'}.</p>
            </article>`;

        setText('deliveryProfileCount', String(cards.length + 1));
        setText('deliveryWarpCount', (settings.warpEndpoints || []).length ? 'Ready' : 'Off');
        setText('metricProfiles', String(cards.length + 1));
        setText('subPathValue', state.subPath || '—');
    }

    function handleSubscriptionAction(button) {
        const path = button.dataset.subPath;
        const app = button.dataset.subApp;
        const tag = button.dataset.subTag || 'Profile';
        const singbox = button.dataset.subSingbox === 'true';
        const action = button.dataset.subAction;
        const url = subUrl(path, app, tag, singbox);

        if (action === 'copy') {
            copyText(singbox ? url : url, `${tag} link copied.`);
        } else if (action === 'qr') {
            openQr(url, tag);
        } else if (action === 'download') {
            downloadSubscription(button.dataset.subDownload || 'Technamooz-profile.txt', path, app);
        }
    }

    function runSubscriptionShortcut(action) {
        if (action === 'copy-normal') {
            const url = subUrl('normal', 'xray', 'Xray Normal');
            copyText(url, 'Normal Xray subscription copied.');
        } else if (action === 'qr-fragment') {
            openQr(subUrl('fragment', 'xray', 'Xray Fragment'), 'Xray Fragment');
        }
    }

    async function copyText(value, message) {
        try {
            await UI.copy(value);
            UI.toast(message || 'Copied to clipboard.', 'success');
        } catch (error) {
            UI.toast(error.message || 'Clipboard access is unavailable.', 'error');
        }
    }

    async function downloadSubscription(filename, path, app) {
        try {
            const response = await fetch(subUrl(path, app, ''), { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error(`Download failed (${response.status}).`);
            const text = await response.text();
            const type = filename.endsWith('.yaml') ? 'text/yaml' : 'application/json';
            UI.downloadBlob(text, filename, type);
            UI.toast('Profile downloaded.', 'success');
        } catch (error) {
            UI.toast(error.message || 'Unable to download this profile.', 'error');
        }
    }

    function initSubscriptions() {
        elements.subscriptionGrid?.addEventListener('click', event => {
            const button = event.target.closest('[data-sub-action]');
            if (button) handleSubscriptionAction(button);
        });

        $('#copySubPath')?.addEventListener('click', () => copyText(state.subPath, 'Subscription path copied.'));
    }

    /* QR ------------------------------------------------------------------- */

    function openQr(value, title) {
        if (!value) return;
        state.qrValue = value;
        if (elements.qrTitle) elements.qrTitle.textContent = title || 'Subscription QR';
        if (elements.qrUrl) elements.qrUrl.textContent = value;
        if (elements.qrContainer) {
            try {
                // qrcode-generator exposes the global `qrcode` factory.
                const qr = window.qrcode(0, 'M');
                qr.addData(value);
                qr.make();
                elements.qrContainer.innerHTML = qr.createSvgTag({
                    cellSize: 8,
                    margin: 0,
                    scalable: true,
                    alt: title || 'Subscription QR code'
                });
            } catch (error) {
                elements.qrContainer.innerHTML = '<p class="muted">This link is too long to encode as a QR code.</p>';
                toastError(error, 'QR generation failed');
            }
        }
        UI.openModal(elements.qrModal);
    }

    function initQr() {
        $('#qrCopyBtn')?.addEventListener('click', () => {
            if (state.qrValue) copyText(state.qrValue, 'QR link copied.');
        });
    }

    /* Network identity ----------------------------------------------------- */

    function setIpBadge(stateName, label) {
        if (!elements.ipStatusBadge) return;
        const dotClass = stateName === 'ready' ? '' : stateName === 'error' ? 'warning' : 'idle';
        elements.ipStatusBadge.innerHTML = `<span class="status-dot ${dotClass}"></span> ${UI.escapeHtml(label)}`;
    }

    function clearIpInfo() {
        ['cf-ip', 'cf-country', 'cf-city', 'cf-isp', 'ip', 'country', 'city', 'isp'].forEach(id => setText(id, '—'));
    }

    function flagFromCountry(countryCode) {
        const code = String(countryCode || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) return '';
        return String.fromCodePoint(...[...code].map(letter => 0x1F1E6 + letter.charCodeAt(0) - 65));
    }

    async function lookupIpDetails(ip) {
        try {
            return await api('/panel/my-ip', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: ip
            });
        } catch (error) {
            if (error.status === 401) throw error;
            return null;
        }
    }

    async function resolveDirectIp() {
        const response = await fetch(`https://ipv4.geojs.io/v1/ip.json?nocache=${Date.now()}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) throw new Error(`geo lookup failed (${response.status})`);
        const data = await response.json();
        if (!data?.ip) throw new Error('geo lookup returned no address');
        return String(data.ip).trim();
    }

    async function resolveCloudflareIp() {
        const response = await fetch(`https://ipv4.icanhazip.com/?nocache=${Date.now()}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) throw new Error(`Cloudflare identity lookup failed (${response.status})`);
        const text = (await response.text()).trim();
        if (!text) throw new Error('Cloudflare identity lookup returned no address');
        return text;
    }

    async function fillIdentity(target, ip) {
        const details = await lookupIpDetails(ip);
        const country = details?.country || '—';
        const flag = flagFromCountry(details?.countryCode);
        const prefix = target === 'cf' ? 'cf-' : '';

        setText(`${prefix}ip`, ip);
        setText(`${prefix}country`, flag ? `${country} ${flag}` : country);
        setText(`${prefix}city`, details?.city || '—');
        setText(`${prefix}isp`, details?.isp || '—');
    }

    async function refreshIdentity() {
        const button = $('#refresh-geo-location');
        if (button) {
            button.disabled = true;
            button.dataset.idleHtml = button.dataset.idleHtml || button.innerHTML;
            button.innerHTML = spinner('Checking…');
        }
        setIpBadge('loading', 'Resolving');
        clearIpInfo();

        const results = await Promise.allSettled([resolveDirectIp(), resolveCloudflareIp()]);
        let loaded = 0;

        if (results[0].status === 'fulfilled') {
            try {
                await fillIdentity('direct', results[0].value);
                loaded++;
            } catch (error) {
                if (error.status === 401) return;
            }
        }

        if (results[1].status === 'fulfilled') {
            try {
                await fillIdentity('cf', results[1].value);
                loaded++;
            } catch (error) {
                if (error.status === 401) return;
            }
        }

        state.ipLoaded = loaded > 0;
        setIpBadge(loaded > 0 ? 'ready' : 'error', loaded > 0 ? 'Identity resolved' : 'Unavailable');

        if (!loaded) {
            UI.toast('Public IP lookup is unavailable from this network. Try again later.', 'warning', { title: 'Network tools' });
        }

        if (button) {
            button.disabled = false;
            if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
        }
    }

    function initNetwork() {
        $('#refresh-geo-location')?.addEventListener('click', refreshIdentity);
        $('#copyDoh')?.addEventListener('click', () => copyText(readTextContent('doh'), 'DoH endpoint copied.'));
    }

    function readTextContent(id) {
        return document.getElementById(id)?.textContent?.trim() || '';
    }

    /* WARP ----------------------------------------------------------------- */

    async function updateWarpAccounts() {
        if (!state.isPassSet) {
            openPasswordModal(true);
            return;
        }

        const confirmed = await UI.confirmDialog({
            title: 'Request fresh WARP accounts?',
            message: 'Cloudflare will register a new pair of WARP peers. Existing WARP subscriptions remain valid until clients refresh them.',
            confirmLabel: 'Refresh accounts',
            danger: false
        });
        if (!confirmed) return;

        const button = $('#warpUpdateBtn');
        setBusy(button, true, 'Registering…');
        try {
            await api('/panel/update-warp', { method: 'POST' });
            UI.toast('Fresh WARP accounts are ready. Refresh WARP subscriptions on your clients.', 'success', {
                title: 'WARP updated'
            });
        } catch (error) {
            toastError(error, 'Unable to update WARP');
        } finally {
            setBusy(button, false);
        }
    }

    /* Copy helpers --------------------------------------------------------- */

    function initCopyButtons() {
        document.addEventListener('click', event => {
            const target = event.target.closest('[data-copy-target]');
            if (!target) return;
            const source = document.getElementById(target.dataset.copyTarget);
            if (source) copyText(source.textContent.trim(), 'Copied to clipboard.');
        });
    }

    /* Boot ----------------------------------------------------------------- */

    function initFormEvents() {
        elements.form?.addEventListener('input', event => {
            if (event.target.id === 'fragmentMode') return;
            if (event.target.closest('.noise-item') && state.currentTab === 'warp-pro') {
                markDirty();
                return;
            }
            markDirty();
        });

        elements.form?.addEventListener('change', event => {
            const target = event.target;

            if (target.id === 'fragmentMode') {
                handleFragmentModeChange();
            }

            if (target.id === 'VLConfigs' || target.id === 'TRConfigs') {
                if (!target.checked && !$('#VLConfigs').checked && !$('#TRConfigs').checked) {
                    target.checked = true;
                    UI.toast('At least one protocol must stay enabled.', 'warning');
                }
            }

            if (target.classList.contains('port-checkbox')) {
                const tls = $$('#tls-ports .port-checkbox:checked');
                if (!tls.length) {
                    target.checked = true;
                    UI.toast('At least one TLS port is required.', 'warning');
                }
            }

            markDirty();
        });

        $('#addUdpNoiseBtn')?.addEventListener('click', addNoise);
        elements.applyButton?.addEventListener('click', saveSettings);
        elements.resetSettingsBtn?.addEventListener('click', resetSettings);

        $('#exportSettingsBtn')?.addEventListener('click', exportSettings);
        $('#importSettingsBtn')?.addEventListener('click', () => {
            const input = $('#fileInput');
            if (!input) return;
            input.value = '';
            input.click();
        });
        $('#fileInput')?.addEventListener('change', event => importSettingsFile(event.target.files?.[0]));

        $('#warpUpdateBtn')?.addEventListener('click', updateWarpAccounts);
        $('#profileLogout')?.addEventListener('click', logout);
        $('#logout')?.addEventListener('click', logout);
        $('#cancelSettings')?.addEventListener('click', () => showView('overview'));

        window.addEventListener('beforeunload', event => {
            if (!state.initialSnapshot) return;
            try {
                if (JSON.stringify(serializeForm()) !== state.initialSnapshot) {
                    event.preventDefault();
                    event.returnValue = '';
                }
            } catch {
                // A serialization failure should not block navigation.
            }
        });
    }

    function initTabs() {
        // Tab buttons are wired in initNavigation; keep this hook for boot order clarity.
        activateTab('common', false);
    }

    async function boot() {
        initNavigation();
        initProfileMenu();
        initCommandPalette();
        initPasswordGuard();
        initSubscriptions();
        initQr();
        initNetwork();
        initCopyButtons();
        initFormEvents();
        initTabs();

        const hash = window.location.hash.slice(1);
        if (hash === 'routing') showView('routing', { hash: false });
        else if (VIEW_LABELS[hash]) showView(hash, { hash: false });
        else showView('overview', { hash: false });

        try {
            const response = await fetch('/panel/settings', {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });
            const payload = await response.json();

            if (!payload.success) {
                if (payload.status === 401) {
                    sessionExpired();
                    return;
                }
                throw new ApiError(payload.message || 'Unable to load panel settings.', payload.status);
            }

            const { proxySettings, isPassSet, subPath } = payload.body || {};
            state.isPassSet = Boolean(isPassSet);
            state.subPath = String(subPath || '');
            applySettings(proxySettings || {});
            renderSubscriptions();
            updateDashboard();

            if (elements.setupBanner) elements.setupBanner.hidden = state.isPassSet;

            if (!state.isPassSet) {
                openPasswordModal(true);
            }
        } catch (error) {
            toastError(error, 'Unable to load panel');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
}());
