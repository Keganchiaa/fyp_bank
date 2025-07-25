const { google } = require('googleapis');
const { getClient, setAccessToken } = require('./oauth'); // adjust path if needed

// Function to create a Google Meet event
async function createMeetEvent({ summary, description, startTime, endTime, attendees, tokens }) {
  // Apply user's access token
  setAccessToken(tokens);
  const calendar = google.calendar({ version: 'v3', auth: getClient() });

  // Real Google Meet link using conferenceData
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
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: {
          type: 'hangoutsMeet'
        }
      }
    }
  };

  try {
    console.log('📤 Creating event with:', JSON.stringify(event, null, 2));

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all'
    });

    return res.data; // contains .hangoutLink
  } catch (err) {
    console.error('🔴 Google Calendar event creation failed:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { createMeetEvent };