// Shared helpers. The leading underscore keeps Vercel from exposing this as an endpoint.
const crypto = require('crypto');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const bridgeBase = () => (process.env.GLITCH_PC_URL || '').replace(/\/+$/, '');

const bridgeHeaders = (extra = {}) => ({
  Authorization: `Bearer ${process.env.GLITCH_BRIDGE_SECRET || ''}`,
  'ngrok-skip-browser-warning': '1',
  ...extra,
});

// A 401 from the bridge means the bridge secret is wrong, not that the user's
// site token is wrong, so don't let the UI mistake it for a bad site token.
const upstreamStatus = (s) => (s === 401 ? 502 : s);

module.exports = { safeEqual, bridgeBase, bridgeHeaders, upstreamStatus };
