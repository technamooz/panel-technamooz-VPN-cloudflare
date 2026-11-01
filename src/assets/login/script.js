/* Technamooz Panel — login controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    const form = document.getElementById('loginForm');
    const password = document.getElementById('password');
    const errorBox = document.getElementById('passwordError');
    const submit = document.getElementById('loginSubmit');
    const toggle = document.getElementById('togglePassword');
    const setupLink = document.getElementById('setupLink');

    function showError(message) {
        errorBox.textContent = message;
        errorBox.classList.toggle('is-visible', Boolean(message));
        password?.focus();
    }

    function setBusy(busy) {
        if (busy) {
            submit.dataset.idleHtml = submit.dataset.idleHtml || submit.innerHTML;
            submit.disabled = true;
            submit.innerHTML = `${UI.icon('refresh', 'spin')} Verifying…`;
        } else {
            if (submit.dataset.idleHtml) submit.innerHTML = submit.dataset.idleHtml;
            submit.disabled = false;
        }
    }

    toggle?.addEventListener('click', () => {
        const visible = password.type === 'text';
        password.type = visible ? 'password' : 'text';
        toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
        toggle.innerHTML = UI.icon(visible ? 'eye' : 'eye-off');
        password.focus();
    });

    form?.addEventListener('submit', async event => {
        event.preventDefault();
        showError('');

        const value = password.value.trim();
        if (!value) {
            showError('Enter the panel password.');
            return;
        }

        setBusy(true);
        try {
            const response = await fetch('/login/authenticate', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'text/plain' },
                body: value
            });
            const payload = await response.json();

            if (!payload.success) {
                const message = payload.message || 'Wrong password.';
                if (/no panel password/i.test(message)) {
                    if (setupLink) setupLink.hidden = false;
                }
                if (payload.status === 429) {
                    throw new Error('Too many attempts. Wait a few minutes before trying again.');
                }
                throw new Error(message);
            }

            password.value = '';
            window.location.assign('/panel');
        } catch (error) {
            showError(error.message || 'Unable to sign in.');
        } finally {
            setBusy(false);
        }
    });

    try {
        const flash = sessionStorage.getItem('technamooz-flash');
        if (flash) {
            sessionStorage.removeItem('technamooz-flash');
            const notice = JSON.parse(flash);
            if (notice?.message) {
                UI.toast(notice.message, notice.type || 'success', {
                    title: notice.title || 'Technamooz Panel',
                    duration: 6200
                });
            }
        }
    } catch {
        // Ignore unavailable storage in privacy-restricted browsers.
    }
}());
