const cheerio = require('cheerio');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
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

function parsePage(html) {
  const $ = cheerio.load(html);

  $('script, style, noscript, svg, img, video, canvas, iframe, [aria-hidden="true"]').remove();

  function sectionLabel(el) {
    const tag = (el.tagName || '').toLowerCase();
    const id  = ($(el).attr('id') || '').toLowerCase();
    const cls = ($(el).attr('class') || '').toLowerCase();
    const c   = id + ' ' + cls;
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

  function isButtonLike(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'button') return true;
    const cls = ($(el).attr('class') || '').toLowerCase();
    return /\bbtn\b|\bbutton\b/.test(cls);
  }

  function extractElements(container) {
    const elements = [];
    const seen = new Set();
    $(container).find('h1,h2,h3,h4,p,button,a').each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (!text || text.length < 2 || text.length > 300) return;
      const key = text.slice(0, 60);
      if (seen.has(key)) return;
      seen.add(key);
      const tag = (el.tagName || '').toLowerCase();
      if (isButtonLike(el)) {
        elements.push({ type: 'button', label: text.slice(0, 60) });
      } else if (['h1','h2','h3','h4'].includes(tag)) {
        elements.push({ type: 'text', content: text, style: tag === 'h4' ? 'h3' : tag });
      } else if (tag === 'p') {
        elements.push({ type: 'text', content: text, style: 'p' });
      }
    });
    return elements;
  }

  const SECTION_SEL = 'header,nav,main,footer,section,article';
  const topLevel = [];
  $(SECTION_SEL).each((_, el) => {
    if ($(el).parents(SECTION_SEL).length === 0) topLevel.push(el);
  });

  const sectionEls = topLevel.length >= 2
