// Vercel Serverless Function — proxies requests to OpenAI server-side.
// This avoids browser CORS restrictions when calling api.openai.com directly.
// The API key is sent from the browser in the request body and forwarded to OpenAI.
// It is never logged or stored.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers — allow requests from any origin (our own Vercel domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { apiKey, messages } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing API key.' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages array.' });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:           'gpt-4o',
        temperature:     0.7,
        max_tokens:      6000,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      const message = data?.error?.message || `OpenAI error (${openaiRes.status})`;
      return res.status(openaiRes.status).json({ error: message });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[api/generate] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error.' });
  }
}
