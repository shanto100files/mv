const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CINEFREAK_URL = "https://cinefreak.net";
const BH = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' };
const DB_PATH = path.join(__dirname, 'cinefreak_db.json');
const BATCH = 10;

async function fetchPage(url) {
  const res = await axios.get(url, { headers: BH, timeout: 10000 });
  return res.data;
}

async function getAllPostUrls() {
  const urls = new Set();
  const categories = ['web-series', 'hindi-movies', 'english-movies', 'hindi-dubbed-movies', 'bangla-movies', 'korean', 'animation'];
  for (const cat of categories) {
    let page = 1;
    while (page <= 50) {
      try {
        const html = await fetchPage(`${CINEFREAK_URL}/category/${cat}/page/${page}/`);
        const $ = cheerio.load(html);
        let found = 0;
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('cinefreak.net/') && !href.includes('/category/') && !href.includes('/page/') && !href.includes('?s=')) {
            if (!urls.has(href)) { urls.add(href); found++; }
          }
        });
        if (found === 0) break;
        page++;
      } catch { break; }
    }
    console.log(`${cat}: ${urls.size} total URLs`);
  }
  return [...urls];
}

function scrapePostPage(html, url) {
  const $ = cheerio.load(html);
  let showTitle = $('h1').first().text().trim() || "";
  showTitle = showTitle.replace(/\s*(Netflix|Download|Watch|Online|GDrive|ESub|CineFreak).*$/i, "").trim();
  const yearMatch = showTitle.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : "";
  const showName = showTitle.replace(/\s*\(\d{4}\).*$/i, "").trim();

  const files = [];
  const seenQualText = new Set();

  $('.ep-meta').each((i, el) => {
    const epText = $(el).text().trim().replace(/\s+/g, " ").replace(/Episode/g, "Ep");
    if (epText.length < 5) return;
    let $card = $(el).parent();
    for (let j = 0; j < 5; j++) {
      if ($card.hasClass('ep-card') || $card.hasClass('card')) break;
      $card = $card.parent();
    }
    $card.find('a[href*="generate.php"], a[href*="cinecloud"]').each((j, linkEl) => {
      const href = $(linkEl).attr('href') || '';
      const qualText = $(linkEl).text().trim();
      const key = `${epText}:${qualText}`;
      if (href && qualText && !seenQualText.has(key) && /\b(480|720|1080|2160|SD|HD)\b/.test(qualText)) {
        seenQualText.add(key);
        const fullTitle = year ? `${showName} (${year}) ${epText} [${qualText}]` : `${showName} ${epText} [${qualText}]`;
        files.push({ t: fullTitle.substring(0, 120), l: (href.startsWith('http') ? href : CINEFREAK_URL + href) });
      }
    });
  });

  if (files.length === 0) {
    const seenQ = new Set();
    $('a[href*="generate.php"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const qualText = $(el).text().trim();
      if (href && qualText && !seenQ.has(qualText) && /\b(480|720|1080|2160|SD|HD)\b/.test(qualText)) {
        seenQ.add(qualText);
        const fullTitle = year ? `${showName} (${year}) [${qualText}]` : `${showName} [${qualText}]`;
        files.push({ t: fullTitle.substring(0, 120), l: (href.startsWith('http') ? href : CINEFREAK_URL + href) });
      }
    });
  }

  return { n: showName, y: year, f: files };
}

async function buildDatabase() {
  console.log("=== Building CineFreak Database ===");
  const postUrls = await getAllPostUrls();
  console.log(`\nScraping ${postUrls.length} posts (batch ${BATCH})...`);

  const db = [];
  let scraped = 0;

  for (let i = 0; i < postUrls.length; i += BATCH) {
    const batch = postUrls.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (url) => {
      const html = await fetchPage(url);
      return scrapePostPage(html, url);
    }));

    results.forEach(r => {
      scraped++;
      if (r.status === 'fulfilled' && r.value && r.value.f.length > 0) {
        db.push(r.value);
      }
    });

    if (scraped % 100 === 0) {
      console.log(`  ${scraped}/${postUrls.length} scraped, ${db.length} with files`);
      fs.writeFileSync(DB_PATH, JSON.stringify(db));
    }
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log(`\nDone: ${db.length} posts, ${db.reduce((s,p) => s + p.f.length, 0)} files`);
  console.log(`Saved to ${DB_PATH}`);
}

buildDatabase().catch(e => console.error("Fatal:", e.message));
