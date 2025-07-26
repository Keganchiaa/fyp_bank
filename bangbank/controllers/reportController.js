const db = require('../db');
const ExcelJS = require('exceljs');

// ADMIN: Show live system analytics report
exports.showReports = async (req, res) => {
  try {
    // ✅ Simple role-based access
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
      reports: [report],
      txnByDate
    });
  } catch (err) {
    console.error('Error generating live report:', err);
    res.status(500).send('Internal Server Error');
  }
};

// Download Excel (basic fallback version)
exports.downloadExcelWithCharts = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');

    // Example structure — you can dynamically fill this in the future
    sheet.addRow(['Title', 'Total Users', 'Active Accounts', 'Pending Accounts']);
    sheet.addRow(['Live System Analytics', 10, 6, 4]);

    const chartSheet = workbook.addWorksheet('Chart Base64s');
    chartSheet.addRow(['Note: Chart screenshots not included (Puppeteer removed)']);

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename=bangbank_report.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Error generating fallback Excel:', err);
    res.status(500).send('Failed to generate Excel');
  }
};