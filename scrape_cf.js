const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CINEFREAK_URL = "https://cinefreak.net";
const BH = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' };
const DB_PATH = path.join(__dirname, 'cinefreak_db.json');
const BATCH = 20;
const PAGES_PER_CAT = 10;

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return []; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db)); }

async function fetchPage(url) {
  const res = await axios.get(url, { headers: BH, timeout: 8000 });
  return res.data;
}

async function scrapeAll() {
  const db = loadDB();
  const existingNames = new Set(db.map(p => `${p.n}|${p.y}`));
  console.log(`Existing: ${db.length} posts`);

  const categories = ['hindi-movies', 'english-movies', 'hindi-dubbed-movies', 'bangla-movies', 'korean', 'animation', 'web-series'];

  for (const cat of categories) {
    const catUrls = new Set();
    for (let page = 1; page <= PAGES_PER_CAT; page++) {
      try {
        const html = await fetchPage(`${CINEFREAK_URL}/category/${cat}/page/${page}/`);
        const $ = cheerio.load(html);
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('cinefreak.net/') && !href.includes('/category/') && !href.includes('/page/') && !href.includes('?s='))
            catUrls.add(href);
        });
      } catch { break; }
    }

    const urls = [...catUrls];
    let newPosts = 0;

    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async (url) => {
        const html = await fetchPage(url);
        return scrapePost(html);
      }));

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.f.length > 0) {
          const post = r.value;
          const key = `${post.n}|${post.y}`;
          if (!existingNames.has(key)) { db.push(post); existingNames.add(key); newPosts++; }
          else {
            const ex = db.find(p => `${p.n}|${p.y}` === key);
            if (ex) { for (const f of post.f) if (!ex.f.find(ef => ef.t === f.t)) ex.f.push(f); }
          }
        }
      }
    }

    console.log(`${cat}: ${urls.length} URLs, +${newPosts} new posts`);
    saveDB(db);
  }

  console.log(`\nFinal: ${db.length} posts, ${db.reduce((s,p)=>s+p.f.length,0)} files`);
}

function scrapePost(html) {
  const $ = cheerio.load(html);
  let title = $('h1').first().text().trim().replace(/\s*(Netflix|Download|Watch|Online|GDrive|ESub|CineFreak).*$/i, "").trim();
  const ym = title.match(/\((\d{4})\)/);
  const year = ym ? ym[1] : "";
  const name = title.replace(/\s*\(\d{4}\).*$/i, "").trim();
  const files = [];
  const seen = new Set();

  $('.ep-meta').each((i, el) => {
    const ep = $(el).text().trim().replace(/\s+/g, " ").replace(/Episode/g, "Ep");
    if (ep.length < 5) return;
    let $card = $(el).parent();
    for (let j = 0; j < 5; j++) { if ($card.hasClass('ep-card') || $card.hasClass('card')) break; $card = $card.parent(); }
    $card.find('a[href*="generate.php"], a[href*="cinecloud"]').each((j, linkEl) => {
      const href = $(linkEl).attr('href') || '';
      const q = $(linkEl).text().trim();
      const key = `${ep}:${q}`;
      if (href && q && !seen.has(key) && /\b(480|720|1080|2160|SD|HD)\b/.test(q)) {
        seen.add(key);
        const ft = year ? `${name} (${year}) ${ep} [${q}]` : `${name} ${ep} [${q}]`;
        files.push({ t: ft.substring(0, 120), l: (href.startsWith('http') ? href : CINEFREAK_URL + href) });
      }
    });
  });

  if (files.length === 0) {
    $('a[href*="generate.php"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const q = $(el).text().trim();
      if (href && q && !seen.has(q) && /\b(480|720|1080|2160|SD|HD)\b/.test(q)) {
        seen.add(q);
        const ft = year ? `${name} (${year}) [${q}]` : `${name} [${q}]`;
        files.push({ t: ft.substring(0, 120), l: (href.startsWith('http') ? href : CINEFREAK_URL + href) });
      }
    });
  }

  return { n: name, y: year, f: files };
}

scrapeAll().catch(e => console.error("Fatal:", e.message));
