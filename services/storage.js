const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../data');
const WAVE_STATE_FILE = path.join(DATA_DIR, 'wave_state.json');
const CURRENT_TRAINEES_FILE = path.join(DATA_DIR, 'current_trainees.json');
const FORMER_TRAINEES_FILE = path.join(DATA_DIR, 'former_trainees.json');
const KICKED_TRAINEES_FILE = path.join(DATA_DIR, 'kicked_trainees.json');
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');

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

// ==================== WAVE & SESSION STATE ====================

function getWaveState() {
    const defaultState = {
        currentWave: 1,
        isSessionActive: false,
        activeSessionNumber: 1,
        activeSessionStartedAt: null,
        sessionHistory: [], // [{ waveNumber: 1, sessionNumber: 1, startedAt: '...', endedAt: '...', durationSeconds: 1200 }]
        sessionBlacklist: [] // usernames/ids to auto re-kick during active session
    };
    return readJsonSafe(WAVE_STATE_FILE, defaultState);
}

function updateWaveState(patch = {}) {
    const current = getWaveState();
    const updated = { ...current, ...patch };
    writeJsonSafe(WAVE_STATE_FILE, updated);
    return updated;
}

function startSession() {
    const state = getWaveState();
    if (state.isSessionActive) return state;

    const updated = updateWaveState({
        isSessionActive: true,
        activeSessionStartedAt: new Date().toISOString(),
        sessionBlacklist: []
    });
    return updated;
}

function endSession() {
    const state = getWaveState();
    if (!state.isSessionActive) return state;

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

// ==================== STAFF DATABASE ====================

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

// ==================== CURRENT TRAINEES ====================

function getCurrentTrainees() {
    return readJsonSafe(CURRENT_TRAINEES_FILE, []);
}

function saveCurrentTrainees(trainees) {
    writeJsonSafe(CURRENT_TRAINEES_FILE, trainees || []);
    return trainees;
}

function syncCurrentTrainees(discordMembers = []) {
    const existingTrainees = getCurrentTrainees();
    const merged = [];

    discordMembers.forEach((member) => {
        const existing = existingTrainees.find((t) => t.discordId === member.discordId);
        if (existing) {
            merged.push({
                ...existing,
                discordTag: member.discordTag,
                discordAvatar: member.discordAvatar || existing.discordAvatar,
                robloxUsername: member.robloxUsername || existing.robloxUsername,
                robloxId: member.robloxId || existing.robloxId,
                avatarUrl: member.avatarUrl || existing.avatarUrl,
                isVerified: member.isVerified !== undefined ? member.isVerified : existing.isVerified
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
                status: 'active', // active, kicked, passed, failed
                notes: [],
                evaluation: null,
                overrides: [],
                addedAt: new Date().toISOString()
            });
        }
    });

    saveCurrentTrainees(merged);
    return merged;
}

function addTraineeNote(robloxUsername, { staffUsername, staffAvatar, staffId, content, outcome = 'neutral', sessionNumber }) {
    if (!robloxUsername || !content) return null;

    const trainees = getCurrentTrainees();
    const norm = robloxUsername.toLowerCase().trim();
    let trainee = trainees.find((t) => (t.robloxUsername || '').toLowerCase().trim() === norm);

    const waveState = getWaveState();
    const activeSession = sessionNumber || (waveState.isSessionActive ? waveState.activeSessionNumber : 1);
    const validOutcome = ['positive', 'neutral', 'negative'].includes(outcome) ? outcome : 'neutral';

    const newNote = {
        id: crypto.randomUUID(),
        sessionNumber: Number(activeSession),
        waveNumber: waveState.currentWave,
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
        // If note was entered for an unlisted player, create a placeholder candidate
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

function deleteTraineeNote(noteId) {
    const trainees = getCurrentTrainees();
    let found = false;

    trainees.forEach((t) => {
        if (Array.isArray(t.notes)) {
            const before = t.notes.length;
            t.notes = t.notes.filter((n) => n.id !== noteId);
            if (t.notes.length !== before) found = true;
        }
    });

    if (found) saveCurrentTrainees(trainees);
    return found;
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

    // Update status in current trainees list
    const current = getCurrentTrainees();
    const target = current.find((t) => t.discordId === discordId || (robloxUsername && (t.robloxUsername || '').toLowerCase() === robloxUsername.toLowerCase()));
    if (target) {
        target.status = 'kicked';
        target.kickedReason = reason;
        saveCurrentTrainees(current);
    }

    return record;
}

// ==================== WAVE ARCHIVING & HISTORICAL WAVES ====================

function getFormerWaves() {
    return readJsonSafe(FORMER_TRAINEES_FILE, []);
}

function finishWaveAndStartNew() {
    const state = getWaveState();
    const currentTrainees = getCurrentTrainees();
    const formerWaves = getFormerWaves();

    // Calculate sessions for current wave
    const waveSessions = (state.sessionHistory || []).filter((s) => s.waveNumber === state.currentWave);

    const archivedWaveRecord = {
        waveNumber: state.currentWave,
        waveName: `Wave ${state.currentWave}`,
        completedAt: new Date().toISOString(),
        traineeCount: currentTrainees.length,
        trainees: currentTrainees,
        sessions: waveSessions,
        sessionCount: waveSessions.length
    };

    formerWaves.unshift(archivedWaveRecord);
    writeJsonSafe(FORMER_TRAINEES_FILE, formerWaves);

    // Reset current trainees
    writeJsonSafe(CURRENT_TRAINEES_FILE, []);

    // Increment wave and reset session counter
    const nextWave = state.currentWave + 1;
    const updatedState = updateWaveState({
        currentWave: nextWave,
        isSessionActive: false,
        activeSessionNumber: 1,
        activeSessionStartedAt: null,
        sessionBlacklist: []
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

    const originalDecision = trainee.evaluation?.decision || 'FAIL';
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
            summary: 'Staff manual evaluation.',
            evaluatedAt: new Date().toISOString()
        };
    }

    saveCurrentTrainees(trainees);
    return { trainee, override: overrideRecord };
}

module.exports = {
    // Wave & Session state
    getWaveState,
    updateWaveState,
    startSession,
    endSession,
    addSessionBlacklist,
    isSessionBlacklisted,
    // Staff
    getAllStaff,
    registerStaff,
    isStaffRobloxUsername,
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
    // Waves Archive
    getFormerWaves,
    finishWaveAndStartNew,
    // AI Evaluations & Staff Overrides
    saveTraineeEvaluation,
    saveStaffOverride
};
