/* Technamooz Panel — users management controller */
(function () {
    'use strict';

    const UI = window.TechnamoozUI;
    if (!UI) return;

    const elements = {
        tableBody: document.getElementById('usersTableBody'),
        search: document.getElementById('searchUsers'),
        userCount: document.getElementById('userCount'),
        addUserModal: document.getElementById('addUserModal'),
        addUserForm: document.getElementById('addUserForm'),
        addUserError: document.getElementById('addUserError'),
        openAddUser: document.getElementById('openAddUser')
    };

    const state = {
        users: [],
        loading: false,
        searchTerm: ''
    };

    const roleLabels = {
        admin: 'مدیر کل',
        user: 'کاربر',
        viewer: 'مشاهده‌گر'
    };
    const statusLabels = {
        active: 'فعال',
        suspended: 'موقتی غیرفعال',
        pending: 'در انتظار'
    };
    const statusClasses = {
        active: 'badge-success',
        suspended: 'badge-warning',
        pending: 'badge-accent'
    };

    function setBusy(busy) {
        state.loading = busy;
        if (elements.openAddUser) elements.openAddUser.disabled = busy;
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

    async function loadUsers() {
        setBusy(true);
        try {
            const users = await api('/panel/users');
            state.users = users;
            render();
        } catch (error) {
            UI.toast(error.message || 'Unable to load users.', 'error', { title: 'Users' });
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
        if (elements.userCount) elements.userCount.textContent = '— کاربر';
    }

    function render() {
        if (!elements.tableBody) return;

        const term = state.searchTerm.toLowerCase();
        const filtered = state.users.filter(u =>
            u.username.toLowerCase().includes(term) ||
            (u.email || '').toLowerCase().includes(term)
        );

        if (elements.userCount) elements.userCount.textContent = `${filtered.length} کاربر`;

        if (!filtered.length) {
            elements.tableBody.innerHTML = `
                <tr class="state-row">
                    <td colspan="7">
                        <span class="state-mark"><svg class="icon" aria-hidden="true"><use href="#i-search"></use></svg></span>
                        <span><strong>نتیجه‌ای یافت نشد</strong><small>عبارت جستجوی دیگری امتحان کنید.</small></span>
                    </td>
                </tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach((user, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="index-cell">${String(index + 1).padStart(2, '0')}</td>
                <td>
                    <div class="user-cell">
                        <span class="user-avatar">${user.username.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${UI.escapeHtml(user.username)}</span>
                        ${user.email ? `<span class="user-email">${UI.escapeHtml(user.email)}</span>` : ''}
                    </div>
                </td>
                <td>
                    <span class="badge badge-accent">${UI.escapeHtml(roleLabels[user.role] || user.role)}</span>
                </td>
                <td>
                    <span class="badge ${statusClasses[user.status] || 'badge'}">${UI.escapeHtml(statusLabels[user.status] || user.status)}</span>
                </td>
                <td class="mono small">${user.lastLogin ? new Date(user.lastLogin).toLocaleString('fa-IR') : '—'}</td>
                <td class="mono">${user.subscriptionCount ?? 0}</td>
                <td class="col-action">
                    <button class="icon-btn row-action" type="button" data-action="edit" data-id="${user.id}" title="ویرایش">${UI.icon('edit')}</button>
                    <button class="icon-btn row-action danger" type="button" data-action="delete" data-id="${user.id}" title="حذف">${UI.icon('trash')}</button>
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
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            if (action === 'delete') {
                const user = state.users.find(u => u.id === id);
                if (!user) return;
                const confirmed = await UI.confirmDialog({
                    title: 'حذف کاربر؟',
                    message: `کاربر "${UI.escapeHtml(user.username)}" دائمی حذف می‌شود.`,
                    confirmLabel: 'حذف',
                    danger: true
                });
                if (!confirmed) return;
                try {
                    await api(`/panel/users/${id}`, { method: 'DELETE' });
                    state.users = state.users.filter(u => u.id !== id);
                    render();
                    UI.toast('کاربر با موفقیت حذف شد.', 'success');
                } catch (error) {
                    UI.toast(error.message || 'Unable to delete user.', 'error');
                }
            }
        });
    }

    elements.search?.addEventListener('input', event => {
        state.searchTerm = event.target.value.trim();
        render();
    });

    elements.openAddUser?.addEventListener('click', () => {
        if (elements.addUserForm) elements.addUserForm.reset();
        if (elements.addUserError) elements.addUserError.textContent = '';
        UI.openModal(elements.addUserModal);
    });

    elements.addUserForm?.addEventListener('submit', async event => {
        event.preventDefault();
        if (elements.addUserError) elements.addUserError.textContent = '';

        const formData = new FormData(elements.addUserForm);
        const body = {
            username: formData.get('username'),
            email: formData.get('email') || undefined,
            role: formData.get('role'),
            status: formData.get('status')
        };

        try {
            setBusy(true);
            const user = await api('/panel/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            state.users.push(user);
            render();
            UI.closeModal(elements.addUserModal);
            UI.toast('کاربر با موفقیت ایجاد شد.', 'success');
        } catch (error) {
            if (elements.addUserError) elements.addUserError.textContent = error.message || 'Unable to create user.';
            elements.addUserError?.classList.toggle('is-visible', true);
        } finally {
            setBusy(false);
        }
    });

    UI.ready(() => {
        initTableActions();
        loadUsers();
    });
}());