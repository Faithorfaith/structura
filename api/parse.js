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

  const { url } = body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
  try { new URL(normalized); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  if (!BROWSERLESS_TOKEN) {
    return res.status(500).json({ error: 'BROWSERLESS_TOKEN env variable is not set.' });
  }

  try {
    const html = await fetchRendered(normalized);
    const data = parsePage(html);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to parse page.' });
  }
};

// ── Fetch fully-rendered HTML via Browserless ─────────────────────────────────

async function fetchRendered(url) {
  const res = await fetch(
    `https://chrome.browserless.io/content?token=${BROWSERLESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        waitFor: 2000,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 },
      }),
    }
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Browserless error ${res.status}: ${msg.slice(0, 200)}`);
  }

  return res.text();
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parsePage(html) {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const SEMANTIC = ['header', 'nav', 'main', 'footer', 'section', 'article'];
  const sectionRx = new RegExp(
    '<(' + SEMANTIC.join('|') + ')(\\s[^>]*)?>' +
    '([\\s\\S]*?)' +
    '<\\/\\1>',
    'gi'
  );

  const found = [];
  let m;
  while ((m = sectionRx.exec(clean)) !== null) {
    found.push({ tag: m[1].toLowerCase(), attrs: m[2] || '', content: m[3] });
  }

  const toProcess = found.length >= 2
    ? found
    : [{ tag: 'body', attrs: '', content: clean }];

  const sections = [];
  for (const sec of toProcess.slice(0, 12)) {
    const label = sectionLabel(sec.tag, sec.attrs);
    const isNav = label === 'Nav' || label === 'Header';
    const elements = extractElements(sec.content, isNav);
    if (elements.length === 0) continue;
    sections.push({ type: label, elements: elements.slice(0, 20) });
  }

  return { sections };
}

function sectionLabel(tag, attrs) {
  const c = attrs.toLowerCase();
  if (tag === 'header' || /\bheader\b/.test(c)) return 'Header';
  if (tag === 'nav'    || /\bnav\b/.test(c))    return 'Nav';
  if (tag === 'footer' || /\bfooter\b/.test(c)) return 'Footer';
  if (/\bhero\b/.test(c))                       return 'Hero';
  if (/\bfeature/.test(c))                      return 'Features';
  if (/\bpricing/.test(c))                      return 'Pricing';
  if (/\btestimonial|\breview/.test(c))         return 'Testimonials';
  if (/\bcta\b|\bcallout\b/.test(c))            return 'CTA';
  if (tag === 'main')                           return 'Main';
  return 'Section';
}

function extractElements(html, isNav) {
  const elements = [];
  const seen = new Set();
  let buttonCount = 0;

  const elRx = /<(h[1-4]|p|button|a)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;

  while ((m = elRx.exec(html)) !== null) {
    const tag   = m[1].toLowerCase();
    const attrs = m[2] || '';
    const text  = stripTags(m[3]).replace(/\s+/g, ' ').trim();

    if (!text || text.length < 2 || text.length > 300) continue;

    const key = text.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);

    const cls = (attrs.match(/class=["']([^"']*)["']/) || [])[1] || '';
    const isButtonTag   = tag === 'button';
    const isAnchorCTA   = tag === 'a' && /\bbtn\b|\bbutton\b/i.test(cls) && text.length > 15 && !isNav;

    if (isButtonTag || isAnchorCTA) {
      if (buttonCount >= 3) continue;
      elements.push({ type: 'button', label: text.slice(0, 50) });
      buttonCount++;
    } else if (/^h[1-4]$/.test(tag)) {
      elements.push({ type: 'text', content: text, style: tag === 'h4' ? 'h3' : tag });
    } else if (tag === 'p' && !isNav) {
      elements.push({ type: 'text', content: text, style: 'p' });
    }
  }

  return elements;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
