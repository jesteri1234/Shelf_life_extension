/**
 * Shelf Life — content script
 *
 * Runs only on the Steam page the user is already logged into
 * (steamcommunity.com/.../games). It reads the game list that is
 * already rendered for the signed-in user and never talks to any
 * server — it just saves the parsed list into chrome.storage.local
 * so the popup can use it.
 *
 * Steam's profile page uses hashed, auto-generated CSS class names
 * that change whenever Valve ships a new build, so this script does
 * NOT rely on class names at all. Instead it anchors on something
 * stable: every game row contains a link to /app/<id>/, and the
 * row's visible text starts with the game title, usually followed
 * by a playtime figure ("<number> hours" / "<number> minutes" — a
 * game with 0 recorded playtime shows no such figure at all) and,
 * when the game has achievements, an "x / y" fraction somewhere in
 * the row.
 *
 * If Steam changes this text layout, scanning will simply find 0
 * games rather than silently returning wrong numbers — check the
 * page console for "[Shelf Life] Scanned N games" to confirm it
 * still works after a Steam redesign.
 */
(function () {
  "use strict";

  function parsePlaytimeHours(text) {
    // Steam's current UI writes "374.6 hours" / "5.9 hours" (full word,
    // not the classic "hrs" abbreviation) and "45 minutes" for very low
    // playtime. Numbers can contain a thousands comma ("1,236.6") which
    // must be stripped before the decimal point is normalized.
    const hrs = text.match(/([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?)\b/i);
    if (hrs) return parseFloat(hrs[1].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    const mins = text.match(/([\d]+(?:[.,]\d+)?)\s*(?:minutes?|mins?)\b/i);
    if (mins) return parseFloat(mins[1].replace(",", ".")) / 60;
    return 0;
  }

  function parseAchievements(text) {
    const matches = [...text.matchAll(/(\d{1,4})\s*\/\s*(\d{1,4})/g)];
    for (const m of matches) {
      const unlocked = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (total > 0 && total < 5000 && unlocked <= total) {
        return { achUnlocked: unlocked, achTotal: total };
      }
    }
    return { achUnlocked: null, achTotal: null };
  }

  function distinctAppIds(container) {
    const ids = new Set();
    for (const a of container.querySelectorAll('a[href*="/app/"]')) {
      const m = (a.getAttribute("href") || "").match(/\/app\/(\d+)/);
      if (m) ids.add(m[1]);
    }
    return ids;
  }

  function findRow(link) {
    // Walk up from the /app/<id>/ link two signals at once:
    //  (a) stop growing once the container would start covering
    //      MORE THAN ONE distinct game (its own icon link + a
    //      "Store Page" link to the same appid are fine and common
    //      — different appids means we've stepped into the shared
    //      list wrapper or a header widget) — this bounds the row
    //      even for a game with 0 recorded playtime, which has no
    //      "X hours" text to anchor on at all;
    //  (b) prefer to stop as soon as that single-game container's
    //      text actually contains a playtime figure, since that's
    //      the richest, most reliable row.
    // "best" always trails one step behind the multi-game boundary,
    // so a never-played game still gets a sensible (title + maybe
    // achievements) row instead of being dropped or merged with a
    // neighbour's stats.
    let row = link;
    let guard = 0;
    let best = link;
    while (row && guard < 14) {
      if (distinctAppIds(row).size > 1) break;
      best = row;
      if (/[\d.,]+\s*(?:hours?|hrs?|minutes?|mins?)\b/i.test(row.innerText || "")) {
        return row;
      }
      row = row.parentElement;
      guard++;
    }
    return best;
  }

  function scrape() {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    const seen = new Set();
    const games = [];

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const idMatch = href.match(/\/app\/(\d+)/);
      if (!idMatch) continue;
      const appid = idMatch[1];
      if (seen.has(appid)) continue;

      const row = findRow(link);
      if (!row) continue; // no playtime text nearby -> not a real library row
      const text = (row.innerText || "").trim();
      if (!text) continue;

      const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
      const title = lines[0] || `App ${appid}`;

      seen.add(appid);
      const playtimeHours = parsePlaytimeHours(text);
      const { achUnlocked, achTotal } = parseAchievements(text);

      games.push({ appid, title, playtimeHours, achUnlocked, achTotal });
    }
    return games;
  }

  function save(games) {
    chrome.storage.local.set(
      {
        steamLibrary: games,
        steamLibraryScannedAt: Date.now(),
        steamLibraryScanOk: games.length > 0,
      },
      () => {
        console.log(`[Shelf Life] Scanned ${games.length} games from your Steam library.`);
      }
    );
  }

  // Steam's page renders asynchronously, so give it a moment, then
  // scan. Re-scan once more a bit later in case more of the list
  // (e.g. lazily-rendered rows) loaded in after the first pass.
  setTimeout(() => save(scrape()), 1200);
  setTimeout(() => save(scrape()), 3500);
})();
