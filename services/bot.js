const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const robloxService = require('./roblox');
const roverService = require('./rover');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

async function logEvent(guild, { title, description, color }) {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId || !guild) return;

    try {
        const channel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (channel && channel.isTextBased()) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color || 0x3498db)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[BOT] Failed to send log:', err.message);
    }
}

async function processUserGroupRequest(member) {
    if (!member.roles.cache.has(process.env.REQUIRED_ROLE_ID)) {
        return { success: false, reason: 'User does not have the required Discord role.' };
    }

    const robloxUser = await roverService.getRobloxUserFromDiscord(member.id);
    if (!robloxUser || !robloxUser.robloxId) {
        return { success: false, reason: 'User is not verified with RoVer.' };
    }

    try {
        await robloxService.handleJoinRequest(robloxUser.robloxId, true);
        return { success: true, robloxId: robloxUser.robloxId };
    } catch (err) {
        return { success: false, reason: `Roblox API error: ${err.message}`, robloxId: robloxUser.robloxId };
    }
}

async function kickUserFromRobloxGroup(guild, discordId, discordTag, reasonText) {
    const robloxUser = await roverService.getRobloxUserFromDiscord(discordId);
    
    if (!robloxUser || !robloxUser.robloxId) {
        await logEvent(guild, {
            title: '⚠️ Exile Skipped (RoVer Unverified)',
            description: `Attempted to exile **${discordTag}** (ID: \`${discordId}\`), but they are not verified with RoVer.`,
            color: 0xe74c3c
        });
        return;
    }

    try {
        await robloxService.exileUser(robloxUser.robloxId);
        await logEvent(guild, {
            title: '🚫 User Exiled from Roblox Group',
            description: `**Discord User:** ${discordTag} (<@${discordId}>)\n**Roblox ID:** \`${robloxUser.robloxId}\`\n**Reason:** ${reasonText}`,
            color: 0xe74c3c
        });
    } catch (err) {
        await logEvent(guild, {
            title: '❌ Exile Failed (Roblox API Error)',
            description: `Failed to exile **${discordTag}**.\n**Error:** ${err.message}`,
            color: 0xe74c3c
        });
    }
}

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('verify-group')
            .setDescription('Accepts your pending Roblox group join request if you have the required role.')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('[BOT] /verify-group slash command registered.');
    } catch (error) {
        console.error('[BOT] Error registering slash commands:', error);
    }
}

client.once('clientReady', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
    await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'verify-group') {
        await interaction.deferReply({ ephemeral: true });
        const member = interaction.member;
        const result = await processUserGroupRequest(member);

        if (result.success) {
            await interaction.editReply('Success! Your group join request has been accepted.');
            await logEvent(interaction.guild, {
                title: '✅ Group Request Accepted (/verify-group)',
                description: `**Discord User:** ${member.user.tag} (<@${member.id}>)\n**Roblox ID:** \`${result.robloxId}\``,
                color: 0x2ecc71
            });
        } else {
            await interaction.editReply(`Failed: ${result.reason}`);
            await logEvent(interaction.guild, {
                title: '⚠️ Group Request Check Failed (/verify-group)',
                description: `**Discord User:** ${member.user.tag} (<@${member.id}>)\n**Reason:** ${result.reason}`,
                color: 0xf1c40f
            });
        }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const targetRoleId = process.env.REQUIRED_ROLE_ID;
    const gainedRole = !oldMember.roles.cache.has(targetRoleId) && newMember.roles.cache.has(targetRoleId);
    const lostRole = oldMember.roles.cache.has(targetRoleId) && !newMember.roles.cache.has(targetRoleId);

    if (gainedRole) {
        const result = await processUserGroupRequest(newMember);
        if (result.success) {
            await logEvent(newMember.guild, {
                title: '✅ Group Request Accepted (Role Granted)',
                description: `**Discord User:** ${newMember.user.tag} (<@${newMember.id}>)\n**Roblox ID:** \`${result.robloxId}\``,
                color: 0x2ecc71
            });
        } else {
            await logEvent(newMember.guild, {
                title: 'ℹ️ Role Granted (Group Acceptance Skipped)',
                description: `**Discord User:** ${newMember.user.tag} (<@${newMember.id}>)\n**Details:** ${result.reason}`,
                color: 0x3498db
            });
        }
    } else if (lostRole) {
        await kickUserFromRobloxGroup(newMember.guild, newMember.id, newMember.user.tag, 'Required Discord role removed.');
    }
});

client.on('guildMemberRemove', async (member) => {
    if (member.roles.cache.has(process.env.REQUIRED_ROLE_ID)) {
        await kickUserFromRobloxGroup(member.guild, member.id, member.user.tag, 'User left or was kicked from the Discord server.');
    }
});

function initBot() {
    if (process.env.DISCORD_TOKEN) {
        client.login(process.env.DISCORD_TOKEN);
    }
}

module.exports = { client, initBot };