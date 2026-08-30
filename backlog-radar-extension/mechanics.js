/**
 * Backlog Radar — scoring engine
 *
 * Pure, deterministic, rule-based math. No AI/ML anywhere in this
 * file — everything here is arithmetic and lookup tables, on
 * purpose (cheap, instant, fully explainable to the user).
 *
 * Shared by popup.js AND background.js (the auto-tagging service
 * worker). Loaded as a plain script (no bundler), attached to `self`
 * rather than `window` because a service worker has no `window`.
 */
self.BR = (function () {
  "use strict";

  // Curated, deliberately short vocabulary of mechanic tags a user
  // can attach to a game. Kept intentionally small for v1 so tagging
  // your library by hand stays quick — this is the same
  // blacklist/whitelist idea discussed for auto-tagging from Steam's
  // own tags, just applied by the user instead of an API for now.
  const MECHANICS = [
    "Roguelike / Roguelite", "Deckbuilder", "Crafting & Base Building",
    "Survival", "Souls-like", "Turn-Based Strategy", "Real-Time Strategy",
    "City Builder", "Management Sim", "Vehicle / Driving Sim",
    "Racing", "Open World", "Sandbox", "Story-Rich / Narrative",
    "Tactical Shooter", "Battle Royale", "MOBA", "MMO", "Puzzle",
    "Platformer", "Metroidvania", "Tower Defense", "Farming Sim",
    "Horror", "Stealth", "RPG", "JRPG", "Party / Social", "Sports",
    "Fighting", "Rhythm", "Card / Board Game",
    // Coarser labels below come straight from Steam's own public
    // store catalog (see STEAM_GENRE_WHITELIST) so auto-tagging has
    // somewhere to land even for games that don't fit any tag above.
    "Action", "Adventure", "Casual", "Indie", "Simulation", "Strategy",
    "Massively Multiplayer", "Free to Play", "Early Access",
  ];

  // Steam's official store genres we accept for auto-tagging, and how
  // each maps onto the vocabulary above. Anything Steam returns that
  // isn't in this list is dropped (content descriptors like "Gore" or
  // "Nudity" aren't mechanics and would only add noise).
  const STEAM_GENRE_MAP = {
    "Action": "Action",
    "Adventure": "Adventure",
    "Casual": "Casual",
    "Indie": "Indie",
    "Simulation": "Simulation",
    "Strategy": "Strategy",
    "RPG": "RPG",
    "Racing": "Racing",
    "Sports": "Sports",
    "Massively Multiplayer": "Massively Multiplayer",
    "Free to Play": "Free to Play",
    "Early Access": "Early Access",
  };

  const ENGAGEMENT_SCORE = {
    endless_favorite: 2.0,
    short_finished: 0.8,
    moderate: 0.2,
    unplayed: -0.3,
    flop: -1.8,
  };

  const ENGAGEMENT_LABEL = {
    endless_favorite: "Endless favorite",
    short_finished: "Finished, short",
    moderate: "Moderate",
    unplayed: "Unplayed",
    flop: "Flop",
  };

  function classifyEngagement(playtimeHours, achUnlocked, achTotal) {
    const playtimeMin = playtimeHours * 60;
    const hasAch = achTotal !== null && achTotal !== undefined && achTotal > 0;
    const achPct = hasAch ? achUnlocked / achTotal : 0;

    if (playtimeMin < 15) return "unplayed";
    if (playtimeMin >= 15 && playtimeMin <= 180 && (!hasAch || achPct < 0.15)) return "flop";
    if (playtimeHours >= 40) return "endless_favorite";
    if (achPct >= 0.5 || (playtimeHours >= 10 && playtimeHours < 40)) return "short_finished";
    return "moderate";
  }

  /**
   * games: [{ appid, title, playtimeHours, achUnlocked, achTotal, mechanics: [..] }]
   * Only games with at least one tagged mechanic contribute to the DNA.
   * Returns { mechanicName: affinity } with affinity in [-1, 1].
   */
  function computeDNA(games) {
    const rawSum = {};
    const rawWeight = {};

    for (const g of games) {
      if (!g.mechanics || g.mechanics.length === 0) continue;
      const category = classifyEngagement(g.playtimeHours, g.achUnlocked, g.achTotal);
      const score = ENGAGEMENT_SCORE[category];
      for (const mech of g.mechanics) {
        rawSum[mech] = (rawSum[mech] || 0) + score;
        rawWeight[mech] = (rawWeight[mech] || 0) + 1;
      }
    }

    const dna = {};
    for (const mech of Object.keys(rawSum)) {
      const avg = rawSum[mech] / rawWeight[mech];
      dna[mech] = Math.tanh(avg);
    }
    return dna;
  }

  function median(sortedNums) {
    const n = sortedNums.length;
    if (!n) return null;
    const mid = Math.floor(n / 2);
    return n % 2 ? sortedNums[mid] : (sortedNums[mid - 1] + sortedNums[mid]) / 2;
  }

  // How many mechanic-matching games it takes before we mostly trust
  // that mechanic's own median over the library-wide one. Below this,
  // the estimate leans on the wider library so 1-2 flukes can't swing
  // a prediction wildly — the same shrinkage idea planned for
  // personal-vs-crowd blending later, just applied within one
  // person's own history for now.
  const HOURS_SHRINKAGE_K = 3;

  /**
   * Predicts how many hours the user will likely put into a candidate
   * based on their OWN historical playtime for games sharing its
   * mechanics — not a manual "hours to finish" guess. Flops and
   * never-started games count at full weight: a mechanic you tend to
   * buy-and-abandon should predict low hours, not get filtered out.
   */
  function predictHoursForMechanics(games, mechanics) {
    const tagged = (games || []).filter((g) => g.mechanics && g.mechanics.length);
    const libraryMedian = median(tagged.map((g) => g.playtimeHours).sort((a, b) => a - b));
    if (libraryMedian === null) return { predictedHours: null, hasSignal: false };

    const perMechanic = (mechanics || [])
      .map((m) => {
        const hours = tagged
          .filter((g) => g.mechanics.includes(m))
          .map((g) => g.playtimeHours)
          .sort((a, b) => a - b);
        return { median: median(hours), n: hours.length };
      })
      .filter((s) => s.median !== null);

    if (!perMechanic.length) return { predictedHours: libraryMedian, hasSignal: false };

    const shrunk = perMechanic.map((s) => {
      const w = s.n / (s.n + HOURS_SHRINKAGE_K);
      return w * s.median + (1 - w) * libraryMedian;
    });
    const predictedHours = shrunk.reduce((a, b) => a + b, 0) / shrunk.length;
    return { predictedHours, hasSignal: true };
  }

  /**
   * Personal-only prediction for a candidate game. Boredom risk comes
   * from DNA affinity (how much you tend to enjoy these mechanics);
   * predicted hours comes from your own historical playtime for
   * games sharing them (see predictHoursForMechanics) — no manual
   * "hours to finish" guess needed. This is the "v1, no crowd data
   * yet" version of the model.
   */
  function evaluateCandidate({ priceEur, mechanics }, dna, library) {
    const tagged = mechanics.filter((m) => dna[m] !== undefined);
    const affinity = tagged.length
      ? tagged.reduce((sum, m) => sum + dna[m], 0) / tagged.length
      : 0;
    const hasSignal = tagged.length > 0;

    const bri = (1 - affinity) / 2 * 100; // 0 = safe bet, 100 = high boredom risk

    const hoursResult = predictHoursForMechanics(library || [], mechanics);
    const predictedHours = hoursResult.predictedHours;
    const roi = priceEur > 0 && predictedHours !== null ? predictedHours / priceEur : null;

    let verdict, verdictClass;
    if (!hasSignal) {
      verdict = "Not enough tagged data yet for these mechanics";
      verdictClass = "unknown";
    } else if (bri >= 70) {
      verdict = "High risk — wait for a deep sale, or skip";
      verdictClass = "avoid";
    } else if (bri >= 40) {
      verdict = "Moderate — try it via a subscription service first";
      verdictClass = "moderate";
    } else {
      verdict = "Strong match — fits your history well";
      verdictClass = "good";
    }

    return {
      affinity,
      bri: Math.round(bri * 10) / 10,
      predictedHours: predictedHours !== null ? Math.round(predictedHours * 10) / 10 : null,
      hasHoursSignal: hoursResult.hasSignal,
      roi: roi !== null && isFinite(roi) ? Math.round(roi * 100) / 100 : null,
      verdict,
      verdictClass,
      hasSignal,
    };
  }

  function libraryStats(games) {
    const counts = { endless_favorite: 0, short_finished: 0, moderate: 0, unplayed: 0, flop: 0 };
    let totalHours = 0;
    for (const g of games) {
      const c = classifyEngagement(g.playtimeHours, g.achUnlocked, g.achTotal);
      counts[c]++;
      totalHours += g.playtimeHours;
    }
    const total = games.length || 1;
    const neverStartedPct = Math.round((counts.unplayed / total) * 1000) / 10;
    const flopPct = Math.round((counts.flop / total) * 1000) / 10;
    return { counts, totalHours: Math.round(totalHours * 10) / 10, total: games.length, neverStartedPct, flopPct };
  }

  // Tag entries used to be stored as a bare array of mechanic names.
  // They're now { mechanics, source: 'auto'|'manual', taggedAt } so
  // auto-tagging never overwrites a choice the user made by hand.
  // This normalizes either shape so old data keeps working.
  function normalizeTagEntry(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return { mechanics: raw, source: "manual", taggedAt: 0 };
    return raw;
  }

  return {
    MECHANICS,
    STEAM_GENRE_MAP,
    normalizeTagEntry,
    ENGAGEMENT_LABEL,
    ENGAGEMENT_SCORE,
    classifyEngagement,
    computeDNA,
    predictHoursForMechanics,
    evaluateCandidate,
    libraryStats,
  };
})();
