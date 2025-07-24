const db = require('../db');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { validateOTP } = require('./otpController');

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

// GET: Render credit card application form
exports.renderApplyForm = async (req, res) => {
  const { product_id } = req.params;

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }

  const userId = req.session.user.id;

  try {
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE product_id = ?',
      [product_id]
    );

    if (!product) {
      return res.status(404).send('Product not found');
    }

    // ✅ NEW: Block non-credit-card products
    if (product.product_type !== 'credit_card') {
      return res.redirect(`/customer/apply/${product_id}`);
    }

    // ✅ Only run these checks for credit cards
    if (product.product_type === 'credit_card') {

      // ✅ Check for at least one active savings account
      const [savingsAccounts] = await db.query(`
        SELECT * FROM accounts
        WHERE userId = ? 
          AND status = 'active'
          AND product_id IN (
            SELECT product_id 
            FROM products 
            WHERE product_type = 'savings'
          )
      `, [userId]);

      if (savingsAccounts.length === 0) {
        return res.redirect(
          `/customer/apply?error=${encodeURIComponent(
            'You must have at least one active savings account before applying for a credit card.'
          )}`
        );
      }

      // ✅ Check for duplicate credit card applications
      const [existingCards] = await db.query(`
        SELECT * 
        FROM credit_cards
        WHERE userId = ?
          AND product_id = ?
          AND status IN ('pending', 'active')
      `, [userId, product_id]);

      if (existingCards.length > 0) {
        return res.redirect(
          `/customer/apply?error=${encodeURIComponent(
            `You already have an application or active credit card for ${product.product_name}.`
          )}`
        );
      }
    }

    res.render('creditCardApply', {
      product,
      user: req.session.user,
      error: null
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading credit card form');
  }
};

// POST: Handle credit card application submission
exports.submitApplication = async (req, res) => {
  const { product_id } = req.params;
  const { id_type, id_number, desired_limit, declaration } = req.body;

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }
  const userId = req.session.user.id;

  try {
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE product_id = ?',
      [product_id]
    );

    if (!product) {
      return res.status(404).send('Product not found.');
    }

    // ✅ NEW: Block non-credit-card products
    if (product.product_type !== 'credit_card') {
      return res.redirect(`/customer/apply/${product_id}`);
    }

    // ✅ Only check these rules for credit cards
    if (product.product_type === 'credit_card') {
      // ✅ Rule #2 - Check for at least one active savings account
      const [savingsAccounts] = await db.query(`
        SELECT * FROM accounts
        WHERE userId = ?
          AND status = 'active'
          AND product_id IN (
            SELECT product_id
            FROM products
            WHERE product_type = 'savings'
          )
      `, [userId]);

      if (savingsAccounts.length === 0) {
        return res.render('creditCardApply', {
          product,
          user: req.session.user,
          error: 'You must have at least one active savings account before applying for a credit card.'
        });
      }

      // ✅ Rule #1 - Check for duplicate applications for this credit card product
      const [existingCards] = await db.query(`
        SELECT *
        FROM credit_cards
        WHERE userId = ?
          AND product_id = ?
          AND status IN ('pending', 'active')
      `, [userId, product_id]);

      if (existingCards.length > 0) {
        return res.render('creditCardApply', {
          product,
          user: req.session.user,
          error: `You already have an application or active credit card for ${product.product_name}.`
        });
      }
    }

    if (!declaration) {
      return res.render('creditCardApply', {
        product,
        user: req.session.user,
        error: 'You must agree to the declaration.'
      });
    }

    if (!req.file) {
      return res.render('creditCardApply', {
        product,
        user: req.session.user,
        error: 'KYC document is required.'
      });
    }

    const limit = parseFloat(desired_limit);
    if (isNaN(limit) || limit <= 0) {
      return res.render('creditCardApply', {
        product,
        user: req.session.user,
        error: 'Please enter a valid desired credit limit.'
      });
    }

    // Validate ID number format
    let idRegex;
    if (id_type === 'nric') {
      idRegex = /^[STFG]\d{7}[A-Z]$/;
    } else if (id_type === 'passport') {
      idRegex = /^[A-Z]{1,2}\d{6,8}$/;
    } else {
      return res.render('creditCardApply', {
        product,
        user: req.session.user,
        error: 'Invalid ID type selected.'
      });
    }

    if (!idRegex.test(id_number)) {
      return res.render('creditCardApply', {
        product,
        user: req.session.user,
        error: `Invalid ID number format for ${id_type.toUpperCase()}.`
      });
    }

    // Generate random card number (16 digits)
    const card_number = String(Math.floor(1e15 + Math.random() * 9e15));

    // Generate expiry date (e.g. 3 years from now)
    const expiry_date = new Date();
    expiry_date.setFullYear(expiry_date.getFullYear() + 3);

    // Create credit card application (pending status)
    const [cardResult] = await db.query(
      `INSERT INTO credit_cards
      (userId, product_id, card_number, expiry_date, credit_limit, outstanding_balance, status)
      VALUES (?, ?, ?, ?, ?, 0.00, 'pending')`,
      [userId, product_id, card_number, expiry_date, limit]
    );

    const newCardId = cardResult.insertId;

    // Save KYC document linked to this card
    await db.query(
      `INSERT INTO kyc_documents
       (userId, card_id, id_type, id_number, document_path, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [userId, newCardId, id_type, id_number, '/uploads/kyc/' + req.file.filename]
    );

    res.redirect('/user/dashboard?success=Credit card application submitted. KYC pending approval.');

  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to submit credit card application');
  }
};

// GET: View all pending credit card applications
exports.viewPendingApplications = async (req, res) => {
  try {
    const [cards] = await db.query(`
      SELECT
        c.card_id,
        c.status,
        c.card_number,
        c.expiry_date,
        c.credit_limit,
        u.username,
        u.userEmail,
        p.product_name,
        k.id_type,
        k.id_number,
        k.document_path,
        k.status AS kyc_status
      FROM credit_cards c
      JOIN users u ON c.userId = u.userId
      JOIN products p ON c.product_id = p.product_id
      LEFT JOIN kyc_documents k
        ON k.card_id = c.card_id
      WHERE c.status = 'pending'
    `);

    res.render('adminCreditCards', {
      user: req.session.user,
      cards,
      success: req.query.success || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load credit card applications');
  }
};

// POST: Approve credit card application
exports.approveCard = async (req, res) => {
  const { card_id } = req.params;
  const { approved_limit } = req.body;

  try {
    const limit = parseFloat(approved_limit);
    if (isNaN(limit) || limit <= 0) {
      return res.redirect('/admin/creditcards?error=Invalid approved credit limit.');
    }

    await db.query(`
      UPDATE credit_cards
      SET credit_limit = ?, status = 'active'
      WHERE card_id = ?
    `, [limit, card_id]);

    await db.query(`
      UPDATE kyc_documents
      SET status = 'verified'
      WHERE card_id = ?
    `, [card_id]);

    res.redirect('/admin/creditcards?success=Credit card application approved.');

  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to approve credit card');
  }
};

// POST: Reject credit card application
exports.rejectCard = async (req, res) => {
  const { card_id } = req.params;

  try {
    //update card and KYC status to rejected
    await db.query(`UPDATE credit_cards SET status = 'rejected' WHERE card_id = ?`, [card_id]);
    await db.query(`UPDATE kyc_documents SET status = 'rejected' WHERE card_id = ?`, [card_id]);

    res.redirect('/admin/creditcards?success=Credit card application rejected.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to reject credit card application');
  }
};

// DELETE: User deletes their credit card after OTP verification
exports.deleteCard = async (req, res) => {
  const card_id = parseInt(req.params.id, 10); // ✅ FIXED
  const { otp } = req.body;

  if (isNaN(card_id)) {
    return res.status(400).send('Invalid card ID.');
  }

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('Session expired. Please log in again.');
  }

  const userId = req.session.user.id;

  try {
    const isValid = await validateOTP(userId, otp, 'card_cancel');

    if (!isValid) {
      // 🔁 Re-store OTP session access so user can retry
      if (!req.session.otpAccess) {
        req.session.otpAccess = {
          type: 'card',
          id: card_id,
          timestamp: Date.now()
        };
      }

      return res.redirect(`/otp/confirm-delete/card/${card_id}?error=Invalid or expired OTP.`);
    }

    // ✅ OTP was valid — clear access
    req.session.otpAccess = null;

    console.log('DEBUG - userId:', userId);
    console.log('DEBUG - card_id:', card_id);

    const [[card]] = await db.query(`
      SELECT * FROM credit_cards
      WHERE card_id = ? AND userId = ?
    `, [card_id, userId]);

    console.log('DEBUG - card lookup result:', card);

    if (!card) {
      return res.status(404).send('Credit card not found or you do not have permission to delete it.');
    }

    await db.query(`DELETE FROM kyc_documents WHERE card_id = ?`, [card_id]);
    await db.query(`DELETE FROM credit_cards WHERE card_id = ?`, [card_id]);

    return res.redirect('/user/dashboard?success=Credit card deleted successfully.');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to delete credit card.');
  }
};

// POST: Directly delete pending credit card application without OTP
exports.deletePendingCard = async (req, res) => {
  const card_id = parseInt(req.params.card_id, 10);
  const userId = req.session.user?.id;

  if (!userId || isNaN(card_id)) {
    return res.status(400).send('Invalid request.');
  }

  try {
    // Confirm card belongs to user and is pending
    const [[card]] = await db.query(`
      SELECT * FROM credit_cards
      WHERE card_id = ? AND userId = ? AND status = 'pending'
    `, [card_id, userId]);

    if (!card) {
      return res.status(404).send('Card not found or not pending.');
    }

    await db.query(`DELETE FROM kyc_documents WHERE card_id = ?`, [card_id]);
    await db.query(`DELETE FROM credit_cards WHERE card_id = ?`, [card_id]);

    res.redirect('/user/dashboard?success=Credit card application canceled.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to cancel credit card application.');
  }
};