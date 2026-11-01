/* Technamooz Panel — secrets generator */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    const uuidOutput = document.getElementById('uuid');
    const passwordOutput = document.getElementById('tr-password');
    const subPathOutput = document.getElementById('sub-path');
    const regenerate = document.getElementById('regenerateBtn');
    let values = {};

    const randomIndexes = length => {
        const bytes = crypto.getRandomValues(new Uint8Array(length));
        return [...bytes];
    };

    function randomFrom(charset, length) {
        return randomIndexes(length).map(index => charset[index % charset.length]).join('');
    }

    function generateUUID() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function generatePassword() {
        const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lower = 'abcdefghijkmnopqrstuvwxyz';
        const digits = '23456789';
        const symbols = '!@#$%^&*_-+=';
        const all = upper + lower + digits + symbols;
        const required = [
            upper[randomIndexes(1)[0] % upper.length],
            lower[randomIndexes(1)[0] % lower.length],
            digits[randomIndexes(1)[0] % digits.length],
            symbols[randomIndexes(1)[0] % symbols.length]
        ];
        const shuffled = [...required, ...randomFrom(all, 20).split('')];

        for (let index = shuffled.length - 1; index > 0; index--) {
            const swap = randomIndexes(1)[0] % (index + 1);
            [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
        }
        return shuffled.join('');
    }

    function generateSubPath() {
        return randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', 28);
    }

    function generate() {
        values = {
            uuid: generateUUID(),
            password: generatePassword(),
            subPath: generateSubPath()
        };
        uuidOutput.textContent = values.uuid;
        passwordOutput.textContent = values.password;
        subPathOutput.textContent = values.subPath;
    }

    function envFile() {
        return `UUID=${values.uuid}\nTR_PASS=${values.password}\nSUB_PATH=${values.subPath}\n`;
    }

    async function copyValue(value, message) {
        try {
            await UI.copy(value);
            UI.toast(message, 'success');
            return true;
        } catch (error) {
            UI.toast(error.message || 'Clipboard access is unavailable.', 'error');
            return false;
        }
    }

    document.querySelectorAll('[data-copy-secret]').forEach(button => {
        button.addEventListener('click', async () => {
            const key = button.dataset.copySecret;
            const value = values[key === 'tr-password' ? 'password' : key === 'sub-path' ? 'subPath' : 'uuid'];
            if (!value) return;
            const copied = await copyValue(value, 'Secret copied to clipboard.');
            if (!copied) return;
            const original = button.innerHTML;
            button.classList.add('is-copied');
            button.innerHTML = UI.icon('check');
            window.setTimeout(() => {
                button.classList.remove('is-copied');
                button.innerHTML = original;
            }, 1600);
        });
    });

    document.getElementById('copyAllBtn')?.addEventListener('click', () => {
        copyValue(envFile(), 'All environment secrets copied.');
    });

    document.getElementById('downloadEnvBtn')?.addEventListener('click', () => {
        UI.downloadBlob(envFile(), 'technamooz-secrets.env', 'text/plain;charset=utf-8');
        UI.toast('Secrets file downloaded. Store it somewhere safe.', 'success');
    });

    regenerate?.addEventListener('click', () => {
        generate();
        UI.toast('Fresh secrets generated in this browser.', 'info');
    });

    generate();
}());
