(function () {
    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) el.textContent = value;
    }

    function todayLabel() {
        return new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        }).format(new Date());
    }

    async function toggleTaskDone(taskId, row) {
        try {
            const title = row?.dataset.title || '';
            const res = await fetch(`/api/items/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'done', content: title })
            });
            if (!res.ok) throw new Error('Could not update task');
            row?.classList.add('is-done');
            await loadDashboard();
        } catch (error) {
            console.error(error);
            if (typeof showToast === 'function') showToast('Could not update task', 'error');
        }
    }

    function renderUpNext(data) {
        const box = byId('home-upnext-body');
        if (!box) return;
        const upNext = data.up_next || {};
        const tasks = upNext.tasks || [];
        const title = upNext.list_title || 'No active project';
        const progress = Number(upNext.progress || 0);
        const href = upNext.list_id ? `/list/${upNext.list_id}` : '/tasks';
        box.innerHTML = `
            <a class="home-upnext__title" href="${href}">${title}</a>
            <div class="home-upnext__meta">${progress}% complete</div>
            <div class="home-upnext__list"></div>
        `;
        const list = box.querySelector('.home-upnext__list');
        if (!tasks.length) {
            list.innerHTML = '<div class="home-upnext__item">No open tasks here.</div>';
            return;
        }
        tasks.forEach((task) => {
            const row = document.createElement('button');
            row.className = 'home-upnext__item';
            row.type = 'button';
            row.dataset.title = task.title || '';
            row.innerHTML = `<span class="check" aria-hidden="true"></span><span>${task.title || 'Untitled task'}</span>`;
            row.addEventListener('click', () => toggleTaskDone(task.id, row));
            list.appendChild(row);
        });
    }

    async function loadDashboard() {
        try {
            const [dashboardRes, userRes] = await Promise.all([
                fetch('/api/dashboard'),
                fetch('/api/current-user')
            ]);
            if (!dashboardRes.ok) throw new Error('Dashboard unavailable');
            const dashboard = await dashboardRes.json();
            const user = userRes.ok ? await userRes.json() : {};
            setText('home-date', todayLabel());
            setText('home-greeting-name', user.username ? `Good morning, ${user.username}` : 'Good morning');
            setText('home-stat-tasks', dashboard.counts?.open_tasks ?? 0);
            setText('home-stat-events', dashboard.counts?.events_today ?? 0);
            setText('home-stat-reminders', dashboard.counts?.reminders ?? 0);
            renderUpNext(dashboard);

            const modules = dashboard.modules || {};
            Object.entries(modules).forEach(([key, value]) => {
                const el = document.querySelector(`[data-home-module-meta="${key}"]`);
                if (el) el.textContent = value;
            });
        } catch (error) {
            console.error(error);
            setText('home-date', todayLabel());
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDashboard);
    } else {
        loadDashboard();
    }
})();
