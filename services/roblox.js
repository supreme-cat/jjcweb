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

async function getAvatarUrlsForUsers(users) {
    const result = {};
    const usersMissingIds = users.filter((user) => !user.robloxId && user.username);
    const userIds = users
        .map((user) => user.robloxId)
        .filter(Boolean);

    if (usersMissingIds.length) {
        try {
            const resolvedList = await Promise.all(
                usersMissingIds.map((user) => noblox.getIdFromUsername(user.username).catch(() => null))
            );

            usersMissingIds.forEach((user, index) => {
                if (resolvedList[index]) {
                    result[user.username.toLowerCase()] = resolvedList[index];
                    userIds.push(resolvedList[index]);
                }
            });
        } catch (err) {
            console.error('[ROBLOX] Failed to resolve usernames:', err.message);
        }
    }

    const uniqueIds = [...new Set(userIds.map(String))];

    if (!uniqueIds.length) {
        return result;
    }

    try {
        const thumbnails = await noblox.getPlayerThumbnail(uniqueIds, 150, 'png', false, 'Headshot');
        const list = Array.isArray(thumbnails) ? thumbnails : [thumbnails];

        list.forEach((thumbnail, index) => {
            const id = uniqueIds[index];
            if (thumbnail?.imageUrl) {
                result[id] = thumbnail.imageUrl;
            }
        });
    } catch (err) {
        console.error('[ROBLOX] Failed to fetch avatars:', err.message);
    }

    return result;
}

module.exports = {
    initRoblox,
    getRank,
    getRoleName,
    handleJoinRequest,
    exileUser,
    getAvatarUrlsForUsers
};
