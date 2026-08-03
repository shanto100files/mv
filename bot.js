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
    if (item) {
      const imgBuf = await makeCardImage(item);
      const photoMsg = await bot.sendPhoto(cid, imgBuf, {
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
      const providerResults = await searchAllProviders(txt);
      if (!providerResults.length) {
        const errMsg = await bot.sendMessage(cid, "❌ Kono result nai");
        trackMessage(errMsg);
        return;
      }
      setCache(cacheKey, providerResults);
      showQualityGroups(cid, providerResults, txt);
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

    // Season pack cache + episode cache
    const seasonPackKey = `seasonpack:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    setCache(seasonPackKey, unique);
    
    const episodeCacheKey = `episode:${seriesTitle.toLowerCase()}:${epLabel}`;
    setCache(episodeCacheKey, unique);

    showQualityGroups(cid, unique, `${seriesTitle} ${epLabel}`);
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

  // Season click -> episodes (database check)
  if (d.startsWith("s_")) {
    bot.answerCallbackQuery(q.id, { text: "Loading episodes..." }).catch(() => {});
    const parts = d.split("_");
    const seasonNum = parseInt(parts[2]);
    const tvId = parseInt(parts[3]);

    const st = DB.get(cid);
    const seriesTitle = st?.tmdbItem?.title || "";
    const cacheKey = `series:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    const cached = getCache(cacheKey);

    if (cached) {
      // Database theke serve
      const episodes = cached.data;
      const epRows = episodes.map((ep) => {
        const title = ep.name || `Episode ${ep.episode_number}`;
        const btnText = `E${ep.episode_number}: ${title}`.substring(0, 55);
        return [{ text: btnText, callback_data: `e_${cid}_${tvId}_${seasonNum}_${ep.episode_number}` }];
      });
      epRows.push([{ text: "━━━━━━━━━━━━━━━━", callback_data: "noop" }]);
      epRows.push([{ text: `📦 Season ${seasonNum} Complete`, callback_data: `sp_${cid}_${tvId}_${seasonNum}` }]);

      await bot.sendMessage(cid, `📺 *Season ${seasonNum}* - ${episodes.length} episodes: (cached)`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: epRows }
      }).then(trackMessage);
    } else {
      // TMDB theke fetch + database e store
      try {
        const episodes = await tmdbGetEpisodes(tvId, seasonNum);
        if (!episodes.length) return bot.sendMessage(cid, "❌ Episode nai");

        setCache(cacheKey, episodes);

        const epRows = episodes.map((ep) => {
          const title = ep.name || `Episode ${ep.episode_number}`;
          const btnText = `E${ep.episode_number}: ${title}`.substring(0, 55);
          return [{ text: btnText, callback_data: `e_${cid}_${tvId}_${seasonNum}_${ep.episode_number}` }];
        });
        epRows.push([{ text: "━━━━━━━━━━━━━━━━", callback_data: "noop" }]);
        epRows.push([{ text: `📦 Season ${seasonNum} Complete`, callback_data: `sp_${cid}_${tvId}_${seasonNum}` }]);

        await bot.sendMessage(cid, `📺 *Season ${seasonNum}* - ${episodes.length} episodes:`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: epRows }
        });
      } catch (e) {
        bot.sendMessage(cid, `❌ Episodes load hoyni`);
      }
    }
  }

  // Episode click -> Season pack search (database check + background fetch next)
  if (d.startsWith("e_")) {
    bot.answerCallbackQuery(q.id, { text: "Searching episode..." }).catch(() => {});
    const parts = d.split("_");
    const tvId = parseInt(parts[2]);
    const seasonNum = parseInt(parts[3]);
    const epNum = parseInt(parts[4]);

    const st = DB.get(cid);
    const seriesTitle = st?.tmdbItem?.title || "";
    const seasonPad = String(seasonNum).padStart(2, "0");
    const epPad = String(epNum).padStart(2, "0");
    const epLabel = `S${seasonPad}E${epPad}`;

    // Season pack cache check (not individual episode)
    const seasonPackKey = `seasonpack:${seriesTitle.toLowerCase()}:s${seasonNum}`;
    const cachedPack = getCache(seasonPackKey);

    // Individual episode cache
    const episodeCacheKey = `episode:${seriesTitle.toLowerCase()}:${epLabel}`;
    const cachedEpisode = getCache(episodeCacheKey);

    if (cachedEpisode) {
      showQualityGroups(cid, cachedEpisode.data, `${seriesTitle} ${epLabel}`);
    } else if (cachedPack) {
      // Season pack theke episode filter
      const filtered = filterEpisodeFromSeasonPack(cachedPack.data, epNum);
      if (filtered.length) {
        setCache(episodeCacheKey, filtered);
        showQualityGroups(cid, filtered, `${seriesTitle} ${epLabel}`);
      } else {
        // Season pack e episode na thakle, nijei fetch
        fetchEpisodeProviders(seriesTitle, seasonNum, epNum, cid, epLabel);
      }
    } else {
      fetchEpisodeProviders(seriesTitle, seasonNum, epNum, cid, epLabel);
    }
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
      const streamRows = streams.slice(0, 6).map((s, i) => [
        { text: `▶️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_stream` },
        { text: `⬇️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_download` },
      ]);

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

        const streamRows = streams.slice(0, 6).map((s, i) => [
          { text: `▶️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_stream` },
          { text: `⬇️ ${s.server || "Server"}`, callback_data: `x_${cid}_${i}_download` },
        ]);

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

// ========== HELPER: Show Quality Groups ==========
function showQualityGroups(cid, providerResults, query) {
  const files = providerResults.map((r, i) => ({
    ...parseTitle(r.title),
    link: r.link,
    provider: r.provider,
    title: r.title,
    idx: i,
  }));

  const groups = {};
  files.forEach(f => {
    const k = groupKey(f);
    if (!groups[k]) groups[k] = { ...f, count: 0, items: [] };
    groups[k].count++;
    groups[k].items.push(f);
  });

  const groupArr = Object.values(groups);
  if (!groupArr.length) return;

  // Max 8 buttons + header
  const maxGroups = 8;
  const limited = groupArr.slice(0, maxGroups);

  const rows = limited.map((g, i) => {
    const badge = g.quality !== "N/A" ? `[${g.quality}]` : "";
    const lang = g.languages.join("+");
    if (g.count === 1) {
      const sizeBadge = g.items[0].size ? ` (${g.items[0].size})` : "";
      const btnText = `${badge} ${lang}${sizeBadge}`.substring(0, 50);
      return [{ text: btnText, callback_data: `g_${cid}_${i}` }];
    }
    const btnText = `${badge} ${lang} • ${g.count} links`.substring(0, 50);
    return [{ text: btnText, callback_data: `g_${cid}_${i}` }];
  });

  bot.sendMessage(cid, `🎬 *${query}*`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows }
  }).then(trackMessage);
  DB.set(cid, { groups: limited, query });
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
      
      // Find nexdrive link
      const nexdriveMatch = html.match(/href="(https?:\/\/[^"]*nexdrive[^"]*)"/i);
      if (nexdriveMatch) {
        const streams = await getNexdriveStreams(nexdriveMatch[1]);
        if (streams.length) return streams;
      }
      
      // Find vcloud link → resolve immediately
      const vcloudMatch = html.match(/href="(https?:\/\/[^"]*(?:vcloud|veepeez)[^"]*)"/i);
      if (vcloudMatch) {
        const resolved = await resolveVCloud(vcloudMatch[1]);
        if (resolved) return [{ server: "V-Cloud", link: resolved, type: "mkv" }];
        return [{ server: "V-Cloud", link: vcloudMatch[1], type: "mkv" }];
      }
      
      // Find hubcloud link → resolve immediately
      const hubcloudMatch = html.match(/href="(https?:\/\/[^"]*hubcloud[^"]*)"/i);
      if (hubcloudMatch) {
        const resolved = await resolveVCloud(hubcloudMatch[1]);
        if (resolved) return [{ server: "HubCloud", link: resolved, type: "mkv" }];
      }
      
      // Find gdirect link
      const gdirectMatch = html.match(/href="(https?:\/\/[^"]*gdirect[^"]*)"/i);
      if (gdirectMatch) {
        return [{ server: "G-Direct", link: gdirectMatch[1], type: "mkv" }];
      }
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

  // Already direct links
  if (link.includes("gdirect") || link.includes("drive.google.com") || link.includes("cloudflarestorage") || link.includes("r2.dev") || link.includes("pixeld") || link.includes("gofile.io") || link.includes("flapdoodle") || link.includes("googleusercontent.com") || link.includes("cinecloud")) {
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

// ========== CINECLOUD RESOLVER ==========
async function resolveCineCloud(link) {
  try {
    const idMatch = link.match(/cinecloud\.site\/[fwd]\/([a-f0-9]+)/i);
    if (!idMatch) return null;
    const fileId = idMatch[1];
    const base = link.match(/(https?:\/\/[^/]+)/)[1];

    // Try /d/ endpoint first (Cloud - has R2 direct links)
    try {
      const dRes = await axios.get(`${base}/d/${fileId}`, { headers: BH, timeout: 15000 });
      const $d = cheerio.load(dRes.data);
      const r2Link = $d('a[href*="cloudflarestorage.com"]').attr('href');
      if (r2Link) {
        console.log("[CineCloud] Found R2 link via /d/");
        return r2Link;
      }
    } catch (e) {
      console.log("[CineCloud] /d/ error:", e.message);
    }

    // Try /w/ endpoint (Instant - has googleusercontent links)
    try {
      const wRes = await axios.get(`${base}/w/${fileId}`, { headers: BH, timeout: 15000 });
      const $w = cheerio.load(wRes.data);
      const googleLink = $w('a[href*="googleusercontent.com"]').attr('href');
      if (googleLink) {
        console.log("[CineCloud] Found Google link via /w/");
        return googleLink;
      }
    } catch (e) {
      console.log("[CineCloud] /w/ error:", e.message);
    }

    return null;
  } catch (e) {
    console.log("[CineCloud] Error:", e.message);
    return null;
  }
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
async function getMdriveStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const html = res.data;
    const streams = [];
    const seenLinks = new Set();

    // mdrive → nexdrive.fit links
    const ndMatches = html.matchAll(/href="(https?:\/\/[^"]*nexdrive[^"]*)"/gi);
    for (const match of ndMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        const ndStreams = await getNexdriveStreams(match[1]);
        streams.push(...ndStreams);
      }
    }

    // Direct download links
    const dlMatches = html.matchAll(/href="(https?:\/\/[^"]*\.(?:mp4|mkv)[^"]*)"/gi);
    for (const match of dlMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Direct", link: match[1], type: match[1].includes(".mkv") ? "mkv" : "mp4" });
      }
    }

    return streams.slice(0, 6);
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
const CINEFREAK_URL = "https://cinefreak.net";

async function cinefreakSearch(query) {
  try {
    const res = await axios.get(`${CINEFREAK_URL}/`, {
      params: { s: query },
      headers: BH,
      timeout: 15000
    });
    const $ = cheerio.load(res.data);
    const results = [];
    
    $('a.movie-card').each((i, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).find('.movie-card-title').text().trim();
      const image = $(el).find('img.wp-post-image').attr('src') || '';
      const quality = $(el).find('.movie-card-format').first().text().trim();
      
      if (href && title) {
        results.push({
          title: title.replace(/\s*[-–]\s*CineFreak$/i, ''),
          link: href,
          image,
          quality,
          provider: 'cinefreak'
        });
      }
    });
    
    return results;
  } catch(e) {
    console.log("[CineFreak] Search error:", e.message);
    return [];
  }
}

async function cinefreakGetStreams(link) {
  try {
    const fullUrl = link.startsWith('http') ? link : CINEFREAK_URL + link;
    const res = await axios.get(fullUrl, { headers: BH, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const streams = [];
    const seenLinks = new Set();
    
    // Extract generate.php links from quality boxes
    $('div.quality-box a[href*="generate.php"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const quality = $(el).text().trim();
      
      if (href.includes('generate.php')) {
        const base64Match = href.match(/id=([A-Za-z0-9+/=]+)/);
        if (base64Match) {
          try {
            const decoded = Buffer.from(base64Match[1], 'base64').toString();
            if (!seenLinks.has(decoded)) {
              seenLinks.add(decoded);
              
              // Determine server from URL
              let server = 'CineCloud';
              if (decoded.includes('cinecloud')) server = 'CineCloud';
              else if (decoded.includes('cloudflarestorage')) server = 'CF Storage';
              else if (decoded.includes('pixeld')) server = 'Pixeldrain';
              else if (decoded.includes('gofile')) server = 'Gofile';
              
              streams.push({
                server: `${server} (${quality})`,
                link: decoded,
                type: 'mkv',
                quality
              });
            }
          } catch {}
        }
      }
    });
    
    // Also check for direct links
    $('a[href*="cinecloud"], a[href*="cloudflarestorage"], a[href*="pixeld"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (href.startsWith('http') && !seenLinks.has(href)) {
        seenLinks.add(href);
        streams.push({ server: 'Direct', link: href, type: 'mkv' });
      }
    });
    
    return streams;
  } catch(e) {
    console.log("[CineFreak] Stream error:", e.message);
    return [];
  }
}

async function cinefreakResolveLink(link) {
  try {
    // If it's a generate.php link, decode it
    if (link.includes('generate.php')) {
      const base64Match = link.match(/id=([A-Za-z0-9+/=]+)/);
      if (base64Match) {
        return Buffer.from(base64Match[1], 'base64').toString();
      }
    }
    
    // If it's a cinecloud link, fetch and check for redirects
    if (link.includes('cinecloud')) {
      const res = await axios.get(link, { headers: BH, timeout: 15000, maxRedirects: 0 });
      if (res.headers?.location) return res.headers.location;
      
      // Check for download button in page
      const $ = cheerio.load(res.data);
      const dlLink = $('a[href*="download"], a.btn-success').first().attr('href');
      if (dlLink && dlLink.startsWith('http')) return dlLink;
    }
    
    return link;
  } catch(e) {
    return link;
  }
}

// ========== CUSTOM MOD STREAM EXTRACTOR ==========
async function getModStreams(link) {
  try {
    const res = await axios.get(link, { timeout: 15000, headers: BH });
    const html = res.data;
    const streams = [];
    const seenLinks = new Set();

    // Extract G-Drive links
    const gdriveMatches = html.matchAll(/href="(https?:\/\/[^"]*drive\.google\.com[^"]*)"/gi);
    for (const match of gdriveMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "G-Drive", link: match[1], type: "mkv" });
      }
    }

    // Extract /go/ or /dl/ links
    const goMatches = html.matchAll(/href="(https?:\/\/[^"]*\/(?:go|dl|download|stream|file)[^"]*)"/gi);
    for (const match of goMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Download", link: match[1], type: "mkv" });
      }
    }

    // Extract direct mp4/mkv links (skip fastdl.zip)
    const directMatches = html.matchAll(/href="(https?:\/\/[^"]*\.(?:mp4|mkv)[^"]*)"/gi);
    for (const match of directMatches) {
      const url = match[1];
      if (url.includes("fastdl.zip") || url.includes("embed.php")) continue;
      if (!seenLinks.has(url)) {
        seenLinks.add(url);
        streams.push({ server: "Direct", link: url, type: url.includes(".mkv") ? "mkv" : "mp4" });
      }
    }

    // Extract episode links from modpro.blog
    const episodeMatches = html.matchAll(/href="(https?:\/\/[^"]*modpro\.blog[^"]*)"/gi);
    for (const match of episodeMatches) {
      if (!seenLinks.has(match[1])) {
        seenLinks.add(match[1]);
        streams.push({ server: "Episodes", link: match[1], type: "mkv" });
      }
    }

    return streams.slice(0, 6);
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
  return all;
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

console.log("🤖 Vega Bot v14 (Database) Started!");
