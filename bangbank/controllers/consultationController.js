const db = require('../db');
const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const { createMeetEvent } = require('../utils/googleCalendar');

// Helper: Send email with Google Meet link
function sendMeetEmail({ to, subject, meetLink, sessionDate, startTime }) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,        // ✅ match .env
            pass: process.env.EMAIL_PASS    // ✅ match .env
        }
    });

    const mailOptions = {
        from: process.env.EMAIL,
        to,
        subject,
        html: `
      <p>You have a new consultation scheduled.</p>
      <p><strong>Date:</strong> ${sessionDate}</p>
      <p><strong>Time:</strong> ${startTime} (SGT)</p>
      <p><strong>Join Link:</strong> <a href="${meetLink}" target="_blank">${meetLink}</a></p>
      <br>
      <p>See you on Google Meet!</p>
    `
    };

    return transporter.sendMail(mailOptions);
}

//advisor: View dashboard with all sessions and consultations
exports.viewAdvisorDashboard = async (req, res) => {
    const advisorId = req.session.user.id;

    try {
        // Get latest advisor info (includes google_tokens)
        const [[advisor]] = await db.query('SELECT * FROM users WHERE userId = ?', [advisorId]);

        // Fetch ALL sessions created by this advisor + booking counts
        const [mySessions] = await db.query(
            `SELECT 
          s.*, 
          COUNT(c.consultation_id) AS booking_count
       FROM sessions s
       LEFT JOIN consultations c ON c.session_id = s.session_id
       WHERE s.advisorId = ?
         AND TIMESTAMP(s.session_date, s.session_time) >= NOW()
       GROUP BY s.session_id
       ORDER BY s.session_date, s.session_time`,
            [advisorId]
        );

        // Fetch consultations (i.e. booked sessions) for this advisor
        const [consultations] = await db.query(
            `SELECT 
            c.*, 
            s.session_date, 
            s.session_time,
            s.end_time,
            u.username AS customer_name,
            u.userEmail AS customer_email
       FROM consultations c
       JOIN sessions s ON c.session_id = s.session_id
       JOIN users u ON c.userId = u.userId
       WHERE c.advisorId = ?
       ORDER BY s.session_date, s.session_time`,
            [advisorId]
        );

        res.render('advisorDashboard', {
            user: advisor,
            mySessions,
            consultations,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading advisor dashboard.');
    }
};

// Advisor: Render form to create a new session
exports.renderCreateSessionForm = (req, res) => {
    res.render('createSession', {
        user: req.session.user,
        success: req.query.success || null,
        error: req.query.error || null
    });
};

// Advisor: Create a new session
exports.createSession = async (req, res) => {
    const { session_date, start_time, } = req.body;
    const advisorId = req.session.user.id;

    try {
        // Today's date/time in your local zone
        const now = DateTime.local();

        const selectedDateTime = DateTime.fromISO(`${session_date}T${start_time}`);

        // If date is in the past
        if (selectedDateTime < now.startOf('day')) {
            return res.redirect('/advisor/dashboard?error=Date cannot be in the past.');
        }

        // If today, check time
        if (selectedDateTime.hasSame(now, 'day')) {
            if (selectedDateTime < now) {
                return res.redirect('/advisor/dashboard?error=Start time cannot be in the past.');
            }
        }

        // Check business hours
        const hour = selectedDateTime.hour;
        if (hour < 9 || hour > 17) {
            return res.redirect('/advisor/dashboard?error=Start time must be between 09:00 and 17:00.');
        }

        // Check for duplicate session
        const [existingSessions] = await db.query(
            `SELECT COUNT(*) AS count
       FROM sessions
       WHERE advisorId = ?
         AND session_date = ?
         AND session_time = ?`,
            [advisorId, session_date, start_time]
        );

        if (existingSessions[0].count > 0) {
            return res.redirect('/advisor/dashboard?error=A session at this date and time already exists.');
        }

        // Compute end time
        const endDateTime = selectedDateTime.plus({ hours: 1 });
        const end_time = endDateTime.toFormat('HH:mm');

        // Save session
        await db.query(
            `INSERT INTO sessions (session_date, session_time, end_time, advisorId, is_booked)
       VALUES (?, ?, ?, ?, 0)`,
            [session_date, start_time, end_time, advisorId]
        );

        res.redirect('/advisor/dashboard?success=Session created successfully!');
    } catch (error) {
        console.error(error);
        res.redirect('/advisor/dashboard?error=Could not create session.');
    }
};

// Customer view of available sessions and their booked consultations
exports.viewAvailableSessions = async (req, res) => {
    const userId = req.session.user.id;

    try {
        // Fetch all sessions, including booking counts
        const [sessions] = await db.query(
            `SELECT 
      s.*, 
      u.username AS advisor_name,
      u.userEmail AS advisor_email,
      COUNT(c.consultation_id) AS booking_count
   FROM sessions s
   JOIN users u ON s.advisorId = u.userId
   LEFT JOIN consultations c ON c.session_id = s.session_id
   WHERE 
     s.is_booked = 0
     AND TIMESTAMP(s.session_date, s.session_time) >= NOW()
   GROUP BY s.session_id
   ORDER BY s.session_date, s.session_time`
        );

        // Fetch this customer's own bookings
        const [myConsultations] = await db.query(
            `SELECT c.*, 
              s.session_date, 
              s.session_time, 
              s.end_time, 
              u.username AS advisor_name,
              u.userEmail AS advisor_email
       FROM consultations c
       JOIN sessions s ON c.session_id = s.session_id
       JOIN users u ON c.advisorId = u.userId
       WHERE c.userId = ?
       ORDER BY s.session_date, s.session_time`,
            [userId]
        );

        res.render('customerConsultations', {
            user: req.session.user,
            sessions: sessions || [],
            myConsultations: myConsultations || [],
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading consultations.');
    }
};

// Customer books a session
exports.bookSession = async (req, res) => {
    const sessionId = req.params.session_id;
    const userId = req.session.user.id;

    try {
        // ✅ Check if session is available
        const [sessionCheck] = await db.query(
            `SELECT * FROM sessions WHERE session_id = ? AND is_booked = 0`,
            [sessionId]
        );

        if (sessionCheck.length === 0) {
            return res.redirect('/customer/consultations?error=Session already booked or unavailable.');
        }

        const session = sessionCheck[0];
        const advisorId = session.advisorId;

        // ✅ Check for existing booking conflict
        const [conflict] = await db.query(
            `SELECT COUNT(*) AS count
             FROM consultations c
             JOIN sessions s ON c.session_id = s.session_id
             WHERE c.userId = ?
               AND s.session_date = ?
               AND s.session_time = ?
               AND c.status = 'booked'`,
            [userId, session.session_date, session.session_time]
        );

        if (conflict[0].count > 0) {
            return res.redirect('/customer/consultations?error=You already have a consultation booked at this time.');
        }

        // ✅ Get user and advisor details
        const [[customer]] = await db.query('SELECT username, userEmail FROM users WHERE userId = ?', [userId]);
        const [[advisor]] = await db.query('SELECT username, userEmail, google_tokens FROM users WHERE userId = ?', [advisorId]);

        // ✅ Ensure advisor has connected Google Calendar
        let advisorTokens;
        try {
            if (!advisor.google_tokens) {
                return res.redirect('/customer/consultations?error=Advisor has not connected Google Calendar.');
            }
            advisorTokens = typeof advisor.google_tokens === 'string'
                ? JSON.parse(advisor.google_tokens)
                : advisor.google_tokens;
        } catch (err) {
            console.error('❌ Failed to parse advisor Google tokens:', err);
            return res.redirect('/customer/consultations?error=Invalid advisor token data.');
        }

        // ✅ Build ISO timestamps
        console.log('🕓 RAW values:', session.session_date, session.session_time, session.end_time);

        // ✅ Construct ISO datetime strings
        const sessionDate = new Date(session.session_date).toISOString().split('T')[0];
        const sessionStart = session.session_time.slice(0, 5);
        const sessionEnd = session.end_time.slice(0, 5);

        const startTimeISO = new Date(`${sessionDate}T${sessionStart}:00+08:00`).toISOString();
        const endTimeISO = new Date(`${sessionDate}T${sessionEnd}:00+08:00`).toISOString();

        // ✅ Create Google Meet using advisor's tokens
        let meetLink = null;
        try {
            const event = await createMeetEvent({
                summary: `Consultation with ${advisor.username}`,
                description: `Consultation between ${customer.username} and ${advisor.username}`,
                startTime: startTimeISO,
                endTime: endTimeISO,
                attendees: [customer.userEmail, advisor.userEmail],
                tokens: advisorTokens
            });
            meetLink = event.hangoutLink;
        } catch (err) {
            console.error('❌ Failed to create Google Meet:', err.response?.data || err.message);
        }

        // ✅ Save consultation and session status
        await db.query(
            `INSERT INTO consultations (userId, advisorId, session_id, status, meet_link)
             VALUES (?, ?, ?, 'booked', ?)`,
            [userId, advisorId, sessionId, meetLink]
        );

        await db.query(`UPDATE sessions SET is_booked = 1 WHERE session_id = ?`, [sessionId]);

        // ✅ Send confirmation emails
        if (meetLink) {
            const subject = 'Your BangBank Consultation Booking';
            await sendMeetEmail({
                to: customer.userEmail,
                subject,
                meetLink,
                sessionDate,
                startTime: sessionStart
            });
            await sendMeetEmail({
                to: advisor.userEmail,
                subject: 'New Customer Consultation Booking',
                meetLink,
                sessionDate,
                startTime: sessionStart
            });
        }

        return res.redirect('/customer/consultations?success=Consultation booked successfully! Check your email for details.');
    } catch (error) {
        console.error('❌ Booking error:', error);
        return res.redirect('/customer/consultations?error=An error occurred while booking your consultation.');
    }
};

// Customer cancels a session
exports.cancelSession = async (req, res) => {
    const consultationId = req.params.consultation_id;

    try {
        const [consultation] = await db.query(
            'SELECT session_id FROM consultations WHERE consultation_id = ?',
            [consultationId]
        );

        if (consultation.length === 0) {
            return res.redirect('/customer/consultations?error=Consultation not found.');
        }

        const sessionId = consultation[0].session_id;

        await db.query('UPDATE sessions SET is_booked = 0 WHERE session_id = ?', [sessionId]);

        await db.query(
            'UPDATE consultations SET status = "cancelled" WHERE consultation_id = ?',
            [consultationId]
        );

        res.redirect('/customer/consultations?success=Consultation cancelled successfully!');
    } catch (error) {
        console.error(error);
        res.redirect('/customer/consultations?error=An error occurred while cancelling your consultation.');
    }
};

// Advisor marks consultation as completed
exports.completeConsultation = async (req, res) => {
    const consultationId = req.params.consultation_id;

    try {
        await db.query(
            'UPDATE consultations SET status = "completed" WHERE consultation_id = ?',
            [consultationId]
        );

        res.redirect('/advisor/dashboard?success=Consultation marked as completed.');
    } catch (error) {
        console.error(error);
        res.redirect('/advisor/dashboard?error=Error marking consultation as completed.');
    }
};

// Advisor updates consultation notes
exports.updateNotes = async (req, res) => {
    const consultationId = req.params.consultation_id;
    const { notes } = req.body;

    try {
        await db.query(
            'UPDATE consultations SET notes = ? WHERE consultation_id = ?',
            [notes, consultationId]
        );

        res.redirect('/advisor/dashboard?success=Notes saved successfully.');
    } catch (error) {
        console.error(error);
        res.redirect('/advisor/dashboard?error=Error saving notes.');
    }
};

// Advisor deletes a session
exports.deleteSession = async (req, res) => {
    const sessionId = req.params.session_id;

    try {
        await db.query(
            `DELETE FROM sessions WHERE session_id = ?`,
            [sessionId]
        );

        res.redirect('/advisor/dashboard?success=Session deleted successfully!');
    } catch (error) {
        console.error(error);
        res.redirect('/advisor/dashboard?error=Could not delete session.');
    }
};

// Advisor renders form to edit a session
exports.renderEditSessionForm = async (req, res) => {
    const sessionId = req.params.session_id;

    try {
        const [rows] = await db.query(
            `SELECT * FROM sessions WHERE session_id = ?`,
            [sessionId]
        );

        if (rows.length === 0) {
            return res.redirect('/advisor/dashboard?error=Session not found.');
        }

        const session = rows[0];

        res.render('editSession', {
            user: req.session.user,
            session,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error(error);
        res.redirect('/advisor/dashboard?error=Error loading session.');
    }
};

// Advisor updates session details
exports.updateSession = async (req, res) => {
    const sessionId = req.params.session_id;
    const { session_date, start_time } = req.body;
    const advisorId = req.session.user.id;

    try {
        const now = DateTime.local();

        const selectedDateTime = DateTime.fromISO(`${session_date}T${start_time}`);

        // If date is in the past
        if (selectedDateTime < now.startOf('day')) {
            return res.redirect(`/advisor/sessions/edit/${sessionId}?error=Date cannot be in the past.`);
        }

        // If today, check time
        if (selectedDateTime.hasSame(now, 'day')) {
            if (selectedDateTime < now) {
                return res.redirect(`/advisor/sessions/edit/${sessionId}?error=Start time cannot be in the past.`);
            }
        }

        // Check business hours
        const hour = selectedDateTime.hour;
        if (hour < 9 || hour > 17) {
            return res.redirect(`/advisor/sessions/edit/${sessionId}?error=Start time must be between 09:00 and 17:00.`);
        }

        // Check for duplicate session, excluding the current one
        const [existingSessions] = await db.query(
            `SELECT COUNT(*) AS count
       FROM sessions
       WHERE advisorId = ?
         AND session_date = ?
         AND session_time = ?
         AND session_id != ?`,
            [advisorId, session_date, start_time, sessionId]
        );

        if (existingSessions[0].count > 0) {
            return res.redirect(`/advisor/sessions/edit/${sessionId}?error=A session at this date and time already exists.`);
        }

        // Compute end time = start_time + 1 hour
        const endDateTime = selectedDateTime.plus({ hours: 1 });
        const end_time = endDateTime.toFormat('HH:mm');

        await db.query(
            `UPDATE sessions
       SET session_date = ?, session_time = ?, end_time = ?
       WHERE session_id = ?`,
            [session_date, start_time, end_time, sessionId]
        );

        res.redirect('/advisor/dashboard?success=Session updated successfully!');
    } catch (error) {
        console.error(error);
        res.redirect(`/advisor/sessions/edit/${sessionId}?error=Could not update session.`);
    }
};