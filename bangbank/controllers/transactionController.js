const db = require('../db');

// GET: Show all transactions belonging to the user's accounts
exports.viewUserTransactions = async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [transactions] = await db.query(`
  SELECT 
    t.transaction_id,
    t.transaction_type,
    t.amount,
    t.description,
    t.transaction_date,
    t.balance_after,
    a.account_id,
    p.product_name AS account_name,
    u.username AS owner_name
  FROM transactions t
  JOIN accounts a ON t.account_id = a.account_id
  JOIN products p ON a.product_id = p.product_id
  JOIN users u ON a.userId = u.userId
  WHERE a.userId = ?
  ORDER BY t.transaction_date DESC
`, [userId]);

    res.render('transactionHistory', {
      user: req.session.user,
      transactions
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load transaction history.');
  }
};