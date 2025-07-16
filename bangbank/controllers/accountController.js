const db = require('../db');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

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

    await db.query(`DELETE FROM kyc_documents WHERE account_id = ?`, [account_id]);
    await db.query(`DELETE FROM accounts WHERE account_id = ?`, [account_id]);

    res.redirect('/admin/accounts');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to reject and delete account.');
  }
};

// POST: Delete an account (pending or active)
exports.deleteAccount = async (req, res) => {
  const { account_id } = req.params;

  try {
    await db.query(`DELETE FROM kyc_documents WHERE account_id = ?`, [account_id]);
    await db.query(`DELETE FROM accounts WHERE account_id = ?`, [account_id]);

    res.redirect('/user/dashboard?success=Account deleted.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to delete account.');
  }
};