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

  try {
    const html = await fetchPage(normalized);
    const data = parsePage(html);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to parse page.' });
  }
};

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  if (!res.ok) throw new Error(`Page returned ${res.status}`);
  return res.text();
}

// ── Parser (zero dependencies) ───────────────────────────────────────────────

function parsePage(html) {
  // Strip noise
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Try semantic sections first
  const SEMANTIC = ['header', 'nav', 'main', 'footer', 'section', 'article'];
  const sectionRegex = new RegExp(
    `<(${SEMANTIC.join('|')})(\\s[^>]*)?>([\s\S]*?)<\\/\\1>`, 'gi'
  );

  const found = [];
  let m;
  while ((m = sectionRegex.exec(clean)) !== null) {
    found.push({ tag: m[1].toLowerCase(), attrs: m[2] || '', content: m[3] });
  }

  // Fallback: treat whole body as one section
  const toProcess = found.length >= 2 ? found : [{ tag: 'body', attrs: '', content: clean }];

  const sections = [];
  for (const sec of toProcess.slice(0, 12)) {
    const elements = extractElements(sec.content);
    if (elements.length === 0) continue;
    sections.push({
      type: sectionLabel(sec.tag, sec.attrs),
      elements: elements.slice(0, 20),
    });
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

function extractElements(html) {
  const elements = [];
  const seen = new Set();

  const elRegex = /<(h[1-4]|p|button|a)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;

  while ((m = elRegex.exec(html)) !== null) {
    const tag   = m[1].toLowerCase();
    const attrs = m[2] || '';
    const text  = stripTags(m[3]).replace(/\s+/g, ' ').trim();

    if (!text || text.length < 2 || text.length > 300) continue;

    const key = text.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);

    const cls = (attrs.match(/class=["']([^"']*)["']/) || [])[1] || '';

    if (tag === 'button' || /\bbtn\b|\bbutton\b/i.test(cls)) {
      elements.push({ type: 'button', label: text.slice(0, 60) });
    } else if (/^h[1-4]$/.test(tag)) {
      elements.push({ type: 'text', content: text, style: tag === 'h4' ? 'h3' : tag });
    } else if (tag === 'p') {
      elements.push({ type: 'text', content: text, style: 'p' });
    }
  }

  return elements;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
