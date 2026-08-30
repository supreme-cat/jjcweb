const { client } = require('../services/bot');
const storage = require('../services/storage');
const rover = require('../services/rover');

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/auth/discord');
}

async function ensureStaff(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/discord');
    }

    // If already verified in this session, immediately allow access without redundant API calls
    if (req.session && req.session.isStaffVerified) {
        return next();
    }

    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        if (!guild) {
            return res.render('access-denied', { user: req.user, reason: 'Discord server unreachable.' });
        }

        const member = await guild.members.fetch(req.user.id).catch(() => null);
        
        // Check staff roles from .env (comma-separated STAFF_ROLE_ID)
        const allowedRoles = (process.env.STAFF_ROLE_ID || '').split(',').map(id => id.trim()).filter(Boolean);
        const hasStaffRole = member && allowedRoles.some(roleId => member.roles.cache.has(roleId));

        if (!member || !hasStaffRole) {
            if (req.session) req.session.isStaffVerified = false;
            return res.render('access-denied', { user: req.user });
        }

        // Cache staff status in session
        if (req.session) {
            req.session.isStaffVerified = true;
            req.session.staffCheckedAt = Date.now();
        }

        // Register into staff.json
        rover.getRobloxUserFromDiscord(req.user.id).then((roblox) => {
            storage.registerStaff({
                discordId: req.user.id,
                discordTag: req.user.username,
                discordAvatar: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : null,
                robloxId: roblox?.robloxId || null,
                robloxUsername: roblox?.robloxUsername || null,
                lastSeen: new Date().toISOString()
            });
        }).catch(() => {});

        return next();
    } catch (err) {
        console.error('[AUTH CHECK ERROR]', err);
        return res.render('access-denied', { user: req.user });
    }
}

module.exports = {
    ensureAuthenticated,
    ensureStaff
};