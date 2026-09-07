const express = require('express');
const router = express.Router();
const { ensureStaff } = require('../middleware/auth');
const erlcService = require('../services/erlc');
const presence = require('../services/presence');
const storage = require('../services/storage');
const aiService = require('../services/ai');
const botService = require('../services/bot');
const roverService = require('../services/rover');

// ==================== DASHBOARD HOME ====================

router.get('/', ensureStaff, (req, res) => {
    presence.touchStaff(req.user, 'dashboard');
    res.render('dashboard', { user: req.user });
});

// ==================== SESSION PANEL ====================

router.get('/session', ensureStaff, async (req, res) => {
    presence.touchStaff(req.user, 'session');
    const waveState = storage.getWaveState();
    const session = await erlcService.fetchServerSession();
    const activeStaff = presence.getActiveStaff();
    const currentSessionNotes = storage.getCurrentNotesForActiveSession();

    res.render('session-panel', {
        user: req.user,
        waveState,
        activeStaff,
        session,
        currentSessionNotes
    });
});

router.post('/api/session/start', ensureStaff, (req, res) => {
    const updatedState = storage.startSession(req.user.username, req.user.id);
    res.json({ ok: true, waveState: updatedState });
});

router.post('/api/session/end', ensureStaff, (req, res) => {
    const { updated, sessionRecord } = storage.endSession(req.user.username, req.user.id);
    res.json({ ok: true, waveState: updated, sessionRecord });
});

router.get('/api/session/data', ensureStaff, async (req, res) => {
    presence.touchStaff(req.user, 'session');
    const waveState = storage.getWaveState();
    const session = await erlcService.fetchServerSession({ force: req.query.force === 'true' });
    const activeStaff = presence.getActiveStaff();
    const currentSessionNotes = storage.getCurrentNotesForActiveSession();

    res.json({
        waveState,
        activeStaff,
        session,
        currentSessionNotes
    });
});

// Auto-Complete Candidate Suggestions
router.get('/api/autocomplete', ensureStaff, async (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    const session = await erlcService.fetchServerSession();
    const livePlayers = session?.players || [];
    const currentTrainees = storage.getCurrentTrainees();

    const seen = new Set();
    const candidates = [];

    // 1. Prioritize connected ER:LC players (excluding staff)
    livePlayers.forEach((player) => {
        const username = player.username;
        if (!username) return;
        const norm = username.toLowerCase();

        if (!storage.isStaffRobloxUsername(username) && !seen.has(norm)) {
            seen.add(norm);
            candidates.push({
                username,
                robloxId: player.robloxId,
                avatarUrl: player.avatarUrl,
                source: 'live',
                badge: 'In Game'
            });
        }
    });

    // 2. Secondary: Current wave trainees (excluding staff)
    currentTrainees.forEach((trainee) => {
        const username = trainee.robloxUsername || trainee.discordTag;
        if (!username) return;
        const norm = username.toLowerCase();

        if (!storage.isStaffRobloxUsername(username) && !seen.has(norm)) {
            seen.add(norm);
            candidates.push({
                username,
                robloxId: trainee.robloxId,
                avatarUrl: trainee.avatarUrl,
                source: 'wave',
                badge: 'Wave Trainee'
            });
        }
    });

    const filtered = query
        ? candidates.filter((c) => c.username.toLowerCase().includes(query))
        : candidates;

    res.json({ candidates: filtered.slice(0, 12) });
});

// In-Game Kick Player + Discord DM + Automated Negative Note + Blacklist
router.post('/api/session/kick', ensureStaff, async (req, res) => {
    const { username, robloxId, reason } = req.body;

    if (!username) {
        return res.status(400).json({ ok: false, error: 'Username is required.' });
    }

    const kickReason = reason && reason.trim() ? reason.trim() : 'Kicked from session by staff.';

    // 1. Kick from ER:LC server
    const erlcResult = await erlcService.kickPlayer(username);

    // 2. Send Discord DM
    const dmResult = await botService.sendSessionKickDM({
        robloxUsername: username,
        robloxId,
        reason: kickReason,
        staffUsername: req.user.username
    });

    // 3. Log automated negative note
    const staffAvatar = req.user.avatar 
        ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
        : null;

    storage.addTraineeNote(username, {
        staffUsername: req.user.username || 'Staff',
        staffAvatar,
        staffId: req.user.id,
        content: `Kicked from session: ${kickReason}`,
        outcome: 'negative'
    });

    // 4. Add to session blacklist (auto re-kick if player rejoins active session)
    storage.addSessionBlacklist(username);

    res.json({
        ok: erlcResult.ok,
        erlc: erlcResult,
        dm: dmResult,
        currentSessionNotes: storage.getCurrentNotesForActiveSession()
    });
});

// Note Logging API
router.post('/api/notes', ensureStaff, (req, res) => {
    const { traineeUsername, content, outcome, source } = req.body;

    if (!traineeUsername || !content) {
        return res.status(400).json({ ok: false, error: 'Roblox Username and observation note text are required.' });
    }

    const staffAvatar = req.user.avatar 
        ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
        : null;

    const note = storage.addTraineeNote(traineeUsername, {
        staffUsername: req.user.username || 'Staff',
        staffAvatar,
        staffId: req.user.id,
        content,
        outcome: outcome || 'neutral',
        source: source || 'session'
    });

    res.json({
        ok: true,
        note,
        currentSessionNotes: storage.getCurrentNotesForActiveSession()
    });
});

router.delete('/api/notes/:id', ensureStaff, (req, res) => {
    const success = storage.deleteTraineeNote(req.params.id);
    res.json({ ok: success, currentSessionNotes: storage.getCurrentNotesForActiveSession() });
});

// Touch Presence
router.post('/api/presence', ensureStaff, (req, res) => {
    presence.touchStaff(req.user, req.body?.page || 'session');
    res.json({ activeStaff: presence.getActiveStaff() });
});

// ==================== WAVE MANAGEMENT ====================

router.get('/waves', ensureStaff, async (req, res) => {
    presence.touchStaff(req.user, 'waves');

    // Auto-sync Discord members with TRAINEE_ROLE_ID on load
    const discordMembers = await botService.fetchWaveMembers();
    if (discordMembers.length > 0) {
        const resolved = await roverService.batchResolveDiscordMembers(discordMembers);
        storage.syncCurrentTrainees(resolved);
    }

    const waveState = storage.getWaveState();
    const currentTrainees = storage.getCurrentTrainees();
    const formerWaves = storage.getFormerWaves();
    const kickedTrainees = storage.getKickedTrainees();

    res.render('wave-management', {
        user: req.user,
        waveState,
        trainees: currentTrainees,
        formerWaves,
        kickedTrainees
    });
});

router.post('/api/waves/sync', ensureStaff, async (req, res) => {
    const discordMembers = await botService.fetchWaveMembers();
    const resolved = await roverService.batchResolveDiscordMembers(discordMembers);
    const synced = storage.syncCurrentTrainees(resolved);

    res.json({
        ok: true,
        count: synced.length,
        trainees: synced
    });
});

// Kick Trainee from Discord & Wave
router.post('/api/waves/kick-trainee', ensureStaff, async (req, res) => {
    const { discordId, robloxUsername, robloxId, reason } = req.body;

    if (!discordId) {
        return res.status(400).json({ ok: false, error: 'Discord ID is required to kick trainee.' });
    }

    const kickReason = reason && reason.trim() ? reason.trim() : 'Removed from training wave by staff.';

    // CRITICAL SEQUENCE: 1. Send DM in Discord -> 2. Kick from Discord Guild
    const kickResult = await botService.executeDiscordTraineeKick({
        discordId,
        robloxUsername,
        robloxId,
        reason: kickReason,
        staffUsername: req.user.username
    });

    // Record in kicked_trainees.json & update status in current_trainees.json
    storage.recordKickedTrainee({
        discordId,
        robloxUsername,
        robloxId,
        reason: kickReason,
        staffUsername: req.user.username,
        staffId: req.user.id
    });

    res.json({
        ok: true,
        kickResult,
        trainees: storage.getCurrentTrainees(),
        kickedTrainees: storage.getKickedTrainees()
    });
});

// Batch AI Evaluation
router.post('/api/waves/evaluate', ensureStaff, async (req, res) => {
    const trainees = storage.getCurrentTrainees();

    if (!trainees.length) {
        return res.status(400).json({ ok: false, error: 'No trainees in current wave to evaluate.' });
    }

    const traineesWithNotes = trainees.map((t) => ({
        username: t.robloxUsername || t.discordTag,
        robloxId: t.robloxId,
        discordId: t.discordId,
        notes: t.notes || []
    }));

    const result = await aiService.evaluateWaveTrainees(traineesWithNotes);

    if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error });
    }

    // Save evaluations to trainee records
    (result.evaluations || []).forEach((ev) => {
        if (ev.traineeUsername) {
            storage.saveTraineeEvaluation(ev.traineeUsername, ev);
        }
    });

    res.json({
        ok: true,
        evaluations: result.evaluations,
        evaluatedAt: result.evaluatedAt,
        trainees: storage.getCurrentTrainees()
    });
});

// Staff Override for AI Evaluation
router.post('/api/waves/override', ensureStaff, (req, res) => {
    const { robloxUsername, newDecision, newReason } = req.body;

    if (!robloxUsername || !newDecision) {
        return res.status(400).json({ ok: false, error: 'Username and new decision (PASS/FAIL) are required.' });
    }

    const result = storage.saveStaffOverride(robloxUsername, {
        newDecision,
        newReason: newReason || `Staff manual override to ${newDecision}`,
        staffUsername: req.user.username,
        staffId: req.user.id
    });

    res.json({
        ok: true,
        trainee: result?.trainee,
        override: result?.override
    });
});

// Finalize Wave (Graduates Passers / Kicks Failers / Archives Wave)
router.post('/api/waves/finalize', ensureStaff, async (req, res) => {
    const trainees = storage.getCurrentTrainees();

    if (!trainees.length) {
        return res.status(400).json({ ok: false, error: 'No active trainees to finalize.' });
    }

    const processed = [];

    for (const trainee of trainees) {
        if (trainee.status === 'kicked') continue;

        const isPass = (trainee.evaluation?.decision || 'FAIL').toUpperCase() === 'PASS';
        const decisionReason = trainee.evaluation?.decisionReason || (isPass ? 'Graduated training wave.' : 'Did not meet requirements.');
        const feedback = trainee.evaluation?.traineeFeedback || 'Thank you for your participation.';
        const username = trainee.robloxUsername || trainee.discordTag;

        if (isPass) {
            // 1. DM feedback & reason -> 2. Assign REQUIRED_ROLE_ID -> 3. Send Roblox group join & /verify-group instructions
            await botService.executeTraineePass({
                discordId: trainee.discordId,
                robloxUsername: username,
                robloxId: trainee.robloxId,
                decisionReason,
                traineeFeedback: feedback,
                staffUsername: req.user.username
            });
            trainee.status = 'passed';
        } else {
            // 1. DM feedback & reason -> 2. Kick from Discord
            await botService.executeTraineeFail({
                discordId: trainee.discordId,
                robloxUsername: username,
                robloxId: trainee.robloxId,
                decisionReason,
                traineeFeedback: feedback,
                staffUsername: req.user.username
            });
            trainee.status = 'failed';
        }

        processed.push({ username, status: trainee.status });
    }

    // Archive wave and increment wave counter
    const archiveResult = storage.finishWaveAndStartNew();

    res.json({
        ok: true,
        archiveResult,
        processed
    });
});

// Finish Wave / Start New Wave Manually
router.post('/api/waves/new', ensureStaff, (req, res) => {
    const archiveResult = storage.finishWaveAndStartNew();
    res.json({ ok: true, archiveResult });
});

// History endpoint for past waves
router.get('/api/waves/history', ensureStaff, (req, res) => {
    res.json({ formerWaves: storage.getFormerWaves() });
});

// ==================== AUDIT LOGS PAGE ====================

router.get('/audit-logs', ensureStaff, (req, res) => {
    const logs = storage.getAuditLogs();
    res.render('audit-logs', { user: req.user, logs });
});

// ==================== STAFF HISTORY PAGE ====================

router.get('/staff-history', ensureStaff, (req, res) => {
    const staffAnalytics = storage.getStaffAnalytics();
    res.render('staff-history', { user: req.user, staffAnalytics });
});

// ==================== WAVE HISTORY VIEW (READ-ONLY) ====================

router.get('/waves/history/:waveNumber', ensureStaff, (req, res) => {
    const waveNumber = parseInt(req.params.waveNumber, 10);
    const wave = storage.getFormerWaveByNumber(waveNumber);
    if (!wave) {
        return res.status(404).send('Wave not found.');
    }
    res.render('wave-history-view', { user: req.user, wave });
});

module.exports = router;