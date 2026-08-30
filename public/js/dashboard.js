function refreshIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-box');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.2s ease';
        setTimeout(() => toast.remove(), 200);
    }, 4000);
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = String(Math.floor(s / 3600)).padStart(2, '0');
    const mins = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
}

// ==================== DASHBOARD HOME CONTROLS ====================

function mountTrainingControls() {
    const trigger = document.querySelector('[data-training-trigger]');
    const submenu = document.querySelector('[data-training-submenu]');
    if (!trigger || !submenu) return;

    trigger.addEventListener('click', () => {
        const isHidden = submenu.style.display === 'none';
        submenu.style.display = isHidden ? 'flex' : 'none';
        trigger.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });
}

// ==================== SESSION PANEL CONTROLLER ====================

function mountSessionPanel() {
    const dataNode = document.querySelector('#initial-session-data');
    if (!dataNode) return;

    const payload = JSON.parse(dataNode.textContent);
    let state = {
        waveState: payload.waveState || {},
        session: payload.session || {},
        activeStaff: payload.activeStaff || [],
        currentSessionNotes: payload.currentSessionNotes || [],
        currentUser: payload.currentUser || 'Staff',
        autocompleteItems: [],
        autocompleteIndex: -1
    };

    const refs = {
        inactiveView: document.getElementById('session-inactive-view'),
        activeView: document.getElementById('session-active-view'),
        startSessionBtn: document.getElementById('start-session-btn'),
        endSessionBtn: document.getElementById('end-session-btn'),
        refreshDataBtn: document.getElementById('refresh-session-data-btn'),
        sessionTitleTag: document.getElementById('session-title-tag'),
        liveTimer: document.getElementById('session-live-timer'),
        staffCount: document.getElementById('staff-count'),
        staffList: document.getElementById('staff-list-container'),
        playerCount: document.getElementById('player-count'),
        playerSearchInput: document.getElementById('player-search-input'),
        playerList: document.getElementById('player-list-container'),
        usernameInput: document.getElementById('trainee-username-input'),
        autocompletePopover: document.getElementById('autocomplete-popover'),
        outcomeInput: document.getElementById('note-outcome-input'),
        noteContentInput: document.getElementById('note-content-input'),
        noteForm: document.getElementById('note-composer-form'),
        clearNoteBtn: document.getElementById('clear-note-btn'),
        noteFeed: document.getElementById('session-note-feed'),
        sessionNoteCount: document.getElementById('session-note-count'),
        
        // Kick Modal
        kickModal: document.getElementById('session-kick-modal'),
        kickForm: document.getElementById('session-kick-form'),
        kickUsernameInput: document.getElementById('kick-target-username'),
        kickReasonInput: document.getElementById('kick-reason-text')
    };

    let timerInterval = null;

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        const startedAt = state.waveState.activeSessionStartedAt;
        if (!startedAt || !state.waveState.isSessionActive) {
            if (refs.liveTimer) refs.liveTimer.textContent = '00:00:00';
            return;
        }

        const startTimestamp = new Date(startedAt).getTime();
        const update = () => {
            const diff = (Date.now() - startTimestamp) / 1000;
            if (refs.liveTimer) refs.liveTimer.textContent = formatDuration(diff);
        };
        update();
        timerInterval = setInterval(update, 1000);
    }

    function renderPlayers() {
        if (!refs.playerList) return;
        const query = (refs.playerSearchInput?.value || '').toLowerCase().trim();
        const players = (state.session?.players || []).filter((p) => {
            const full = `${p.username} ${p.displayName} ${p.callsign}`.toLowerCase();
            return full.includes(query);
        });

        if (refs.playerCount) refs.playerCount.textContent = state.session?.players?.length || 0;

        if (!players.length) {
            refs.playerList.innerHTML = '<div class="empty-box" style="padding: 16px;">No players in game.</div>';
            return;
        }

        refs.playerList.innerHTML = '';
        players.forEach((p) => {
            const div = document.createElement('div');
            div.className = 'player-item';
            div.innerHTML = `
                <div class="player-left">
                    ${p.avatarUrl ? `<img class="player-avatar" src="${p.avatarUrl}" alt="">` : `<div class="player-avatar" style="display: grid; place-items: center; font-size: 11px; font-weight: 700;">${(p.username || 'P')[0].toUpperCase()}</div>`}
                    <div class="player-meta">
                        <strong>${p.username}</strong>
                        <small>${p.team || 'Player'}${p.callsign ? ` - ${p.callsign}` : ''}</small>
                    </div>
                </div>
                <button class="btn-kick-icon" type="button" title="Kick from Session">
                    <i data-lucide="user-x"></i>
                </button>
            `;

            div.addEventListener('click', (e) => {
                if (e.target.closest('.btn-kick-icon')) return;
                refs.usernameInput.value = p.username;
                hideAutocomplete();
                refs.noteContentInput.focus();
            });

            div.querySelector('.btn-kick-icon').addEventListener('click', (e) => {
                e.stopPropagation();
                openKickModal(p.username, p.robloxId);
            });

            refs.playerList.appendChild(div);
        });
        refreshIcons();
    }

    function renderFeed() {
        if (!refs.noteFeed) return;
        const notes = state.currentSessionNotes || [];
        if (refs.sessionNoteCount) refs.sessionNoteCount.textContent = notes.length;

        if (!notes.length) {
            refs.noteFeed.innerHTML = '<div class="empty-box" id="empty-feed-msg">No notes logged yet for this session.</div>';
            return;
        }

        refs.noteFeed.innerHTML = '';
        notes.forEach((note) => {
            const div = document.createElement('div');
            div.className = 'note-entry';
            div.setAttribute('data-outcome', note.outcome || 'neutral');
            div.innerHTML = `
                <div class="note-entry-top">
                    <strong>${note.traineeUsername}</strong>
                    <small>${new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <div class="note-entry-body">${note.content}</div>
                <div class="note-entry-footer">
                    <span class="badge badge-${note.outcome || 'neutral'}">${note.outcome}</span>
                    <small style="color: var(--text-dim);">By ${note.staffUsername}</small>
                </div>
            `;
            refs.noteFeed.appendChild(div);
        });
        refreshIcons();
    }

    // Auto-Complete
    async function fetchAutocomplete(q) {
        try {
            const res = await fetch(`/dashboard/api/autocomplete?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            state.autocompleteItems = data.candidates || [];
            state.autocompleteIndex = -1;
            renderAutocomplete();
        } catch (err) {
            hideAutocomplete();
        }
    }

    function renderAutocomplete() {
        if (!refs.autocompletePopover) return;
        if (!state.autocompleteItems.length) {
            hideAutocomplete();
            return;
        }

        refs.autocompletePopover.innerHTML = '';
        state.autocompleteItems.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = `autocomplete-row ${idx === state.autocompleteIndex ? 'selected' : ''}`;
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${item.avatarUrl ? `<img src="${item.avatarUrl}" alt="">` : ''}
                    <strong>${item.username}</strong>
                </div>
                <span class="badge badge-soon" style="font-size: 9px;">${item.badge}</span>
            `;
            row.addEventListener('click', () => {
                refs.usernameInput.value = item.username;
                hideAutocomplete();
                refs.noteContentInput.focus();
            });
            refs.autocompletePopover.appendChild(row);
        });
        refs.autocompletePopover.style.display = 'flex';
    }

    function hideAutocomplete() {
        if (refs.autocompletePopover) refs.autocompletePopover.style.display = 'none';
        state.autocompleteIndex = -1;
    }

    if (refs.usernameInput) {
        refs.usernameInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val.length > 0) fetchAutocomplete(val);
            else hideAutocomplete();
        });

        refs.usernameInput.addEventListener('keydown', (e) => {
            if (refs.autocompletePopover.style.display !== 'flex') return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.autocompleteIndex = Math.min(state.autocompleteIndex + 1, state.autocompleteItems.length - 1);
                renderAutocomplete();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.autocompleteIndex = Math.max(state.autocompleteIndex - 1, 0);
                renderAutocomplete();
            } else if (e.key === 'Enter' && state.autocompleteIndex >= 0) {
                e.preventDefault();
                const chosen = state.autocompleteItems[state.autocompleteIndex];
                if (chosen) {
                    refs.usernameInput.value = chosen.username;
                    hideAutocomplete();
                    refs.noteContentInput.focus();
                }
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.form-field')) hideAutocomplete();
    });

    // Start Session Action
    if (refs.startSessionBtn) {
        refs.startSessionBtn.addEventListener('click', async () => {
            refs.startSessionBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/session/start', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.waveState = data.waveState;
                    refs.inactiveView.style.display = 'none';
                    refs.activeView.style.display = 'block';
                    refs.sessionTitleTag.textContent = `Wave ${state.waveState.currentWave} — Session ${state.waveState.activeSessionNumber}`;
                    startTimer();
                    refreshSessionData({ force: true });
                    showToast(`Session ${state.waveState.activeSessionNumber} started.`, 'success');
                }
            } catch (err) {
                showToast('Failed to start session.', 'error');
            } finally {
                refs.startSessionBtn.disabled = false;
            }
        });
    }

    // End Session Action
    if (refs.endSessionBtn) {
        refs.endSessionBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to end this training session? Live feed will be archived.')) return;
            refs.endSessionBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/session/end', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.waveState = data.waveState;
                    state.currentSessionNotes = [];
                    refs.activeView.style.display = 'none';
                    refs.inactiveView.style.display = 'flex';
                    refs.startSessionBtn.querySelector('span').textContent = `Start Session ${state.waveState.activeSessionNumber}`;
                    if (timerInterval) clearInterval(timerInterval);
                    showToast(`Session ended. Duration: ${formatDuration(data.sessionRecord.durationSeconds)}`, 'info');
                }
            } catch (err) {
                showToast('Failed to end session.', 'error');
            } finally {
                refs.endSessionBtn.disabled = false;
            }
        });
    }

    // Note form submission
    if (refs.noteForm) {
        refs.noteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = refs.usernameInput.value.trim();
            const content = refs.noteContentInput.value.trim();
            const outcome = refs.outcomeInput.value;

            if (!username || !content) return;

            try {
                const res = await fetch('/dashboard/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ traineeUsername: username, content, outcome })
                });
                const data = await res.json();
                if (data.ok) {
                    state.currentSessionNotes = data.currentSessionNotes;
                    refs.noteContentInput.value = '';
                    renderFeed();
                    showToast(`Note logged for ${username}.`, 'success');
                }
            } catch (err) {
                showToast('Failed to save note.', 'error');
            }
        });
    }

    if (refs.clearNoteBtn) {
        refs.clearNoteBtn.addEventListener('click', () => {
            refs.usernameInput.value = '';
            refs.noteContentInput.value = '';
            refs.outcomeInput.value = 'neutral';
        });
    }

    // Kick Modal Handlers
    let activeKickTarget = null;
    function openKickModal(username, robloxId) {
        activeKickTarget = { username, robloxId };
        refs.kickUsernameInput.value = username;
        refs.kickReasonInput.value = '';
        refs.kickModal.classList.add('open');
        refs.kickReasonInput.focus();
    }

    function closeKickModal() {
        if (refs.kickModal) refs.kickModal.classList.remove('open');
        activeKickTarget = null;
    }

    if (refs.kickForm) {
        refs.kickForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeKickTarget) return;
            const reason = refs.kickReasonInput.value.trim();
            const submitBtn = refs.kickForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            try {
                const res = await fetch('/dashboard/api/session/kick', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: activeKickTarget.username,
                        robloxId: activeKickTarget.robloxId,
                        reason
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    state.currentSessionNotes = data.currentSessionNotes;
                    renderFeed();
                    showToast(`Kicked ${activeKickTarget.username} from session.`, 'success');
                    closeKickModal();
                    refreshSessionData({ force: true });
                } else {
                    showToast(data.error || 'Kick failed.', 'error');
                }
            } catch (err) {
                showToast('Error executing kick.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    if (refs.playerSearchInput) {
        refs.playerSearchInput.addEventListener('input', renderPlayers);
    }

    if (refs.refreshDataBtn) {
        refs.refreshDataBtn.addEventListener('click', () => {
            refreshSessionData({ force: true });
            showToast('Refreshing live data...', 'info');
        });
    }

    async function refreshSessionData({ force = false } = {}) {
        if (!state.waveState.isSessionActive && !force) return;
        try {
            const res = await fetch(`/dashboard/api/session/data${force ? '?force=true' : ''}`);
            if (!res.ok) return;
            const data = await res.json();
            state.waveState = data.waveState || state.waveState;
            state.session = data.session || state.session;
            state.activeStaff = data.activeStaff || state.activeStaff;
            state.currentSessionNotes = data.currentSessionNotes || state.currentSessionNotes;
            renderPlayers();
            renderFeed();
        } catch (err) {}
    }

    // Modal close triggers
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closeKickModal);
    });

    // Initialize
    if (state.waveState.isSessionActive) {
        startTimer();
        renderPlayers();
        renderFeed();
    }

    setInterval(() => refreshSessionData(), 6000);
}

// ==================== WAVE MANAGEMENT CONTROLLER ====================

function mountWaveManagement() {
    const dataNode = document.querySelector('#wave-bootstrap-data');
    if (!dataNode) return;

    const payload = JSON.parse(dataNode.textContent);
    let state = {
        waveState: payload.waveState || {},
        trainees: payload.trainees || [],
        formerWaves: payload.formerWaves || [],
        kickedTrainees: payload.kickedTrainees || [],
        activeNotesTrainee: null,
        activeKickTrainee: null,
        evaluatedBatch: []
    };

    const refs = {
        traineeGrid: document.getElementById('trainee-grid-container'),
        searchInput: document.getElementById('wave-search-input'),
        sortSelect: document.getElementById('wave-sort-select'),
        syncBtn: document.getElementById('sync-wave-btn'),
        finishWaveBtn: document.getElementById('finish-wave-btn'),
        openHistoryBtn: document.getElementById('open-history-btn'),
        openAiEvalBtn: document.getElementById('open-ai-eval-btn'),
        activeTraineeCount: document.getElementById('active-trainee-count'),

        // Notes Modal
        notesModal: document.getElementById('notes-modal'),
        notesTitle: document.getElementById('notes-modal-title'),
        notesSubtitle: document.getElementById('notes-modal-subtitle'),
        notesContainer: document.getElementById('notes-by-session-container'),
        quickNoteForm: document.getElementById('modal-quick-note-form'),
        hiddenUsername: document.getElementById('modal-hidden-username'),
        noteTextInput: document.getElementById('modal-note-text'),
        outcomeSelect: document.getElementById('modal-outcome-select'),

        // Kick Modal
        kickModal: document.getElementById('kick-trainee-modal'),
        kickForm: document.getElementById('kick-trainee-form'),
        kickDiscordIdInput: document.getElementById('kick-trainee-discord-id'),
        kickRobloxNameInput: document.getElementById('kick-trainee-roblox-name'),
        kickReasonInput: document.getElementById('kick-trainee-reason-input'),

        // AI Modal
        aiModal: document.getElementById('ai-eval-modal'),
        aiLoading: document.getElementById('ai-loading-box'),
        aiContent: document.getElementById('ai-results-content'),
        aiList: document.getElementById('ai-results-list'),
        finalizeBtn: document.getElementById('finalize-wave-btn'),

        // History Modal
        historyModal: document.getElementById('history-modal')
    };

    function sortAndRenderTrainees() {
        if (!refs.traineeGrid) return;
        const query = (refs.searchInput?.value || '').toLowerCase().trim();
        const sortType = refs.sortSelect?.value || 'newest';

        let filtered = state.trainees.filter((t) => {
            const full = `${t.robloxUsername} ${t.discordTag}`.toLowerCase();
            return full.includes(query);
        });

        filtered.sort((a, b) => {
            if (sortType === 'most_notes') return ((b.notes || []).length) - ((a.notes || []).length);
            if (sortType === 'least_notes') return ((a.notes || []).length) - ((b.notes || []).length);
            if (sortType === 'pass') return (a.evaluation?.decision === 'PASS' ? -1 : 1);
            if (sortType === 'fail') return (a.evaluation?.decision === 'FAIL' ? -1 : 1);
            return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
        });

        if (refs.activeTraineeCount) {
            refs.activeTraineeCount.textContent = state.trainees.filter((t) => t.status !== 'kicked').length;
        }

        if (!filtered.length) {
            refs.traineeGrid.innerHTML = '<div class="empty-box" style="grid-column: 1 / -1; padding: 36px;">No candidates match your search or filter.</div>';
            return;
        }

        refs.traineeGrid.innerHTML = '';
        filtered.forEach((t) => {
            const isKicked = t.status === 'kicked';
            const notesCount = (t.notes || []).length;
            const evalVerdict = t.evaluation ? t.evaluation.decision : null;

            const card = document.createElement('div');
            card.className = `trainee-card ${isKicked ? 'kicked' : ''}`;
            card.innerHTML = `
                <div>
                    <div class="trainee-top">
                        <div class="avatar-stack">
                            ${t.avatarUrl ? `<img class="roblox-img" src="${t.avatarUrl}" alt="">` : `<div class="roblox-img" style="display: grid; place-items: center; font-weight: 700; font-size: 14px;">${(t.robloxUsername || 'T')[0].toUpperCase()}</div>`}
                            ${t.discordAvatar ? `<img class="discord-img" src="${t.discordAvatar}" alt="">` : ''}
                        </div>
                        <div class="trainee-meta">
                            <strong>${t.robloxUsername}</strong>
                            <small>${t.discordTag}</small>
                        </div>
                    </div>

                    <div class="trainee-status-row" style="margin-top: 10px;">
                        ${isKicked 
                            ? '<span class="badge badge-kicked">Kicked</span>'
                            : evalVerdict 
                                ? `<span class="badge badge-${evalVerdict.toLowerCase()}">${evalVerdict} (${t.evaluation.score}/100)</span>`
                                : '<span class="badge badge-neutral">Active</span>'}
                        <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">${notesCount} notes</span>
                    </div>
                </div>

                <div class="trainee-actions-row">
                    <button class="btn btn-secondary" type="button" data-check-notes-btn="${t.robloxUsername}" style="flex: 1; min-height: 32px; font-size: 12px;">
                        <i data-lucide="file-text"></i>
                        <span>Check Notes</span>
                    </button>
                    ${!isKicked ? `
                        <button class="btn btn-danger" type="button" data-kick-trainee-btn="${t.discordId}" data-roblox-name="${t.robloxUsername}" style="min-height: 32px; padding: 0 10px;" title="Kick from Discord & Wave">
                            <i data-lucide="user-x"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            card.querySelector('[data-check-notes-btn]').addEventListener('click', () => openNotesModal(t));
            if (!isKicked) {
                card.querySelector('[data-kick-trainee-btn]').addEventListener('click', () => openKickTraineeModal(t));
            }

            refs.traineeGrid.appendChild(card);
        });
        refreshIcons();
    }

    // Notes Modal: Separate strictly by session
    function openNotesModal(trainee) {
        state.activeNotesTrainee = trainee;
        refs.notesTitle.textContent = `${trainee.robloxUsername}'s Notes`;
        refs.notesSubtitle.textContent = `Discord: ${trainee.discordTag}`;
        refs.hiddenUsername.value = trainee.robloxUsername;
        renderNotesModalList();
        refs.notesModal.classList.add('open');
        refreshIcons();
    }

    function renderNotesModalList() {
        if (!state.activeNotesTrainee || !refs.notesContainer) return;
        const notes = state.activeNotesTrainee.notes || [];

        if (!notes.length) {
            refs.notesContainer.innerHTML = '<div class="empty-box" style="padding: 24px;">No notes recorded for this candidate yet.</div>';
            return;
        }

        // Group notes by session
        const grouped = {};
        notes.forEach((n) => {
            const s = n.sessionNumber || 1;
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(n);
        });

        refs.notesContainer.innerHTML = '';
        const sessionKeys = Object.keys(grouped).sort((a, b) => Number(b) - Number(a)); // Newest session first

        sessionKeys.forEach((sessNum) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'session-note-group';
            groupDiv.innerHTML = `<div class="session-note-group-title">Session ${sessNum} (${grouped[sessNum].length} notes)</div>`;

            const entriesList = document.createElement('div');
            entriesList.style.display = 'flex';
            entriesList.style.flexDirection = 'column';
            entriesList.style.gap = '8px';

            grouped[sessNum].forEach((note) => {
                const entry = document.createElement('div');
                entry.className = 'note-entry';
                entry.setAttribute('data-outcome', note.outcome || 'neutral');
                entry.innerHTML = `
                    <div class="note-entry-top">
                        <strong>Logged by ${note.staffUsername}</strong>
                        <small>${new Date(note.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                    <div class="note-entry-body">${note.content}</div>
                    <div class="note-entry-footer">
                        <span class="badge badge-${note.outcome || 'neutral'}">${note.outcome}</span>
                    </div>
                `;
                entriesList.appendChild(entry);
            });

            groupDiv.appendChild(entriesList);
            refs.notesContainer.appendChild(groupDiv);
        });
        refreshIcons();
    }

    // Quick Add Note from inside modal
    if (refs.quickNoteForm) {
        refs.quickNoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = refs.hiddenUsername.value;
            const content = refs.noteTextInput.value.trim();
            const outcome = refs.outcomeSelect.value;
            if (!username || !content) return;

            try {
                const res = await fetch('/dashboard/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ traineeUsername: username, content, outcome })
                });
                const data = await res.json();
                if (data.ok) {
                    if (!state.activeNotesTrainee.notes) state.activeNotesTrainee.notes = [];
                    state.activeNotesTrainee.notes.unshift(data.note);
                    refs.noteTextInput.value = '';
                    renderNotesModalList();
                    sortAndRenderTrainees();
                    showToast('Note added.', 'success');
                }
            } catch (err) {
                showToast('Failed to add note.', 'error');
            }
        });
    }

    // Kick Trainee Modal (DM -> Kick Discord -> Kicked DB)
    function openKickTraineeModal(trainee) {
        state.activeKickTrainee = trainee;
        refs.kickDiscordIdInput.value = trainee.discordId;
        refs.kickRobloxNameInput.value = trainee.robloxUsername;
        refs.kickReasonInput.value = '';
        refs.kickModal.classList.add('open');
        refs.kickReasonInput.focus();
    }

    if (refs.kickForm) {
        refs.kickForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!state.activeKickTrainee) return;

            const discordId = refs.kickDiscordIdInput.value;
            const reason = refs.kickReasonInput.value.trim();
            const submitBtn = refs.kickForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            try {
                const res = await fetch('/dashboard/api/waves/kick-trainee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        discordId,
                        robloxUsername: state.activeKickTrainee.robloxUsername,
                        robloxId: state.activeKickTrainee.robloxId,
                        reason
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    state.trainees = data.trainees;
                    sortAndRenderTrainees();
                    refs.kickModal.classList.remove('open');
                    showToast(`Kicked ${state.activeKickTrainee.robloxUsername} from Discord & Wave.`, 'success');
                } else {
                    showToast(data.error || 'Kick failed.', 'error');
                }
            } catch (err) {
                showToast('Error kicking trainee.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    // Sync Discord Trainees
    if (refs.syncBtn) {
        refs.syncBtn.addEventListener('click', async () => {
            refs.syncBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/waves/sync', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.trainees = data.trainees;
                    sortAndRenderTrainees();
                    showToast(`Synced ${data.count} candidates from Discord.`, 'success');
                }
            } catch (err) {
                showToast('Failed to sync.', 'error');
            } finally {
                refs.syncBtn.disabled = false;
            }
        });
    }

    // Finish Wave / Start New Wave
    if (refs.finishWaveBtn) {
        refs.finishWaveBtn.addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to finish Wave ${state.waveState.currentWave}? This will archive all active trainees and increment to Wave ${state.waveState.currentWave + 1}.`)) return;

            refs.finishWaveBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/waves/new', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    showToast(`Wave ${state.waveState.currentWave} finished and archived!`, 'success');
                    setTimeout(() => window.location.reload(), 800);
                }
            } catch (err) {
                showToast('Error finishing wave.', 'error');
            } finally {
                refs.finishWaveBtn.disabled = false;
            }
        });
    }

    // AI Evaluation Modal
    if (refs.openAiEvalBtn) {
        refs.openAiEvalBtn.addEventListener('click', async () => {
            refs.aiModal.classList.add('open');
            refs.aiLoading.style.display = 'block';
            refs.aiContent.style.display = 'none';

            try {
                const res = await fetch('/dashboard/api/waves/evaluate', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.evaluatedBatch = data.evaluations || [];
                    state.trainees = data.trainees || state.trainees;
                    renderAiBatchResults();
                    refs.aiLoading.style.display = 'none';
                    refs.aiContent.style.display = 'block';
                } else {
                    refs.aiModal.classList.remove('open');
                    showToast(data.error || 'Evaluation failed.', 'error');
                }
            } catch (err) {
                refs.aiModal.classList.remove('open');
                showToast('Network error running AI evaluation.', 'error');
            }
        });
    }

    function renderAiBatchResults() {
        if (!refs.aiList) return;
        refs.aiList.innerHTML = '';

        state.evaluatedBatch.forEach((ev) => {
            const isPass = ev.decision === 'PASS';
            const card = document.createElement('div');
            card.style.background = 'rgba(255, 255, 255, 0.02)';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = 'var(--radius-sm)';
            card.style.padding = '12px 14px';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="font-size: 15px;">${ev.traineeUsername}</strong>
                        <span class="badge badge-${isPass ? 'pass' : 'fail'}">${ev.decision}</span>
                        <span style="font-weight: 700; font-size: 13px;">${ev.score}/100</span>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn btn-secondary" type="button" data-override-btn="${ev.traineeUsername}" style="min-height: 28px; padding: 0 10px; font-size: 11px;">
                            <i data-lucide="edit-3"></i>
                            <span>Override</span>
                        </button>
                    </div>
                </div>

                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
                    <strong>Staff Summary:</strong> ${ev.summary || 'N/A'}
                </div>
                <div style="font-size: 12px; color: #60a5fa;">
                    <strong>DM Reason:</strong> ${ev.decisionReason || 'N/A'}
                </div>
            `;

            card.querySelector('[data-override-btn]').addEventListener('click', () => {
                const newDec = prompt(`Override verdict for ${ev.traineeUsername} (Type PASS or FAIL):`, ev.decision);
                if (!newDec || !['PASS', 'FAIL'].includes(newDec.toUpperCase())) return;
                const newReason = prompt(`Enter override reason for ${ev.traineeUsername}:`, `Staff override to ${newDec.toUpperCase()}`);
                
                fetch('/dashboard/api/waves/override', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        robloxUsername: ev.traineeUsername,
                        newDecision: newDec.toUpperCase(),
                        newReason: newReason || 'Staff manual override'
                    })
                }).then(r => r.json()).then(data => {
                    if (data.ok) {
                        ev.decision = newDec.toUpperCase();
                        ev.decisionReason = newReason;
                        renderAiBatchResults();
                        sortAndRenderTrainees();
                        showToast(`Override logged for ${ev.traineeUsername}.`, 'info');
                    }
                });
            });

            refs.aiList.appendChild(card);
        });
        refreshIcons();
    }

    // Finalize Wave (DMs, Roles, Kicks, Archives)
    if (refs.finalizeBtn) {
        refs.finalizeBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to finalize the wave? This will send Discord DMs, assign roles to graduates, kick failed candidates, and archive the wave.')) return;

            refs.finalizeBtn.disabled = true;
            refs.finalizeBtn.textContent = 'Processing Finalization...';

            try {
                const res = await fetch('/dashboard/api/waves/finalize', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    showToast('Wave finalized and archived successfully!', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showToast(data.error || 'Finalize failed.', 'error');
                }
            } catch (err) {
                showToast('Error finalizing wave.', 'error');
            } finally {
                refs.finalizeBtn.disabled = false;
                refs.finalizeBtn.textContent = 'Finalize Wave (Send DMs & Roles)';
            }
        });
    }

    // Historical Waves Drawer
    if (refs.openHistoryBtn) {
        refs.openHistoryBtn.addEventListener('click', () => {
            refs.historyModal.classList.add('open');
            refreshIcons();
        });
    }

    // Modal Close Triggers
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
        });
    });

    if (refs.searchInput) refs.searchInput.addEventListener('input', sortAndRenderTrainees);
    if (refs.sortSelect) refs.sortSelect.addEventListener('change', sortAndRenderTrainees);

    // Initial Render
    sortAndRenderTrainees();
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    refreshIcons();
    mountTrainingControls();
    mountSessionPanel();
    mountWaveManagement();
});
