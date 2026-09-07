const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Standardized persistent storage path for Dokploy and local environments
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../data');
const WAVE_STATE_FILE = path.join(DATA_DIR, 'wave_state.json');
const CURRENT_TRAINEES_FILE = path.join(DATA_DIR, 'current_trainees.json');
const FORMER_TRAINEES_FILE = path.join(DATA_DIR, 'former_trainees.json');
const KICKED_TRAINEES_FILE = path.join(DATA_DIR, 'kicked_trainees.json');
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit_logs.json');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJsonSafe(filePath, fallback = {}) {
    try {
        ensureDataDir();
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
            return fallback;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data || (Array.isArray(fallback) ? '[]' : '{}'));
    } catch (err) {
        console.error(`[STORAGE] Error reading ${filePath}:`, err.message);
        return fallback;
    }
}

function writeJsonSafe(filePath, data) {
    try {
        ensureDataDir();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`[STORAGE] Error writing ${filePath}:`, err.message);
        return false;
    }
}

// ==================== AUDIT LOGGING ====================

function getAuditLogs() {
    const logs = readJsonSafe(AUDIT_LOGS_FILE, []);
    return Array.isArray(logs) ? logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) : [];
}

function logAuditAction({ action, category, details, staffUsername, staffId }) {
    const logs = getAuditLogs();
    const entry = {
        id: crypto.randomUUID(),
        action: action || 'General Action',
        category: category || 'system',
        details: details || '',
        staffUsername: staffUsername || 'Staff',
        staffId: staffId || null,
        timestamp: new Date().toISOString()
    };
    logs.unshift(entry);
    writeJsonSafe(AUDIT_LOGS_FILE, logs);
    return entry;
}

// ==================== WAVE & SESSION STATE ====================

function getWaveState() {
    const defaultState = {
        currentWave: 1,
        isSessionActive: false,
        activeSessionNumber: 1,
        activeSessionStartedAt: null,
        sessionHistory: [],
        sessionBlacklist: []
    };
    return readJsonSafe(WAVE_STATE_FILE, defaultState);
}

function updateWaveState(patch = {}) {
    const current = getWaveState();
    const updated = { ...current, ...patch };
    writeJsonSafe(WAVE_STATE_FILE, updated);
    return updated;
}

function startSession(staffUsername = 'Staff', staffId = null) {
    const state = getWaveState();
    if (state.isSessionActive) return state;

    const startedAt = new Date().toISOString();
    const updated = updateWaveState({
        isSessionActive: true,
        activeSessionStartedAt: startedAt,
        sessionBlacklist: []
    });

    logAuditAction({
        action: `Started Session ${state.activeSessionNumber}`,
        category: 'session',
        details: `Wave ${state.currentWave} — Session ${state.activeSessionNumber} started.`,
        staffUsername,
        staffId
    });

    return updated;
}

function endSession(staffUsername = 'Staff', staffId = null) {
    const state = getWaveState();
    if (!state.isSessionActive) return { updated: state, sessionRecord: null };

    const endedAt = new Date().toISOString();
    const startedAt = state.activeSessionStartedAt || endedAt;
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000));

    const sessionRecord = {
        waveNumber: state.currentWave,
        sessionNumber: state.activeSessionNumber,
        startedAt,
        endedAt,
        durationSeconds
    };

    const history = Array.isArray(state.sessionHistory) ? state.sessionHistory : [];
    history.push(sessionRecord);

    const updated = updateWaveState({
        isSessionActive: false,
        activeSessionStartedAt: null,
        activeSessionNumber: Number(state.activeSessionNumber || 1) + 1,
        sessionHistory: history,
        sessionBlacklist: []
    });

    logAuditAction({
        action: `Ended Session ${sessionRecord.sessionNumber}`,
        category: 'session',
        details: `Wave ${sessionRecord.waveNumber} — Session ${sessionRecord.sessionNumber} concluded. Duration: ${durationSeconds}s.`,
        staffUsername,
        staffId
    });

    return { updated, sessionRecord };
}

function addSessionBlacklist(username) {
    if (!username) return;
    const state = getWaveState();
    const list = Array.isArray(state.sessionBlacklist) ? state.sessionBlacklist : [];
    const clean = username.toLowerCase().trim();
    if (!list.includes(clean)) {
        list.push(clean);
        updateWaveState({ sessionBlacklist: list });
    }
}

function isSessionBlacklisted(username) {
    if (!username) return false;
    const state = getWaveState();
    if (!state.isSessionActive) return false;
    const list = Array.isArray(state.sessionBlacklist) ? state.sessionBlacklist : [];
    return list.includes(username.toLowerCase().trim());
}

// ==================== STAFF DATABASE & ANALYTICS ====================

function getAllStaff() {
    return readJsonSafe(STAFF_FILE, []);
}

function registerStaff(staffMember) {
    if (!staffMember?.discordId) return;
    const staffList = getAllStaff();
    const index = staffList.findIndex((s) => s.discordId === staffMember.discordId);

    if (index >= 0) {
        staffList[index] = { ...staffList[index], ...staffMember, lastSeen: new Date().toISOString() };
    } else {
        staffList.push({ ...staffMember, registeredAt: new Date().toISOString() });
    }

    writeJsonSafe(STAFF_FILE, staffList);
}

function isStaffRobloxUsername(username) {
    if (!username) return false;
    const clean = username.toLowerCase().trim();
    const staffList = getAllStaff();
    return staffList.some((s) => (s.robloxUsername || '').toLowerCase().trim() === clean);
}

function getStaffAnalytics() {
    const staffList = getAllStaff();
    const auditLogs = getAuditLogs();
    const allNotes = getAllCurrentNotes();
    const formerWaves = getFormerWaves();

    formerWaves.forEach((w) => {
        (w.trainees || []).forEach((t) => {
            if (Array.isArray(t.notes)) allNotes.push(...t.notes);
        });
    });

    return staffList.map((s) => {
        const staffName = s.discordTag;
        const staffId = s.discordId;

        const notesCount = allNotes.filter((n) => n.staffId === staffId || (n.staffUsername && n.staffUsername.toLowerCase() === staffName.toLowerCase())).length;
        const kicksCount = auditLogs.filter((l) => l.category === 'kick' && (l.staffId === staffId || l.staffUsername === staffName)).length;
        const sessionsCount = auditLogs.filter((l) => l.category === 'session' && l.action.startsWith('Started') && (l.staffId === staffId || l.staffUsername === staffName)).length;
        const overridesCount = auditLogs.filter((l) => l.category === 'override' && (l.staffId === staffId || l.staffUsername === staffName)).length;
        const recentActions = auditLogs.filter((l) => l.staffId === staffId || l.staffUsername === staffName).slice(0, 10);

        return {
            ...s,
            notesCount,
            kicksCount,
            sessionsCount,
            overridesCount,
            recentActions
        };
    });
}

// ==================== CURRENT TRAINEES ====================

function getCurrentTrainees() {
    return readJsonSafe(CURRENT_TRAINEES_FILE, []);
}

function saveCurrentTrainees(trainees) {
    writeJsonSafe(CURRENT_TRAINEES_FILE, trainees || []);
    return trainees;
}

/**
 * Syncs Discord members into current_trainees.json, matching by discordId OR robloxUsername to preserve notes.
 */
function syncCurrentTrainees(discordMembers = []) {
    const existingTrainees = getCurrentTrainees();
    const merged = [];

    discordMembers.forEach((member) => {
        const existing = existingTrainees.find((t) => 
            t.discordId === member.discordId ||
            (member.robloxUsername && (t.robloxUsername || '').toLowerCase() === member.robloxUsername.toLowerCase()) ||
            (member.discordTag && (t.discordTag || '').toLowerCase() === member.discordTag.toLowerCase())
        );

        if (existing) {
            merged.push({
                ...existing,
                discordId: member.discordId || existing.discordId,
                discordTag: member.discordTag || existing.discordTag,
                discordAvatar: member.discordAvatar || existing.discordAvatar,
                robloxUsername: member.robloxUsername || existing.robloxUsername,
                robloxId: member.robloxId || existing.robloxId,
                avatarUrl: member.avatarUrl || existing.avatarUrl,
                isVerified: member.isVerified !== undefined ? member.isVerified : existing.isVerified,
                notes: existing.notes || []
            });
        } else {
            merged.push({
                discordId: member.discordId,
                discordTag: member.discordTag,
                discordAvatar: member.discordAvatar,
                robloxUsername: member.robloxUsername || member.discordTag,
                robloxId: member.robloxId || null,
                avatarUrl: member.avatarUrl || null,
                isVerified: Boolean(member.isVerified),
                status: 'active',
                notes: [],
                evaluation: null,
                overrides: [],
                addedAt: new Date().toISOString()
            });
        }
    });

    // Retain any existing trainee who was created via note logger but not yet synced
    existingTrainees.forEach((existing) => {
        if (!merged.some((m) => m.discordId === existing.discordId || (m.robloxUsername || '').toLowerCase() === (existing.robloxUsername || '').toLowerCase())) {
            merged.push(existing);
        }
    });

    saveCurrentTrainees(merged);
    return merged;
}

function addTraineeNote(robloxUsername, { staffUsername, staffAvatar, staffId, content, outcome = 'neutral', source = 'session' }) {
    if (!robloxUsername || !content) return null;

    const trainees = getCurrentTrainees();
    const norm = robloxUsername.toLowerCase().trim();
    let trainee = trainees.find((t) => 
        (t.robloxUsername || '').toLowerCase().trim() === norm ||
        (t.discordTag || '').toLowerCase().trim() === norm
    );

    const waveState = getWaveState();
    const isWaveManagement = source === 'wave_management';
    const activeSession = isWaveManagement ? null : (waveState.isSessionActive ? waveState.activeSessionNumber : 1);
    const validOutcome = ['positive', 'neutral', 'negative'].includes(outcome) ? outcome : 'neutral';

    const newNote = {
        id: crypto.randomUUID(),
        section: isWaveManagement ? 'Wave Management Notes' : `Session ${activeSession}`,
        sessionNumber: activeSession,
        waveNumber: waveState.currentWave,
        source: isWaveManagement ? 'Wave Management' : 'Session Panel',
        staffUsername: staffUsername || 'Staff',
        staffAvatar: staffAvatar || null,
        staffId: staffId || null,
        traineeUsername: robloxUsername.trim(),
        content: content.trim(),
        outcome: validOutcome,
        createdAt: new Date().toISOString()
    };

    if (trainee) {
        if (!Array.isArray(trainee.notes)) trainee.notes = [];
        trainee.notes.unshift(newNote);
    } else {
        trainee = {
            discordId: null,
            discordTag: robloxUsername.trim(),
            discordAvatar: null,
            robloxUsername: robloxUsername.trim(),
            robloxId: null,
            avatarUrl: null,
            isVerified: false,
            status: 'active',
            notes: [newNote],
            evaluation: null,
            overrides: [],
            addedAt: new Date().toISOString()
        };
        trainees.push(trainee);
    }

    saveCurrentTrainees(trainees);

    logAuditAction({
        action: `Logged Note on ${robloxUsername}`,
        category: 'note',
        details: `[${validOutcome.toUpperCase()}] ${isWaveManagement ? 'Wave Management Note' : `Session ${activeSession}`}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
        staffUsername,
        staffId
    });

    return newNote;
}

function getAllCurrentNotes() {
    const trainees = getCurrentTrainees();
    const all = [];
    trainees.forEach((t) => {
        if (Array.isArray(t.notes)) {
            all.push(...t.notes);
        }
    });
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getCurrentNotesForActiveSession() {
    const state = getWaveState();
    if (!state.isSessionActive) return [];
    const all = getAllCurrentNotes();
    return all.filter((n) => n.waveNumber === state.currentWave && n.sessionNumber === state.activeSessionNumber);
}

function deleteTraineeNote(noteId, staffUsername = 'Staff', staffId = null) {
    if (!noteId) return false;
    const trainees = getCurrentTrainees();
    let deletedNote = null;

    trainees.forEach((t) => {
        if (Array.isArray(t.notes)) {
            const found = t.notes.find((n) => String(n.id) === String(noteId));
            if (found) deletedNote = found;
            t.notes = t.notes.filter((n) => String(n.id) !== String(noteId));
        }
    });

    if (deletedNote) {
        saveCurrentTrainees(trainees);
        logAuditAction({
            action: `Deleted Note on ${deletedNote.traineeUsername}`,
            category: 'note',
            details: `Removed observation note: "${deletedNote.content.slice(0, 60)}"`,
            staffUsername,
            staffId
        });
        return true;
    }
    return false;
}

// ==================== KICKED TRAINEES ====================

function getKickedTrainees() {
    return readJsonSafe(KICKED_TRAINEES_FILE, []);
}

function recordKickedTrainee({ discordId, discordTag, robloxUsername, robloxId, reason, staffUsername, staffId }) {
    const kicked = getKickedTrainees();
    const record = {
        id: crypto.randomUUID(),
        discordId,
        discordTag,
        robloxUsername,
        robloxId,
        reason: reason || 'Kicked from training wave.',
        staffUsername: staffUsername || 'Staff',
        staffId: staffId || null,
        kickedAt: new Date().toISOString()
    };
    kicked.unshift(record);
    writeJsonSafe(KICKED_TRAINEES_FILE, kicked);

    const current = getCurrentTrainees();
    const target = current.find((t) => t.discordId === discordId || (robloxUsername && (t.robloxUsername || '').toLowerCase() === robloxUsername.toLowerCase()));
    if (target) {
        target.status = 'kicked';
        target.kickedReason = reason;
        saveCurrentTrainees(current);
    }

    logAuditAction({
        action: `Kicked Trainee from Wave: ${robloxUsername || discordTag}`,
        category: 'kick',
        details: `Reason: ${reason} | Discord: ${discordId}`,
        staffUsername,
        staffId
    });

    return record;
}

// ==================== HISTORICAL WAVES ====================

function getFormerWaves() {
    return readJsonSafe(FORMER_TRAINEES_FILE, []);
}

function getFormerWaveByNumber(waveNumber) {
    const former = getFormerWaves();
    return former.find((w) => Number(w.waveNumber) === Number(waveNumber)) || null;
}

function finishWaveAndStartNew(staffUsername = 'Staff', staffId = null) {
    const state = getWaveState();
    const currentTrainees = getCurrentTrainees();
    const formerWaves = getFormerWaves();

    const waveSessions = (state.sessionHistory || []).filter((s) => s.waveNumber === state.currentWave);

    const archivedWaveRecord = {
        waveNumber: state.currentWave,
        waveName: `Wave ${state.currentWave}`,
        completedAt: new Date().toISOString(),
        traineeCount: currentTrainees.length,
        graduatedCount: currentTrainees.filter((t) => t.status === 'passed').length,
        failedCount: currentTrainees.filter((t) => t.status === 'failed' || t.status === 'kicked').length,
        trainees: currentTrainees,
        sessions: waveSessions,
        sessionCount: waveSessions.length
    };

    formerWaves.unshift(archivedWaveRecord);
    writeJsonSafe(FORMER_TRAINEES_FILE, formerWaves);

    // Clear current trainees
    writeJsonSafe(CURRENT_TRAINEES_FILE, []);

    const nextWave = state.currentWave + 1;
    const updatedState = updateWaveState({
        currentWave: nextWave,
        isSessionActive: false,
        activeSessionNumber: 1,
        activeSessionStartedAt: null,
        sessionBlacklist: []
    });

    logAuditAction({
        action: `Finished Wave ${state.currentWave}`,
        category: 'wave',
        details: `Archived Wave ${state.currentWave} (${archivedWaveRecord.traineeCount} candidates, ${archivedWaveRecord.sessionCount} sessions). Initialized Wave ${nextWave}.`,
        staffUsername,
        staffId
    });

    return {
        previousWave: archivedWaveRecord,
        newWaveNumber: nextWave,
        state: updatedState
    };
}

// ==================== EVALUATIONS & OVERRIDES ====================

function saveTraineeEvaluation(robloxUsername, evaluation) {
    const trainees = getCurrentTrainees();
    const norm = robloxUsername.toLowerCase().trim();
    const trainee = trainees.find((t) => (t.robloxUsername || '').toLowerCase().trim() === norm);
    if (!trainee) return null;

    trainee.evaluation = {
        ...evaluation,
        evaluatedAt: new Date().toISOString()
    };
    saveCurrentTrainees(trainees);
    return trainee.evaluation;
}

function saveStaffOverride(robloxUsername, { newDecision, newReason, staffUsername, staffId }) {
    const trainees = getCurrentTrainees();
    const norm = robloxUsername.toLowerCase().trim();
    const trainee = trainees.find((t) => (t.robloxUsername || '').toLowerCase().trim() === norm);
    if (!trainee) return null;

    const originalDecision = trainee.evaluation?.decision || 'PENDING';
    const originalReason = trainee.evaluation?.decisionReason || 'N/A';

    const overrideRecord = {
        id: crypto.randomUUID(),
        originalDecision,
        originalReason,
        newDecision,
        newReason,
        staffUsername: staffUsername || 'Staff',
        staffId: staffId || null,
        timestamp: new Date().toISOString()
    };

    if (!Array.isArray(trainee.overrides)) trainee.overrides = [];
    trainee.overrides.unshift(overrideRecord);

    if (trainee.evaluation) {
        trainee.evaluation.decision = newDecision;
        trainee.evaluation.decisionReason = newReason;
    } else {
        trainee.evaluation = {
            decision: newDecision,
            score: newDecision === 'PASS' ? 80 : 40,
            decisionReason: newReason,
            traineeFeedback: newReason,
            summary: 'Staff manual override.',
            evaluatedAt: new Date().toISOString()
        };
    }

    saveCurrentTrainees(trainees);

    logAuditAction({
        action: `Staff Override on ${robloxUsername}: ${originalDecision} -> ${newDecision}`,
        category: 'override',
        details: `Reason: ${newReason}`,
        staffUsername,
        staffId
    });

    return { trainee, override: overrideRecord };
}

module.exports = {
    // Audit logs
    getAuditLogs,
    logAuditAction,
    // Wave & Session state
    getWaveState,
    updateWaveState,
    startSession,
    endSession,
    addSessionBlacklist,
    isSessionBlacklisted,
    // Staff & Analytics
    getAllStaff,
    registerStaff,
    isStaffRobloxUsername,
    getStaffAnalytics,
    // Current Trainees & Notes
    getCurrentTrainees,
    saveCurrentTrainees,
    syncCurrentTrainees,
    addTraineeNote,
    getAllCurrentNotes,
    getCurrentNotesForActiveSession,
    deleteTraineeNote,
    // Kicked Trainees
    getKickedTrainees,
    recordKickedTrainee,
    // Waves Archive & History
    getFormerWaves,
    getFormerWaveByNumber,
    finishWaveAndStartNew,
    // AI Evaluations & Staff Overrides
    saveTraineeEvaluation,
    saveStaffOverride
};
