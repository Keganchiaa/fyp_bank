const db = require('../db'); // Adjust if your DB config is in a different path


exports.showReports = async (req, res) => {
  try {
    if (!req.session.user || !['admin', 'super_admin'].includes(req.session.user.role)) {
      return res.status(403).send('Unauthorized');
    }

    const [
      [totalUsers],
      [activeAccounts],
      [pendingAccounts],
      [activeCards],
      [pendingCards],
      [totalConsultations],
      [completedConsultations],
      [totalTransactions],
      [totalBalance]
    ] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total FROM users`),
      db.query(`SELECT COUNT(*) AS total FROM accounts WHERE status = 'active'`),
      db.query(`SELECT COUNT(*) AS total FROM accounts WHERE status = 'pending'`),
      db.query(`SELECT COUNT(*) AS total FROM credit_cards WHERE status = 'active'`),
      db.query(`SELECT COUNT(*) AS total FROM credit_cards WHERE status = 'pending'`),
      db.query(`SELECT COUNT(*) AS total FROM consultations`),
      db.query(`SELECT COUNT(*) AS total FROM consultations WHERE status = 'completed'`),
      db.query(`SELECT COUNT(*) AS total FROM transactions`),
      db.query(`SELECT SUM(balance) AS total FROM accounts WHERE status = 'active'`)
    ]);

    const [txnByDate] = await db.query(`
  SELECT 
    DATE(transaction_date) AS date,
    COUNT(*) AS count
  FROM transactions
  WHERE transaction_date >= CURDATE() - INTERVAL 7 DAY
  GROUP BY DATE(transaction_date)
  ORDER BY DATE(transaction_date)
`);



    const report = {
      title: 'Live System Analytics',
      total_users: totalUsers[0].total,
      active_accounts: activeAccounts[0].total,
      pending_accounts: pendingAccounts[0].total,
      active_cards: activeCards[0].total,
      pending_cards: pendingCards[0].total,
      total_consultations: totalConsultations[0].total,
      completed_consultations: completedConsultations[0].total,
      total_transactions: totalTransactions[0].total,
      total_balance: totalBalance[0].total || 0,
      generated_at: new Date()
    };

    res.render('showReport', {
      user: req.session.user,
      reports: [report], txnByDate
    });

  } catch (err) {
    console.error('Error generating live report:', err);
    res.status(500).send('Internal Server Error');
  }
};

