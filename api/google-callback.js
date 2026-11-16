// Google OAuth callback endpoint. Keep the callback handler in api/config.js
// so token exchange, state validation, encryption, and storage stay centralized.
const configHandler = require('./config');

module.exports = async (req, res) => {
  req.url = '/api/config?action=callback&connector=google';
  return configHandler(req, res);
};
