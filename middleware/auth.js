const { client } = require('../services/bot');

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

    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        if (!guild) {
            return res.render('access-denied', { user: req.user, reason: 'Discord server unreachable.' });
        }

        const member = await guild.members.fetch(req.user.id).catch(() => null);
        
        // Parse the comma-separated role IDs from .env
        const allowedRoles = (process.env.STAFF_ROLE_ID || '').split(',').map(id => id.trim());
        const hasStaffRole = member && allowedRoles.some(roleId => member.roles.cache.has(roleId));

        if (!member || !hasStaffRole) {
            return res.render('access-denied', { user: req.user });
        }

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