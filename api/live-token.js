// POST /api/live-token
// Mint a short-lived, single-use Gemini Live API token. The long-lived Google API key
// remains server-side; the browser receives only this restricted ephemeral token.
const { requireUser } = require('./_lib');

const LIVE_MODEL = 'models/gemini-3.8-live';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only.' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Live needs GOOGLE_API_KEY in the Vercel environment variables.' });
  }

  try {
    const now = Date.now();
    // CreateAuthTokenRequest wraps the token resource in "authToken".
    // The REST resource uses bidiGenerateContentSetup (not the SDK-only
    // liveConnectConstraints alias).
    const payload = {
      authToken: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        bidiGenerateContentSetup: {
          model: LIVE_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          },
          systemInstruction: {
            parts: [{ text: 'You are Glitch, a natural, warm, quick-witted conversational AI and the user’s helpful friend. Speak naturally, concisely and conversationally, not like a formal assistant. You may use light playful humour, but never be cruel or mock vulnerability. Listen carefully, answer what the user actually means, and allow interruptions. If unsure, say so. Never claim to see camera or screen content unless a frame has actually been shared.' }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: false, prefixPaddingMs: 180, silenceDurationMs: 550 },
          },
        },
      },
    };

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.name) {
      const detail = String(data.error && data.error.message || 'Google did not issue a Live token.').slice(0, 240);
      return res.status(response.status === 429 ? 429 : 502).json({ error: detail });
    }

    return res.status(200).json({
      token: data.name,
      model: LIVE_MODEL,
      expiresAt: data.expireTime || payload.expireTime,
    });
  } catch (error) {
    return res.status(502).json({
      error: error && error.name === 'TimeoutError'
        ? 'Google Live token creation timed out. Please try again.'
        : 'Could not create a secure Live session. Please try again.',
    });
  }
};
