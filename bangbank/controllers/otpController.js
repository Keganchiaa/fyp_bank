const db = require('../db');
const { generateOTP } = require('../utils/generateOTP');
const nodemailer = require('nodemailer');

// Helper: Send OTP
const sendOTP = async (userId, email, purpose) => {
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60000); // 5 mins

    // ❌ Invalidate any previous OTPs that haven't been used yet
    await db.query(
        `UPDATE otp_tokens SET is_used = 1 
     WHERE userId = ? AND purpose = ? AND is_used = 0`,
        [userId, purpose]
    );

    await db.query(
        `INSERT INTO otp_tokens (userId, otp_code, purpose, expires_at) VALUES (?, ?, ?, ?)`,
        [userId, otpCode, purpose, expiresAt]
    );

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASS,
        },
    });

    await transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP for ${purpose} is ${otpCode}. It will expire in 5 minutes.`,
    });
};

// Helper: Validate OTP
const validateOTP = async (userId, otp, purpose) => {
    const [rows] = await db.query(
        `SELECT * FROM otp_tokens 
     WHERE userId = ? AND otp_code = ? AND purpose = ? AND is_used = 0 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
        [userId, otp, purpose]
    );

    if (rows.length === 0) return false;

    await db.query(`UPDATE otp_tokens SET is_used = 1 WHERE otp_id = ?`, [rows[0].otp_id]);
    return true;
};

// API: Send OTP
exports.sendOtpHandler = async (req, res) => {
    const { userId, email, purpose } = req.body;

    try {
        await sendOTP(userId, email, purpose);
        res.json({ success: true, message: 'OTP sent to email.' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ success: false, message: 'Failed to send OTP.' });
    }
};

// API: Verify OTP
exports.verifyOtpHandler = async (req, res) => {
    const { userId, otp, purpose } = req.body;

    try {
        const isValid = await validateOTP(userId, otp, purpose);
        if (isValid) {
            res.json({ success: true, message: 'OTP verified.' });
        } else {
            res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
        }
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ success: false, message: 'Failed to verify OTP.' });
    }
};

// Web: Trigger OTP for delete and redirect to confirm page
exports.requestOtpForDeletion = async (req, res) => {
    const { type, id } = req.params;
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    try {
        // safer: fetch user email from DB
        const [[row]] = await db.query('SELECT userEmail FROM users WHERE userId = ?', [user.id]);
        if (!row || !row.userEmail) throw new Error('User email not found');

        // ✅ Set purpose dynamically based on type
        const purpose = type === 'account' ? 'account_cancel' : 'card_cancel';

        // ✅ Save a secure flag in the session to allow access
        req.session.otpAccess = {
            type,
            id,
            timestamp: Date.now()
        };

        await sendOTP(user.id, row.userEmail, purpose);
        res.redirect(`/otp/confirm-delete/${type}/${id}?resent=1`);
    } catch (error) {
        console.error('Error sending OTP for delete:', error);
        res.redirect('/user/dashboard?error=Failed to send OTP. Try again.');
    }
};

// Web: Render OTP confirmation form for updates
exports.requestOtpForUpdate = async (req, res) => {
    const { type, id } = req.params;
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    try {
        const [[row]] = await db.query('SELECT userEmail FROM users WHERE userId = ?', [user.id]);
        if (!row || !row.userEmail) throw new Error('User email not found');

        // OTP purpose
        const purpose = type === 'reset' ? 'password_reset' : `${type}_update`;

        // ✅ Save OTP access for confirmation page access check
        req.session.otpAccess = {
            type,
            id,
            timestamp: Date.now(),
        };

        await sendOTP(user.id, row.userEmail, purpose);
        res.redirect(`/otp/confirm-update/${type}/${id}?resent=1`);
    } catch (err) {
        console.error('Error sending OTP for profile update:', err);
        res.redirect('/profile?error=Failed to send OTP.');
    }
};

// Web: Render OTP input form
exports.renderOtpConfirmationForm = (req, res) => {
    const { type, id } = req.params;
    const error = req.query.error || null;
    const resent = req.query.resent === '1';

    const access = req.session.otpAccess;

    // Debug log to confirm values
    console.log('OTP CONFIRM PAGE DEBUG:', { type, id, access });

    // ✅ Skip login check for password reset only
    if (!req.session.user && type !== 'reset') {
        return res.redirect('/login');
    }

    const fiveMinutes = 5 * 60 * 1000;
    const validSession =
        access &&
        access.type === type &&
        access.id === id &&
        Date.now() - access.timestamp < fiveMinutes;

    if (!validSession) {
        // Redirect based on context
        if (type === 'reset') {
            return res.redirect('/forgot-password?error=OTP session expired or invalid.');
        } else if (req.session.user?.role === 'user') {
            return res.redirect('/user/dashboard?error=OTP session expired or invalid.');
        } else {
            return res.redirect('/profile?error=OTP session expired or invalid.');
        }
    }

    if (!validSession) {
        return res.render('otpConfirm', {
            type,
            id,
            user: req.session.user || null,
            error: error || 'OTP session expired or invalid. Please click resend to get a new code.',
            resent: false
        });
    }

    return res.render('otpConfirm', {
        type,
        id,
        user: req.session.user || null,
        error,
        resent
    });
};

// Export helpers for use in account/creditCard controllers
exports.sendOTP = sendOTP;
exports.validateOTP = validateOTP;

// Web: Trigger OTP for password reset (no login required)
exports.requestOtpForPasswordReset = async (req, res) => {
    const { type, id } = req.params;

    // ✅ Verify session and required fields
    const resetData = req.session.passwordReset;

    console.log('DEBUG: passwordReset session =', resetData);

    console.log('DEBUG: id =', id);
    console.log('DEBUG: type =', type);

    if (!resetData) {
        return res.redirect('/forgot-password?error=Missing session.');
    }
    if (String(resetData.userId) !== String(id)) {
        return res.redirect('/forgot-password?error=User ID mismatch.');
    }
    if (type !== 'reset') {
        return res.redirect('/forgot-password?error=Invalid request type.');
    }

    try {
        const purpose = 'password_reset';
        const email = resetData.email;

        // Set OTP access to allow rendering of otpConfirm.ejs
        req.session.otpAccess = {
            type,
            id,
            timestamp: Date.now(),
        };

        await sendOTP(id, email, purpose);

        return res.redirect(`/otp/confirm-update/${type}/${id}?resent=1`);
    } catch (err) {
        console.error('Error sending OTP for password reset:', err);
        return res.redirect('/forgot-password?error=Failed to send OTP.');
    }
};