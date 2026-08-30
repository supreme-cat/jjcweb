const ACTIVE_WINDOW_MS = 70000;
const staffSessions = new Map();

function touchStaff(user, page = 'panel') {
    if (!user?.id) {
        return;
    }

    staffSessions.set(user.id, {
        id: user.id,
        name: user.username || 'Staff',
        avatarUrl: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : null,
        page,
        lastSeen: Date.now()
    });
}

function getActiveStaff() {
    const now = Date.now();

    for (const [id, staff] of staffSessions) {
        if (now - staff.lastSeen > ACTIVE_WINDOW_MS) {
            staffSessions.delete(id);
        }
    }

    return [...staffSessions.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((staff) => ({
            ...staff,
            status: staff.page === 'session' ? 'Session panel' : 'Management panel'
        }));
}

module.exports = { touchStaff, getActiveStaff };
