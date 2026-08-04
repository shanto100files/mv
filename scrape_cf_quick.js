const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CINEFREAK_URL = "https://cinefreak.net";
const BH = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const DB_PATH = path.join(__dirname, 'cinefreak_db.json');

async function scrapePost(url) {
  const res = await axios.get(url, { headers: BH, timeout: 10000 });
  const $ = cheerio.load(res.data);
  let showTitle = $('h1').first().text().trim() || "";
  showTitle = showTitle.replace(/\s*(Netflix|Download|Watch|Online|GDrive|ESub|CineFreak).*$/i, "").trim();
  const yearMatch = showTitle.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : "";
  const showName = showTitle.replace(/\s*\(\d{4}\).*$/i, "").trim();
  const files = [];
  const seen = new Set();
  $('.ep-meta').each((i, el) => {
    const epText = $(el).text().trim().replace(/\s+/g, " ").replace(/Episode/g, "Ep");
    if (epText.length < 5) return;
    let $card = $(el).parent();
    for (let j = 0; j < 5; j++) { if ($card.hasClass('ep-card') || $card.hasClass('card')) break; $card = $card.parent(); }
    $card.find('a[href*="generate.php"]').each((j, linkEl) => {
      const href = $(linkEl).attr('href') || '';
      const qualText = $(linkEl).text().trim();
      const key = `${epText}:${qualText}`;
      if (href && qualText && !seen.has(key) && /\b(480|720|1080|SD|HD)\b/.test(qualText)) {
        seen.add(key);
        files.push({ t: `${showName} (${year}) ${epText} [${qualText}]`, l: href.startsWith('http') ? href : CINEFREAK_URL + href });
      }
    });
  });
  if (files.length === 0) {
    $('a[href*="generate.php"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const qualText = $(el).text().trim();
      if (href && qualText && !seen.has(qualText) && /\b(480|720|1080|SD|HD)\b/.test(qualText)) {
        seen.add(qualText);
        files.push({ t: `${showName} (${year}) [${qualText}]`, l: href.startsWith('http') ? href : CINEFREAK_URL + href });
      }
    });
  }
  return { n: showName, y: year, f: files };
}

async function quickScrape() {
  // Scrape first 3 pages of each category (quick test)
  const categories = ['web-series', 'hindi-movies', 'english-movies', 'hindi-dubbed-movies'];
  const urls = new Set();
  for (const cat of categories) {
    for (let page = 1; page <= 3; page++) {
      try {
        const res = await axios.get(`${CINEFREAK_URL}/category/${cat}/page/${page}/`, { headers: BH, timeout: 10000 });
        const $ = cheerio.load(res.data);
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('cinefreak.net/') && !href.includes('/category/') && !href.includes('/page/')) urls.add(href);
        });
      } catch {}
    }
    console.log(`${cat}: ${urls.size} URLs`);
  }

  const db = [];
  const allUrls = [...urls];
  for (let i = 0; i < allUrls.length; i += 5) {
    const batch = allUrls.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(u => scrapePost(u)));
    results.forEach(r => { if (r.status === 'fulfilled' && r.value.f.length > 0) db.push(r.value); });
    if ((i + 5) % 50 === 0) console.log(`  ${i + 5}/${allUrls.length} done, ${db.length} posts`);
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log(`\nDone: ${db.length} posts, ${db.reduce((s,p) => s + p.f.length, 0)} files → ${DB_PATH}`);
}

quickScrape().catch(e => console.error(e.message));
