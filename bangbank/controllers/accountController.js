const db = require('../db');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { validateOTP } = require('./otpController'); // adjust path if needed

// Multer config for KYC upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/kyc/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = crypto.randomBytes(8).toString('hex') + ext;
    cb(null, uniqueName);
  }
});
exports.uploadKYC = multer({ storage: storage }).single('kyc_document');

// GET: Render account application form
exports.renderApplyForm = async (req, res) => {
  const { product_id } = req.params;

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }
  const userId = req.session.user.id;

  try {
    // ✅ Always fetch the product first
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE product_id = ?',
      [product_id]
    );

    if (!product) {
      return res.status(404).send('Product not found');
    }

    // ✅ NEW: check product type
    if (product.product_type === 'credit_card') {
      return res.redirect(`/customer/creditcard/apply/${product_id}`);
    }

    // ✅ Check for duplicate if it's a savings product
    if (product.product_type === 'savings') {
      const [existingAccounts] = await db.query(
        `
          SELECT *
          FROM accounts
          WHERE userId = ?
          AND product_id = ?
          AND status IN ('pending', 'active')
        `,
        [userId, product_id]
      );

      if (existingAccounts.length > 0) {
        return res.redirect(
          `/customer/apply?error=${encodeURIComponent(
            `You already have an application or active account for ${product.product_name}.`
          )}`
        );
      }
    }

    // ✅ For fixed deposits → allow duplicates, no check needed

    // No duplicate found, proceed to render application form
    res.render('accountApply', {
      product,
      user: req.session.user,
      error: null
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading form');
  }
};

// POST: Handle form submission
exports.submitApplication = async (req, res) => {
  const { product_id } = req.params;
  const { id_type, id_number, initial_deposit, declaration } = req.body;

  // ✅ Adjust to match session format: user.id
  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }
  const userId = req.session.user.id;

  try {
    ;
    // ✅ Always fetch the product first!
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE product_id = ?',
      [product_id]
    );
    if (!product) {
      return res.status(404).send('Product not found.');
    }

    // ✅ NEW: check product type
    if (product.product_type === 'credit_card') {
      return res.redirect(`/customer/creditcard/apply/${product_id}`);
    }

    if (!declaration) {
      const [[product]] = await db.query('SELECT * FROM products WHERE product_id = ?', [product_id]);
      return res.render('accountApply', { product, user: req.session.user, error: 'You must agree to the declaration.' });
    }

    if (!req.file) {
      const [[product]] = await db.query('SELECT * FROM products WHERE product_id = ?', [product_id]);
      return res.render('accountApply', { product, user: req.session.user, error: 'KYC document is required.' });
    }

    // ✅ Check if user already has this account type
    if (product.product_type === 'savings') {
      const [existingAccounts] = await db.query(
        `
      SELECT * 
      FROM accounts 
      WHERE userId = ? 
      AND product_id = ? 
      AND status IN ('pending', 'active')
    `,
        [userId, product_id]
      );

      if (existingAccounts.length > 0) {
        return res.render('accountApply', {
          product,
          user: req.session.user,
          error: `You already have an application or active account for ${product.product_name}.`
        });
      }
    }

    // ✅ For fixed deposits → allow duplicates, no check needed

    const deposit = parseFloat(initial_deposit);
    if (isNaN(deposit) || deposit < 0) {
      return res.render('accountApply', {
        product,
        user: req.session.user,
        error: 'Please enter a valid initial deposit amount.'
      });
    }

    if (product.min_balance !== null) {
      if (deposit < parseFloat(product.min_balance)) {
        return res.render('accountApply', {
          product,
          user: req.session.user,
          error: `The minimum deposit for this product is $${parseFloat(product.min_balance).toFixed(2)}.`
        });
      }
    }

    // Validate ID number format
    let idRegex;

    if (id_type === 'nric') {
      idRegex = /^[STFG]\d{7}[A-Z]$/;
    } else if (id_type === 'passport') {
      idRegex = /^[A-Z]{1,2}\d{6,8}$/;
    } else {
      return res.render('accountApply', {
        product,
        user: req.session.user,
        error: 'Invalid ID type selected.'
      });
    }

    if (!idRegex.test(id_number)) {
      return res.render('accountApply', {
        product,
        user: req.session.user,
        error: `Invalid ID number format for ${id_type.toUpperCase()}.`
      });
    }

    // Generate random account number
    const account_number = 'RP' + Math.floor(100000000 + Math.random() * 900000000);

    // Create bank account first
    const [accountResult] = await db.query(
      `INSERT INTO accounts (userId, product_id, account_number, balance, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [userId, product_id, account_number, deposit]
    );

    const newAccountId = accountResult.insertId;

    // Save KYC document linked to this account
    await db.query(
      `INSERT INTO kyc_documents (userId, account_id, id_type, id_number, document_path, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [userId, newAccountId, id_type, id_number, '/uploads/kyc/' + req.file.filename]
    );

    res.redirect('/user/dashboard?success= Account application submitted. KYC pending approval.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to submit application');
  }
};

// GET: View all pending account applications (with KYC)
exports.viewPendingApplications = async (req, res) => {
  try {
    const [accounts] = await db.query(`
      SELECT 
        a.account_id,
        a.status,
        u.username,
        u.userEmail,
        p.product_name,
        k.id_type,
        k.id_number,
        k.document_path,
        k.status AS kyc_status
      FROM accounts a
      JOIN users u ON a.userId = u.userId
      JOIN products p ON a.product_id = p.product_id
      LEFT JOIN kyc_documents k
        ON k.account_id = a.account_id
      WHERE a.status = 'pending'
    `);

    res.render('adminAccount', {
      user: req.session.user,
      accounts
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load applications');
  }
};

// POST: Approve an account
exports.approveAccount = async (req, res) => {
  const { account_id } = req.params;
  try {
    await db.query(`UPDATE accounts SET status = 'active' WHERE account_id = ?`, [account_id]);
    await db.query(`UPDATE kyc_documents SET status = 'verified'
                    WHERE account_id = ?`, [account_id]);
    res.redirect('/admin/accounts');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to approve account');
  }
};

// POST: Reject an account
exports.rejectAccount = async (req, res) => {
  const { account_id } = req.params;
  try {
    const [[account]] = await db.query(
      `SELECT account_id FROM accounts WHERE account_id = ?`,
      [account_id]
    );

    if (!account) {
      return res.status(404).send('Account not found.');
    }

    // ✅ Update status to 'rejected' instead of deleting
    await db.query(`UPDATE accounts SET status = 'rejected' WHERE account_id = ?`, [account_id]);
    await db.query(`UPDATE kyc_documents SET status = 'rejected' WHERE account_id = ?`, [account_id]);

    res.redirect('/admin/accounts?success=Account application rejected.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to reject and delete account.');
  }
};

// POST: Delete an account (pending or active) with OTP validation
exports.deleteAccount = async (req, res) => {
  const account_id = parseInt(req.params.id, 10); // ✅ FIXED
  const { otp } = req.body;

  if (isNaN(account_id)) {
    return res.status(400).send('Invalid account ID.');
  }

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }

  const userId = req.session.user.id;

  try {
    const isValid = await validateOTP(userId, otp, 'account_cancel');

    if (!isValid) {
      // 🔁 Restore OTP session access so user can retry
      if (!req.session.otpAccess) {
        req.session.otpAccess = {
          type: 'account',
          id: account_id,
          timestamp: Date.now()
        };
      }

      return res.redirect(`/otp/confirm-delete/account/${account_id}?error=Invalid or expired OTP.`);
    }

    // ✅ OTP was valid — clear access
    req.session.otpAccess = null;

    console.log('DEBUG - userId:', userId);
    console.log('DEBUG - account_id:', account_id);

    await db.query(`DELETE FROM kyc_documents WHERE account_id = ?`, [account_id]);
    await db.query(`DELETE FROM accounts WHERE account_id = ?`, [account_id]);

    return res.redirect('/user/dashboard?success=Account deleted.');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to delete account.');
  }
};

// POST: Directly delete a pending account without OTP
exports.deletePendingAccount = async (req, res) => {
  const account_id = parseInt(req.params.account_id, 10);
  const userId = req.session.user?.id;

  if (!userId || isNaN(account_id)) {
    return res.status(400).send('Invalid request.');
  }

  try {
    // Confirm account belongs to user and is pending
    const [[account]] = await db.query(`
      SELECT * FROM accounts
      WHERE account_id = ? AND userId = ? AND status = 'pending'
    `, [account_id, userId]);

    if (!account) {
      return res.status(404).send('Account not found or not pending.');
    }

    await db.query(`DELETE FROM kyc_documents WHERE account_id = ?`, [account_id]);
    await db.query(`DELETE FROM accounts WHERE account_id = ?`, [account_id]);

    res.redirect('/user/dashboard?success=Bank account application canceled.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to cancel bank account application.');
  }
};

// GET: Render top-up page
exports.renderTopUpPage = async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [accounts] = await db.query(`
      SELECT 
        a.account_id, 
        a.balance, 
        p.product_name
      FROM accounts a
      JOIN products p ON a.product_id = p.product_id
      WHERE a.userId = ? 
        AND a.status = 'active' 
        AND p.product_type = 'savings'
    `, [userId]);

    res.render('topup', {
      user: req.session.user,
      accounts,
      error: req.query.error || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load top-up page.');
  }
};

// POST: Top up account balance
exports.topUpAccount = async (req, res) => {
  const { account_id } = req.params;
  const { amount } = req.body;
  const userId = req.session.user.id;

  try {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      return res.redirect('/account/topup?error=Invalid deposit amount.');
    }

    const [[account]] = await db.query(`SELECT * FROM accounts WHERE account_id = ? AND userId = ?`, [account_id, userId]);
    if (!account) {
      return res.redirect('/account/topup?error=Account not found.');
    }

    const newBalance = parseFloat(account.balance) + depositAmount;

    // Update account balance and log transaction
    await db.query(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newBalance, account_id]);
    await db.query(
      `INSERT INTO transactions (account_id, transaction_type, amount, description, balance_after)
       VALUES (?, 'deposit', ?, 'Top-up via dashboard', ?)`,
      [account_id, depositAmount, newBalance]
    );

    res.redirect('/user/dashboard?success=Top-up successful.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to top up account.');
  }
};

// GET: Render transfer page
exports.renderTransferPage = async (req, res) => {
  const userId = req.session.user.id;

  try {
    // Fetch user's own active savings accounts
    const [userAccounts] = await db.query(`
      SELECT 
        a.account_id, 
        a.balance, 
        p.product_name
      FROM accounts a
      JOIN products p ON a.product_id = p.product_id
      WHERE a.userId = ? 
        AND a.status = 'active'
        AND p.product_type = 'savings'
    `, [userId]);

    // Fetch all users' active savings accounts
    const [allUsers] = await db.query(`
      SELECT 
        u.userId, 
        u.username, 
        a.account_id, 
        a.balance, 
        p.product_name
      FROM users u
      JOIN accounts a ON u.userId = a.userId
      JOIN products p ON a.product_id = p.product_id
      WHERE a.status = 'active'
        AND p.product_type = 'savings'
    `);

    // Group accounts under each user
    const groupedUsers = {};
    allUsers.forEach(row => {
      if (!groupedUsers[row.userId]) {
        groupedUsers[row.userId] = {
          username: row.username,
          accounts: []
        };
      }
      groupedUsers[row.userId].accounts.push({
        account_id: row.account_id,
        product_name: row.product_name,
        balance: row.balance
      });
    });

    res.render('transfer', {
      user: req.session.user,
      userAccounts,
      allUsers: Object.values(groupedUsers),
      error: req.query.error || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load transfer page.');
  }
};

// POST: Transfer funds between accounts
exports.transferBetweenAccounts = async (req, res) => {
  const { from_account_id } = req.params;
  const { to_account_id, amount } = req.body;
  const userId = req.session.user.id;

  try {
    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.redirect('/account/transfer?error=Invalid transfer amount.');
    }

    // ✅ Get fromAccount (must belong to logged-in user)
    const [[fromAccount]] = await db.query(`
      SELECT a.*, u.username AS from_username, p.product_name AS from_product_name
      FROM accounts a
      JOIN users u ON a.userId = u.userId
      JOIN products p ON a.product_id = p.product_id
      WHERE a.account_id = ? AND a.userId = ?
    `, [from_account_id, userId]);

    if (!fromAccount) return res.status(404).send('Your source account was not found.');

    // ✅ Get toAccount (can belong to anyone)
    const [[toAccount]] = await db.query(`
      SELECT a.*, u.username AS to_username, p.product_name AS to_product_name
      FROM accounts a
      JOIN users u ON a.userId = u.userId
      JOIN products p ON a.product_id = p.product_id
      WHERE a.account_id = ?
    `, [to_account_id]);

    if (!toAccount) {
      return res.redirect('/account/transfer?error=Recipient account not found.');
    }

    if (fromAccount.account_id === toAccount.account_id) {
      return res.redirect('/account/transfer?error=Cannot transfer to the same account.');
    }

    if (fromAccount.balance < transferAmount) {
      return res.redirect('/account/transfer?error=Insufficient funds.');
    }

    const newFromBalance = fromAccount.balance - transferAmount;
    const newToBalance = toAccount.balance + transferAmount;

    // ✅ Update balances
    await db.query(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newFromBalance, fromAccount.account_id]);
    await db.query(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newToBalance, toAccount.account_id]);

    // ✅ Log transactions
    await db.query(
      `INSERT INTO transactions (account_id, transaction_type, amount, description, balance_after)
       VALUES (?, 'transfer', ?, ?, ?)`,
      [fromAccount.account_id, transferAmount, `Transfer to ${toAccount.to_username}'s ${toAccount.to_product_name}`, newFromBalance]
    );

    await db.query(
      `INSERT INTO transactions (account_id, transaction_type, amount, description, balance_after)
       VALUES (?, 'deposit', ?, ?, ?)`,
      [toAccount.account_id, transferAmount, `Transfer from ${fromAccount.from_username}'s ${fromAccount.from_product_name}`, newToBalance]
    );

    res.redirect('/user/dashboard?success=Transfer successful.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to transfer funds.');
  }
};