const axios = require('axios');
const fs = require('fs');
const path = require('path');
const robloxService = require('./roblox');

const cacheFilePath = path.join(__dirname, '../data/users.json');

function loadCache() {
    try {
        const dir = path.dirname(cacheFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(cacheFilePath)) fs.writeFileSync(cacheFilePath, '{}');
        return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
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
    const cache = loadCache();

    // 1. Try RoVer Guild API
    try {
        const response = await axios.get(
            `https://registry.rover.link/api/guilds/${process.env.DISCORD_GUILD_ID}/discord-to-roblox/${discordId}`,
            {
                headers: {
                    Authorization: process.env.ROVER_API_KEY ? `Bearer ${process.env.ROVER_API_KEY}` : ''
                },
                timeout: 5000
            }
        );

        const userData = {
            robloxId: response.data.robloxId,
            robloxUsername: response.data.cachedUsername || 'Unknown'
        };

        cache[discordId] = userData;
        saveCache(cache);
        return userData;
    } catch (error) {
        // 2. Try RoVer Global User API
        try {
            const globalRes = await axios.get(`https://registry.rover.link/api/users/${discordId}`, { timeout: 5000 });
            const userData = {
                robloxId: globalRes.data.robloxId,
                robloxUsername: globalRes.data.cachedUsername || 'Unknown'
            };
            cache[discordId] = userData;
            saveCache(cache);
            return userData;
        } catch (globalErr) {
            // 3. Fallback to local cache
            if (cache[discordId]) {
                return cache[discordId];
            }
        }
    }

    return null;
}

/**
 * Reverse lookup: Roblox ID or Username -> Discord ID
 */
async function getDiscordIdFromRoblox(robloxId, robloxUsername) {
    const cache = loadCache();

    // 1. Check local cache first
    for (const [discordId, data] of Object.entries(cache)) {
        if (robloxId && String(data.robloxId) === String(robloxId)) {
            return { discordId, robloxId: data.robloxId, robloxUsername: data.robloxUsername };
        }
        if (robloxUsername && (data.robloxUsername || '').toLowerCase() === robloxUsername.toLowerCase()) {
            return { discordId, robloxId: data.robloxId, robloxUsername: data.robloxUsername };
        }
    }

    // 2. RoVer Guild API Reverse Lookup
    if (robloxId && process.env.DISCORD_GUILD_ID) {
        try {
            const response = await axios.get(
                `https://registry.rover.link/api/guilds/${process.env.DISCORD_GUILD_ID}/roblox-to-discord/${robloxId}`,
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
                    robloxId,
                    robloxUsername: robloxUsername || response.data?.cachedUsername || 'Unknown'
                };
                saveCache(cache);
                return { discordId, robloxId, robloxUsername };
            }
        } catch (err) {
            // Silently fall through if not found in RoVer
        }
    }

    return null;
}

/**
 * Batch resolve Discord members to their Roblox profiles and avatar headshots
 */
async function batchResolveDiscordMembers(discordMembers = []) {
    const resolvedList = [];

    // Parallel lookups
    await Promise.all(
        discordMembers.map(async (member) => {
            const robloxData = await getRobloxUserFromDiscord(member.discordId);
            resolvedList.push({
                discordId: member.discordId,
                discordTag: member.discordTag,
                discordAvatar: member.discordAvatar,
                robloxId: robloxData?.robloxId || null,
                robloxUsername: robloxData?.robloxUsername || member.discordTag,
                isVerified: Boolean(robloxData?.robloxId),
                avatarUrl: null
            });
        })
    );

    // Fetch avatar headshots for all resolved Roblox IDs
    const usersWithRoblox = resolvedList.filter((u) => u.robloxId);
    if (usersWithRoblox.length) {
        const avatars = await robloxService.getAvatarUrlsForUsers(usersWithRoblox);
        resolvedList.forEach((u) => {
            if (u.robloxId && avatars[u.robloxId]) {
                u.avatarUrl = avatars[u.robloxId];
            }
        });
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