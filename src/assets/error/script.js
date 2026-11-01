/* Technamooz Panel — runtime error screen */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    const retry = document.getElementById('retryButton');
    const copyButton = document.getElementById('copyError');
    const message = document.getElementById('errorMessage');

    retry?.addEventListener('click', () => {
        retry.disabled = true;
        retry.innerHTML = `${UI ? UI.icon('refresh', 'spin') : ''}<span>Reconnecting…</span>`;
        window.location.reload();
    });

    copyButton?.addEventListener('click', async () => {
        if (!UI) return;

        const idleHtml = copyButton.innerHTML;

        try {
            await UI.copy(message?.textContent || 'Unknown error');
            copyButton.innerHTML = `${UI.icon('check')} Copied`;
            UI.toast('Error details copied to your clipboard.', 'success', {
                title: 'Copied',
                duration: 2600
            });
            window.setTimeout(() => {
                copyButton.innerHTML = idleHtml;
            }, 1600);
        } catch (error) {
            UI.toast(error.message || 'Clipboard access is unavailable.', 'error', {
                title: 'Copy failed'
            });
        }
    });
}());
