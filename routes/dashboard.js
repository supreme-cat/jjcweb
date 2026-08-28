const express = require('express');
const router = express.Router();
const { ensureStaff } = require('../middleware/auth');

router.get('/', ensureStaff, (req, res) => {
    res.render('dashboard', { user: req.user });
});

module.exports = router;