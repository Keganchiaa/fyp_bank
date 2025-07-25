const { google } = require('googleapis');
require('dotenv').config();

// Initialize OAuth2 client with credentials
const oauth2Client = new google.auth.OAuth2(
  process.env.OAUTH_CLIENT_ID,
  process.env.OAUTH_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback' // Make sure this matches your credentials
);

function getAuthUrl() {
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
  });
}

async function getAccessToken(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  return tokens;
}

function setAccessToken(tokens) {
  oauth2Client.setCredentials(tokens);
}

function getClient() {
  return oauth2Client;
}

module.exports = {
  getAuthUrl,
  getAccessToken,
  setAccessToken,
  getClient
};