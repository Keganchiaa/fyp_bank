const { google } = require('googleapis');
require('dotenv').config();

// Initialize OAuth2 client with credentials
const oauth2Client = new google.auth.OAuth2(
  process.env.OAUTH_CLIENT_ID,
  process.env.OAUTH_CLIENT_SECRET,
  process.env.OAUTH_REDIRECT_URI // now from .env for safety/flexibility
);

// ✅ Generate the Google Auth URL
function getAuthUrl() {
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures refresh_token is always returned
    scope: scopes
  });
}

// ✅ Exchange code for tokens
async function getAccessToken(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  return tokens; // contains access_token and refresh_token
}

// ✅ Set token manually (e.g. from DB)
function setAccessToken(tokens) {
  oauth2Client.setCredentials(tokens);
}

// ✅ Get authenticated calendar client using stored tokens
function getCalendarClient(tokens) {
  const client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENT_ID,
    process.env.OAUTH_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return google.calendar({ version: 'v3', auth: client });
}

// Export functions for use in other modules
module.exports = {
  getAuthUrl,
  getAccessToken,
  setAccessToken,
  getCalendarClient
};