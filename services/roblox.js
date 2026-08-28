const noblox = require('noblox.js');
let initialized = false;

async function initRoblox() {
    if (initialized) return;
    try {
        await noblox.setCookie(process.env.ROBLOX_COOKIE);
        const user = await noblox.getCurrentUser();
        console.log(`[ROBLOX] Authenticated as ${user.UserName} (${user.UserID})`);
        initialized = true;
    } catch (err) {
        console.error('[ROBLOX] Failed to authenticate:', err.message);
    }
}

async function getRank(userId) {
    await initRoblox();
    return await noblox.getRankInGroup(parseInt(process.env.ROBLOX_GROUP_ID), userId);
}

async function getRoleName(userId) {
    await initRoblox();
    return await noblox.getRoleInGroup(parseInt(process.env.ROBLOX_GROUP_ID), userId);
}

async function handleJoinRequest(userId, accept = true) {
    await initRoblox();
    return await noblox.handleJoinRequest(parseInt(process.env.ROBLOX_GROUP_ID), userId, accept);
}

async function exileUser(userId) {
    await initRoblox();
    return await noblox.exile(parseInt(process.env.ROBLOX_GROUP_ID), userId);
}

module.exports = { initRoblox, getRank, getRoleName, handleJoinRequest, exileUser };