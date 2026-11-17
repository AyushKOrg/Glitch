// Shared compact text normalization for search providers.
const short = (value, limit = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
module.exports = { short };
