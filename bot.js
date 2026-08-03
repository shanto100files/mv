const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = "8383924215:AAE_osrg0VPVPv-vEoqW6tt-G4tBO4sbctY";
const TMDB_KEY = "7300351df93ae28d50e92aba76a55a3c";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TELEGRAPH_ACCOUNT = "VegaBot";

const PROV_DIR = path.join(__dirname, "..", "vega-providers");
const urlsData = JSON.parse(fs.readFileSync(path.join(PROV_DIR, "urls.json"), "utf-8"));
const urlsEndpoint = "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json";
const nativeFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  
  // URLs endpoint override
  if (url === urlsEndpoint) return new Response(JSON.stringify(urlsData), { status: 200, headers: { "Content-Type": "application/json" } });
  
  // Relative URLs - add base URL
  if (url && !url.startsWith("http")) {
    const base = "https://moviesmod.zone";
    const absoluteUrl = base + (url.startsWith("/") ? url : "/" + url);
    return nativeFetch(absoluteUrl, init);
  }
  
  return nativeFetch(input, init);
};

const providerContext = {
  axios, cheerio,
  commonHeaders: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  Aes: {},
};
const signal = new AbortController().signal;

const PROVIDERS = {
  vega:      { urlKey: "Vega" },
  mod:       { urlKey: "Moviesmod" },
  topmovies: { urlKey: "Topmovies" },
  world4u:   { urlKey: "w4u" },
  movies4u:  { urlKey: "movies4u" },
  hdhub4u:   { urlKey: "hdhub" },
  "4khdhub": { urlKey: "4khdhub" },
  cinefreak: { url: "https://cinefreak.net" },
};

function getMod(n, f) { try { const p = path.join(PROV_DIR, "dist", n, `${f}.js`); return fs.existsSync(p) ? require(p) : null; } catch { return null; } }
function getBase(n) { return urlsData[PROVIDERS[n]?.urlKey]?.url || ""; }
function mkLink(p, l) { return l.startsWith("http") ? l : getBase(p) + l; }

// ========== DATABASE ==========
const DB_PATH = path.join(__dirname, "db.json");
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {}
  return {};
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getCache(key) {
  const db = loadDB();
  const item = db[key];
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    delete db[key];
    saveDB(db);
    return null;
  }
  return item;
}

function setCache(key, data) {
  if (!data || (Array.isArray(data) && data.length === 0)) return;
  const db = loadDB();
  db[key] = { data, timestamp: Date.now() };
  saveDB(db);
}

// ========== TELEGRAPH ==========
async function createTelegraphAccount() {
  try {
    const res = await axios.get("https://api.telegra.ph/createAccount", {
      params: { short_name: TELEGRAPH_ACCOUNT, author_name: "Vega Bot" }
    });
    return res.data?.result?.access_token;
  } catch { return null; }
}

let TELEGRAPH_TOKEN = null;

async function getTelegraphToken() {
  if (TELEGRAPH_TOKEN) return TELEGRAPH_TOKEN;
  TELEGRAPH_TOKEN = await createTelegraphAccount();
  return TELEGRAPH_TOKEN;
}

async function createTelegraphPage(title, content, authorName = "Vega Bot") {
  try {
    const token = await getTelegraphToken();
    if (!token) return null;

    const res = await axios.post("https://api.telegra.ph/createPage", {
      access_token: token,
      title: title,
      author_name: authorName,
      author_url: "https://t.me/vegabot",
      content: content,
      return_content: true,
    });
    return res.data?.result?.url;
  } catch (e) {
    console.log("[Telegraph] Error:", e.message);
    return null;
  }
}

function buildTelegraphContent(item, qualityGroups, streams) {
  const content = [];

  // Header
  content.push({ tag: "h3", children: [item.title || "Movie"] });

  // Info
  if (item.year || item.rating) {
    content.push({
      tag: "p",
      children: [`Year: ${item.year || "N/A"} | Rating: ${item.rating || "N/A"} | Type: ${item.type === "tv" ? "Series" : "Movie"}`]
    });
  }

  // Ad placeholder
  content.push({ tag: "p", children: ["━━━━━━━━━━━━━━━━━━━━"] });
  content.push({ tag: "p", children: ["📢 *Advertisement*" ] });
  content.push({ tag: "p", children: ["[Your Ad Here - Contact @admin]"] });
  content.push({ tag: "p", children: ["━━━━━━━━━━━━━━━━━━━━"] });

  // Quality Groups
  if (qualityGroups && qualityGroups.length) {
    content.push({ tag: "h4", children: ["📥 Download Options"] });

    qualityGroups.forEach((g, i) => {
      const badge = g.quality !== "N/A" ? `[${g.quality}]` : "";
      const lang = g.languages.join("+");
      const count = g.count || g.items?.length || 0;

      content.push({
        tag: "p",
        children: [
          { tag: "strong", children: [`${badge} ${lang} (${count} links)`] }
        ]
      });

      // Items
      const items = g.items || [g];
      items.forEach(item => {
        const size = item.size ? ` - ${item.size}` : "";
        const src = item.source ? ` (${item.source})` : "";
        content.push({
          tag: "p",
          children: [`• ${item.provider}${src}${size}`]
        });
      });
    });
  }

  // Streams
  if (streams && streams.length) {
    content.push({ tag: "h4", children: ["🎬 Stream/Download Links"] });

    streams.forEach((s, i) => {
      content.push({
        tag: "p",
        children: [
          { tag: "strong", children: [`${s.server || `Server ${i+1}`}`] },
          ` - ${s.type || "mkv"}`
        ]
      });
      content.push({
        tag: "a",
        attrs: { href: s.link },
        children: ["▶ Stream / ⬇ Download"]
      });
      content.push({ tag: "br" });
    });
  }

  // Footer
  content.push({ tag: "p", children: ["━━━━━━━━━━━━━━━━━━━━"] });
  content.push({ tag: "p", children: ["🤖 Powered by Vega Bot"] });

  return content;
}

// ========== PARSE ==========
function parseTitle(title) {
  const q = title.match(/\b(4k|2160p|1080p|720p|480p|360p)\b/i);
  const quality = q ? q[1].toUpperCase() : "N/A";

  const langs = [];
  if (/hindi/i.test(title)) langs.push("Hindi");
  if (/english/i.test(title)) langs.push("English");
  if (/dual\s*audio/i.test(title)) { if (!langs.includes("Hindi")) langs.push("Hindi"); if (!langs.includes("English")) langs.push("English"); }
  if (/telugu/i.test(title)) langs.push("Telugu");
  if (/tamil/i.test(title)) langs.push("Tamil");
  if (langs.length === 0) langs.push("N/A");

  const size = title.match(/\[([\d.]+\s*(?:GB|MB))\]/i);
  const src = title.match(/(WEB-?DL|BluRay|HDRip|DVDRip|WEBRip|HDR|HEVC|x264|x265|10Bit)/i);

  return { quality, languages: langs, size: size ? size[1] : null, source: src ? src[1] : null };
}

function groupKey(parsed) {
  return `${parsed.quality}|${parsed.languages.sort().join("+")}`;
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DB = new Map();
const processedCB = new Set();
const MSG_TTL = 10 * 60 * 1000; // 10 minutes

function isRealFile(title) {
  const t = title.toLowerCase().trim();
  if (t.length < 10) return false;
  const catKeywords = ["web-series", "bangla movies", "hindi movies", "tamil movies", "telugu movies", "movies", "web series", "series", "tv shows", "anime", "korean drama"];
  if (catKeywords.some(k => t === k || t === k + "s")) return false;
  const hasQuality = /\b(4k|2160p|1080p|720p|480p|360p)\b/i.test(t);
  const hasSize = /\b(\d+\s*(gb|mb))\b/i.test(t);
  const hasYear = /\b(20\d{2}|19\d{2})\b/.test(t);
  const hasCodec = /\b(x264|x265|hevc|10bit|bluray|web-?dl|webrip|hdrip|dvdrip|h264|h265|avc)\b/i.test(t);
  if (hasQuality || hasSize || hasYear || hasCodec) return true;
  if (/\[.+\]/.test(t)) return true;
  return false;
}

function isRelevant(title, query) {
  const t = title.toLowerCase();
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  // ALL significant words must appear in title
  const allMatch = words.every(w => {
    const regex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(t);
  });
  if (!allMatch) return false;
  // For short queries (1-2 words), title should START with the query
  // e.g. "RRR" should match "RRR (2022)" but NOT "New Year Celebrations With RRR"
  if (words.length <= 2) {
    const firstWord = words[0];
    const regex = new RegExp(`^\\b${firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(t);
  }
  return true;
}

// Track messages for auto-delete
function trackMessage(msg) {
  if (!msg?.message_id) return;
  setTimeout(() => {
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
  }, MSG_TTL);
}

function trackAllMessages(chatId, msgIds) {
  msgIds.forEach(id => {
    setTimeout(() => {
      bot.deleteMessage(chatId, id).catch(() => {});
    }, MSG_TTL);
  });
}

bot.onText(/\/start/, (msg) => {
  const m = bot.sendMessage(msg.chat.id, "🎬 *Vega Bot v15*\n\nMovie/Show name likhe search koro.\nDatabase e store hobe, porer bar fast serve korbe.\n10 min por messages delete hobe.", { parse_mode: "Markdown" });
  m.then(trackMessage);
});

// ========== SEARCH ==========
bot.on("message", async (msg) => {
  const cid = msg.chat.id;
  const txt = msg.text?.trim();
  if (!txt || txt.startsWith("/")) return;

  const wait = await bot.sendMessage(cid, "🔍 ...");
  trackMessage(wait);
  try {
    const tmdb = await tmdbSearch(txt);
    const item = tmdb[0];

    // Poster
    let photoMsg;
    if (item) {
      const imgBuf = await makeCardImage(item);
      photoMsg = await bot.sendPhoto(cid, imgBuf, {
        caption: `*${item.title}* (${item.year || "?"}) ⭐${item.rating || "N/A"}`,
        parse_mode: "Markdown",
      });
      trackMessage(photoMsg);
    }

    // TV series hole
    if (item?.type === "tv" && item.id) {
      try {
        const tvDetails = await tmdbGetTVDetails(item.id);
        if (tvDetails.seasons?.length > 0) {
          const airedSeasons = tvDetails.seasons.filter(s => s.season_number > 0 && s.episode_count > 0);
          const seasonRows = airedSeasons.map((s) => {
              const epCount = s.episode_count || "?";
              const btnText = `📺 Season ${s.season_number} (${epCount} eps)`;
              return [{ text: btnText, callback_data: `s_${cid}_${s.season_number}_${item.id}` }];
            });

          if (airedSeasons.length > 1) {
            seasonRows.push([{ text: "━━━━━━━━━━━━━━━━", callback_data: "noop" }]);
            seasonRows.push([{ text: `📦 All Seasons (${airedSeasons.reduce((a,s)=>a+s.episode_count,0)} eps)`, callback_data: `sp_${cid}_${item.id}_${airedSeasons.map(s => s.season_number).join(",")}` }]);
          }

          // Loading indicator below poster
          const loadMsg = await bot.sendMessage(cid,
            `┌──────────────────────────┐\n` +
            `│  ⏳ *${item.title}*\n` +
            `│  📺 ${airedSeasons.length} seasons found\n` +
            `│  🔍 Tap a season to load links`,
            { parse_mode: "Markdown" }
          );
          trackMessage(loadMsg);

          const seasonMsg = await bot.sendMessage(cid, `📺 *${item.title}* - ${airedSeasons.length} seasons:`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: seasonRows }
          });
          trackMessage(seasonMsg);
          DB.set(cid, { tmdbItem: item });

          backgroundFetchSeries(item, tvDetails);
          return;
        }
      } catch (e) {}
    }

    // Movie hole
    const cacheKey = `movie:${txt.toLowerCase()}`;
    const cached = getCache(cacheKey);

    if (cached) {
      showQualityGroups(cid, cached.data, txt);
    } else {
      // Loading indicator below poster
      const loadMsg = await bot.sendMessage(cid,
        `┌──────────────────────────┐\n` +
        `│  ⏳ *${txt.substring(0, 30)}*\n` +
        `│  🎬 Movie\n` +
        `│  🔍 Loading links from providers...`,
        { parse_mode: "Markdown" }
      );
      trackMessage(loadMsg);

      try {
        const providerResults = await searchAllProviders(txt);

        if (!providerResults.length) {
          await bot.deleteMessage(cid, loadMsg.message_id).catch(() => {});
          const errMsg = await bot.sendMessage(cid, "❌ Kono result nai");
          trackMessage(errMsg);
          return;
        }

        // Fetch post pages to extract individual download links
        await bot.editMessageText(
          `┌──────────────────────────┐\n` +
          `│  ⏳ *${txt.substring(0, 30)}*\n` +
          `│  🎬 Movie\n` +
          `│  📥 Extracting download links...`,
          { chat_id: cid, message_id: loadMsg.message_id, parse_mode: "Markdown" }
        ).catch(() => {});

        const allLinks = [];
        const fetches = providerResults.slice(0, 5).map(async (r) => {
          const links = await fetchPostDownloadLinks(r.provider, r.link, r.title);
          if (links.length) {
            allLinks.push(...links);
          } else {
            // Fallback: keep original post title
            allLinks.push({ title: r.title, link: r.link, provider: r.provider, quality: "N/A", size: null });
          }
        });
        await Promise.allSettled(fetches);

        await bot.deleteMessage(cid, loadMsg.message_id).catch(() => {});

        if (!allLinks.length) {
          const errMsg = await bot.sendMessage(cid, "❌ Kono download link nai");
          trackMessage(errMsg);
          return;
        }

        // Sort: quality first (4K > 1080P > 720P > 480P), then by size
        const qOrder = { "4K": 0, "2160P": 1, "1080P": 2, "720P": 3, "480P": 4, "360P": 5, "N/A": 9 };
        allLinks.sort((a, b) => (qOrder[a.quality] ?? 9) - (qOrder[b.quality] ?? 9));

        setCache(cacheKey, allLinks);
        showQualityGroups(cid, allLinks, txt);
      } catch (e) {
        await bot.deleteMessage(cid, loader.message_id).catch(() => {});
        throw e;
      }
    }

  } catch (e) {
    const errMsg = await bot.sendMessage(cid, `❌ ${e.message}`);
    trackMessage(errMsg);
  }
});

// ========== FILTER EPISODE FROM SEASON PACK ==========
function filterEpisodeFromSeasonPack(packResults, epNum) {
  // Season pack results theke specific episode filter
  // Title e episode info thakbe - "Ep01 Added", "E01-E08", etc.
  const epStr = String(epNum).padStart(2, "0");
  
  return packResults.filter(r => {
    const title = r.title.toLowerCase();
    // Check if title mentions this episode or contains range including this episode
    if (title.includes(`e${epStr}`) || title.includes(`ep${epStr}`)) return true;
    if (title.includes(`episode ${epNum}`)) return true;
    // Check for range like "e01-08" or "ep01-08"
    const rangeMatch = title.match(/e(?:p)?(\d{2})-(\d{2})/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      if (epNum >= start && epNum <= end) return true;
    }
    // If title says "All Episodes" or "Complete", include it
    if (title.includes("complete") || title.includes("all episode")) return true;
    return false;
  });
}

// ========== FETCH EPISODE PROVIDERS ==========
async function fetchEpisodeProviders(seriesTitle, seasonNum, epNum, cid, epLabel) {
  const seasonPad = String(seasonNum).padStart(2, "0");
  const epPad = String(epNum).padStart(2, "0");

  const queries = [
    `${seriesTitle} Season ${seasonNum}`,
    `${seriesTitle} S${seasonPad}`,
    `${seriesTitle} S${seasonPad}E${epPad}`,
    `${seriesTitle} Season ${seasonNum} ${epNum}`,
  ];

  const wait = await bot.sendMessage(cid, `🔍 ${seriesTitle} ${epLabel} ...`);
  try {
    const allResults = await Promise.all(queries.map(q => searchAllProviders(q)));
    const seen = new Set();
    const unique = [];
    allResults.flat().forEach(r => {
      const key = `${r.provider}:${r.link}`;
      if (!seen.has(key)) { seen.add(key); unique.push(r); }
    });

    await bot.deleteMessage(cid, wait.message_id).catch(() => {});
    if (!unique.length) return bot.sendMessage(cid, `❌ ${epLabel} - kono file nai`);

    // Cache
    const seasonPackKey = `seasonpack:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    setCache(seasonPackKey, unique);
    const episodeCacheKey = `episode:${seriesTitle.toLowerCase()}:${epLabel}`;
    setCache(episodeCacheKey, unique);

    // Detect season pack
    const isSeasonPack = unique.every(r => {
      const t = r.title.toLowerCase();
      return t.includes("season") || t.includes("complete") || t.includes("all episode") || t.includes("series");
    });

    showFileList(cid, unique, `${seriesTitle} ${epLabel}`, isSeasonPack, epNum);
  } catch (e) {
    await bot.deleteMessage(cid, wait.message_id).catch(() => {});
    bot.sendMessage(cid, `❌ ${e.message}`);
  }
}

// ========== BACKGROUND FETCH SERIES ==========
async function backgroundFetchSeries(item, tvDetails) {
  const seriesTitle = item.title;
  const seasons = tvDetails.seasons.filter(s => s.season_number > 0 && s.episode_count > 0);

  console.log(`[BG] Starting background fetch for: ${seriesTitle}`);

  // Shob seasons er episodes fetch
  for (const season of seasons) {
    const seasonNum = season.season_number;
    const seasonCacheKey = `series:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    const cached = getCache(seasonCacheKey);

    if (!cached) {
      try {
        const episodes = await tmdbGetEpisodes(item.id, seasonNum);
        if (episodes.length) {
          setCache(seasonCacheKey, episodes);
          console.log(`[BG] Cached episodes for Season ${seasonNum}: ${episodes.length} episodes`);
        }
      } catch (e) {
        console.log(`[BG] Error fetching episodes for Season ${seasonNum}:`, e.message);
      }
    }
  }

  // Season Complete providers fetch
  const allSeasonNums = seasons.map(s => s.season_number).join(",");
  const seasonPackCacheKey = `seasonpack:${seriesTitle.toLowerCase()}:${allSeasonNums}`;
  const cachedPack = getCache(seasonPackCacheKey);

  if (!cachedPack) {
    try {
      const queries = [];
      seasons.forEach(s => {
        const n = s.season_number;
        const pad = String(n).padStart(2, "0");
        queries.push(
          `${seriesTitle} Season ${n} Complete`,
          `${seriesTitle} Season ${n} All Episodes`,
          `${seriesTitle} S${pad} Complete`,
        );
      });

      const allResults = await Promise.all(queries.map(q => searchAllProviders(q)));
      const seen = new Set();
      const unique = [];
      allResults.flat().forEach(r => {
        const key = `${r.provider}:${r.link}`;
        if (!seen.has(key)) { seen.add(key); unique.push(r); }
      });

      if (unique.length) {
        setCache(seasonPackCacheKey, unique);
        console.log(`[BG] Cached season pack results: ${unique.length} files`);
      }
    } catch (e) {
      console.log(`[BG] Error fetching season pack:`, e.message);
    }
  }

  console.log(`[BG] Background fetch completed for: ${seriesTitle}`);
}

// ========== BACKGROUND FETCH NEXT EPISODES ==========
async function backgroundFetchEpisodes(seriesTitle, currentSeason, currentEp, tvId) {
  console.log(`[BG] Fetching next episodes for ${seriesTitle} S${currentSeason}E${currentEp}`);

  // Next 2 episodes fetch
  for (let i = 1; i <= 2; i++) {
    const nextEp = currentEp + i;
    const seasonPad = String(currentSeason).padStart(2, "0");
    const epPad = String(nextEp).padStart(2, "0");
    const epLabel = `S${seasonPad}E${epPad}`;

    const cacheKey = `episode:${seriesTitle.toLowerCase()}:${epLabel}`;
    const cached = getCache(cacheKey);

    if (!cached) {
      try {
        const queries = [
          `${seriesTitle} ${epLabel}`,
          `${seriesTitle} Season ${currentSeason} ${nextEp}`,
        ];

        const allResults = await Promise.all(queries.map(q => searchAllProviders(q)));
        const seen = new Set();
        const unique = [];
        allResults.flat().forEach(r => {
          const key = `${r.provider}:${r.link}`;
          if (!seen.has(key)) { seen.add(key); unique.push(r); }
        });

        if (unique.length) {
          setCache(cacheKey, unique);
          console.log(`[BG] Cached ${epLabel}: ${unique.length} files`);
        }
      } catch (e) {
        console.log(`[BG] Error fetching ${epLabel}:`, e.message);
      }
    }
  }
}

// ========== CALLBACKS ==========
bot.on("callback_query", async (q) => {
  if (processedCB.has(q.id)) return;
  processedCB.add(q.id);
  setTimeout(() => processedCB.delete(q.id), 3000);

  const cid = q.message.chat.id;
  const d = q.data;

  if (d === "noop") return;

  // Quality filter tabs for file list
  if (d.startsWith("qf_")) {
    bot.answerCallbackQuery(q.id).catch(() => {});
    const quality = d.split("_")[2];
    filterFileList(cid, quality);
    return;
  }

  // Movie file list pagination + quality filter
  if (d.startsWith("mg_")) {
    bot.answerCallbackQuery(q.id).catch(() => {});
    const parts = d.split("_");
    const quality = parts[2]; // "all" or quality string
    const page = parseInt(parts[3]) || 1;
    const st = DB.get(cid);
    if (!st?.movieProviderResults) return;
    // Edit existing message instead of sending new one
    const msgId = q.message.message_id;
    showQualityGroups(cid, st.movieProviderResults, st.query, null, page, quality, msgId);
    return;
  }

  // File list — click to resolve streams
  if (d.startsWith("fl_")) {
    bot.answerCallbackQuery(q.id, { text: "Resolving streams..." }).catch(() => {});
    const parts = d.split("_");
    const fileIdx = parseInt(parts[2]);
    const action = parts[3] || "stream";

    const st = DB.get(cid);
    const file = st?.fileMap?.[fileIdx];
    if (!file) return;

    const wait = await bot.sendMessage(cid,
      `┌──────────────────────────┐\n` +
      `│  ⏳ *Resolving streams*\n` +
      `│\n` +
      `│  📄 ${file.title.substring(0, 40)}\n` +
      `│  🌐 ${file.provider}\n` +
      `│\n` +
      `│  ⏳ Please wait...`,
      { parse_mode: "Markdown" }
    );
    trackMessage(wait);

    try {
      // The link from fetchPostDownloadLinks is already the specific download link
      // Try resolve directly first
      let linkToResolve = file.link;
      
      // HubDrive fallback: if link is hubdrive, fetch page to get hubcloud link
      if (/hubdrive/i.test(linkToResolve)) {
        try {
          const res = await axios.get(linkToResolve, { timeout: 15000, headers: BH });
          const html = res.data;
          // Find hubcloud link on hubdrive page
          const hubMatch = html.match(/href="(https?:\/\/[^"]*hubcloud[^"]*)"/i) ||
                          html.match(/href="(https?:\/\/[^"]*\/drive\/[^"]*)"/i) ||
                          html.match(/class="btn[^"]*"[^>]*href="(https?:\/\/[^"]*)"/i);
          if (hubMatch) {
            linkToResolve = hubMatch[1];
          }
        } catch (e) {
          console.log(`[HubDrive] Fallback error:`, e.message);
        }
      }

      const streams = [{ server: file.provider, link: linkToResolve, type: "mkv", quality: file.quality || "N/A" }];
      await bot.deleteMessage(cid, wait.message_id).catch(() => {});

      if (!streams.length) {
        bot.sendMessage(cid, `❌ ${file.provider} — stream available na`).then(trackMessage);
        return;
      }

      // Resolve all streams in parallel
      const results = await Promise.allSettled(
        streams.slice(0, 6).map(async (s) => {
          const cacheKey = `direct:${s.link}:${action}`;
          const cached = getCache(cacheKey);
          let directLink;
          if (cached) {
            directLink = cached.data;
          } else {
            directLink = await resolveDirectLink(s.link, action);
            setCache(cacheKey, directLink);
          }
          return { server: s.server, quality: s.quality || s.type, directLink };
        })
      );

      const resolved = results.filter(r => r.status === "fulfilled").map(r => r.value);

      if (!resolved.length) {
        // Fallback: original stream links with quality labels
        const fallbackBtns = streams.slice(0, 6).map(s => {
          const qualityLabel = s.quality ? `[${s.quality}] ` : "";
          return [{ text: `${qualityLabel}${s.server}`, url: s.link }];
        });
        bot.sendMessage(cid, `📋 *${file.title.substring(0, 80)}*\n\n🔗 ${streams.length} link(s) — direct resolve failed:`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: fallbackBtns }
        }).then(trackMessage);
        return;
      }

      // Build response — file title + resolved links as buttons
      const lines = resolved.map((r, i) => {
        const qLabel = r.quality ? ` [${r.quality}]` : "";
        return `${i + 1}. ▶️ ${r.server}${qLabel}`;
      });

      const msgText = `📋 *${file.title.substring(0, 80)}*\n\n🔗 ${resolved.length} link(s) resolved:\n\n${lines.join("\n")}`;

      const buttons = resolved.map((r) => {
        const qLabel = r.quality ? `[${r.quality}] ` : "";
        return [{ text: `▶️ ${qLabel}${r.server}`, url: r.directLink }];
      });

      bot.sendMessage(cid, msgText, {
        disable_web_page_preview: true,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
      }).then(trackMessage);

    } catch (e) {
      await bot.deleteMessage(cid, wait.message_id).catch(() => {});
      bot.sendMessage(cid, `❌ ${file.provider} — ${e.message.substring(0, 80)}`).then(trackMessage);
    }
    return;
  }

  // Season click -> search all providers and show flat file list
  if (d.startsWith("s_")) {
    bot.answerCallbackQuery(q.id, { text: "Loading links..." }).catch(() => {});
    const parts = d.split("_");
    const seasonNum = parseInt(parts[2]);
    const tvId = parseInt(parts[3]);

    const st = DB.get(cid);
    const seriesTitle = st?.tmdbItem?.title || "";
    const seasonPad = String(seasonNum).padStart(2, "0");
    const label = `${seriesTitle} Season ${seasonNum}`;

    const cacheKey = `seasonlinks:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    const cached = getCache(cacheKey);

    if (cached) {
      showQualityGroups(cid, cached.data, label, null, 1, "all");
    } else {
      const loader = await bot.sendMessage(cid, `⏳ Loading ${label} links...`);

      try {
        const queries = [
          `${seriesTitle} Season ${seasonNum}`,
          `${seriesTitle} S${seasonPad}`,
          `${seriesTitle} Season ${seasonNum} Complete`,
          `${seriesTitle} S${seasonPad} Complete`,
        ];
        const allResults = await Promise.all(queries.map(q => searchAllProviders(q)));
        const seen = new Set();
        const unique = [];
        allResults.flat().forEach(r => {
          const key = `${r.provider}:${r.link}`;
          if (!seen.has(key)) { seen.add(key); unique.push(r); }
        });

        await bot.deleteMessage(cid, loader.message_id).catch(() => {});
        if (!unique.length) return bot.sendMessage(cid, `❌ ${label} — kono file nai`);

        setCache(cacheKey, unique);
        showQualityGroups(cid, unique, label, null, 1, "all");
      } catch (e) {
        await bot.editMessageText(
          `┌──────────────────────────┐\n` +
          `│  ❌ *Error Loading Season ${seasonNum}*\n` +
          `│\n` +
          `│  ${e.message.substring(0, 40)}\n` +
          `└──────────────────────────┘`,
          { chat_id: cid, message_id: loader.message_id, parse_mode: "Markdown" }
        ).catch(() => {});
      }
    }
    return;
  }

  // Season links pagination
  if (d.startsWith("sl_")) {
    bot.answerCallbackQuery(q.id).catch(() => {});
    const parts = d.split("_");
    const page = parseInt(parts[2]) || 1;
    const st = DB.get(cid);
    if (!st?.seasonFiles) return;
    // Show flat file list like movies
    showQualityGroups(cid, st.seasonFiles, st.seasonLabel, null, page, "all");
    return;
  }

  // Episode tab click
  if (d.startsWith("se_")) {
    bot.answerCallbackQuery(q.id, { text: "Loading..." }).catch(() => {});
    const parts = d.split("_");
    const epFilter = parts[2]; // "all", "pack", or episode number
    const st = DB.get(cid);
    if (!st?.seasonFiles) return;

    // Show flat file list like movies
    showQualityGroups(cid, st.seasonFiles, st.seasonLabel, null, 1, "all");
    return;
  }

  // Season complete -> providers search (database check)
  if (d.startsWith("sp_")) {
    bot.answerCallbackQuery(q.id, { text: "Searching season pack..." }).catch(() => {});
    const parts = d.split("_");
    const tvId = parseInt(parts[2]);
    const seasonNums = parts[3];

    const st = DB.get(cid);
    const seriesTitle = st?.tmdbItem?.title || "";

    const nums = seasonNums.split(",");
    const label = nums.length > 1 ? `Season ${nums.join(",")} Complete` : `Season ${seasonNums} Complete`;

    const cacheKey = `seasonpack:${seriesTitle.toLowerCase()}:${seasonNums}`;
    const cached = getCache(cacheKey);

    if (cached) {
      showQualityGroups(cid, cached.data, `${seriesTitle} ${label}`);
    } else {
      const queries = [];
      nums.forEach(num => {
        const n = parseInt(num);
        const pad = String(n).padStart(2, "0");
        queries.push(
          `${seriesTitle} Season ${n} Complete`,
          `${seriesTitle} Season ${n} All Episodes`,
          `${seriesTitle} S${pad} Complete`,
          `${seriesTitle} Season ${n}`,
        );
      });

      const wait = await bot.sendMessage(cid, `🔍 ${seriesTitle} ${label} ...`);
      try {
        const allResults = await Promise.all(queries.map(q => searchAllProviders(q)));
        const seen = new Set();
        const unique = [];
        allResults.flat().forEach(r => {
          const key = `${r.provider}:${r.link}`;
          if (!seen.has(key)) { seen.add(key); unique.push(r); }
        });

        await bot.deleteMessage(cid, wait.message_id).catch(() => {});
        if (!unique.length) return bot.sendMessage(cid, `❌ ${label} - kono file nai`);

        setCache(cacheKey, unique);
        showQualityGroups(cid, unique, `${seriesTitle} ${label}`);
      } catch (e) {
        await bot.deleteMessage(cid, wait.message_id).catch(() => {});
        bot.sendMessage(cid, `❌ ${e.message}`);
      }
    }
  }

  // Group click -> files
  if (d.startsWith("g_")) {
    bot.answerCallbackQuery(q.id, { text: "Loading files..." }).catch(() => {});
    const idx = parseInt(d.split("_").pop());
    const st = DB.get(cid);
    if (!st?.groups?.[idx]) return;

    const group = st.groups[idx];
    const files = group.items;

    const rows = files.map((f, i) => {
      const sizeBadge = f.size ? ` (${f.size})` : "";
      const provBadge = f.provider;
      const srcBadge = f.source ? ` • ${f.source}` : "";
      const btnText = `${provBadge}${srcBadge}${sizeBadge}`.substring(0, 55);
      return [{ text: btnText, callback_data: `f_${cid}_${i}` }];
    });

    const qBadge = group.quality !== "N/A" ? `[${group.quality}]` : "";
    const lang = group.languages.join("+");

    await bot.sendMessage(cid, `📋 *${qBadge} ${lang}* - ${files.length} files:`, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: rows }
    });
    DB.set(cid, { ...st, currentFiles: files, currentGroup: group });
  }

  // File click -> stream resolve (database check + Telegraph)
  if (d.startsWith("f_")) {
    bot.answerCallbackQuery(q.id, { text: "Resolving streams..." }).catch(() => {});
    const idx = parseInt(d.split("_").pop());
    const st = DB.get(cid);
    if (!st?.currentFiles?.[idx]) return;

    const file = st.currentFiles[idx];
    const streamCacheKey = `streams:${file.provider}:${file.link}`;
    const cachedStreams = getCache(streamCacheKey);

    if (cachedStreams) {
      const streams = cachedStreams.data;
      if (!streams.length) {
        const errMsg = await bot.sendMessage(cid, `❌ ${file.provider} - stream available na`);
        trackMessage(errMsg);
        return;
      }

      // Telegraph page create
      const telegraphUrl = await createTelegraphPage(
        `${file.title.substring(0, 80)}`,
        buildTelegraphContent(st.tmdbItem || {}, st.currentGroup ? [st.currentGroup] : [], streams)
      );

      // Stream buttons
      const streamRows = streams.slice(0, 6).map((s, i) => {
        if (s.browserOnly) {
          return [{ text: `🌐 ${s.server || "Open"}`, url: s.link }];
        }
        return [
          { text: `▶️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_stream` },
          { text: `⬇️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_download` },
        ];
      });

      // Telegraph button
      if (telegraphUrl) {
        streamRows.push([{ text: "📄 Open in Telegraph", url: telegraphUrl }]);
      }

      const qBadge = st.currentGroup?.quality !== "N/A" ? `[${st.currentGroup.quality}]` : "";
      const lang = st.currentGroup?.languages?.join("+") || "";

      const streamMsg = await bot.sendMessage(cid, `🎬 *${file.title.substring(0, 60)}*\n📐 ${qBadge} ${lang} | ${file.size || "N/A"}\n📡 ${file.provider} *(cached)*`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: streamRows }
      });
      trackMessage(streamMsg);
      DB.set(cid, { ...st, streams, currentFile: file });
    } else {
      const wait = await bot.sendMessage(cid, `⏳ ${file.provider} - resolving...`);
      trackMessage(wait);

      try {
        const streams = await getStreamsForProvider(file.provider, file.link, file.title);
        await bot.deleteMessage(cid, wait.message_id).catch(() => {});

        if (!streams.length) {
          const errMsg = await bot.sendMessage(cid, `❌ ${file.provider} - stream available na`);
          trackMessage(errMsg);
          return;
        }

        setCache(streamCacheKey, streams);

        // Telegraph page create
        const telegraphUrl = await createTelegraphPage(
          `${file.title.substring(0, 80)}`,
          buildTelegraphContent(st.tmdbItem || {}, st.currentGroup ? [st.currentGroup] : [], streams)
        );

        const streamRows = streams.slice(0, 6).map((s, i) => {
          if (s.browserOnly) {
            return [{ text: `🌐 ${s.server || "Open"}`, url: s.link }];
          }
          return [
            { text: `▶️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_stream` },
            { text: `⬇️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_download` },
          ];
        });

        if (telegraphUrl) {
          streamRows.push([{ text: "📄 Open in Telegraph", url: telegraphUrl }]);
        }

        const qBadge = st.currentGroup?.quality !== "N/A" ? `[${st.currentGroup.quality}]` : "";
        const lang = st.currentGroup?.languages?.join("+") || "";

        const streamMsg = await bot.sendMessage(cid, `🎬 *${file.title.substring(0, 60)}*\n📐 ${qBadge} ${lang} | ${file.size || "N/A"}\n📡 ${file.provider}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: streamRows }
        });
        trackMessage(streamMsg);
        DB.set(cid, { ...st, streams, currentFile: file });
      } catch (e) {
        await bot.deleteMessage(cid, wait.message_id).catch(() => {});
        const errMsg = await bot.sendMessage(cid, `❌ ${e.message.substring(0, 100)}`);
        trackMessage(errMsg);
      }
    }
  }

  // Stream/Download - direct link resolve (database check)
  if (d.startsWith("x_")) {
    bot.answerCallbackQuery(q.id).catch(() => {});
    const parts = d.split("_");
    const idx = parseInt(parts[2]);
    const action = parts[3];
    const st = DB.get(cid);
    if (!st?.streams?.[idx]) return;

    const s = st.streams[idx];
    const directCacheKey = `direct:${s.link}:${action}`;
    const cachedDirect = getCache(directCacheKey);

    if (cachedDirect) {
      // Database theke serve
      const directLink = cachedDirect.data;
      const label = action === "download" ? "⬇️ Download" : "▶️ Stream";
      const buttons = action === "download"
        ? [[{ text: "⬇️ Download File", url: directLink }]]
        : [[{ text: "▶️ Open Stream", url: directLink }]];

      bot.sendMessage(cid, `${label} *(cached)*\n🖥️ ${s.server}\n📐 ${s.type}\n\n🔗 ${directLink}`, {
        disable_web_page_preview: true,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      // Direct link resolve + database e store
      try {
        const directLink = await resolveDirectLink(s.link, action);
        setCache(directCacheKey, directLink);

        const label = action === "download" ? "⬇️ Download" : "▶️ Stream";
        const buttons = action === "download"
          ? [[{ text: "⬇️ Download File", url: directLink }]]
          : [[{ text: "▶️ Open Stream", url: directLink }]];

        bot.sendMessage(cid, `${label}\n🖥️ ${s.server}\n📐 ${s.type}\n\n🔗 ${directLink}`, {
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons }
        });
      } catch (e) {
        // Fallback - original link
        const label = action === "download" ? "⬇️ Download" : "▶️ Stream";
        const buttons = action === "download"
          ? [[{ text: "⬇️ Download File", url: s.link }]]
          : [[{ text: "▶️ Open Stream", url: s.link }]];

        bot.sendMessage(cid, `${label} *(original)*\n🖥️ ${s.server}\n📐 ${s.type}\n\n🔗 ${s.link}`, {
          disable_web_page_preview: true,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons }
        });
      }
    }
  }
});

// ========== SHOW FILE LIST (Episode/Movie) ==========
// Shows files directly like screenshot: quality badge + provider + size + Watch/DL
function showFileList(cid, providerResults, query, isSeasonPack, epNum) {
  const files = providerResults.map((r, i) => ({
    ...parseTitle(r.title),
    link: r.link,
    provider: r.provider,
    title: r.title,
    idx: i,
  }));

  if (!files.length) return;

  // Detect available quality tabs
  const qualityCounts = {};
  files.forEach(f => {
    const q = f.quality;
    qualityCounts[q] = (qualityCounts[q] || 0) + 1;
  });

  // Build quality filter tabs
  const filterRows = [];
  const allBtn = [{ text: `All  ${files.length}`, callback_data: `qf_${cid}_all` }];
  const qTabs = Object.entries(qualityCounts)
    .sort((a, b) => {
      const order = { "4K": 0, "2160P": 1, "1080P": 2, "720P": 3, "480P": 4, "360P": 5 };
      return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
    })
    .map(([q, count]) => ({ text: `${q}  ${count}`, callback_data: `qf_${cid}_${q}` }));
  filterRows.push([...allBtn, ...qTabs]);

  // Build file cards (max 8)
  const fileCards = files.slice(0, 8).map((f, i) => {
    const qBadge = f.quality !== "N/A" ? f.quality : "";
    const provBadge = f.provider;
    const sizeText = f.size ? `  ${f.size}` : "";
    const srcText = f.source ? ` ${f.source}` : "";
    const titleShort = f.title.substring(0, 55);

    return [
      { text: `▶ Watch`, callback_data: `fl_${cid}_${i}_stream` },
      { text: `⬇ DL`, callback_data: `fl_${cid}_${i}_download` },
    ];
  });

  // Header message
  const header = isSeasonPack
    ? `📦 *${query}* — Episode ${epNum} available in these packs:\n_Download pack & extract episode ${epNum}_`
    : `🎬 *${query}* — ${files.length} files found:`;

  // File list as text message with inline buttons
  const fileListText = files.slice(0, 8).map((f, i) => {
    const qBadge = f.quality !== "N/A" ? `[${f.quality}]` : "";
    const provBadge = f.provider;
    const sizeText = f.size ? ` ${f.size}` : "";
    const srcText = f.source ? ` ${f.source}` : "";
    return `${i + 1}. ${qBadge} ${provBadge}${srcText}${sizeText}\n   ${f.title.substring(0, 55)}`;
  }).join("\n\n");

  const msgText = `${header}\n\n${fileListText}`;

  // Row 1: quality tabs
  // Row 2+: Watch/DL buttons per file
  const keyboard = [...filterRows];
  files.slice(0, 8).forEach((f, i) => {
    keyboard.push([
      { text: `▶ Watch`, callback_data: `fl_${cid}_${i}_stream` },
      { text: `⬇ DL`, callback_data: `fl_${cid}_${i}_download` },
    ]);
  });

  bot.sendMessage(cid, msgText, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  }).then(trackMessage);
  DB.set(cid, { files, query, qualityCounts });
}

// ========== SHOW SEASON LINKS (Episode Tabs) ==========

function extractEpisodeNumber(title) {
  const t = title.toLowerCase();
  // Match S01E01, E01, Ep01, Episode 1
  const m1 = t.match(/s\d+e(\d{1,3})/i);
  if (m1) return parseInt(m1[1]);
  const m2 = t.match(/e(?:p)?(\d{1,3})/i);
  if (m2) return parseInt(m2[1]);
  const m3 = t.match(/episode\s*(\d{1,3})/i);
  if (m3) return parseInt(m3[1]);
  // Match "01x01" style
  const m4 = t.match(/\d+x(\d{1,3})/i);
  if (m4) return parseInt(m4[1]);
  return null;
}

function detectEpisodeRange(files) {
  const epNums = new Set();
  files.forEach(f => {
    const ep = extractEpisodeNumber(f.title);
    if (ep !== null) epNums.add(ep);
    // Match ranges like E01-E08
    const rangeMatch = f.title.match(/e(?:p)?(\d{2})-(\d{2})/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      for (let i = start; i <= end; i++) epNums.add(i);
    }
  });
  if (epNums.size === 0) return null;
  const sorted = [...epNums].sort((a, b) => a - b);
  if (sorted.length === 1) return `E${String(sorted[0]).padStart(2, "0")}`;
  return `E${String(sorted[0]).padStart(2, "0")}-E${String(sorted[sorted.length - 1]).padStart(2, "0")}`;
}

// ========== FILTER FILE LIST BY QUALITY ==========
function filterFileList(cid, quality) {
  const st = DB.get(cid);
  if (!st?.files) return;

  const allFiles = st.files;
  const filtered = quality === "all" ? allFiles : allFiles.filter(f => f.quality === quality);
  if (!filtered.length) return;

  // Rebuild buttons
  const qualityCounts = {};
  allFiles.forEach(f => {
    const q = f.quality;
    qualityCounts[q] = (qualityCounts[q] || 0) + 1;
  });

  const filterRows = [];
  const allBtn = [{ text: `All  ${allFiles.length}`, callback_data: `qf_${cid}_all` }];
  const qTabs = Object.entries(qualityCounts)
    .sort((a, b) => {
      const order = { "4K": 0, "2160P": 1, "1080P": 2, "720P": 3, "480P": 4, "360P": 5 };
      return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
    })
    .map(([q, count]) => ({ text: `${q}  ${count}`, callback_data: `qf_${cid}_${q}` }));
  filterRows.push([...allBtn, ...qTabs]);

  const keyboard = [...filterRows];
  filtered.slice(0, 8).forEach((f, i) => {
    keyboard.push([
      { text: `▶ Watch`, callback_data: `fl_${cid}_${i}_stream` },
      { text: `⬇ DL`, callback_data: `fl_${cid}_${i}_download` },
    ]);
  });

  const fileListText = filtered.slice(0, 8).map((f, i) => {
    const qBadge = f.quality !== "N/A" ? `[${f.quality}]` : "";
    const provBadge = f.provider;
    const sizeText = f.size ? ` ${f.size}` : "";
    const srcText = f.source ? ` ${f.source}` : "";
    return `${i + 1}. ${qBadge} ${provBadge}${srcText}${sizeText}\n   ${f.title.substring(0, 55)}`;
  }).join("\n\n");

  const header = quality === "all" ? `🎬 *${st.query}* — ${allFiles.length} files:` : `🎬 *${st.query}* — ${quality} files:`;

  bot.editMessageText(`${header}\n\n${fileListText}`, {
    chat_id: cid,
    message_id: st.listMsgId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  }).catch(() => {});
}

// ========== SHOW QUALITY GROUPS → FILE BUTTONS (Movies/Season Packs) ==========
const PROV_SHORT = { vega: "VEG", mod: "MOD", movies4u: "M4U", cinefreak: "CF", hdhub4u: "HDH", "4khdhub": "4K", topmovies: "TOP", world4u: "W4U" };

function showQualityGroups(cid, providerResults, query, headerMsg, page = 1, qualityFilter = "all", msgId = null) {
  const FILES_PER_PAGE = 8;

  const files = providerResults.map((r, i) => ({
    ...parseTitle(r.title),
    link: r.link,
    provider: r.provider,
    title: r.title,
    idx: i,
  }));

  if (!files.length) return;

  // Filter by quality
  const filtered = qualityFilter === "all" ? files : files.filter(f => f.quality === qualityFilter);

  // Quality counts
  const qualityCounts = {};
  files.forEach(f => { qualityCounts[f.quality] = (qualityCounts[f.quality] || 0) + 1; });

  // Pagination
  const totalPages = Math.ceil(filtered.length / FILES_PER_PAGE);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * FILES_PER_PAGE;
  const pageFiles = filtered.slice(startIdx, startIdx + FILES_PER_PAGE);

  // Quality filter tabs
  const filterRows = [];
  const allBtn = [{ text: `All ${files.length}`, callback_data: `mg_${cid}_all_1` }];
  const qTabs = Object.entries(qualityCounts)
    .sort((a, b) => {
      const order = { "4K": 0, "2160P": 1, "1080P": 2, "720P": 3, "480P": 4, "360P": 5 };
      return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
    })
    .map(([q, count]) => ({ text: `${q} ${count}`, callback_data: `mg_${cid}_${q}_1` }));
  filterRows.push([...allBtn, ...qTabs]);

  // File buttons — with provider shortcode
  const fileButtons = pageFiles.map((f) => {
    const provTag = PROV_SHORT[f.provider] || f.provider.substring(0, 3).toUpperCase();
    const hasSize = /\[\d/.test(f.title);
    const sizeText = (!hasSize && f.size) ? `[${f.size}] ` : "";
    const btnText = `[${provTag}] ${sizeText}${f.title}`.substring(0, 55);
    return [{ text: btnText, callback_data: `fl_${cid}_${f.idx}_stream` }];
  });

  // Pagination buttons
  const navButtons = [];
  if (safePage > 1) navButtons.push({ text: `◀ Prev`, callback_data: `mg_${cid}_${qualityFilter}_${safePage - 1}` });
  navButtons.push({ text: `📄 ${safePage}/${totalPages}`, callback_data: "noop" });
  if (safePage < totalPages) navButtons.push({ text: `Next ▶`, callback_data: `mg_${cid}_${qualityFilter}_${safePage + 1}` });

  const keyboard = [...filterRows, ...fileButtons, navButtons];

  const qualityText = qualityFilter !== "all" ? ` [${qualityFilter}]` : "";
  const title = headerMsg || query;
  const header = `🎬 *${title}*${qualityText}\n\n🔗 ${filtered.length} links | Page ${safePage}/${totalPages}`;

  const fileMap = {};
  files.forEach(f => { fileMap[f.idx] = f; });

  const msgOptions = {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  };

  if (msgId) {
    // Edit existing message
    bot.editMessageText(header, { chat_id: cid, message_id: msgId, ...msgOptions }).catch(() => {});
  } else {
    bot.sendMessage(cid, header, msgOptions).then(trackMessage);
  }

  DB.set(cid, { files, fileMap, query, qualityFilter, movieProviderResults: providerResults });
}

// ========== FETCH POST DOWNLOAD LINKS ==========
async function fetchPostDownloadLinks(provider, link, title) {
  const fullLink = mkLink(provider, link);
  try {
    const pageRes = await axios.get(fullLink, { timeout: 15000, headers: BH });
    const html = pageRes.data;
    const $ = cheerio.load(html);
    const results = [];
    const seenLinks = new Set();

    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (!href.startsWith("http")) return;
      if (seenLinks.has(href)) return;

      const isDownload = /click here|download|hubcloud|vcloud|nexdrive|gdirect|drive/i.test(text) ||
                        /hubcloud|vcloud|nexdrive|gdirect|drive|generate\.php/i.test(href);
      if (!isDownload) return;

      const parent = $(el).parent();
      const prevText = parent.prev().text().trim() || parent.text().trim();
      const qualityMatch = prevText.match(/\b(4k|2160p|1080p|720p|480p|360p)\b/i);
      const sizeMatch = prevText.match(/\[?([\d.]+\s*(?:GB|MB))\]?/i) || text.match(/\[?([\d.]+\s*(?:GB|MB))\]?/i);
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "N/A";
      const size = sizeMatch ? sizeMatch[1] : null;

      seenLinks.add(href);
      const qSize = size ? `${quality} [${size}]` : quality;
      // Strip quality/size from original title to avoid double
      let cleanTitle = title
        .replace(/\b(4k|2160p|1080p|720p|480p|360p)\b/gi, "")
        .replace(/\[?[\d.]+\s*(?:GB|MB)\]?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      // Remove trailing pipes/dashes
      cleanTitle = cleanTitle.replace(/[\|–\-]+$/, "").trim();
      if (cleanTitle.length < 5) cleanTitle = title.substring(0, 60);
      const resultTitle = `${qSize} - ${cleanTitle}`.substring(0, 100);
      results.push({ title: resultTitle, link: href, provider, quality, size });
    });

    return results;
  } catch (e) {
    console.log(`[FetchLinks] ${provider} error:`, e.message);
    return [];
  }
}

// ========== STREAM ==========
const BH = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Cookie": "xla=s4t", "Accept": "text/html,application/xhtml+xml" };

async function getStreamsForProvider(provider, link, title) {
  const fullLink = mkLink(provider, link);
  
  // Custom extractors for specific providers
  if (provider === "vega") {
    try {
      const pageRes = await axios.get(fullLink, { timeout: 15000, headers: BH });
      const html = pageRes.data;
      const $ = cheerio.load(html);
      const streams = [];
      const seenLinks = new Set();

      // Extract ALL download links with quality labels
      // Vega pattern: "720p" text → "Click Here To Download [1.5GB]" link
      // Also: "1080p 3.8GB" → link
      $("a").each((i, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        if (!href.startsWith("http")) return;
        if (seenLinks.has(href)) return;

        // Must be a download/link button
        const isDownload = /click here|download|hubcloud|vcloud|nexdrive|gdirect|drive/i.test(text) || 
                          /hubcloud|vcloud|nexdrive|gdirect|drive/i.test(href);
        if (!isDownload) return;

        // Find quality label from surrounding text
        const parent = $(el).parent();
        const prevText = parent.prev().text().trim() || parent.text().trim();
        const qualityMatch = prevText.match(/\b(4k|2160p|1080p|720p|480p|360p)\b/i);
        const sizeMatch = prevText.match(/\[?([\d.]+\s*(?:GB|MB))\]?/i) || text.match(/\[?([\d.]+\s*(?:GB|MB))\]?/i);
        const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "N/A";
        const size = sizeMatch ? sizeMatch[1] : null;

        seenLinks.add(href);
        const label = size ? `${quality} (${size})` : quality;
        
        if (href.includes("nexdrive")) {
          streams.push({ server: "NexDrive", link: href, type: "mkv", quality: label });
        } else if (href.includes("hubcloud")) {
          streams.push({ server: "HubCloud", link: href, type: "mkv", quality: label });
        } else if (/vcloud|veepeez/i.test(href)) {
          streams.push({ server: "V-Cloud", link: href, type: "mkv", quality: label });
        } else if (href.includes("gdirect")) {
          streams.push({ server: "G-Direct", link: href, type: "mkv", quality: label });
        } else {
          streams.push({ server: "Link", link: href, type: "mkv", quality: label });
        }
      });

      if (streams.length) return streams.slice(0, 8);

      // Fallback: old method
      const nexdriveMatch = html.match(/href="(https?:\/\/[^"]*nexdrive[^"]*)"/i);
      if (nexdriveMatch) {
        const nexStreams = await getNexdriveStreams(nexdriveMatch[1]);
        if (nexStreams.length) return nexStreams;
      }
      const vcloudMatch = html.match(/href="(https?:\/\/[^"]*(?:vcloud|veepeez)[^"]*)"/i);
      if (vcloudMatch) return [{ server: "V-Cloud", link: vcloudMatch[1], type: "mkv" }];
      const hubcloudMatch = html.match(/href="(https?:\/\/[^"]*hubcloud[^"]*)"/i);
      if (hubcloudMatch) return [{ server: "HubCloud", link: hubcloudMatch[1], type: "mkv" }];
    } catch (e) {
      console.log(`[Vega] Page fetch error:`, e.message);
    }
  }
  
  if (provider === "world4u") {
    try {
      const pageRes = await axios.get(fullLink, { timeout: 15000, headers: BH });
      const html = pageRes.data;
      
      // Find w4links
      const w4uMatch = html.match(/href="(https?:\/\/[^"]*w4links[^"]*)"/i);
      if (w4uMatch) {
        const streams = await getW4UStreams(w4uMatch[1]);
        if (streams.length) return streams;
      }
      
      // Find gdrive links
      const gdriveMatches = html.matchAll(/href="(https?:\/\/[^"]*drive\.google\.com[^"]*)"/gi);
      const streams = [];
      for (const match of gdriveMatches) {
        streams.push({ server: "G-Drive", link: match[1], type: "mkv" });
      }
      if (streams.length) return streams;
    } catch (e) {
      console.log(`[World4u] Page fetch error:`, e.message);
    }
  }
  
  if (provider === "movies4u") {
    try {
      const pageRes = await axios.get(fullLink, { timeout: 15000, headers: BH });
      const html = pageRes.data;
      
      // Find mdrive links
      const mdriveMatches = html.matchAll(/href="(https?:\/\/[^"]*mdrive[^"]*)"/gi);
      const streams = [];
      for (const match of mdriveMatches) {
        const mdriveStreams = await getMdriveStreams(match[1]);
        streams.push(...mdriveStreams);
      }
      if (streams.length) return streams;
      
      // Find nexdrive links
      const nexdriveMatches = html.matchAll(/href="(https?:\/\/[^"]*nexdrive[^"]*)"/gi);
      for (const match of nexdriveMatches) {
        const nexdriveStreams = await getNexdriveStreams(match[1]);
        streams.push(...nexdriveStreams);
      }
      if (streams.length) return streams;
    } catch (e) {
      console.log(`[Movies4u] Page fetch error:`, e.message);
    }
  }
  
  if (provider === "cinefreak") {
    try {
      const streams = await cinefreakGetStreams(fullLink);
      if (streams.length) return streams;
    } catch (e) {
      console.log(`[CineFreak] Stream error:`, e.message);
    }
  }
  
  if (provider === "mod") {
    try {
      const streams = await getModStreams(fullLink);
      if (streams.length) return streams;
    } catch (e) {
      console.log(`[Mod] Custom extractor error:`, e.message);
    }
  }

  // hdhub4u: extract hubdrive/hubcloud/nexdrive links from page
  if (provider === "hdhub4u") {
    try {
      // First try the built-in stream module
      const mod = getMod(provider, "stream");
      if (mod?.getStream) {
        try {
          const streams = await mod.getStream({ link: fullLink, type: "movie", signal, providerContext });
          const valid = (streams || []).filter(s => s.link);
          if (valid.length) return valid;
        } catch {}
      }
      // Fallback: manual page extraction
      const pageRes = await axios.get(fullLink, { timeout: 15000, headers: BH });
      const html = pageRes.data;
      const streams = [];

      // Hubcloud link → resolve
      const hubcloudMatch = html.match(/href="(https?:\/\/hubcloud\.[a-z]+\/(?:drive|w)[^"]*)"/i);
      if (hubcloudMatch) {
        try {
          const resolved = await resolveVCloud(hubcloudMatch[1]);
          if (resolved) streams.push({ server: "HubCloud", link: resolved, type: "mkv" });
        } catch {}
      }

      // Nexdrive link
      const nexdriveMatch = html.match(/href="(https?:\/\/[^"]*nexdrive[^"]*)"/i);
      if (nexdriveMatch) {
        try {
          const nexStreams = await getNexdriveStreams(nexdriveMatch[1]);
          streams.push(...nexStreams);
        } catch {}
      }

      // Gdrive link
      const gdriveMatches = html.matchAll(/href="(https?:\/\/drive\.google\.com[^"]*)"/gi);
      for (const m of gdriveMatches) {
        streams.push({ server: "G-Drive", link: m[1], type: "mkv" });
      }

      if (streams.length) return streams.filter(s => s.link);
    } catch (e) {
      console.log(`[HDHub4u] Custom extractor error:`, e.message);
    }
  }

  // 4khdhub: extract hubcloud/vcloud/cf-worker links
  if (provider === "4khdhub") {
    try {
      const streams = await getMod(provider, "stream")?.getStream({ link: fullLink, type: "movie", signal, providerContext });
      if (streams?.length) return streams.filter(s => s.link); // filter out undefined links
    } catch (e) {
      console.log(`[4KHDHub] Stream error:`, e.message);
    }
  }

  // Default: use provider stream module
  const mod = getMod(provider, "stream");
  if (!mod?.getStream) throw new Error("stream not found");
  return mod.getStream({ link: fullLink, type: "movie", signal, providerContext });
}

// ========== RESOLVE DIRECT LINK ==========
async function resolveDirectLink(link, action) {
  // V-Cloud resolve (vcloud.zip, hubcloud)
  if (link.includes("vcloud") || link.includes("veepeez") || link.includes("hubcloud")) {
    const resolved = await resolveVCloud(link);
    if (resolved) return resolved;
  }

  // FastDl resolve (fastdl.zip → googleusercontent)
  if (link.includes("fastdl.zip")) {
    const resolved = await resolveFastDl(link);
    if (resolved) return resolved;
  }

  // GDFlix resolve
  if (link.includes("gdflix") || link.includes("gdflix.top")) {
    const resolved = await resolveGDFlix(link);
    if (resolved) return resolved;
  }

  // Filepress/filebee resolve
  if (link.includes("filepress") || link.includes("filebee")) {
    const resolved = await resolveFilepress(link);
    if (resolved) return resolved;
  }

  // Nexdrive resolve
  if (link.includes("nexdrive")) {
    const resolved = await resolveNexdrive(link);
    if (resolved) return resolved;
  }

  // CineCloud resolve
  if (link.includes("cinecloud.site")) {
    const resolved = await resolveCineCloud(link);
    if (resolved) return resolved;
  }

  // HubDrive → get hubcloud link → resolve
  if (link.includes("hubdrive")) {
    try {
      const res = await axios.get(link, { timeout: 15000, headers: BH });
      const html = res.data;
      const hubMatch = html.match(/href="(https?:\/\/[^"]*hubcloud[^"]*)"/i) ||
                      html.match(/href="(https?:\/\/[^"]*\/drive\/[^"]*)"/i);
      if (hubMatch) {
        const resolved = await resolveVCloud(hubMatch[1]);
        if (resolved) return resolved;
      }
    } catch {}
  }

  // vgmlinks resolve — follow redirect to get actual link
  if (link.includes("vgmlinks.live")) {
    try {
      const res = await axios.get(link, { timeout: 10000, headers: BH, maxRedirects: 5 });
      const finalUrl = res.request?.res?.responseUrl || res.headers?.location;
      if (finalUrl && finalUrl !== link) {
        // Recursively resolve the redirected link
        return await resolveDirectLink(finalUrl, action);
      }
      // Try to extract link from page
      const html = res.data;
      const match = html.match(/href="(https?:\/\/[^"]*(?:hubcloud|vcloud|nexdrive|gdirect)[^"]*)"/i);
      if (match) return await resolveDirectLink(match[1], action);
    } catch {}
  }

  // fast-dl.one resolve — follow redirect
  if (link.includes("fast-dl.one")) {
    try {
      const res = await axios.get(link, { timeout: 10000, headers: BH, maxRedirects: 5 });
      const finalUrl = res.request?.res?.responseUrl || res.headers?.location;
      if (finalUrl && finalUrl !== link) return finalUrl;
    } catch {}
  }

  // CineFreak generate.php resolve
  if (link.includes("generate.php") && link.includes("cinefreak")) {
    const resolved = await cinefreakResolveLink(link);
    if (resolved && resolved !== link) return resolved;
  }

  // Already direct links
  if (link.includes("gdirect") || link.includes("drive.google.com") || link.includes("cloudflarestorage") || link.includes("r2.dev") || link.includes("pixeld") || link.includes("gofile.io") || link.includes("flapdoodle") || link.includes("googleusercontent.com")) {
    return link;
  }

  return link;
}

async function resolveHubCloud(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Cookie": "xla=s4t" } });
    const html = res.data;

    // double atob decode
    const atobMatch = html.match(/atob\(atob\(['"]([^'"]+)['"]\)\)/);
    if (atobMatch) {
      const firstDecode = Buffer.from(atobMatch[1], 'base64').toString();
      const tokenUrl = Buffer.from(firstDecode, 'base64').toString();
      console.log("[HubCloud] Token URL:", tokenUrl.substring(0, 100));
      
      const tokenRes = await axios.get(tokenUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } });
      const $ = cheerio.load(tokenRes.data);
      const btnLinks = [];
      $('.btn-success').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('http') && !href.includes('hubcloud') && !href.includes('vcloud')) {
          btnLinks.push({ text: $(el).text().trim(), link: href });
        }
      });
      if (btnLinks.length) {
        const cf = btnLinks.find(b => b.link.includes('cloudflarestorage'));
        const pd = btnLinks.find(b => b.link.includes('pixeld'));
        return (cf || pd || btnLinks[0]).link;
      }
    }

    // var url fallback
    const urlMatch = html.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
    if (urlMatch) return urlMatch[1];

    return null;
  } catch { return null; }
}

async function resolveVCloud(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Cookie": "xla=s4t", "Accept": "text/html,application/xhtml+xml" } });
    const html = res.data;

    // vcloud.zip: double atob decode → token URL → download buttons
    const atobMatch = html.match(/atob\(atob\(['"]([^'"]+)['"]\)\)/);
    if (atobMatch) {
      const firstDecode = Buffer.from(atobMatch[1], 'base64').toString();
      const tokenUrl = Buffer.from(firstDecode, 'base64').toString();
      console.log("[VCloud] Token URL:", tokenUrl.substring(0, 100));
      
      const tokenRes = await axios.get(tokenUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Cookie": "xla=s4t" } });
      const tokenHtml = tokenRes.data;
      
      const $ = cheerio.load(tokenHtml);
      const btnLinks = [];
      $('.btn-success').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('http') && !href.includes('vcloud.zip')) {
          btnLinks.push({ text: $(el).text().trim(), link: href });
        }
      });
      
      if (btnLinks.length) {
        console.log("[VCloud] Found", btnLinks.length, "links");
        btnLinks.forEach(b => console.log("  ", b.text.substring(0, 30), "->", b.link.substring(0, 80)));
        const cfStorage = btnLinks.find(b => b.link.includes('cloudflarestorage'));
        const pixeldrain = btnLinks.find(b => b.link.includes('pixeld'));
        const gofile = btnLinks.find(b => b.link.includes('gofile'));
        const best = cfStorage || pixeldrain || gofile || btnLinks[0];
        return best.link;
      }
    }

    // Fallback
    const match = html.match(/href="(https?:\/\/[^"]*(?:download|cloud)[^"]*)"/i) ||
                  html.match(/"download_url"\s*:\s*"(https?:\/\/[^"]*)"/i);
    if (match) return match[1];
    return null;
  } catch(e) { console.log("[VCloud] Error:", e.message); return null; }
}

async function resolveGDFlix(link) {
  try {
    const res = await axios.get(link, { timeout: 10000, headers: { "User-Agent": providerContext.commonHeaders["User-Agent"] } });
    const html = res.data;

    const match = html.match(/href="(https?:\/\/[^"]*(?:download|drive)[^"]*)"/i) ||
                  html.match(/href="(https?:\/\/[^"]*drive\.google\.com[^"]*)"/i);

    if (match) return match[1];
    return null;
  } catch { return null; }
}

async function resolveFilepress(link) {
  try {
    const fileId = link.split('/').pop();
    const baseUrl = link.split('/').slice(0, -2).join('/');
    const browserHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Content-Type": "application/json", "Referer": link };
    
    const apiRes = await axios.post(`${baseUrl}/api/file/downlaod/`, {
      id: fileId, method: "indexDownlaod", captchaValue: null
    }, { headers: browserHeaders, timeout: 10000 });
    
    if (apiRes.data?.status) {
      const token = apiRes.data.data;
      const dlRes = await axios.post(`${baseUrl}/api/file/downlaod2/`, {
        id: token, method: "indexDownlaod", captchaValue: null
      }, { headers: browserHeaders, timeout: 10000 });
      
      if (dlRes.data?.data?.[0]) {
        console.log("[Filepress] Resolved:", dlRes.data.data[0].substring(0, 100));
        return dlRes.data.data[0];
      }
    }
    return null;
  } catch { return null; }
}

async function resolveNexdrive(link) {
  try {
    const res = await axios.get(link, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } });
    const html = res.data;

    // Try vcloud link inside
    const vcloudMatch = html.match(/href="(https?:\/\/[^"]*vcloud[^"]*)"/i);
    if (vcloudMatch) return resolveVCloud(vcloudMatch[1]);

    // Try fastdl link inside
    const fastdlMatch = html.match(/href="(https?:\/\/fastdl\.zip[^"]*)"/i);
    if (fastdlMatch) return resolveFastDl(fastdlMatch[1]);

    // Try gdirect
    const gdirectMatch = html.match(/href="(https?:\/\/[^"]*gdirect[^"]*)"/i);
    if (gdirectMatch) return gdirectMatch[1];

    return null;
  } catch { return null; }
}

async function resolveFastDl(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Referer": "https://nexdrive.fit/" } });
    const html = res.data;
    
    const reurlMatch = html.match(/var\s+reurl\s*=\s*["']([^"']+)["']/);
    if (reurlMatch) {
      const dlUrl = reurlMatch[1];
      console.log("[FastDl] Resolved:", dlUrl.substring(0, 100));
      return dlUrl;
    }
    return null;
  } catch { return null; }
}

// ========== CUSTOM NEXDRIVE STREAM EXTRACTOR ==========
async function getNexdriveStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const html = res.data;
    const streams = [];
    const seenLinks = new Set();

    // Extract G-Direct links
    const gdirectMatches = html.matchAll(/href="(https?:\/\/[^"]*(?:gdown|gdirect)[^"]*)"/gi);
    for (const match of gdirectMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "G-Direct", link: match[1], type: "mkv" });
      }
    }

    // Extract Filepress links
    const filepressMatches = html.matchAll(/href="(https?:\/\/[^"]*(?:filepress|fpd)[^"]*)"/gi);
    for (const match of filepressMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Filepress", link: match[1], type: "mkv" });
      }
    }

    // Extract V-Cloud links
    const vcloudMatches = html.matchAll(/href="(https?:\/\/[^"]*(?:vcloud|veepeez|vc)[^"]*)"/gi);
    for (const match of vcloudMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "V-Cloud", link: match[1], type: "mkv" });
      }
    }

    // Extract HubCloud links
    const hubcloudMatches = html.matchAll(/href="(https?:\/\/[^"]*(?:hubcloud|hubs)[^"]*)"/gi);
    for (const match of hubcloudMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "HubCloud", link: match[1], type: "mkv" });
      }
    }

    // Extract direct mp4/mkv links (skip fastdl.zip, embed.php)
    const directMatches = html.matchAll(/href="(https?:\/\/[^"]*\.(?:mp4|mkv|avi)[^"]*)"/gi);
    for (const match of directMatches) {
      const url = match[1];
      // Skip dead links
      if (url.includes("fastdl.zip") || url.includes("embed.php")) continue;
      if (!seenLinks.has(url)) {
        seenLinks.add(url);
        streams.push({ server: "Direct", link: url, type: url.includes(".mkv") ? "mkv" : "mp4" });
      }
    }

    // Extract data-url attributes
    const dataUrlMatches = html.matchAll(/data-url="([^"]*)"/gi);
    for (const match of dataUrlMatches) {
      if (match[1].startsWith("http") && !seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Server", link: match[1], type: "mkv" });
      }
    }

    return streams.slice(0, 6); // Max 6 streams
  } catch { return []; }
}

// ========== CUSTOM MDRIVE STREAM EXTRACTOR ==========
// MOVIES4U structure: Season → Quality → G-Direct + V-Cloud + Batch/Zip
// Links go to mdrive.buzz/mdisk/XXXX
async function getMdriveStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const $ = cheerio.load(res.data);
    const streams = [];
    const seenLinks = new Set();

    // Extract all download links from mdrive page
    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (!href || seenLinks.has(href)) return;

      // Skip navigation/ads
      if (text.length < 3) return;
      if (href.includes("javascript:") || href === "#") return;

      // G-Direct links
      if (/g-?direct|instant/i.test(text) || href.includes("gdirect")) {
        seenLinks.add(href);
        streams.push({ server: "G-Direct", link: href, type: "mkv" });
      }
      // V-Cloud links
      else if (/v-?cloud|resumable/i.test(text) || href.includes("vcloud")) {
        seenLinks.add(href);
        streams.push({ server: "V-Cloud", link: href, type: "mkv" });
      }
      // Batch/Zip links
      else if (/batch|zip|gdtot|g-?drive/i.test(text)) {
        seenLinks.add(href);
        streams.push({ server: "Batch/Zip", link: href, type: "mkv" });
      }
      // Direct mdrive links (Download Now buttons)
      else if (/download now|download/i.test(text) && href.includes("mdrive")) {
        seenLinks.add(href);
        streams.push({ server: "Direct", link: href, type: "mkv" });
      }
    });

    // Also extract nexdrive links if present
    $("a[href*='nexdrive']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (!seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: "NexDrive", link: href, type: "mkv" });
      }
    });

    return streams.slice(0, 8);
  } catch { return []; }
}

// ========== CUSTOM W4U STREAM EXTRACTOR ==========
async function getW4UStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const html = res.data;
    const streams = [];
    const seenLinks = new Set();

    // W4U has INSTANT LINK with G-Drive
    const gdriveMatches = html.matchAll(/href="(https?:\/\/[^"]*drive\.google\.com[^"]*)"/gi);
    for (const match of gdriveMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "G-Drive", link: match[1], type: "mkv" });
      }
    }

    // Extract any /go/ or /dl/ links
    const goMatches = html.matchAll(/href="(https?:\/\/[^"]*\/(?:go|dl|download|instant|stream)[^"]*)"/gi);
    for (const match of goMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Download", link: match[1], type: "mkv" });
      }
    }

    // Extract data-url attributes
    const dataUrlMatches = html.matchAll(/data-url="([^"]*)"/gi);
    for (const match of dataUrlMatches) {
      if (match[1].startsWith("http") && !seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Server", link: match[1], type: "mkv" });
      }
    }

    return streams.slice(0, 6);
  } catch { return []; }
}

// ========== CINEFREAK SCRAPER ==========
// CineFreak structure: Single Episode Links → Quality (HD 720p, HD 1080p) → generate.php → cinecloud
// Also has Combo Packs for multiple episodes
const CINEFREAK_URL = "https://cinefreak.net";

async function cinefreakSearch(query) {
  try {
    const res = await axios.get(`${CINEFREAK_URL}/`, { params: { s: query }, headers: BH, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const results = [];

    // Clean title — remove nav/category prefixes
    function cleanTitle(raw) {
      let t = raw;
      // Remove known nav prefixes
      t = t.replace(/^(RE-UPLOADED\s+)?COMPLETED\s+/i, "");
      t = t.replace(/^(WEB-DL\s*)+/i, "");
      t = t.replace(/^(BluRay\s*)+/i, "");
      t = t.replace(/^(HDRip\s*)+/i, "");
      t = t.replace(/^(Dual Audio\s*)+/i, "");
      t = t.replace(/^(Hindi Dubbed\s*)/i, "");
      t = t.replace(/^(Hindi\s*)/i, "");
      t = t.replace(/^(English\s*)/i, "");
      t = t.replace(/^(Tamil\s*)/i, "");
      t = t.replace(/^(Telugu\s*)/i, "");
      t = t.replace(/^(WEB-Series\s*)/i, "");
      t = t.replace(/^(Movies\s*)/i, "");
      t = t.replace(/^[A-Z][a-z]+ Movies\s*/i, "");
      t = t.replace(/Animation\s*/i, "");
      t = t.replace(/Dual Audio\s*/i, "");
      // Remove trailing nav text
      t = t.replace(/\s*(CineFreak|GDrive Link|Full Movie Download|Watch Online).*$/i, "");
      t = t.replace(/\s*\d+ years? ago\s*$/i, "");
      return t.trim();
    }

    // CineFreak search results - find actual post links
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href") || "";
      const rawText = $(el).text().trim().replace(/\s+/g, " ");
      const text = cleanTitle(rawText);

      // Must be a cinefreak.net post, not category/search
      if (!href.includes("cinefreak.net/") || href.includes("?s=") || href.includes("/category/")) return;
      if (text.length < 10) return;

      // Exclude category/nav links — actual posts have year, quality, or file info
      const isCategory = /^(movies?|web[\s-]?series?|tv[\s-]?shows?|anime|bangla|hindi|tamil|telugu|korean|english|dual[\s-]?audio)/i.test(text);
      if (isCategory) return;

      // Must look like a real post title (has year or quality or size)
      const hasYear = /\b(20\d{2}|19\d{2})\b/.test(text);
      const hasQuality = /\b(4k|2160p|1080p|720p|480p|web-?dl|bluray|hdrip|dvdrip|hevc|x264|x265)\b/i.test(text);
      const hasSize = /\b\d+\s*(gb|mb)\b/i.test(text);
      if (!hasYear && !hasQuality && !hasSize) return;

      results.push({
        title: text.substring(0, 100),
        link: href,
        provider: "cinefreak"
      });
    });

    // Deduplicate by URL
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.link)) return false;
      seen.add(r.link);
      return true;
    }).slice(0, 5);
  } catch (e) {
    console.log("[CineFreak] Search error:", e.message);
    return [];
  }
}

async function cinefreakGetStreams(link) {
  try {
    const fullUrl = link.startsWith("http") ? link : CINEFREAK_URL + link;
    const res = await axios.get(fullUrl, { headers: BH, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const streams = [];
    const seenLinks = new Set();

    // Extract generate.php links - these decode to cinecloud.site
    $("a[href*='generate.php']").each((i, el) => {
      const href = $(el).attr("href") || "";
      const quality = $(el).text().trim();

      const base64Match = href.match(/id=([A-Za-z0-9+/=]+)/);
      if (base64Match) {
        try {
          const decoded = Buffer.from(base64Match[1], "base64").toString();
          if (!seenLinks.has(decoded)) {
            seenLinks.add(decoded);
            streams.push({
              server: `CineCloud (${quality})`,
              link: decoded,
              type: "mkv",
              quality
            });
          }
        } catch {}
      }
    });

    // Also extract direct cinecloud links
    $("a[href*='cinecloud']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (href.startsWith("http") && !seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: "CineCloud", link: href, type: "mkv" });
      }
    });

    return streams;
  } catch (e) {
    console.log("[CineFreak] Stream error:", e.message);
    return [];
  }
}

async function resolveCineCloud(link) {
  try {
    const idMatch = link.match(/cinecloud\.site\/[fwd]\/([a-f0-9]+)/i);
    if (!idMatch) return null;
    const fileId = idMatch[1];
    const base = link.match(/(https?:\/\/[^/]+)/)[1];

    // Try /d/ endpoint (Cloudflare R2 direct)
    try {
      const dRes = await axios.get(`${base}/d/${fileId}`, { headers: BH, timeout: 15000 });
      const $d = cheerio.load(dRes.data);
      const r2Link = $d('a[href*="cloudflarestorage.com"]').attr('href');
      if (r2Link) return r2Link;
    } catch {}

    // Try /w/ endpoint (googleusercontent direct)
    try {
      const wRes = await axios.get(`${base}/w/${fileId}`, { headers: BH, timeout: 15000 });
      const $w = cheerio.load(wRes.data);
      const googleLink = $w('a[href*="googleusercontent.com"]').attr('href');
      if (googleLink) return googleLink;
    } catch {}

    return null;
  } catch { return null; }
}

async function cinefreakResolveLink(link) {
  try {
    // generate.php → decode base64 → cinecloud URL
    if (link.includes("generate.php")) {
      const base64Match = link.match(/id=([A-Za-z0-9+/=]+)/);
      if (base64Match) {
        return Buffer.from(base64Match[1], "base64").toString();
      }
    }

    // cinecloud.site → resolve to direct R2/google link
    if (link.includes("cinecloud.site")) {
      const resolved = await resolveCineCloud(link);
      if (resolved) return resolved;
    }

    return link;
  } catch (e) {
    return link;
  }
}

// ========== CUSTOM MOD STREAM EXTRACTOR ==========
// MOD structure: Season → Quality → Episode Links + Batch/Zip
// Episode/Batch links go to modpro.blog → cloud.unblockedgames.world (BROWSER-ONLY, unresolvable server-side)
// Only direct G-Drive/OneDrive/G-Direct links from the page can be used
async function getModStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const $ = cheerio.load(res.data);
    const streams = [];
    const seenLinks = new Set();

    // Extract G-Drive links
    $("a[href*='drive.google.com']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (!seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: "G-Drive", link: href, type: "mkv" });
      }
    });

    // Extract OneDrive links
    $("a[href*='onedrive']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (!seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: "OneDrive", link: href, type: "mkv" });
      }
    });

    // Extract G-Direct links
    $("a[href*='gdirect']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (!seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: "G-Direct", link: href, type: "mkv" });
      }
    });

    // Note: modpro.blog episode/batch links go to cloud.unblockedgames.world which
    // requires browser JS execution + Cloudflare challenge — cannot resolve server-side.
    // If no direct links found, show modpro.blog link as "Open in Browser"
    if (!streams.length) {
      const modproLink = $("a[href*='modpro.blog']").first().attr("href");
      if (modproLink) {
        streams.push({ server: "Open in Browser", link: modproLink, type: "mkv", browserOnly: true });
      }
    }

    return streams.slice(0, 8);
  } catch { return []; }
}

// ========== TMDB ==========
async function tmdbSearch(q) {
  const r = await axios.get("https://api.themoviedb.org/3/search/multi", { params: { api_key: TMDB_KEY, query: q, language: "en-US" } });
  return r.data.results.filter(x => x.media_type === "movie" || x.media_type === "tv").slice(0, 1).map(x => ({
    id: x.id, title: x.title || x.name, year: (x.release_date || x.first_air_date || "").slice(0, 4),
    poster: x.poster_path ? TMDB_IMG + x.poster_path : null, rating: x.vote_average?.toFixed(1), type: x.media_type,
  }));
}

async function tmdbGetTVDetails(tvId) {
  const r = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}`, { params: { api_key: TMDB_KEY, language: "en-US" } });
  return r.data;
}

async function tmdbGetEpisodes(tvId, seasonNum) {
  const r = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNum}`, { params: { api_key: TMDB_KEY, language: "en-US" } });
  return r.data.episodes || [];
}

// ========== SEARCH ==========
async function searchAllProviders(query) {
  const all = [];
  
  // CineFreak custom search
  try {
    const cfResults = await cinefreakSearch(query);
    cfResults.slice(0, 3).forEach(r => all.push({ ...r, provider: 'cinefreak' }));
  } catch {}
  
  // Vega-providers search
  await Promise.allSettled(Object.entries(PROVIDERS).map(async ([name]) => {
    if (name === 'cinefreak') return; // Skip, already handled
    try {
      const posts = getMod(name, "posts");
      if (!posts?.getSearchPosts) return;
      const results = await posts.getSearchPosts({ searchQuery: query, page: 1, providerValue: name, signal, providerContext });
      results.slice(0, 3).forEach(r => all.push({ ...r, provider: name }));
    } catch {}
  }));
  // Dedup by URL (normalize: remove trailing slash, query params)
  const seen = new Set();
  const deduped = all.filter(r => {
    const norm = r.link.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    const key = `${r.provider}:${norm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Filter out category/navigation links + irrelevant results
  return deduped.filter(r => isRealFile(r.title) && isRelevant(r.title, query));
}

// ========== IMAGE ==========
async function makeCardImage(item) {
  const W = 300, H = 450;
  let pb;
  try { if (item.poster) { const r = await axios.get(item.poster, { responseType: "arraybuffer", timeout: 8000 }); pb = await sharp(Buffer.from(r.data)).resize(W, H - 60, { fit: "cover" }).toBuffer(); } else throw 0; } catch { pb = await sharp({ create: { width: W, height: H - 60, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(); }
  const b = await sharp(pb).composite([{ input: Buffer.from(`<svg width="${W}" height="${H-60}"><defs><linearGradient id="g" x1="0" y1=".6" x2="0" y2="1"><stop offset="0%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,.85)"/></linearGradient></defs><rect width="${W}" height="${H-60}" fill="url(#g)"/></svg>`), top: 0, left: 0 }]).toBuffer();
  const r = parseFloat(item.rating) || 0;
  const bc = r >= 7 ? "#2ecc71" : r >= 5 ? "#f39c12" : "#e74c3c";
  const tc = item.type === "tv" ? "#3498db" : "#e74c3c";
  const tt = item.title.length > 25 ? item.title.substring(0, 23) + "..." : item.title;
  const svg = `<svg width="${W}" height="${H}"><rect x="0" y="${H-60}" width="${W}" height="60" fill="rgba(15,15,25,.95)"/><text x="14" y="${H-35}" font-family="Arial" font-size="16" font-weight="bold" fill="white">${esc(tt)}</text><text x="14" y="${H-14}" font-family="Arial" font-size="12" fill="#aaa">${item.year||"?"} • ${item.type==="tv"?"Series":"Movie"}</text><rect x="${W-60}" y="10" width="50" height="24" rx="4" fill="${bc}"/><text x="${W-35}" y="27" font-family="Arial" font-size="13" font-weight="bold" fill="white" text-anchor="middle">★ ${item.rating||"N/A"}</text><rect x="10" y="10" width="${item.type==="tv"?62:56}" height="24" rx="4" fill="${tc}"/><text x="${item.type==="tv"?41:38}" y="27" font-family="Arial" font-size="12" font-weight="bold" fill="white" text-anchor="middle">${item.type==="tv"?"SERIES":"MOVIE"}</text></svg>`;
  return sharp(b).resize(W, H).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function edit(m, t) { return bot.editMessageText(t, { chat_id: m.chat.id, message_id: m.message_id }).catch(() => {}); }

console.log("🤖 Vega Bot v16 (Season Links) Started!");
