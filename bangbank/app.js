require('dotenv').config(); // Load environment variables

// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

// Import database connection
const db = require('./db');

// ✅ Custom controllers
const userController = require('./controllers/userController');
const productController = require('./controllers/productController');
const accountController = require('./controllers/accountController');
const creditCardController = require('./controllers/creditCardController');
const consultationController = require('./controllers/consultationController');
const otpController = require('./controllers/otpController');
const transactionController = require('./controllers/transactionController');
const reportController = require('./controllers/reportController');

// ✅ OAuth utility
const oauth = require('./utils/oauth');

const app = express();

// Middleware for parsing JSON and URL-encoded data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session management
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // true if using HTTPS
}));

// Track previous page
app.use((req, res, next) => {
  if (!req.session) return next();
  if (req.headers.referer) {
    req.session.previousPage = req.headers.referer;
  }
  next();
});

// Set EJS as view engine and serve static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Middleware: Auth checks
const isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login?error=Please log in to continue.');
};

// ✅ Only allow admin or super_admin to access
const isAdminOrSuperadmin = (req, res, next) => {
  const role = req.session.user?.role;
  if (role === 'admin' || role === 'super_admin') return next();
  res.status(403).send('Access denied');
};

// ✅ Only allow customers to access
const isUserOnly = (req, res, next) => {
  const role = req.session.user?.role;
  if (role === 'user') return next();
  res.status(403).send('Access denied: Customers only');
};

// ✅ Only allow advisor to access
const isAdvisorOnly = (req, res, next) => {
  const role = req.session.user?.role;
  if (role === 'advisor') return next();
  res.status(403).send('Access denied: Advisor only');
};

// ================== ROUTES ================== //

// Home
app.get('/', (req, res) => {
  res.render('home', { user: req.session.user || null });
});

// Register (GET and POST)
app.get('/register', userController.renderRegister);
app.post('/register', userController.uploadImage, userController.register);

// Login (GET and POST)
app.get('/login', (req, res) => {
  const success = req.query.success || null;
  const error = req.query.error || null;
  res.render('login', { success, error });
});

// Login POST handler
app.post('/login', userController.login);

// Dashboard
app.get('/user/dashboard', isAuthenticated, isUserOnly, userController.renderUserDashboard);

// User Profile
app.get('/profile', isAuthenticated, userController.getProfile);

// otp and profile update
app.post('/otp/request/:type/:id', isAuthenticated, userController.uploadImage, otpController.requestOtpForUpdate);
app.post('/profile/initiate-update', isAuthenticated, userController.uploadImage, userController.initiateProfileUpdate);

// OTP verification
app.post('/otp/verify/:type/:id', userController.uploadImage, async (req, res) => {
  const { type } = req.params;

  // Require login for profile/account/card OTP flows
  if (type === 'profile' || type === 'account' || type === 'card') {
    if (!req.session.user) {
      return res.redirect('/login?error=Please log in to confirm this action.');
    }
  }

  if (type === 'profile') {
    return require('./controllers/userController').updateProfile(req, res);
  } else if (type === 'account') {
    return require('./controllers/accountController').deleteAccount(req, res);
  } else if (type === 'card') {
    return require('./controllers/creditCardController').deleteCard(req, res);
  } else if (type === 'reset') {
    return require('./controllers/userController').resetPasswordWithOTP(req, res);
  } else {
    return res.status(400).send('Invalid OTP verification type.');
  }
});

// User Profile Edit
app.get('/profile/edit', isAuthenticated, userController.renderEditProfile);

// Admin Dashboard + CRUD
app.get('/admin/dashboard', isAuthenticated, isAdminOrSuperadmin, userController.getAdminDashboard);
app.post('/admin/create', isAuthenticated, isAdminOrSuperadmin, userController.uploadImage, userController.createUser);
app.get('/admin/edit/:id', isAuthenticated, isAdminOrSuperadmin, userController.editUserForm);
app.post('/admin/edit/:id', isAuthenticated, isAdminOrSuperadmin, userController.uploadImage, userController.editUser);
app.get('/admin/delete/:id', isAuthenticated, isAdminOrSuperadmin, userController.deleteUser);
app.get('/admin/details/:id', isAuthenticated, isAdminOrSuperadmin, userController.viewUserDetails);

// ADMIN PRODUCT ROUTES
app.get('/admin/products', isAuthenticated, isAdminOrSuperadmin, productController.getAllProducts);
app.get('/admin/products/edit/:id', isAuthenticated, isAdminOrSuperadmin, productController.editProductForm);
app.post('/admin/products/edit/:id', isAuthenticated, isAdminOrSuperadmin, productController.updateProduct);
app.post('/admin/products/delete/:id', isAuthenticated, isAdminOrSuperadmin, productController.deleteProduct);
app.post('/admin/products/create', isAuthenticated, isAdminOrSuperadmin, productController.createProduct);

// ADMIN ACCOUNT ROUTES
app.get('/admin/accounts', isAuthenticated, isAdminOrSuperadmin, accountController.viewPendingApplications);
app.post('/admin/accounts/approve/:account_id', isAuthenticated, isAdminOrSuperadmin, accountController.approveAccount);
app.post('/admin/accounts/reject/:account_id', isAuthenticated, isAdminOrSuperadmin, accountController.rejectAccount);

// ADMIN CREDIT CARD ROUTES
app.get('/admin/creditcards', isAuthenticated, isAdminOrSuperadmin, creditCardController.viewPendingApplications);
app.post('/admin/creditcards/approve/:card_id', isAuthenticated, isAdminOrSuperadmin, creditCardController.approveCard);
app.post('/admin/creditcards/reject/:card_id', isAuthenticated, isAdminOrSuperadmin, creditCardController.rejectCard);

// ADVISOR ROUTES
app.get('/advisor/dashboard', isAuthenticated, isAdvisorOnly, consultationController.viewAdvisorDashboard);
app.post('/advisor/consultations/complete/:consultation_id', isAuthenticated, isAdvisorOnly, consultationController.completeConsultation);
app.post('/advisor/consultations/notes/:consultation_id', isAuthenticated, isAdvisorOnly, consultationController.updateNotes);
app.post('/advisor/sessions/create', isAuthenticated, isAdvisorOnly, consultationController.createSession);
app.post('/advisor/sessions/delete/:session_id', isAuthenticated, isAdvisorOnly, consultationController.deleteSession);
app.get('/advisor/sessions/edit/:session_id', isAuthenticated, isAdvisorOnly, consultationController.renderEditSessionForm);
app.post('/advisor/sessions/edit/:session_id', isAuthenticated, isAdvisorOnly, consultationController.updateSession);

// CUSTOMER PRODUCT VIEW
app.get('/customer/apply', isAuthenticated, isUserOnly, productController.viewAvailableProducts);

// CUSTOMER ACCOUNT ROUTES
app.get('/customer/apply/:product_id', isAuthenticated, isUserOnly, accountController.renderApplyForm);
app.post('/customer/apply/:product_id', isAuthenticated, isUserOnly, accountController.uploadKYC, accountController.submitApplication);
app.post('/otp/verify-delete/account/:account_id', isAuthenticated, isUserOnly, accountController.deleteAccount);
// Direct delete for pending bank account (no OTP)
app.post('/customer/account/delete/:account_id', isAuthenticated, isUserOnly, accountController.deletePendingAccount);
// top up and transfer routes
app.get('/account/topup', isAuthenticated, isUserOnly, accountController.renderTopUpPage);
app.get('/account/transfer', isAuthenticated, isUserOnly, accountController.renderTransferPage);
app.post('/account/topup/:account_id', isAuthenticated, isUserOnly, accountController.topUpAccount);
app.post('/account/transfer/:from_account_id', isAuthenticated, isUserOnly, accountController.transferBetweenAccounts);

// CUSTOMER CREDIT CARD ROUTES
app.get('/customer/creditcard/apply/:product_id', isAuthenticated, isUserOnly, creditCardController.renderApplyForm);
app.post('/customer/creditcard/apply/:product_id', isAuthenticated, isUserOnly, creditCardController.uploadKYC, creditCardController.submitApplication);
app.post('/otp/verify-delete/card/:card_id', isAuthenticated, isUserOnly, creditCardController.deleteCard);
// Direct delete for pending credit card (no OTP)
app.post('/customer/creditcard/delete/:card_id', isAuthenticated, isUserOnly, creditCardController.deletePendingCard);

// CUSTOMER CONSULTATION ROUTES
app.get('/customer/consultations', isAuthenticated, isUserOnly, consultationController.viewAvailableSessions);
app.post('/customer/consultations/book/:session_id', isAuthenticated, isUserOnly, consultationController.bookSession);
app.post('/customer/consultations/cancel/:consultation_id', isAuthenticated, isUserOnly, consultationController.cancelSession);

// view all rejected applications
app.get('/user/rejected-applications', isAuthenticated, isUserOnly, userController.viewRejectedApplications);

// View transaction history
app.get('/customer/transactions', isAuthenticated, isUserOnly, transactionController.viewUserTransactions);

// Forgot password process
app.get('/forgot-password', userController.renderForgotPasswordForm);
app.post('/forgot-password', userController.initiatePasswordReset);

//OTP ROUTES
app.post('/otp/send', otpController.sendOtpHandler);
app.post('/otp/verify', otpController.verifyOtpHandler);

// POST: Trigger OTP and redirect to confirmation page
app.post('/otp/request-delete/:type/:id', otpController.requestOtpForDeletion);
app.get('/otp/request-delete/:type/:id', otpController.requestOtpForDeletion);
app.get('/otp/confirm-delete/:type/:id', otpController.renderOtpConfirmationForm);

// update OTP request and confirmation
app.get('/otp/request-update/:type/:id', otpController.requestOtpForUpdate);
app.get('/otp/confirm-update/:type/:id', otpController.renderOtpConfirmationForm);

// Reset password with OTP
app.get('/otp/request-password-reset/:type/:id', otpController.requestOtpForPasswordReset);
app.get('/otp/confirm-update/:type/:id', otpController.renderOtpConfirmationForm);

// Report generation
app.get('/admin/reports', isAuthenticated, isAdminOrSuperadmin, reportController.showReports);
app.get('/admin/report/excel', isAuthenticated, isAdminOrSuperadmin, reportController.downloadExcelWithCharts);

// Google Calendar OAuth
app.get('/google/login', (req, res) => {
  const url = oauth.getAuthUrl();
  res.redirect(url);
});

// OAuth2 Callback
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;

  try {
    const tokens = await oauth.getAccessToken(code);
    const user = req.session.user;

    if (!user) return res.redirect('/login?error=Login required first');
    if (user.role !== 'advisor') {
      return res.redirect('/?error=Only advisors can connect Google Calendar.');
    }

    // Save advisor tokens
    await db.query(
      `UPDATE users SET google_tokens = ? WHERE userId = ?`,
      [JSON.stringify(tokens), user.id]
    );

    res.redirect('/advisor/dashboard?success=Google Calendar connected!');
  } catch (err) {
    console.error('❌ OAuth2 callback failed:', err.message);
    res.redirect('/advisor/dashboard?error=Failed to connect Google Calendar.');
  }
});

// ✅ Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Could not log out');
    }
    res.redirect('/');
  });
});

// ✅ Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// ✅ Start Server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));