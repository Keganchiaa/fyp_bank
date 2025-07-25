const { google } = require('googleapis'); // ✅ Required to build event structure
const { getCalendarClient } = require('./oauth'); // ✅ Your new token-aware client

// Function to create a Google Meet event
async function createMeetEvent({ summary, description, startTime, endTime, attendees, tokens }) {
  // Use advisor's OAuth tokens to get authorized calendar client
  const calendar = getCalendarClient(tokens);

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

    return res.data; // Contains hangoutLink
  } catch (err) {
    console.error('🔴 Google Calendar event creation failed:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { createMeetEvent };