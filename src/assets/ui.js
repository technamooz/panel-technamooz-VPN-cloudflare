/* Technamooz shared UI helpers: theme, toasts, dialogs, clipboard. */
(function () {
    'use strict';

    const THEME_KEY = 'technamooz-theme';
    const LEGACY_THEME_KEY = 'darkMode';

    function getTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') return stored;

        const legacy = localStorage.getItem(LEGACY_THEME_KEY);
        return legacy === 'disabled' ? 'light' : 'dark';
    }

    function syncThemeControls(theme) {
        const isDark = theme === 'dark';

        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
            button.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
            button.setAttribute('aria-pressed', String(isDark));
        });

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#070708' : '#f1ede9');
    }

    function setTheme(theme, persist = true) {
        const next = theme === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;

        if (persist) {
            localStorage.setItem(THEME_KEY, next);
            localStorage.removeItem(LEGACY_THEME_KEY);
        }

        syncThemeControls(next);
        return next;
    }

    function toggleTheme() {
        return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    function initTheme() {
        setTheme(getTheme(), false);
        document.addEventListener('click', event => {
            if (event.target.closest('[data-theme-toggle]')) {
                event.preventDefault();
                toggleTheme();
            }
        });
    }

    function icon(name, className = '') {
        return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function getToastStack() {
        let stack = document.querySelector('.toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'toast-stack';
            stack.setAttribute('aria-live', 'polite');
            stack.setAttribute('aria-atomic', 'false');
            document.body.appendChild(stack);
        }
        return stack;
    }

    function dismissToast(toast) {
        if (!toast || toast.classList.contains('is-leaving')) return;
        toast.classList.add('is-leaving');
        window.setTimeout(() => toast.remove(), 260);
    }

    function toast(message, type = 'info', options = {}) {
        const stack = getToastStack();
        const titles = {
            success: 'Done',
            error: 'Something went wrong',
            warning: 'Heads up',
            info: 'Notice'
        };
        const icons = {
            success: 'check-circle',
            error: 'alert',
            warning: 'alert',
            info: 'info'
        };
        const element = document.createElement('div');
        const duration = Number(options.duration ?? (type === 'error' ? 7600 : 4600));

        element.className = `toast ${type}`;
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
        element.innerHTML = `
            <span class="toast-icon">${icon(icons[type] || 'info')}</span>
            <div class="toast-body">
                <strong></strong>
                <p></p>
            </div>
            <button class="toast-close" type="button" aria-label="Dismiss notification">${icon('x')}</button>`;
        element.querySelector('strong').textContent = options.title || titles[type] || titles.info;
        element.querySelector('p').textContent = String(message ?? '');
        element.querySelector('.toast-close').addEventListener('click', () => dismissToast(element));
        stack.appendChild(element);

        if (duration > 0) {
            window.setTimeout(() => dismissToast(element), duration);
        }

        return element;
    }

    function openModal(target) {
        const modal = typeof target === 'string' ? document.getElementById(target) : target;
        if (!modal) return null;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('has-modal');
        const focusable = modal.querySelector('input:not([type="hidden"]), select, textarea, button');
        if (focusable) window.setTimeout(() => focusable.focus(), 60);
        return modal;
    }

    function closeModal(target) {
        const modal = typeof target === 'string' ? document.getElementById(target) : target;
        if (!modal) return;

        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');

        if (!document.querySelector('.modal.is-open')) {
            document.body.classList.remove('has-modal');
        }
    }

    function initModals() {
        document.addEventListener('click', event => {
            const closer = event.target.closest('[data-modal-close]');
            if (closer) {
                event.preventDefault();
                closeModal(closer.closest('.modal'));
                return;
            }

            if (event.target.classList.contains('modal')) {
                closeModal(event.target);
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            const open = [...document.querySelectorAll('.modal.is-open')].pop();
            if (open) closeModal(open);
        });
    }

    function confirmDialog(options = {}) {
        return new Promise(resolve => {
            const title = options.title || 'Are you sure?';
            const message = options.message || '';
            const confirmLabel = options.confirmLabel || 'Confirm';
            const cancelLabel = options.cancelLabel || 'Cancel';
            const danger = options.danger !== false;

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
                    <div class="modal-icon">${icon(danger ? 'alert' : 'info')}</div>
                    <div class="modal-head">
                        <div>
                            <h2 id="confirm-title"></h2>
                            <p></p>
                        </div>
                        <button class="modal-close" type="button" data-confirm-cancel aria-label="Close">${icon('x')}</button>
                    </div>
                    <div class="modal-foot">
                        <button class="btn btn-ghost" type="button" data-confirm-cancel></button>
                        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm-ok></button>
                    </div>
                </div>`;

            modal.querySelector('h2').textContent = title;
            modal.querySelector('p').textContent = message;
            modal.querySelector('.btn-ghost').textContent = cancelLabel;
            modal.querySelector('[data-confirm-ok]').textContent = confirmLabel;
            document.body.appendChild(modal);

            const finish = value => {
                closeModal(modal);
                window.setTimeout(() => modal.remove(), 250);
                resolve(value);
            };

            modal.querySelectorAll('[data-confirm-cancel]').forEach(button => {
                button.addEventListener('click', () => finish(false));
            });
            modal.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
            modal.addEventListener('click', event => {
                if (event.target === modal) finish(false);
            });
            modal.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    event.stopImmediatePropagation();
                    finish(false);
                }
            });

            openModal(modal);
        });
    }

    async function copy(text) {
        const value = String(text ?? '');
        if (!value) throw new Error('Nothing to copy.');

        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            const area = document.createElement('textarea');
            area.value = value;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            area.style.pointerEvents = 'none';
            document.body.appendChild(area);
            area.select();
            area.setSelectionRange(0, area.value.length);
            const copied = document.execCommand('copy');
            area.remove();
            if (!copied) throw new Error('Clipboard access is unavailable.');
            return true;
        }
    }

    function downloadBlob(content, filename, type = 'application/octet-stream') {
        const blob = content instanceof Blob ? content : new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function ready(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    initTheme();
    initModals();

    window.TechnamoozUI = {
        getTheme,
        setTheme,
        toggleTheme,
        icon,
        escapeHtml,
        toast,
        openModal,
        closeModal,
        confirmDialog,
        copy,
        downloadBlob,
        ready
    };
}());
