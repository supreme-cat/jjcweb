require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();

// Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 * 7 } // 7 days session
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport Serialization
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Fetch Roblox data from RoVer
async function fetchRoverAccount(discordId) {
  try {
    const res = await axios.get(
      `https://registry.rover.link/api/guilds/${process.env.DISCORD_GUILD_ID}/discord-to-roblox/${discordId}`,
      {
        headers: {
          Authorization: process.env.ROVER_API_KEY ? `Bearer ${process.env.ROVER_API_KEY}` : ''
        }
      }
    );
    return {
      robloxId: res.data.robloxId,
      robloxUsername: res.data.robloxUsername
    };
  } catch (err) {
    return { robloxId: null, robloxUsername: null };
  }
}

// Discord OAuth2 Strategy Configuration
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
  // Fetch RoVer details on login
  const roverData = await fetchRoverAccount(profile.id);

  const user = {
    discordId: profile.id,
    username: profile.username,
    avatar: profile.avatar,
    robloxId: roverData.robloxId,
    robloxUsername: roverData.robloxUsername
  };

  return done(null, user);
}));

// Serve static dashboard/training page files
app.use(express.static(path.join(__dirname, 'public')));

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/'
}), (req, res) => {
  res.redirect('/dashboard');
});

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Middleware to protect routes (require login)
function checkAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/discord');
}

// API endpoint for frontend JavaScript to get current logged-in user data
app.get('/api/user', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user: req.user
  });
});

// Protected Dashboard Page
app.get('/dashboard', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(process.env.PORT || 2211, () => {
  console.log(`Training portal live at http://localhost:${process.env.PORT || 2211}`);
});