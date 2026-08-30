/**
 * Shelf Life — auto-tagging service worker
 *
 * After content.js scans your library, this fills in a first-pass
 * genre tag for every untagged game automatically, using Steam's own
 * public store catalog (store.steampowered.com/api/appdetails) — the
 * same endpoint the Steam store website itself uses to render a
 * game's genre chips. No AI, no third-party service: it's one HTTP
 * request per game to Steam, asking "what genre is this", one at a
 * time with a small delay so it behaves like a polite single user
 * browsing the store rather than a scraper.
 *
 * This is the one part of the extension that leaves the machine, and
 * it deliberately sends the bare minimum: an app ID, nothing about
 * you or your library. Steam already knows you own the game — this
 * just asks Steam what genre it filed it under.
 *
 * A tag this queue writes is marked source:"auto" and is never
 * allowed to overwrite a tag you set by hand (source:"manual") in
 * the popup's "Tag mechanics" screen.
 */
importScripts("mechanics.js");

const REQUEST_DELAY_MS = 650;
const RETRY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days, for games with no genre data yet
let running = false;

// --- Community data sharing --------------------------------------
//
// Off by default is opt-in; this is deliberately opt-out instead,
// because a crowd feature nobody's data feeds never gets useful. To
// make that an honest trade instead of a quiet one, the popup always
// shows the toggle and exactly what it sends — see popup.js/popup.html.
//
// TODO after deploying the backend (see /backlog-radar-backend and
// its DEPLOY.md): replace this with the real Worker URL.
const API_BASE = "https://backlog-radar-api.elias-backlogradar.workers.dev";

// Only Steam's own coarse genres are ever shared, never fine manual
// tags like "Roguelike" or "Souls-like" — the crowd model doesn't
// need them, and leaving them out keeps the shared payload smaller
// and further from anything personally distinctive.
const STEAM_GENRE_VALUES = new Set(Object.values(self.BR.STEAM_GENRE_MAP));
function coarseGenreFor(mechanics) {
  if (!mechanics) return null;
  return mechanics.find((m) => STEAM_GENRE_VALUES.has(m)) || null;
}

async function isShareEnabled() {
  const res = await chrome.storage.local.get(["backlogRadarShareEnabled"]);
  return res.backlogRadarShareEnabled !== false; // default true (opt-out)
}

/**
 * A random id generated once locally and never tied to Steam in any
 * way — it only exists so the backend can tell "this is the same
 * install re-submitting" apart from "this is a new contributor", for
 * rate limiting. The backend salts and hashes it before storing
 * anything (see backlog-radar-backend/src/index.js).
 */
async function getInstallId() {
  const res = await chrome.storage.local.get(["backlogRadarInstallId"]);
  if (res.backlogRadarInstallId) return res.backlogRadarInstallId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ backlogRadarInstallId: id });
  return id;
}

async function submitToBackend() {
  if (!(await isShareEnabled())) return;
  const libRes = await chrome.storage.local.get(["steamLibrary"]);
  const library = libRes.steamLibrary || [];
  if (!library.length) return;

  const tagMap = await getTagMap();
  const installId = await getInstallId();
  const games = library.map((g) => {
    const entry = self.BR.normalizeTagEntry(tagMap[g.appid]);
    return {
      appid: g.appid,
      playtimeHours: g.playtimeHours,
      achUnlocked: g.achUnlocked || 0,
      achTotal: g.achTotal || 0,
      genre: coarseGenreFor(entry && entry.mechanics),
    };
  });

  try {
    await fetch(`${API_BASE}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId, games }),
    });
  } catch (_err) {
    // Best-effort: sharing never blocks or breaks anything local.
  }
}

/**
 * Pulls the published community aggregate (see backend's
 * GET /aggregate.json) and caches it locally for the Discover tab.
 * This is a plain read — it happens whether or not sharing is on,
 * same as reading any other public Steam data.
 */
async function fetchAggregate() {
  try {
    const res = await fetch(`${API_BASE}/aggregate.json`);
    if (!res.ok) return;
    const data = await res.json();
    await chrome.storage.local.set({
      communityAggregate: data.games || [],
      communityAggregateFetchedAt: Date.now(),
    });
  } catch (_err) {
    // Offline, or the backend isn't deployed yet — Discover just stays personal-only.
  }
}

/**
 * "Players like you": which OTHER games are favorited by the same
 * installs that favorited each of yours. Your own favorite list never
 * leaves the machine — only this shared, anonymous co-occurrence
 * table is fetched; matching against it happens locally in the popup.
 */
async function fetchFavoritePairs() {
  try {
    const res = await fetch(`${API_BASE}/pairs.json`);
    if (!res.ok) return;
    const data = await res.json();
    await chrome.storage.local.set({
      favoritePairs: data.pairs || [],
      favoritePairsFetchedAt: Date.now(),
    });
  } catch (_err) {
    // Same as fetchAggregate — fails quietly, Discover just stays without this section.
  }
}

async function getTagMap() {
  const res = await chrome.storage.local.get(["backlogRadarTags"]);
  return res.backlogRadarTags || {};
}

async function setStatus(status) {
  await chrome.storage.local.set({ backlogRadarAutoTagStatus: status });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGenres(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;
  const res = await fetch(url, { credentials: "omit" });
  if (res.status === 429) {
    throw Object.assign(new Error("rate limited"), { code: 429 });
  }
  if (!res.ok) return [];
  const json = await res.json();
  const entry = json && json[appid];
  if (!entry || !entry.success || !entry.data || !Array.isArray(entry.data.genres)) return [];
  const mapped = entry.data.genres
    .map((g) => self.BR.STEAM_GENRE_MAP[g.description])
    .filter(Boolean);
  return [...new Set(mapped)];
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    const libRes = await chrome.storage.local.get(["steamLibrary"]);
    const library = libRes.steamLibrary || [];
    const tagMap = await getTagMap();
    const now = Date.now();

    const pending = library.filter((g) => {
      const entry = self.BR.normalizeTagEntry(tagMap[g.appid]);
      if (!entry) return true; // never tagged
      if (entry.source === "manual") return false; // never touch manual tags
      if (entry.mechanics && entry.mechanics.length > 0) return false; // already auto-tagged successfully
      return now - (entry.taggedAt || 0) > RETRY_COOLDOWN_MS; // retry old empty results occasionally
    });

    await setStatus({ running: true, done: 0, total: pending.length, lastError: null });

    let done = 0;
    let backoff = REQUEST_DELAY_MS;
    for (const game of pending) {
      try {
        const genres = await fetchGenres(game.appid);
        const fresh = await getTagMap();
        const existing = self.BR.normalizeTagEntry(fresh[game.appid]);
        if (!existing || existing.source !== "manual") {
          fresh[game.appid] = { mechanics: genres, source: "auto", taggedAt: Date.now() };
          await chrome.storage.local.set({ backlogRadarTags: fresh });
        }
        backoff = REQUEST_DELAY_MS;
      } catch (err) {
        if (err && err.code === 429) {
          backoff = Math.min(backoff * 2, 15000); // back off hard on rate limiting
        }
        await setStatus({ running: true, done, total: pending.length, lastError: String(err && err.message) });
      }
      done++;
      await setStatus({ running: true, done, total: pending.length, lastError: null });
      await sleep(backoff);
    }
  } finally {
    running = false;
    const s = await chrome.storage.local.get(["backlogRadarAutoTagStatus"]);
    await setStatus({ ...(s.backlogRadarAutoTagStatus || {}), running: false });
    // Scan -> auto-tag -> share, in that order, so genres are filled
    // in before a submission goes out.
    await submitToBackend();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.steamLibrary) {
    runQueue();
  }
  // Turning sharing on submits right away rather than waiting for the
  // next rescan; turning it off takes effect on the next attempt too
  // (isShareEnabled is checked fresh every time).
  if (changes.backlogRadarShareEnabled && changes.backlogRadarShareEnabled.newValue === true) {
    submitToBackend();
  }
});

const AGGREGATE_ALARM = "backlogRadarRefresh";
chrome.alarms.create(AGGREGATE_ALARM, { periodInMinutes: 360 }); // every 6h
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AGGREGATE_ALARM) {
    fetchAggregate();
    fetchFavoritePairs();
    submitToBackend(); // keeps crowd data fresh as your own playtime changes
  }
});

// Also catch the case where a library was already scanned before this
// version of the extension (with auto-tagging) was installed/updated.
chrome.runtime.onInstalled.addListener(() => {
  runQueue();
  fetchAggregate();
  fetchFavoritePairs();
});
chrome.runtime.onStartup.addListener(() => {
  runQueue();
  fetchAggregate();
  fetchFavoritePairs();
});
