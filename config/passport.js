const DiscordStrategy = require('passport-discord').Strategy;

module.exports = function (passport) {
    passport.use(
        new DiscordStrategy(
            {
                clientID: process.env.DISCORD_CLIENT_ID,
                clientSecret: process.env.DISCORD_CLIENT_SECRET,
                callbackURL: process.env.DISCORD_CALLBACK_URL,
                scope: ['identify', 'guilds']
            },
            (accessToken, refreshToken, profile, done) => {
                return done(null, profile);
            }
        )
    );

    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((obj, done) => done(null, obj));
};