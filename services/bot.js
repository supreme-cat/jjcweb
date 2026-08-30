const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const robloxService = require('./roblox');
const roverService = require('./rover');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

async function logEvent(guild, { title, description, color }) {
    const logChannelId = process.env.TRAINING_LOGS_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;

    try {
        const targetGuild = guild || (process.env.DISCORD_GUILD_ID ? await client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null) : null);
        if (!targetGuild) return;

        const channel = await targetGuild.channels.fetch(logChannelId).catch(() => null);
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

/**
 * Strictly pulls guild members holding the TRAINEE_ROLE_ID from .env
 */
async function fetchWaveMembers() {
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.TRAINEE_ROLE_ID;

    if (!guildId || !roleId) {
        console.warn('[BOT] Missing DISCORD_GUILD_ID or TRAINEE_ROLE_ID.');
        return [];
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) return [];

        const members = await guild.members.fetch();
        const trainees = [];

        guild.members.cache.forEach((member) => {
            if (member.roles.cache.has(roleId) && !member.user.bot) {
                trainees.push({
                    discordId: member.id,
                    discordTag: member.user.username,
                    discordAvatar: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png` : null,
                    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null
                });
            }
        });

        return trainees;
    } catch (err) {
        console.error('[BOT] Error fetching wave members:', err.message);
        return [];
    }
}

/**
 * CRITICAL SEQUENCE FOR DISCORD KICK:
 * 1. DM the trainee in Discord with the reason.
 * 2. If DM fails, log to TRAINING_LOGS_CHANNEL_ID.
 * 3. Kick member from Discord server.
 */
async function executeDiscordTraineeKick({ discordId, robloxUsername, robloxId, reason, staffUsername }) {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !discordId) {
        return { success: false, error: 'Missing Discord ID or Guild ID.' };
    }

    let dmDelivered = false;
    let dmError = null;

    try {
        const targetUser = await client.users.fetch(discordId).catch(() => null);
        if (targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 JJC Production — Training Notice')
                .setDescription(`You have been removed from the JJC Production training program.`)
                .addFields(
                    { name: 'Roblox Account', value: `\`${robloxUsername || 'Linked Account'}\``, inline: true },
                    { name: 'Moderator', value: `\`${staffUsername || 'Staff Team'}\``, inline: true },
                    { name: 'Reason', value: reason || 'Violation of training guidelines.' }
                )
                .setColor(0xe74c3c)
                .setFooter({ text: 'JJC Production Management System' })
                .setTimestamp();

            await targetUser.send({ embeds: [embed] })
                .then(() => { dmDelivered = true; })
                .catch((err) => {
                    dmError = err.message;
                    console.warn(`[BOT] DM failed for ${discordId}: ${err.message}`);
                });
        }
    } catch (err) {
        dmError = err.message;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
        if (!dmDelivered) {
            await logEvent(guild, {
                title: '⚠️ Trainee DM Notice (DMs Closed / Failed)',
                description: `Could not deliver kick DM to <@${discordId}> (${robloxUsername || 'Unknown'}).\n**Error:** ${dmError || 'DMs Disabled'}\n**Reason:** ${reason}`,
                color: 0xf39c12
            });
        }

        // Kick from Discord
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (member) {
            await member.kick(`Training Kick: ${reason}`).catch((err) => {
                console.error(`[BOT] Failed to kick guild member ${discordId}:`, err.message);
            });
        }

        // Exile from Roblox Group if linked
        if (robloxId) {
            await robloxService.exileUser(robloxId).catch(() => {});
        }

        await logEvent(guild, {
            title: '🚫 Trainee Removed & Kicked from Server',
            description: `**Discord User:** <@${discordId}> (\`${discordId}\`)\n**Roblox Username:** \`${robloxUsername || 'N/A'}\`\n**Staff:** \`${staffUsername || 'Staff'}\`\n**Reason:** ${reason}`,
            color: 0xe74c3c
        });
    }

    return { success: true, dmDelivered, dmError };
}

/**
 * CRITICAL SEQUENCE FOR PASSING TRAINEE:
 * 1. DM feedback and determination reason FIRST.
 * 2. Assign required Role ID from .env (REQUIRED_ROLE_ID) SECOND.
 * 3. Send instructions to request Roblox group join and run /verify-group in Discord.
 */
async function executeTraineePass({ discordId, robloxUsername, robloxId, decisionReason, traineeFeedback, staffUsername }) {
    const guildId = process.env.DISCORD_GUILD_ID;
    const requiredRoleId = process.env.REQUIRED_ROLE_ID;
    const traineeRoleId = process.env.TRAINEE_ROLE_ID;

    let dmDelivered = false;

    try {
        const targetUser = await client.users.fetch(discordId).catch(() => null);
        if (targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 Training Evaluation — Passed!')
                .setDescription(`Congratulations! You have successfully passed your JJC Production training evaluation.`)
                .addFields(
                    { name: 'Status', value: '✅ **PASSED**', inline: true },
                    { name: 'Roblox Account', value: `\`${robloxUsername}\``, inline: true },
                    { name: 'Evaluator', value: `\`${staffUsername || 'Staff Evaluation Team'}\``, inline: true },
                    { name: 'Reason', value: decisionReason || 'Demonstrated proficiency and compliance throughout the wave.' },
                    { name: 'Instructor Feedback', value: traineeFeedback || 'Excellent performance.' },
                    { name: 'Next Steps', value: '1. Request to join the official **JJC Production Roblox Group**.\n2. In our Discord server, run the `/verify-group` command to have your group request accepted automatically!' }
                )
                .setColor(0x2ecc71)
                .setFooter({ text: 'JJC Production Management System' })
                .setTimestamp();

            await targetUser.send({ embeds: [embed] })
                .then(() => { dmDelivered = true; })
                .catch(() => {});
        }
    } catch (err) {}

    // Role assignment
    if (guildId) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (guild) {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (member) {
                if (requiredRoleId) {
                    await member.roles.add(requiredRoleId).catch(() => {});
                }
                if (traineeRoleId && member.roles.cache.has(traineeRoleId)) {
                    await member.roles.remove(traineeRoleId).catch(() => {});
                }
            }

            // Auto-accept group request if already pending
            if (robloxId) {
                await robloxService.handleJoinRequest(robloxId, true).catch(() => {});
            }

            await logEvent(guild, {
                title: '🎓 Trainee Graduated & Passed Wave',
                description: `**Discord User:** <@${discordId}> (\`${discordId}\`)\n**Roblox Username:** \`${robloxUsername}\`\n**Evaluator:** \`${staffUsername || 'Staff'}\``,
                color: 0x2ecc71
            });
        }
    }

    return { success: true, dmDelivered };
}

/**
 * CRITICAL SEQUENCE FOR FAILING TRAINEE:
 * 1. DM feedback and reason FIRST.
 * 2. Kick from Discord SECOND.
 */
async function executeTraineeFail({ discordId, robloxUsername, robloxId, decisionReason, traineeFeedback, staffUsername }) {
    return executeDiscordTraineeKick({
        discordId,
        robloxUsername,
        robloxId,
        reason: `${decisionReason || 'Did not meet training wave requirements.'} | Feedback: ${traineeFeedback || 'None.'}`,
        staffUsername
    });
}

/**
 * Send in-game session kick notification to Discord user
 */
async function sendSessionKickDM({ robloxUsername, robloxId, reason, staffUsername }) {
    const userLookup = await roverService.getDiscordIdFromRoblox(robloxId, robloxUsername);
    if (!userLookup || !userLookup.discordId) {
        return { delivered: false, error: 'User not verified with RoVer; could not send Discord DM.' };
    }

    try {
        const user = await client.users.fetch(userLookup.discordId);
        if (!user) return { delivered: false, error: 'Discord user not found.' };

        const embed = new EmbedBuilder()
            .setTitle('🚨 JJC Production — Session Notice')
            .setDescription(`You have been removed from the active ER:LC training session.`)
            .addFields(
                { name: 'Roblox Account', value: `\`${robloxUsername}\``, inline: true },
                { name: 'Staff Moderator', value: `\`${staffUsername || 'Staff Team'}\``, inline: true },
                { name: 'Reason', value: reason || 'Removed by staff during active session.' }
            )
            .setColor(0xe74c3c)
            .setFooter({ text: 'JJC Production Management Panel' })
            .setTimestamp();

        await user.send({ embeds: [embed] });
        return { delivered: true, discordId: userLookup.discordId };
    } catch (err) {
        return { delivered: false, error: `Could not send DM: ${err.message}` };
    }
}

// ==================== EXISTING GROUP ACCEPTANCE LOGIC (PRESERVED) ====================

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

    if (!process.env.DISCORD_TOKEN) return;

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        if (client.user?.id) {
            await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log('[BOT] /verify-group slash command registered.');
        }
    } catch (error) {
        console.error('[BOT] Error registering slash commands:', error.message);
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
    if (!targetRoleId) return;
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
        }
    } else if (lostRole) {
        await kickUserFromRobloxGroup(newMember.guild, newMember.id, newMember.user.tag, 'Required Discord role removed.');
    }
});

client.on('guildMemberRemove', async (member) => {
    if (process.env.REQUIRED_ROLE_ID && member.roles.cache.has(process.env.REQUIRED_ROLE_ID)) {
        await kickUserFromRobloxGroup(member.guild, member.id, member.user.tag, 'User left or was kicked from the Discord server.');
    }
});

function initBot() {
    if (process.env.DISCORD_TOKEN) {
        client.login(process.env.DISCORD_TOKEN).catch((err) => {
            console.error('[BOT] Discord login failed:', err.message);
        });
    }
}

module.exports = {
    client,
    initBot,
    fetchWaveMembers,
    executeDiscordTraineeKick,
    executeTraineePass,
    executeTraineeFail,
    sendSessionKickDM,
    logEvent
};