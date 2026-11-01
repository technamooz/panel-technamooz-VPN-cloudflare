/* Technamooz Panel — backup/restore controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        createBackup: document.getElementById('createBackup'),
        backupFile: document.getElementById('backupFile'),
        pickBackupFile: document.getElementById('pickBackupFile'),
        restoreBackup: document.getElementById('restoreBackup')
    };

    const state = { backupData: null };

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

    async function createBackupData() {
        try {
            const backup = await api('/panel/backup');
            state.backupData = backup;
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `technamooz-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            UI.toast('بکاپ با موفقیت دریافت شد.', 'success');
        } catch (error) {
            UI.toast(error.message || 'Unable to create backup.', 'error', { title: 'Backup' });
        }
    }

    async function restoreBackupData() {
        const file = elements.backupFile.files?.[0];
        if (!file) return;

        const confirmed = await UI.confirmDialog({
            title: 'تایید بازگردانی',
            message: 'بازگردانی بکاپ تنظیمات فعلی پنل را جایگزین می‌کند. آیا مطمئن هستید؟',
            confirmLabel: 'بازگردانی',
            danger: true
        });
        if (!confirmed) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await api('/panel/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            UI.toast('بکاپ با موفقیت بازگردانی شد. لطفا صفحه را رفرش کنید.', 'success');
            elements.restoreBackup.disabled = true;
            elements.backupFile.value = '';
        } catch (error) {
            UI.toast(error.message || 'Unable to restore backup.', 'error', { title: 'Restore' });
        }
    }

    elements.createBackup?.addEventListener('click', createBackupData);
    elements.pickBackupFile?.addEventListener('click', () => elements.backupFile.click());
    elements.backupFile?.addEventListener('change', () => {
        elements.restoreBackup.disabled = !elements.backupFile.files?.[0];
    });
    elements.restoreBackup?.addEventListener('click', restoreBackupData);
}());