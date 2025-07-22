const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const db = require('../db'); // Your database configuration
const { validateOTP } = require('./otpController');

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
exports.uploadImage = upload.single('userImage');

// Render registration page
exports.renderRegister = (req, res) => {
    res.render('register');
};

// Register a new user
exports.register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).render('register', { error: 'Validation error. Please check your input.' });
    }

    const {
        username,
        userEmail,
        userPassword,
        confirmPassword,
        userRole,
        country,
        address_line_1,
        address_line_2,
        postcode,
        phone_number,
        date_of_birth,
        first_name,
        last_name,
        alias
    } = req.body;

    const userImage = req.file ? req.file.filename : 'default.png';

    try {
        if (!/^\d{8}$/.test(phone_number)) {
            return res.render('register', {
                error: 'Phone number must be exactly 8 digits.'
            });
        }

        if (!/^\d{6}$/.test(postcode)) {
            return res.render('register', { error: 'Postal code must be exactly 6 digits.' });
        }

        if (userPassword.length < 6) {
            return res.status(400).render('register', {
                error: 'Password must be at least 6 characters long.'
            });
        }

        if (userPassword !== confirmPassword) {
            return res.render('register', {
                error: 'Passwords do not match. Please try again.'
            });
        }

        const [existingUser] = await db.query(
            'SELECT * FROM users WHERE username = ? OR userEmail = ?',
            [username, userEmail]
        );

        if (existingUser.length > 0) {
            return res.render('register', {
                error: 'Username or email already exists. Please choose a different one.'
            });
        }

        const hashedPassword = await bcrypt.hash(userPassword, 10);

        const sql = `
            INSERT INTO users (
                username, userEmail, userPassword, userImage, userRole,
                country, address_line_1, address_line_2, postcode, phone_number,
                date_of_birth, first_name, last_name, alias
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await db.query(sql, [
            username, userEmail, hashedPassword, userImage, userRole || 'user',
            country, address_line_1, address_line_2 || null, postcode, phone_number,
            date_of_birth, first_name, last_name, alias || null
        ]);

        return res.redirect('/login?success=Registration successful! You can now log in.');
    } catch (error) {
        console.error('Error during user registration:', error);
        res.status(500).render('register', {
            error: 'An error occurred during registration. Please try again later.'
        });
    }
};

// Login user
exports.login = async (req, res) => {
    const { userEmail, userPassword } = req.body;

    try {
        // Fetch user by email
        const [users] = await db.query('SELECT * FROM users WHERE userEmail = ?', [userEmail]);

        // Check if user exists
        if (users.length === 0) {
            return res.render('login', { error: 'Invalid email or password.', success: null });
        }

        const user = users[0];

        // Compare hashed passwords
        const isMatch = await bcrypt.compare(userPassword, user.userPassword);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password.', success: null });
        }

        // Save user to session
        req.session.user = {
            id: user.userId,
            username: user.username,
            userImage: user.userImage,
            role: user.userRole
        };

        // Redirect based on role
        if (user.userRole === 'super_admin' || user.userRole === 'admin') {
            return res.redirect('/admin/dashboard');
        }
        if (user.userRole === 'advisor') {
            return res.redirect('/advisor/dashboard'); // you'll create this
        }
        return res.redirect('/user/dashboard');

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).render('login', {
            error: 'An error occurred during login. Please try again later.',
            success: null
        });
    }
};

// admin: Get admin dashboard
exports.getAdminDashboard = async (req, res) => {
    try {
        const [users] = await db.query('SELECT * FROM users');
        res.render('adminDashboard', {
            user: req.session.user,
            users, // fetched via db.query earlier in this function
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.render('adminDashboard', {
            user: req.session.user,
            users: [],
            error: 'Failed to load user list.'
        });
    }
};

// Render user dashboard
exports.renderUserDashboard = async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [accounts] = await db.query(`
      SELECT 
        a.account_id,
        a.balance,
        a.status,
        a.opened_at,
        p.product_name AS account_type,
        p.product_type
      FROM accounts a
      JOIN products p ON a.product_id = p.product_id
      WHERE a.userId = ?
    `, [userId]);

        const [cards] = await db.query(`
      SELECT 
        c.card_id,
        c.card_number,
        c.credit_limit,
        c.outstanding_balance,
        c.status,
        c.created_at,
        p.product_name
      FROM credit_cards c
      JOIN products p ON c.product_id = p.product_id
      WHERE c.userId = ?
    `, [userId]);

        res.render('userDashboard', {
            user: req.session.user,
            accounts,
            cards,
            success: req.query.success || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load dashboard');
    }
};

// view user details
exports.viewUserDetails = async (req, res) => {
    const userId = parseInt(req.params.id);
    const currentUserId = req.session.user.id;
    const currentRole = req.session.user.role;

    try {
        // ✅ Fetch user profile
        const [rows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);

        if (rows.length === 0) {
            return res.redirect('/admin/dashboard?error=User not found.');
        }

        const targetUser = rows[0];

        // 🚫 Prevent super admin from viewing their own details
        if (currentRole === 'super_admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=Please view your own details via the Profile page.');
        }

        // 🚫 Prevent admin from viewing their own details
        if (currentRole === 'admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=Please view your own details via the Profile page.');
        }

        // 🚫 Prevent admin from viewing other admins or super admin
        if (
            currentRole === 'admin' &&
            (targetUser.userRole === 'admin' || targetUser.userRole === 'super_admin')
        ) {
            return res.redirect('/admin/dashboard?error=You are not authorized to view this user.');
        }

        // ✅ Fetch user's accounts
        const [accounts] = await db.query(`
      SELECT 
        a.account_id,
        a.account_number,
        a.balance,
        a.status,
        a.opened_at,
        p.product_name,
        p.product_type
      FROM accounts a
      JOIN products p ON a.product_id = p.product_id
      WHERE a.userId = ?
    `, [userId]);

        // ✅ Fetch user's credit cards
        const [cards] = await db.query(`
      SELECT
        c.card_id,
        c.card_number,
        c.expiry_date,
        c.credit_limit,
        c.outstanding_balance,
        c.status,
        c.created_at,
        p.product_name,
        k.id_type,
        k.id_number,
        k.document_path,
        k.status AS kyc_status
      FROM credit_cards c
      JOIN products p ON c.product_id = p.product_id
      LEFT JOIN kyc_documents k ON k.card_id = c.card_id
      WHERE c.userId = ?
    `, [userId]);

        // ✅ Fetch user's KYC documents
        const [kycDocs] = await db.query(`
      SELECT k.*, a.account_number
      FROM kyc_documents k
      LEFT JOIN accounts a ON k.account_id = a.account_id
      WHERE k.userId = ?
    `, [userId]);

        // Attach the KYC doc to the related account
        accounts.forEach(account => {
            const kycDoc = kycDocs.find(k => k.account_id === account.account_id);
            account.kycDoc = kycDoc || null;
        });

        // ✅ Attach the KYC doc to the related credit card
        cards.forEach(card => {
            const kycDoc = kycDocs.find(k => k.card_id === card.card_id);
            card.kycDoc = kycDoc || null;
        });

        res.render('adminUserDetails', {
            user: targetUser,
            currentUser: req.session.user,
            accounts,
            cards,
            kycDocs,
            error: null,
            success: null
        });

    } catch (error) {
        console.error('Error fetching user details:', error);
        res.redirect('/admin/dashboard?error=Unable to load user details.');
    }
};

// create user
exports.createUser = async (req, res) => {
    try {
        const {
            username,
            userEmail,
            userPassword,
            userRole,
            country,
            address_line_1,
            address_line_2,
            postcode,
            phone_number,
            date_of_birth,
            first_name,
            last_name,
            alias
        } = req.body;

        // ✅ Validate phone number (8 digits)
        if (!/^\d{8}$/.test(phone_number)) {
            return res.redirect('/admin/dashboard?error=Phone number must be exactly 8 digits.');
        }

        // ✅ Validate postal code (6 digits)
        if (!/^\d{6}$/.test(postcode)) {
            return res.redirect('/admin/dashboard?error=Postal code must be exactly 6 digits.');
        }

        if (userPassword.length < 6) {
            return res.redirect('/admin/dashboard?error=Password must be at least 6 characters long.');
        }

        // Only allow admins to create user or advisor accounts
        if (
            req.session.user.role === 'admin' &&
            (userRole !== 'user' && userRole !== 'advisor')
        ) {
            return res.status(403).send('Admins can only create user or advisor accounts.');
        }

        // Prevent anyone from creating a super_admin (fixed role)
        if (userRole === 'super_admin') {
            return res.status(403).send('You are not authorized to create a super admin account.');
        }

        // Check for duplicates
        const [existing] = await db.query(
            'SELECT * FROM users WHERE username = ? OR userEmail = ?',
            [username, userEmail]
        );
        if (existing.length > 0) {
            return res.redirect('/admin/dashboard?error=Username or email already exists.');
        }

        const hashedPassword = await bcrypt.hash(userPassword, 10);
        const userImage = req.file ? req.file.filename : 'default.png';

        // Insert full user data
        await db.query(
            `INSERT INTO users (
        username, userEmail, userPassword, userImage, userRole,
        country, address_line_1, address_line_2, postcode, phone_number,
        date_of_birth, first_name, last_name, alias
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                username, userEmail, hashedPassword, userImage, userRole,
                country, address_line_1, address_line_2 || null, postcode, phone_number,
                date_of_birth, first_name, last_name, alias || null
            ]
        );

        res.redirect('/admin/dashboard?success=User created.');
    } catch (error) {
        console.error('Error creating user:', error);
        res.redirect('/admin/dashboard?error=Server error during user creation.');
    }
};

// Render form to edit user
exports.editUserForm = async (req, res) => {
    const userId = parseInt(req.params.id);
    const currentUserId = req.session.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);
        if (rows.length === 0) {
            return res.redirect('/admin/dashboard?error=User not found.');
        }

        const targetUser = rows[0];
        const currentRole = req.session.user.role;

        // 🚫 Prevent super admin from editing themselves
        if (
            currentRole === 'super_admin' &&
            userId === currentUserId
        ) {
            return res.redirect('/admin/dashboard?error=You are not allowed to edit your own super admin account.');
        }

        // 🚫 Prevent admin from editing themselves
        if (
            currentRole === 'admin' &&
            userId === currentUserId
        ) {
            return res.redirect('/admin/dashboard?error=You are not allowed to edit your own admin account.');
        }

        // 🚫 Prevent admin from editing another admin or super_admin
        if (
            currentRole === 'admin' &&
            (targetUser.userRole === 'admin' || targetUser.userRole === 'super_admin')
        ) {
            return res.redirect('/admin/dashboard?error=You are not authorized to edit this user.');
        }

        // ✅ Render the edit form with the user's data and the logged-in user's role
        res.render('editUsers', {
            user: targetUser,
            currentUser: req.session.user,
            error: null,
            success: null
        });

    } catch (error) {
        console.error('Error loading edit form:', error);
        res.redirect('/admin/dashboard?error=Unable to load edit form.');
    }
};

// edit user
exports.editUser = async (req, res) => {
    const userId = parseInt(req.params.id);
    const currentUserId = req.session.user.id;

    const {
        username,
        userEmail,
        userPassword,
        userRole,
        first_name,
        last_name,
        alias,
        date_of_birth,
        phone_number,
        country,
        address_line_1,
        address_line_2,
        postcode
    } = req.body;

    try {
        // Fetch current user to preserve image if not updated
        const [existingUserRows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);
        if (existingUserRows.length === 0) {
            return res.redirect('/admin/dashboard?error=User not found.');
        }
        const targetUser = existingUserRows[0];
        const currentRole = req.session.user.role;

        // 🚫 Block super admin from editing themselves
        if (currentRole === 'super_admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=You are not allowed to edit your own super admin account.');
        }

        // 🚫 Prevent admin from editing themselves
        if (currentRole === 'admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=You are not allowed to edit your own admin account.');
        }

        // 🚫 Block admin from updating another admin/super_admin
        if (
            currentRole === 'admin' &&
            (targetUser.userRole === 'admin' || targetUser.userRole === 'super_admin')
        ) {
            return res.redirect('/admin/dashboard?error=You are not authorized to update this user.');
        }

        if (!/^\d{8}$/.test(phone_number)) {
            return res.render('editUsers', {
                user: { ...req.body, userId, userImage: targetUser.userImage },
                currentUser: req.session.user,
                error: 'Phone number must be exactly 8 digits.',
                success: null
            });
        }

        // ✅ Validate postcode format (exactly 6 digits)
        if (!/^\d{6}$/.test(postcode)) {
            return res.render('editUsers', {
                user: { ...req.body, userId, userImage: targetUser.userImage },
                currentUser: req.session.user,
                error: 'Postal code must be exactly 6 digits.',
                success: null
            });
        }

        // ✅ Define userImage BEFORE any usage
        const userImage = req.file ? req.file.filename : targetUser.userImage;

        // ✅ Check for duplicate username/email (exclude current user)
        const [conflictUsers] = await db.query(
            'SELECT * FROM users WHERE (username = ? OR userEmail = ?) AND userId != ?',
            [username, userEmail, userId]
        );
        if (conflictUsers.length > 0) {
            return res.render('editUsers', {
                user: { ...req.body, userId, userImage },
                currentUser: req.session.user,
                error: 'Username or email already exists.',
                success: null
            });
        }

        // ✅ Password validation if provided
        if (userPassword && userPassword.length < 6) {
            return res.render('editUsers', {
                user: { ...req.body, userId, userImage },
                currentUser: req.session.user,
                error: 'Password must be at least 6 characters long.',
                success: null
            });
        }

        // Prepare update
        let sql, values;

        if (userPassword) {
            const hashedPassword = await bcrypt.hash(userPassword, 10);
            sql = `
        UPDATE users SET username = ?, userEmail = ?, userPassword = ?, userImage = ?, userRole = ?,
          first_name = ?, last_name = ?, alias = ?, date_of_birth = ?, phone_number = ?,
          country = ?, address_line_1 = ?, address_line_2 = ?, postcode = ?
        WHERE userId = ?
      `;
            values = [
                username, userEmail, hashedPassword, userImage, userRole,
                first_name, last_name, alias || null, date_of_birth, phone_number,
                country, address_line_1, address_line_2 || null, postcode,
                userId
            ];
        } else {
            sql = `
        UPDATE users SET username = ?, userEmail = ?, userImage = ?, userRole = ?,
          first_name = ?, last_name = ?, alias = ?, date_of_birth = ?, phone_number = ?,
          country = ?, address_line_1 = ?, address_line_2 = ?, postcode = ?
        WHERE userId = ?
      `;
            values = [
                username, userEmail, userImage, userRole,
                first_name, last_name, alias || null, date_of_birth, phone_number,
                country, address_line_1, address_line_2 || null, postcode,
                userId
            ];
        }

        await db.query(sql, values);

        res.redirect('/admin/dashboard?success=User updated successfully.');
    } catch (error) {
        console.error('Edit error:', error);
        res.render('editUsers', {
            user: { ...req.body, userId, userImage },
            currentUser: req.session.user,
            error: 'An error occurred. Please try again.',
            success: null
        });
    }
};

// delete user
exports.deleteUser = async (req, res) => {
    const userId = parseInt(req.params.id);
    const currentUserId = req.session.user.id;
    const currentRole = req.session.user.role;

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);

        if (rows.length === 0) {
            return res.redirect('/admin/dashboard?error=User not found.');
        }

        const targetUser = rows[0];

        // 🚫 Block super admin from deleting themselves
        if (currentRole === 'super_admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=You cannot delete your own super admin account.');
        }

        // 🚫 Prevent admin from deleting themselves
        if (currentRole === 'admin' && userId === currentUserId) {
            return res.redirect('/admin/dashboard?error=You cannot delete your own admin account.');
        }

        // 🚫 Block admin from deleting other admins or super admins
        if (
            currentRole === 'admin' &&
            (targetUser.userRole === 'admin' || targetUser.userRole === 'super_admin')
        ) {
            return res.redirect('/admin/dashboard?error=You are not authorized to delete this user.');
        }

        await db.query('DELETE FROM users WHERE userId = ?', [userId]);
        res.redirect('/admin/dashboard?success=User deleted successfully.');
    } catch (error) {
        console.error('Error deleting user:', error);
        res.redirect('/admin/dashboard?error=Unable to delete user.');
    }
};

// get user profile
exports.getProfile = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const userId = req.session.user.id;
        const [rows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);

        if (rows.length === 0) {
            return res.redirect('/login?error=User not found.');
        }

        res.render('profile', {
            user: rows[0], // ✅ pass full DB user object
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        console.error('Profile error:', err);
        res.redirect('/login?error=Could not load profile.');
    }
};

// Render form to edit profile
exports.renderEditProfile = async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE userId = ?', [userId]);
        if (rows.length === 0) {
            return res.redirect('/profile?error=User not found.');
        }

        res.render('editProfile', {
            user: rows[0],
            currentUser: req.session.user,
            error: req.query.error || null,
            success: req.query.success || null
        });
    } catch (error) {
        console.error('Error loading edit profile page:', error);
        res.redirect('/profile?error=Could not load profile edit page.');
    }
};

// update profile with OTP confirmation
exports.updateProfile = async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    const { otp } = req.body;
    const { type, id } = req.params;

    // ✅ Only process if OTP is valid
    if (req.originalUrl.includes('/verify/') && type === 'profile') {
        const isValid = await validateOTP(userId, otp, 'profile_update');
        if (!isValid) {
            return res.redirect(`/otp/confirm-update/${type}/${id}?error=Invalid or expired OTP.`);
        }

        // ✅ Only clear OTP access here after successful validation
        req.session.otpAccess = null;
    }

    // ✅ Load validated form data from session
    const draft = req.session.profileUpdateDraft;
    if (!draft) {
        return res.redirect('/profile?error=No profile update data found.');
    }

    const {
        username,
        userEmail,
        userPassword,
        confirmPassword,
        first_name,
        last_name,
        alias,
        date_of_birth,
        phone_number,
        country,
        address_line_1,
        address_line_2,
        postcode,
        userImage
    } = draft;

    try {
        let sql, values;

        if (userPassword) {
            const hashedPassword = await bcrypt.hash(userPassword, 10);
            sql = `
                UPDATE users SET username=?, userEmail=?, userPassword=?, userImage=?,
                first_name=?, last_name=?, alias=?, date_of_birth=?, phone_number=?,
                country=?, address_line_1=?, address_line_2=?, postcode=?
                WHERE userId=?
            `;
            values = [
                username, userEmail, hashedPassword, userImage,
                first_name, last_name, alias || null, date_of_birth, phone_number,
                country, address_line_1, address_line_2 || null, postcode,
                userId
            ];
        } else {
            sql = `
                UPDATE users SET username=?, userEmail=?, userImage=?,
                first_name=?, last_name=?, alias=?, date_of_birth=?, phone_number=?,
                country=?, address_line_1=?, address_line_2=?, postcode=?
                WHERE userId=?
            `;
            values = [
                username, userEmail, userImage,
                first_name, last_name, alias || null, date_of_birth, phone_number,
                country, address_line_1, address_line_2 || null, postcode,
                userId
            ];
        }

        await db.query(sql, values);

        // ✅ Update session user info
        req.session.user.username = username;
        req.session.user.userEmail = userEmail;
        req.session.user.userImage = userImage;

        // ✅ Clear draft (OTP already cleared above)
        req.session.profileUpdateDraft = null;

        return res.redirect('/profile?success=Profile updated successfully.');
    } catch (error) {
        console.error('Error updating profile:', error);
        return res.render('editProfile', {
            user: draft,
            currentUser: req.session.user,
            error: 'An error occurred. Please try again.',
            success: null
        });
    }
};

// initiate profile update
exports.initiateProfileUpdate = async (req, res) => {
    const userId = req.session.user.id;

    const {
        username,
        userEmail,
        userPassword,
        confirmPassword,
        first_name,
        last_name,
        alias,
        date_of_birth,
        phone_number,
        country,
        address_line_1,
        address_line_2,
        postcode
    } = req.body;

    const userImage = req.file ? req.file.filename : req.session.user.userImage;

    const renderError = (msg) => res.render('editProfile', {
        user: { ...req.body, userImage },
        currentUser: req.session.user,
        error: msg,
        success: null
    });

    // ✅ Validate
    if (!/^\d{8}$/.test(phone_number)) return renderError('Phone number must be exactly 8 digits.');
    if (!/^\d{6}$/.test(postcode)) return renderError('Postal code must be exactly 6 digits.');
    if (userPassword && userPassword.length < 6) return renderError('Password must be at least 6 characters long.');
    if (userPassword && userPassword !== confirmPassword) return renderError('Passwords do not match.');

    try {
        const [conflict] = await db.query(
            'SELECT * FROM users WHERE (username = ? OR userEmail = ?) AND userId != ?',
            [username, userEmail, userId]
        );
        if (conflict.length > 0) return renderError('Username or email is already taken.');

        // ✅ Save form data to session
        req.session.profileUpdateDraft = {
            username, userEmail, userPassword, confirmPassword,
            first_name, last_name, alias, date_of_birth, phone_number,
            country, address_line_1, address_line_2, postcode, userImage
        };

        return res.redirect(`/otp/request-update/profile/${userId}`);
    } catch (err) {
        console.error('Validation error:', err);
        return renderError('Server error. Please try again.');
    }
};

// Render forgot password form
exports.renderForgotPasswordForm = (req, res) => {
  res.render('forgotPassword', { error: null, success: null });
};

// Handle forgot password request
exports.initiatePasswordReset = async (req, res) => {
  const { userEmail, newPassword, confirmPassword } = req.body;

  const renderError = (msg) => {
    return res.render('forgotPassword', { error: msg, success: null });
  };

  if (!newPassword || newPassword.length < 6) {
    return renderError('Password must be at least 6 characters.');
  }

  if (newPassword !== confirmPassword) {
    return renderError('Passwords do not match.');
  }

  try {
    const [[user]] = await db.query(
      'SELECT * FROM users WHERE userEmail = ?',
      [userEmail]
    );

    if (!user) return renderError('No account found with that email.');

    // ✅ Save to session for later use after OTP
    req.session.passwordReset = {
      userId: user.userId,
      email: user.userEmail,
      newPassword,
    };

    return res.redirect(`/otp/request-password-reset/reset/${user.userId}`);
  } catch (err) {
    console.error('initiatePasswordReset error:', err);
    return renderError('Something went wrong. Please try again.');
  }
};

// Reset password with OTP confirmation
exports.resetPasswordWithOTP = async (req, res) => {
  const { otp } = req.body;
  const { type, id: userId } = req.params;

  if (req.originalUrl.includes('/verify/') && type === 'reset') {
    const isValid = await validateOTP(userId, otp, 'password_reset');
    req.session.otpError = 'Invalid or expired OTP.';
    if (!isValid) {
      return res.redirect(`/otp/confirm-update/${type}/${userId}?error=Invalid or expired OTP.`);
    }

    req.session.otpAccess = null;
  }

  const resetData = req.session.passwordReset;
  if (!resetData || resetData.userId != userId) {
    return res.redirect('/forgot-password?error=No password reset data found.');
  }

  try {
    const hashedPassword = await bcrypt.hash(resetData.newPassword, 10);

    await db.query(
      'UPDATE users SET userPassword = ? WHERE userId = ?',
      [hashedPassword, userId]
    );

    req.session.passwordReset = null;

    return res.redirect('/login?success=Password reset successful. You may now log in.');
  } catch (err) {
    console.error('resetPasswordWithOTP error:', err);
    return res.redirect('/forgot-password?error=Failed to reset password.');
  }
};