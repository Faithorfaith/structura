const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const PROMPT = `You are analyzing a website screenshot to extract its design structure.

Return ONLY a valid JSON object — no markdown, no code blocks, no explanation. Just raw JSON.

Use this exact schema:
{
  "sections": [
    {
      "type": "Hero|Nav|Features|Pricing|Testimonials|CTA|Footer|Section",
      "backgroundColor": "#hexcolor or null",
      "elements": [
        { "type": "text", "content": "the actual visible text", "style": "h1|h2|h3|p", "color": "#hexcolor or null" },
        { "type": "button", "label": "button label" }
      ]
    }
  ],
  "colors": ["#hex1", "#hex2"],
  "fonts": ["FontName"]
}

Rules:
- Identify every major visible section (aim for 4-8 sections)
- Extract the actual text you can read — do not make up content
- Max 6 elements per section, max 2 buttons per section
- For colors: list 6-8 dominant brand colors, skip pure white (#ffffff) and pure black (#000000)
- Only name fonts if clearly identifiable from the design
- backgroundColor should reflect the actual section background`;

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

  const { screenshot } = body || {};
  if (!screenshot) return res.status(400).json({ error: 'screenshot is required.' });

  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set.' });

  // Strip data URL prefix
  const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              { text: PROMPT },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const msg = await geminiRes.text().catch(() => '');
      throw new Error(`Gemini error ${geminiRes.status}: ${msg.slice(0, 300)}`);
    }

    const json = await geminiRes.json();
    const raw  = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let layout;
    try {
      layout = JSON.parse(cleaned);
    } catch {
      throw new Error('Gemini returned invalid JSON: ' + cleaned.slice(0, 200));
    }

    return res.status(200).json(layout);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
};
