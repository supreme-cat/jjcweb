require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { initBot } = require('./services/bot');
const { initRoblox } = require('./services/roblox');

const app = express();

// Passport setup
require('./config/passport')(passport);

// Views setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false
    })
);

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));

// Initialize bot and Roblox auth
initRoblox();
initBot();

const PORT = process.env.PORT || 2211;
app.listen(PORT, () => console.log(`[WEB SERVER] Running on port ${PORT}`));