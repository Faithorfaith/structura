const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  let { url } = body || {};
  if (!url) return res.status(400).json({ error: 'URL is required.' });

  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL.' }); }

  if (!BROWSERLESS_TOKEN) return res.status(500).json({ error: 'BROWSERLESS_TOKEN not set.' });

  try {
    const res2 = await fetch(
      `https://chrome.browserless.io/screenshot?token=${BROWSERLESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          options: { type: 'jpeg', quality: 85, fullPage: false },
          viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
          gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 },
        }),
      }
    );

    if (!res2.ok) {
      const msg = await res2.text().catch(() => '');
      throw new Error(`Browserless error ${res2.status}: ${msg.slice(0, 200)}`);
    }

    const buffer = await res2.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return res.status(200).json({
      screenshot: 'data:image/jpeg;base64,' + base64,
      width: 1440,
      height: 900,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Screenshot failed.' });
  }
};
