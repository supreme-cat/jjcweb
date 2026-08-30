const axios = require('axios');
const robloxService = require('./roblox');
const storage = require('./storage');

const ERLC_API_BASE = 'https://api.erlc.gg';
const CACHE_TTL_MS = 6000;

let cachedSession = null;
let cachedAt = 0;

function parsePlayerField(value) {
    const [username, id] = String(value || '').split(':');
    return {
        username: username || 'Unknown',
        robloxId: id || null
    };
}

function normalizePlayer(player) {
    const parsed = parsePlayerField(player.Player);

    return {
        id: parsed.robloxId || parsed.username,
        username: parsed.username,
        displayName: parsed.username,
        robloxId: parsed.robloxId,
        status: 'In session',
        team: player.Team || 'Unknown',
        callsign: player.Callsign || '',
        permission: player.Permission || 'Normal',
        avatarUrl: null
    };
}

async function fetchServerSession({ force = false } = {}) {
    const hasFreshCache = cachedSession && Date.now() - cachedAt < CACHE_TTL_MS;

    if (!force && hasFreshCache) {
        return cachedSession;
    }

    if (!process.env.ERLC_SERVER_KEY) {
        return {
            ok: false,
            error: 'Missing ERLC_SERVER_KEY in .env.',
            serverName: 'ER:LC Server',
            livePlayers: 0,
            maxPlayers: 0,
            queueCount: 0,
            players: [],
            queue: []
        };
    }

    try {
        const response = await axios.get(`${ERLC_API_BASE}/v2/server`, {
            params: {
                Players: true,
                Queue: true
            },
            headers: {
                'server-key': process.env.ERLC_SERVER_KEY
            },
            timeout: 9000
        });

        const data = response.data || {};
        const players = (data.Players || []).map(normalizePlayer);
        const queue = data.Queue || [];
        const avatars = await robloxService.getAvatarUrlsForUsers(players);
        const playersWithAvatars = players.map((player) => ({
            ...player,
            avatarUrl: avatars[player.robloxId] || avatars[player.username.toLowerCase()] || null
        }));

        // AUTOMATED SESSION RE-KICK ENFORCEMENT
        // If a session is active, check if any blacklisted player attempted to rejoin
        const waveState = storage.getWaveState();
        if (waveState.isSessionActive && Array.isArray(waveState.sessionBlacklist)) {
            playersWithAvatars.forEach((p) => {
                if (storage.isSessionBlacklisted(p.username)) {
                    console.log(`[ERLC ENFORCEMENT] Auto re-kicking blacklisted player: ${p.username}`);
                    kickPlayer(p.username).catch(() => {});
                }
            });
        }

        cachedSession = {
            ok: true,
            error: null,
            serverName: data.Name || 'ER:LC Server',
            livePlayers: Number(data.CurrentPlayers || playersWithAvatars.length || 0),
            maxPlayers: Number(data.MaxPlayers || 0),
            queueCount: queue.length,
            players: playersWithAvatars,
            queue
        };
        cachedAt = Date.now();

        return cachedSession;
    } catch (err) {
        return {
            ok: false,
            error: err.response?.data?.message || err.message || 'Failed to fetch ER:LC server data.',
            serverName: 'ER:LC Server',
            livePlayers: 0,
            maxPlayers: 0,
            queueCount: 0,
            players: [],
            queue: []
        };
    }
}

/**
 * Sends a kick command to the ER:LC server: ":kick <username>"
 */
async function kickPlayer(username) {
    if (!process.env.ERLC_SERVER_KEY) {
        return { ok: false, error: 'Missing ERLC_SERVER_KEY in .env.' };
    }

    if (!username) {
        return { ok: false, error: 'Roblox username is required.' };
    }

    const command = `:kick ${username.trim()}`;

    try {
        const response = await axios.post(
            `${ERLC_API_BASE}/v2/server/command`,
            { command },
            {
                headers: {
                    'server-key': process.env.ERLC_SERVER_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        // Invalidate cache
        cachedSession = null;

        return {
            ok: true,
            message: `Successfully executed: ${command}`,
            data: response.data
        };
    } catch (err) {
        console.error('[ERLC API] Kick failed:', err.response?.data || err.message);
        return {
            ok: false,
            error: err.response?.data?.message || err.message || 'Failed to execute kick on ER:LC server.'
        };
    }
}

module.exports = {
    fetchServerSession,
    kickPlayer
};
