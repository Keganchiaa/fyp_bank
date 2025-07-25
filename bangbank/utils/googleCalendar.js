const { google } = require('googleapis');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'),
  scopes: SCOPES
});

const calendar = google.calendar({ version: 'v3', auth });

async function createMeetEvent({ summary, description, startTime, endTime, attendees }) {
  // Generate a placeholder Meet link
  const randomId = Math.random().toString(36).substring(2, 10);
  const meetLink = `https://meet.google.com/osv-ozqx-iwk`;

  const event = {
    summary,
    description,
    start: {
      dateTime: startTime,
      timeZone: 'Asia/Singapore'
    },
    end: {
      dateTime: endTime,
      timeZone: 'Asia/Singapore'
    },
    attendees: attendees.map(email => ({ email })),
    location: meetLink // Use this instead of conferenceData
  };

  try {
    console.log('📤 Creating event with:', JSON.stringify(event, null, 2));

    const res = await calendar.events.insert({
      calendarId: 'keganchia@gmail.com',
      resource: event,
      sendUpdates: 'all'
    });

    // Return the placeholder link
    return {
      ...res.data,
      hangoutLink: meetLink
    };
  } catch (err) {
    console.error('🔴 Google Calendar event creation failed:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { createMeetEvent };