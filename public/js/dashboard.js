/* ================================================================
   JJC Production — Dashboard Client Controller
   Handles: Session Panel lifecycle, Wave Management, Autocomplete, Overrides
   ================================================================ */

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

function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
}

// ==================== DASHBOARD HOME CONTROLS ====================

function mountTrainingControls() {
    const trigger = document.getElementById('training-trigger') || document.querySelector('[data-training-trigger]');
    const submenu = document.getElementById('training-submenu') || document.querySelector('[data-training-submenu]');
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
        startSessionLabel: document.getElementById('start-session-label'),
        startWaveLabel: document.getElementById('start-wave-label'),
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
        kickModal: document.getElementById('session-kick-modal'),
        kickForm: document.getElementById('session-kick-form'),
        kickUsernameInput: document.getElementById('kick-target-username'),
        kickRobloxIdInput: document.getElementById('kick-target-roblox-id'),
        kickReasonInput: document.getElementById('kick-reason-text')
    };

    let timerInterval = null;

    // Apply view state based on server-side active state
    function applySessionState() {
        if (state.waveState.isSessionActive) {
            if (refs.inactiveView) refs.inactiveView.style.display = 'none';
            if (refs.activeView) refs.activeView.style.display = 'block';
            if (refs.sessionTitleTag) {
                refs.sessionTitleTag.textContent = `Wave ${state.waveState.currentWave} — Session ${state.waveState.activeSessionNumber}`;
            }
            startTimer();
        } else {
            if (refs.activeView) refs.activeView.style.display = 'none';
            if (refs.inactiveView) refs.inactiveView.style.display = 'flex';
            if (refs.startSessionLabel) {
                refs.startSessionLabel.textContent = state.waveState.activeSessionNumber;
            }
            if (refs.startWaveLabel) {
                refs.startWaveLabel.textContent = state.waveState.currentWave;
            }
            stopTimer();
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        const startedAt = state.waveState.activeSessionStartedAt;
        if (!startedAt) {
            if (refs.liveTimer) refs.liveTimer.textContent = '00:00:00';
            return;
        }
        const startTs = new Date(startedAt).getTime();
        const tick = () => {
            if (refs.liveTimer) {
                refs.liveTimer.textContent = formatDuration((Date.now() - startTs) / 1000);
            }
        };
        tick();
        timerInterval = setInterval(tick, 1000);
    }

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
    }

    // Player list renderer (always auto-renders on mount and updates on input)
    function renderPlayers(players) {
        const list = players !== undefined ? players : (state.session?.players || []);
        const query = (refs.playerSearchInput?.value || '').toLowerCase().trim();
        const filtered = query ? list.filter((p) => (p.username || '').toLowerCase().includes(query)) : list;

        if (refs.playerCount) refs.playerCount.textContent = list.length;

        if (!refs.playerList) return;
        if (!filtered.length) {
            refs.playerList.innerHTML = '<div class="empty-box" style="padding: 16px;">No players connected in game.</div>';
            return;
        }

        refs.playerList.innerHTML = '';
        filtered.forEach((p) => {
            const div = document.createElement('div');
            div.className = 'player-item';
            div.innerHTML = `
                <div class="player-left">
                    ${p.avatarUrl
                        ? `<img class="player-avatar" src="${p.avatarUrl}" alt="">`
                        : `<div class="player-avatar" style="display:grid;place-items:center;font-size:11px;font-weight:700;">${(p.username || 'P')[0].toUpperCase()}</div>`}
                    <div class="player-meta">
                        <strong>${p.username}</strong>
                        <small>${p.team || 'Player'}${p.callsign ? ` · ${p.callsign}` : ''}</small>
                    </div>
                </div>
                <button class="btn-kick-icon" type="button" title="Kick from Session">
                    <i data-lucide="user-x"></i>
                </button>
            `;

            div.addEventListener('click', (e) => {
                if (e.target.closest('.btn-kick-icon')) return;
                if (refs.usernameInput) refs.usernameInput.value = p.username;
                hideAutocomplete();
                if (refs.noteContentInput) refs.noteContentInput.focus();
            });

            div.querySelector('.btn-kick-icon').addEventListener('click', (e) => {
                e.stopPropagation();
                openKickModal(p.username, p.robloxId);
            });

            refs.playerList.appendChild(div);
        });
        refreshIcons();
    }

    function renderStaff(staff) {
        const list = staff !== undefined ? staff : (state.activeStaff || []);
        if (refs.staffCount) refs.staffCount.textContent = list.length;
        if (!refs.staffList) return;
        refs.staffList.innerHTML = '';
        list.forEach((s) => {
            const div = document.createElement('div');
            div.className = 'staff-item';
            div.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="pulse-dot" style="width:6px;height:6px;"></span>
                    <span style="font-size:13px;font-weight:600;">${s.name}</span>
                </div>
                <span class="badge badge-active" style="font-size:10px;">Connected</span>
            `;
            refs.staffList.appendChild(div);
        });
    }

    // Note feed renderer
    function renderFeed(notes) {
        const list = notes !== undefined ? notes : (state.currentSessionNotes || []);
        if (refs.sessionNoteCount) refs.sessionNoteCount.textContent = list.length;
        if (!refs.noteFeed) return;
        if (!list.length) {
            refs.noteFeed.innerHTML = '<div class="empty-box">No notes logged yet for this session.</div>';
            return;
        }
        refs.noteFeed.innerHTML = '';
        list.forEach((note) => {
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
                    <small style="color:var(--text-dim);">By ${note.staffUsername}</small>
                </div>
            `;
            refs.noteFeed.appendChild(div);
        });
    }

    // Autocomplete
    async function fetchAutocomplete(q) {
        try {
            const res = await fetch(`/dashboard/api/autocomplete?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            state.autocompleteItems = data.candidates || [];
            state.autocompleteIndex = -1;
            renderAutocomplete();
        } catch {
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
                <div style="display:flex;align-items:center;gap:8px;">
                    ${item.avatarUrl ? `<img src="${item.avatarUrl}" style="width:22px;height:22px;border-radius:50%;" alt="">` : ''}
                    <strong>${item.username}</strong>
                </div>
                <span class="badge badge-soon" style="font-size:9px;">${item.badge}</span>
            `;
            row.addEventListener('click', () => {
                if (refs.usernameInput) refs.usernameInput.value = item.username;
                hideAutocomplete();
                if (refs.noteContentInput) refs.noteContentInput.focus();
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
            if (refs.autocompletePopover?.style.display !== 'flex') return;
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
                if (chosen && refs.usernameInput) {
                    refs.usernameInput.value = chosen.username;
                    hideAutocomplete();
                    refs.noteContentInput?.focus();
                }
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.form-field')) hideAutocomplete();
    });

    if (refs.playerSearchInput) {
        refs.playerSearchInput.addEventListener('input', () => renderPlayers());
    }

    // Start Session Action
    if (refs.startSessionBtn) {
        refs.startSessionBtn.addEventListener('click', async () => {
            refs.startSessionBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/session/start', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.waveState = data.waveState;
                    applySessionState();
                    await refreshSessionData({ force: true });
                    showToast(`Session ${state.waveState.activeSessionNumber} started.`, 'success');
                }
            } catch {
                showToast('Failed to start session.', 'error');
            } finally {
                refs.startSessionBtn.disabled = false;
            }
        });
    }

    // End Session Action
    if (refs.endSessionBtn) {
        refs.endSessionBtn.addEventListener('click', async () => {
            if (!confirm('End this training session? The live feed will be archived and session number will increment.')) return;
            refs.endSessionBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/session/end', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.waveState = data.waveState;
                    state.currentSessionNotes = [];
                    applySessionState();
                    renderFeed([]);
                    showToast(data.sessionRecord ? `Session ended. Duration: ${formatDuration(data.sessionRecord.durationSeconds)}` : 'Session ended.', 'info');
                }
            } catch {
                showToast('Failed to end session.', 'error');
            } finally {
                refs.endSessionBtn.disabled = false;
            }
        });
    }

    // Note Form (Immediately saves to storage via POST /api/notes)
    if (refs.noteForm) {
        refs.noteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = refs.usernameInput?.value.trim();
            const content = refs.noteContentInput?.value.trim();
            const outcome = refs.outcomeInput?.value || 'neutral';
            if (!username || !content) return;

            const submitBtn = refs.noteForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ traineeUsername: username, content, outcome, source: 'session' })
                });
                const data = await res.json();
                if (data.ok) {
                    state.currentSessionNotes = data.currentSessionNotes;
                    if (refs.noteContentInput) refs.noteContentInput.value = '';
                    renderFeed();
                    showToast(`Note logged for ${username}.`, 'success');
                } else {
                    showToast(data.error || 'Failed to save note.', 'error');
                }
            } catch {
                showToast('Network error saving note.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    if (refs.clearNoteBtn) {
        refs.clearNoteBtn.addEventListener('click', () => {
            if (refs.usernameInput) refs.usernameInput.value = '';
            if (refs.noteContentInput) refs.noteContentInput.value = '';
            if (refs.outcomeInput) refs.outcomeInput.value = 'neutral';
        });
    }

    // Kick Modal Handlers
    let activeKickTarget = null;
    function openKickModal(username, robloxId) {
        activeKickTarget = { username, robloxId };
        if (refs.kickUsernameInput) refs.kickUsernameInput.value = username;
        if (refs.kickRobloxIdInput) refs.kickRobloxIdInput.value = robloxId || '';
        if (refs.kickReasonInput) refs.kickReasonInput.value = '';
        if (refs.kickModal) refs.kickModal.classList.add('open');
        refs.kickReasonInput?.focus();
    }

    if (refs.kickForm) {
        refs.kickForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeKickTarget) return;
            const reason = refs.kickReasonInput?.value.trim();
            const submitBtn = refs.kickForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/session/kick', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: activeKickTarget.username, robloxId: activeKickTarget.robloxId, reason })
                });
                const data = await res.json();
                if (data.ok || data.erlc?.ok) {
                    state.currentSessionNotes = data.currentSessionNotes || state.currentSessionNotes;
                    renderFeed();
                    showToast(`Kicked ${activeKickTarget.username} from session.`, 'success');
                    if (refs.kickModal) refs.kickModal.classList.remove('open');
                    activeKickTarget = null;
                    await refreshSessionData({ force: true });
                } else {
                    showToast(data.error || 'Kick failed.', 'error');
                }
            } catch {
                showToast('Error executing kick.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    // Live Data Refresh
    if (refs.refreshDataBtn) {
        refs.refreshDataBtn.addEventListener('click', async () => {
            await refreshSessionData({ force: true });
            showToast('Live data refreshed.', 'info');
        });
    }

    async function refreshSessionData({ force = false } = {}) {
        try {
            const res = await fetch(`/dashboard/api/session/data${force ? '?force=true' : ''}`);
            if (!res.ok) return;
            const data = await res.json();
            state.waveState = data.waveState || state.waveState;
            state.session = data.session || state.session;
            state.activeStaff = data.activeStaff || state.activeStaff;
            state.currentSessionNotes = data.currentSessionNotes || state.currentSessionNotes;
            renderStaff();
            renderPlayers();
            renderFeed();
        } catch {}
    }

    // Modal Close
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closeAllModals);
    });

    // Initialize View
    applySessionState();
    renderStaff();
    renderPlayers();
    renderFeed();

    if (state.waveState.isSessionActive) {
        setInterval(() => refreshSessionData(), 6000);
    }
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
        evaluatedBatch: [],
        overrideDecision: 'PASS'
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

        // Override Modal
        overrideModal: document.getElementById('override-modal'),
        overrideModalSubtitle: document.getElementById('override-modal-subtitle'),
        overrideTargetInput: document.getElementById('override-target-username'),
        overrideDecisionInput: document.getElementById('override-decision-value'),
        overrideReasonInput: document.getElementById('override-reason-input'),
        togglePassBtn: document.getElementById('toggle-pass-btn'),
        toggleFailBtn: document.getElementById('toggle-fail-btn'),
        confirmOverrideBtn: document.getElementById('confirm-override-btn'),

        // History Modal
        historyModal: document.getElementById('history-modal')
    };

    // Trainee Card Rendering
    function sortAndRenderTrainees() {
        if (!refs.traineeGrid) return;
        const query = (refs.searchInput?.value || '').toLowerCase().trim();
        const sortType = refs.sortSelect?.value || 'newest';

        let filtered = state.trainees.filter((t) => {
            const full = `${t.robloxUsername || ''} ${t.discordTag || ''}`.toLowerCase();
            return !query || full.includes(query);
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
            refs.traineeGrid.innerHTML = '<div class="empty-box" style="grid-column:1/-1;padding:36px;">No candidates match your search or filter.</div>';
            return;
        }

        refs.traineeGrid.innerHTML = '';
        filtered.forEach((t) => {
            const isKicked = t.status === 'kicked';
            const notesCount = (t.notes || []).length;
            const evalDecision = t.evaluation?.decision || null;

            const card = document.createElement('div');
            card.className = `trainee-card ${isKicked ? 'kicked' : ''}`;

            let verdictBadge = '<span class="badge badge-neutral">Active</span>';
            if (isKicked) verdictBadge = '<span class="badge badge-kicked">Kicked</span>';
            else if (evalDecision === 'PASS') verdictBadge = `<span class="badge badge-pass">PASS (${t.evaluation.score}/100)</span>`;
            else if (evalDecision === 'FAIL') verdictBadge = `<span class="badge badge-fail">FAIL (${t.evaluation.score}/100)</span>`;

            card.innerHTML = `
                <div>
                    <div class="trainee-top">
                        <div class="avatar-stack">
                            ${t.avatarUrl
                                ? `<img class="roblox-img" src="${t.avatarUrl}" alt="">`
                                : `<div class="roblox-img" style="display:grid;place-items:center;font-weight:700;font-size:14px;">${(t.robloxUsername || 'T')[0].toUpperCase()}</div>`}
                            ${t.discordAvatar ? `<img class="discord-img" src="${t.discordAvatar}" alt="">` : ''}
                        </div>
                        <div class="trainee-meta">
                            <strong>${t.robloxUsername}</strong>
                            <small>${t.discordTag}</small>
                        </div>
                    </div>
                    <div class="trainee-status-row" style="margin-top:10px;">
                        ${verdictBadge}
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);">${notesCount} notes</span>
                    </div>
                </div>
                <div class="trainee-actions-row">
                    <button class="btn btn-secondary" type="button" data-check-notes style="flex:1;min-height:32px;font-size:12px;">
                        <i data-lucide="file-text"></i><span>Check Notes</span>
                    </button>
                    ${!isKicked ? `<button class="btn btn-danger" type="button" data-kick-trainee style="min-height:32px;padding:0 10px;" title="Kick from Discord & Wave"><i data-lucide="user-x"></i></button>` : ''}
                </div>
            `;

            card.querySelector('[data-check-notes]').addEventListener('click', () => openNotesModal(t));
            if (!isKicked) {
                card.querySelector('[data-kick-trainee]').addEventListener('click', () => openKickModal(t));
            }

            refs.traineeGrid.appendChild(card);
        });
        refreshIcons();
    }

    // Notes Modal (Separate into Wave Management Notes and Sessions)
    function openNotesModal(trainee) {
        state.activeNotesTrainee = trainee;
        if (refs.notesTitle) refs.notesTitle.textContent = `${trainee.robloxUsername}'s Notes`;
        if (refs.notesSubtitle) refs.notesSubtitle.textContent = `Discord: ${trainee.discordTag}`;
        if (refs.hiddenUsername) refs.hiddenUsername.value = trainee.robloxUsername;
        renderNotesModalList();
        if (refs.notesModal) refs.notesModal.classList.add('open');
        refreshIcons();
    }

    function renderNotesModalList() {
        if (!state.activeNotesTrainee || !refs.notesContainer) return;
        const notes = state.activeNotesTrainee.notes || [];

        if (!notes.length) {
            refs.notesContainer.innerHTML = '<div class="empty-box" style="padding:24px;">No notes recorded for this candidate yet.</div>';
            return;
        }

        // Group notes by section
        const grouped = {};
        notes.forEach((n) => {
            const section = n.section || (n.source === 'Wave Management' ? 'Wave Management Notes' : `Session ${n.sessionNumber || 1}`);
            if (!grouped[section]) grouped[section] = [];
            grouped[section].push(n);
        });

        refs.notesContainer.innerHTML = '';

        // Order sections: Wave Management Notes first, then session descending
        const sectionKeys = Object.keys(grouped).sort((a, b) => {
            if (a.includes('Wave Management')) return -1;
            if (b.includes('Wave Management')) return 1;
            const aNum = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const bNum = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return bNum - aNum;
        });

        sectionKeys.forEach((section) => {
            const groupEl = document.createElement('div');
            groupEl.className = 'session-note-group';
            groupEl.innerHTML = `<div class="session-note-group-title">${section} (${grouped[section].length} note${grouped[section].length !== 1 ? 's' : ''})</div>`;
            const list = document.createElement('div');
            list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

            grouped[section].forEach((note) => {
                const entry = document.createElement('div');
                entry.className = 'note-entry';
                entry.setAttribute('data-outcome', note.outcome || 'neutral');
                entry.innerHTML = `
                    <div class="note-entry-top">
                        <strong>By ${note.staffUsername}</strong>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <small>${new Date(note.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
                            <button class="btn-delete-note" type="button" title="Delete Note" style="background: none; border: none; padding: 2px 4px; color: var(--text-dim); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; transition: color 0.1s ease;" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='var(--text-dim)'">
                                <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="note-entry-body">${note.content}</div>
                    <div class="note-entry-footer">
                        <span class="badge badge-${note.outcome || 'neutral'}">${note.outcome}</span>
                    </div>
                `;

                const delBtn = entry.querySelector('.btn-delete-note');
                if (delBtn) {
                    delBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!confirm('Are you sure you want to delete this observation note?')) return;
                        delBtn.disabled = true;
                        try {
                            const res = await fetch(`/dashboard/api/notes/${note.id}`, { method: 'DELETE' });
                            const data = await res.json();
                            if (data.ok) {
                                state.activeNotesTrainee.notes = (state.activeNotesTrainee.notes || []).filter((n) => n.id !== note.id);
                                if (data.trainees) {
                                    state.trainees = data.trainees;
                                    const updated = state.trainees.find((t) => (t.robloxUsername || '').toLowerCase() === (state.activeNotesTrainee.robloxUsername || '').toLowerCase());
                                    if (updated) state.activeNotesTrainee = updated;
                                }
                                renderNotesModalList();
                                sortAndRenderTrainees();
                                showToast('Note deleted.', 'info');
                            } else {
                                showToast(data.error || 'Failed to delete note.', 'error');
                            }
                        } catch {
                            showToast('Error deleting note.', 'error');
                        }
                    });
                }

                list.appendChild(entry);
            });

            groupEl.appendChild(list);
            refs.notesContainer.appendChild(groupEl);
        });
        refreshIcons();
    }

    // Quick Add Note from inside modal (source: wave_management)
    if (refs.quickNoteForm) {
        refs.quickNoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = refs.hiddenUsername?.value;
            const content = refs.noteTextInput?.value.trim();
            const outcome = refs.outcomeSelect?.value || 'neutral';
            if (!username || !content) return;

            try {
                const res = await fetch('/dashboard/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ traineeUsername: username, content, outcome, source: 'wave_management' })
                });
                const data = await res.json();
                if (data.ok) {
                    if (!state.activeNotesTrainee.notes) state.activeNotesTrainee.notes = [];
                    state.activeNotesTrainee.notes.unshift(data.note);
                    if (refs.noteTextInput) refs.noteTextInput.value = '';
                    renderNotesModalList();
                    sortAndRenderTrainees();
                    showToast('Note added (Wave Management).', 'success');
                }
            } catch {
                showToast('Failed to add note.', 'error');
            }
        });
    }

    // Kick Trainee Modal (DM -> Kick Discord -> Kicked DB)
    function openKickModal(trainee) {
        state.activeKickTrainee = trainee;
        if (refs.kickDiscordIdInput) refs.kickDiscordIdInput.value = trainee.discordId;
        if (refs.kickRobloxNameInput) refs.kickRobloxNameInput.value = trainee.robloxUsername;
        if (refs.kickReasonInput) refs.kickReasonInput.value = '';
        if (refs.kickModal) refs.kickModal.classList.add('open');
        refs.kickReasonInput?.focus();
    }

    if (refs.kickForm) {
        refs.kickForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!state.activeKickTrainee) return;
            const reason = refs.kickReasonInput?.value.trim();
            const submitBtn = refs.kickForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            try {
                const res = await fetch('/dashboard/api/waves/kick-trainee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        discordId: state.activeKickTrainee.discordId,
                        robloxUsername: state.activeKickTrainee.robloxUsername,
                        robloxId: state.activeKickTrainee.robloxId,
                        reason
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    state.trainees = data.trainees;
                    sortAndRenderTrainees();
                    if (refs.kickModal) refs.kickModal.classList.remove('open');
                    showToast(`Kicked ${state.activeKickTrainee.robloxUsername}.`, 'success');
                } else {
                    showToast(data.error || 'Kick failed.', 'error');
                }
            } catch {
                showToast('Error kicking trainee.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    // Override Modal (PASS/FAIL Toggle)
    let overrideTarget = null;

    function openOverrideModal(username, currentDecision) {
        overrideTarget = username;
        state.overrideDecision = currentDecision === 'PASS' ? 'PASS' : 'FAIL';
        if (refs.overrideModalSubtitle) refs.overrideModalSubtitle.textContent = `Overriding verdict for ${username}`;
        if (refs.overrideTargetInput) refs.overrideTargetInput.value = username;
        if (refs.overrideReasonInput) refs.overrideReasonInput.value = '';
        setOverrideToggle(state.overrideDecision);
        if (refs.overrideModal) refs.overrideModal.classList.add('open');
    }

    function setOverrideToggle(decision) {
        state.overrideDecision = decision;
        if (refs.overrideDecisionInput) refs.overrideDecisionInput.value = decision;

        if (refs.togglePassBtn) {
            refs.togglePassBtn.style.background = decision === 'PASS' ? 'var(--green-bg)' : 'rgba(255,255,255,0.04)';
            refs.togglePassBtn.style.color = decision === 'PASS' ? '#34d399' : 'var(--text-muted)';
            refs.togglePassBtn.style.borderWidth = decision === 'PASS' ? '2px' : '1px';
            refs.togglePassBtn.style.borderColor = decision === 'PASS' ? 'var(--green-border)' : 'var(--border)';
        }
        if (refs.toggleFailBtn) {
            refs.toggleFailBtn.style.background = decision === 'FAIL' ? 'var(--red-bg)' : 'rgba(255,255,255,0.04)';
            refs.toggleFailBtn.style.color = decision === 'FAIL' ? '#f87171' : 'var(--text-muted)';
            refs.toggleFailBtn.style.borderWidth = decision === 'FAIL' ? '2px' : '1px';
            refs.toggleFailBtn.style.borderColor = decision === 'FAIL' ? 'var(--red-border)' : 'var(--border)';
        }
    }

    if (refs.togglePassBtn) refs.togglePassBtn.addEventListener('click', () => setOverrideToggle('PASS'));
    if (refs.toggleFailBtn) refs.toggleFailBtn.addEventListener('click', () => setOverrideToggle('FAIL'));

    if (refs.confirmOverrideBtn) {
        refs.confirmOverrideBtn.addEventListener('click', async () => {
            if (!overrideTarget) return;
            const newReason = refs.overrideReasonInput?.value.trim() || `Staff override to ${state.overrideDecision}`;
            refs.confirmOverrideBtn.disabled = true;
            try {
                const res = await fetch('/dashboard/api/waves/override', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ robloxUsername: overrideTarget, newDecision: state.overrideDecision, newReason })
                });
                const data = await res.json();
                if (data.ok) {
                    const trainee = state.trainees.find((t) => (t.robloxUsername || '').toLowerCase() === overrideTarget.toLowerCase());
                    if (trainee && trainee.evaluation) {
                        trainee.evaluation.decision = state.overrideDecision;
                        trainee.evaluation.decisionReason = newReason;
                    }
                    const batchItem = state.evaluatedBatch.find((e) => e.traineeUsername === overrideTarget);
                    if (batchItem) {
                        batchItem.decision = state.overrideDecision;
                        batchItem.decisionReason = newReason;
                    }
                    if (refs.overrideModal) refs.overrideModal.classList.remove('open');
                    sortAndRenderTrainees();
                    renderAiBatchResults();
                    showToast(`Override saved: ${overrideTarget} → ${state.overrideDecision}`, 'info');
                }
            } catch {
                showToast('Error saving override.', 'error');
            } finally {
                refs.confirmOverrideBtn.disabled = false;
            }
        });
    }

    // Sync Discord Trainees
    if (refs.syncBtn) {
        refs.syncBtn.addEventListener('click', async () => {
            refs.syncBtn.disabled = true;
            showToast('Syncing members with trainee role from Discord...', 'info');
            try {
                const res = await fetch('/dashboard/api/waves/sync', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.trainees = data.trainees;
                    sortAndRenderTrainees();
                    showToast(`Synced ${data.count} candidates from Discord.`, 'success');
                } else {
                    showToast('Failed to sync trainees from Discord.', 'error');
                }
            } catch {
                showToast('Network error syncing trainees.', 'error');
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
            } catch {
                showToast('Error finishing wave.', 'error');
            } finally {
                refs.finishWaveBtn.disabled = false;
            }
        });
    }

    // AI Evaluation Modal
    if (refs.openAiEvalBtn) {
        refs.openAiEvalBtn.addEventListener('click', async () => {
            if (refs.aiModal) refs.aiModal.classList.add('open');
            if (refs.aiLoading) refs.aiLoading.style.display = 'block';
            if (refs.aiContent) refs.aiContent.style.display = 'none';

            try {
                const res = await fetch('/dashboard/api/waves/evaluate', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    state.evaluatedBatch = data.evaluations || [];
                    state.trainees = data.trainees || state.trainees;
                    renderAiBatchResults();
                    if (refs.aiLoading) refs.aiLoading.style.display = 'none';
                    if (refs.aiContent) refs.aiContent.style.display = 'block';
                    sortAndRenderTrainees();
                } else {
                    if (refs.aiModal) refs.aiModal.classList.remove('open');
                    showToast(data.error || 'Evaluation failed.', 'error');
                }
            } catch {
                if (refs.aiModal) refs.aiModal.classList.remove('open');
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
            card.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:15px;">${ev.traineeUsername}</strong>
                        <span class="badge badge-${isPass ? 'pass' : 'fail'}">${ev.decision}</span>
                        <span style="font-weight:700;font-size:13px;">${ev.score}/100</span>
                    </div>
                    <button class="btn btn-secondary" type="button" data-override-target="${ev.traineeUsername}" style="min-height:28px;padding:0 10px;font-size:11px;">
                        <i data-lucide="edit-3"></i><span>Override</span>
                    </button>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;"><strong>Staff Summary:</strong> ${ev.summary || 'N/A'}</div>
                <div style="font-size:12px;color:#60a5fa;"><strong>DM Reason:</strong> ${ev.decisionReason || 'N/A'}</div>
            `;

            card.querySelector('[data-override-target]').addEventListener('click', () => {
                openOverrideModal(ev.traineeUsername, ev.decision);
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
            } catch {
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
            if (refs.historyModal) refs.historyModal.classList.add('open');
            refreshIcons();
        });
    }

    // Global Modal Close
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closeAllModals);
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
