const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
                }
            }
        );

        const userData = {
            robloxId: response.data.robloxId,
            robloxUsername: response.data.cachedUsername || 'Unknown'
        };

        // Cache successful lookup
        cache[discordId] = userData;
        saveCache(cache);

        return userData;
    } catch (error) {
        // 2. Try RoVer Global User API if Guild lookup fails
        try {
            const globalRes = await axios.get(`https://registry.rover.link/api/users/${discordId}`);
            const userData = {
                robloxId: globalRes.data.robloxId,
                robloxUsername: globalRes.data.cachedUsername || 'Unknown'
            };
            cache[discordId] = userData;
            saveCache(cache);
            return userData;
        } catch (globalErr) {
            // 3. Fallback to local storage (for kicked / left members)
            if (cache[discordId]) {
                console.log(`[ROVER] Found cached Roblox ID for Discord ID ${discordId}`);
                return cache[discordId];
            }
        }
    }

    return null;
}

module.exports = { getRobloxUserFromDiscord };