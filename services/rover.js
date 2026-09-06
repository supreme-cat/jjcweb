const axios = require('axios');
const fs = require('fs');
const path = require('path');
const noblox = require('noblox.js');
const robloxService = require('./roblox');

const cacheFilePath = path.join(__dirname, '../data/users.json');

function loadCache() {
    try {
        const dir = path.dirname(cacheFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(cacheFilePath)) fs.writeFileSync(cacheFilePath, '{}');
        return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8') || '{}');
    } catch (err) {
        console.error('[STORAGE] Error loading users.json:', err.message);
        return {};
    }
}

function saveCache(cache) {
    try {
        fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error('[STORAGE] Error saving users.json:', err.message);
    }
}

async function getRobloxUserFromDiscord(discordId) {
    if (!discordId) return null;
    const cache = loadCache();

    // Check memory / local cache first
    if (cache[discordId]?.robloxId) {
        return cache[discordId];
    }

    // 1. Try RoVer Guild API
    if (process.env.DISCORD_GUILD_ID) {
        try {
            const response = await axios.get(
                `https://registry.rover.link/api/guilds/${process.env.DISCORD_GUILD_ID}/discord-to-roblox/${discordId}`,
                {
                    headers: {
                        Authorization: process.env.ROVER_API_KEY ? `Bearer ${process.env.ROVER_API_KEY}` : ''
                    },
                    timeout: 4000
                }
            );

            if (response.data?.robloxId) {
                const userData = {
                    robloxId: response.data.robloxId,
                    robloxUsername: response.data.cachedUsername || 'Unknown'
                };
                cache[discordId] = userData;
                saveCache(cache);
                return userData;
            }
        } catch (error) {
            // RoVer Guild API failed, fall back
        }
    }

    // 2. Try RoVer Global User API
    try {
        const globalRes = await axios.get(`https://registry.rover.link/api/users/${discordId}`, { timeout: 4000 });
        if (globalRes.data?.robloxId) {
            const userData = {
                robloxId: globalRes.data.robloxId,
                robloxUsername: globalRes.data.cachedUsername || 'Unknown'
            };
            cache[discordId] = userData;
            saveCache(cache);
            return userData;
        }
    } catch (globalErr) {
        // Fallback to local cache entry if exists
        if (cache[discordId]) {
            return cache[discordId];
        }
    }

    return null;
}

/**
 * Reverse lookup: Roblox ID or Username -> Discord ID
 */
async function getDiscordIdFromRoblox(robloxId, robloxUsername) {
    const cache = loadCache();

    // 1. Check local users.json cache first
    for (const [discordId, data] of Object.entries(cache)) {
        if (robloxId && String(data.robloxId) === String(robloxId)) {
            return { discordId, robloxId: data.robloxId, robloxUsername: data.robloxUsername || robloxUsername };
        }
        if (robloxUsername && (data.robloxUsername || '').toLowerCase() === robloxUsername.toLowerCase()) {
            return { discordId, robloxId: data.robloxId || robloxId, robloxUsername: data.robloxUsername };
        }
    }

    // 2. Check current_trainees.json
    try {
        const traineesPath = path.join(__dirname, '../data/current_trainees.json');
        if (fs.existsSync(traineesPath)) {
            const trainees = JSON.parse(fs.readFileSync(traineesPath, 'utf8') || '[]');
            const found = trainees.find((t) => 
                (robloxId && String(t.robloxId) === String(robloxId)) ||
                (robloxUsername && (t.robloxUsername || '').toLowerCase() === robloxUsername.toLowerCase()) ||
                (robloxUsername && (t.discordTag || '').toLowerCase() === robloxUsername.toLowerCase())
            );
            if (found && found.discordId) {
                cache[found.discordId] = {
                    robloxId: found.robloxId || robloxId,
                    robloxUsername: found.robloxUsername || robloxUsername
                };
                saveCache(cache);
                return { discordId: found.discordId, robloxId: found.robloxId || robloxId, robloxUsername: found.robloxUsername || robloxUsername };
            }
        }
    } catch (err) {}

    // 3. Resolve Roblox ID via noblox if missing
    let targetRobloxId = robloxId;
    if (!targetRobloxId && robloxUsername) {
        try {
            targetRobloxId = await noblox.getIdFromUsername(robloxUsername).catch(() => null);
        } catch (err) {}
    }

    // 4. RoVer Guild API Reverse Lookup
    if (targetRobloxId && process.env.DISCORD_GUILD_ID) {
        try {
            const response = await axios.get(
                `https://registry.rover.link/api/guilds/${process.env.DISCORD_GUILD_ID}/roblox-to-discord/${targetRobloxId}`,
                {
                    headers: {
                        Authorization: process.env.ROVER_API_KEY ? `Bearer ${process.env.ROVER_API_KEY}` : ''
                    },
                    timeout: 5000
                }
            );

            const discordId = response.data?.discordId || response.data?.id;
            if (discordId) {
                cache[discordId] = {
                    robloxId: targetRobloxId,
                    robloxUsername: robloxUsername || response.data?.cachedUsername || 'Unknown'
                };
                saveCache(cache);
                return { discordId, robloxId: targetRobloxId, robloxUsername };
            }
        } catch (err) {
            // RoVer lookup failed
        }
    }

    return null;
}

/**
 * Batch resolve Discord members to their Roblox profiles and avatar headshots
 * Uses chunked concurrent processing to avoid hitting rate limits.
 */
async function batchResolveDiscordMembers(discordMembers = []) {
    const resolvedList = [];
    const chunkSize = 8;

    for (let i = 0; i < discordMembers.length; i += chunkSize) {
        const chunk = discordMembers.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
            chunk.map(async (member) => {
                const robloxData = await getRobloxUserFromDiscord(member.discordId);
                return {
                    discordId: member.discordId,
                    discordTag: member.discordTag,
                    discordAvatar: member.discordAvatar,
                    robloxId: robloxData?.robloxId || null,
                    robloxUsername: robloxData?.robloxUsername || member.discordTag,
                    isVerified: Boolean(robloxData?.robloxId),
                    avatarUrl: null
                };
            })
        );
        resolvedList.push(...chunkResults);
    }

    // Fetch avatar headshots for all resolved Roblox IDs
    const usersWithRoblox = resolvedList.filter((u) => u.robloxId);
    if (usersWithRoblox.length) {
        try {
            const avatars = await robloxService.getAvatarUrlsForUsers(usersWithRoblox);
            resolvedList.forEach((u) => {
                if (u.robloxId && avatars[u.robloxId]) {
                    u.avatarUrl = avatars[u.robloxId];
                }
            });
        } catch (err) {
            console.error('[ROVER] Avatar resolution error:', err.message);
        }
    }

    return resolvedList;
}

module.exports = {
    getRobloxUserFromDiscord,
    getDiscordIdFromRoblox,
    batchResolveDiscordMembers,
    loadCache,
    saveCache
};