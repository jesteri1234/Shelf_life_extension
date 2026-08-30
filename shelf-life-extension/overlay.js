/**
 * Shelf Life — store-page overlay
 *
 * Shows the boredom-risk prediction right on a game's own Steam store
 * page, so checking a purchase doesn't require opening the popup.
 * Only appears for games not already in your library — if you own it,
 * there's nothing to decide.
 *
 * Genre is read from the page's own genre links (anchored on `/genre/`
 * hrefs, same "don't trust class names" rule as content.js) rather than
 * a network call — the data's already right there on the page.
 */
(function () {
  "use strict";

  const appidMatch = location.pathname.match(/\/app\/(\d+)/);
  if (!appidMatch) return;
  const appid = Number(appidMatch[1]);

  function pageGenres() {
    const links = document.querySelectorAll('a[href*="/genre/"]');
    const found = new Set();
    for (const a of links) {
      const text = (a.textContent || "").trim();
      const mapped = self.BR.STEAM_GENRE_MAP[text];
      if (mapped) found.add(mapped);
    }
    return [...found];
  }

  function buildLibraryWithTags(rawLibrary, tagMap) {
    return rawLibrary.map((g) => {
      const entry = self.BR.normalizeTagEntry(tagMap[g.appid]) || { mechanics: [] };
      return { ...g, mechanics: entry.mechanics || [] };
    });
  }

  function render({ verdictClass, verdict, bri, predictedHours, hasSignal, hasHoursSignal, community }) {
    if (document.getElementById("shelf-life-overlay")) return;

    const el = document.createElement("div");
    el.id = "shelf-life-overlay";
    el.innerHTML = `
      <div class="sl-top">
        <span class="sl-brand">Shelf Life</span>
        <button class="sl-close" type="button" aria-label="Dismiss">&times;</button>
      </div>
      <div class="sl-verdict ${verdictClass}">${verdict}</div>
      <div class="sl-grid">
        <div class="sl-stat">Your boredom risk<b>${hasSignal ? bri + "%" : "—"}</b></div>
        <div class="sl-stat">Predicted playtime<b>${predictedHours !== null ? (hasHoursSignal ? "" : "~") + predictedHours + "h" : "—"}</b></div>
        ${
          community
            ? `<div class="sl-stat">Community risk<b>${Math.round(community.community_score)}%</b></div>
               <div class="sl-stat">Shared by<b>${community.n}</b></div>`
            : `<div class="sl-stat" style="grid-column:1/-1">No community data yet for this game.</div>`
        }
      </div>
      <div class="sl-note">Based on your own tagged library${community ? " + community data" : ""}. Click the extension icon for more.</div>
    `;
    document.body.appendChild(el);
    el.querySelector(".sl-close").addEventListener("click", () => el.remove());
  }

  chrome.storage.local.get(["steamLibrary", "backlogRadarTags", "communityAggregate"], (res) => {
    const rawLibrary = res.steamLibrary || [];
    if (rawLibrary.some((g) => Number(g.appid) === appid)) return; // already owned, nothing to decide

    const tagMap = res.backlogRadarTags || {};
    const library = buildLibraryWithTags(rawLibrary, tagMap);
    const dna = self.BR.computeDNA(library);
    const communityAggregate = res.communityAggregate || [];
    const communityEntry = communityAggregate.find((g) => Number(g.appid) === appid) || null;

    const genres = pageGenres();
    const tagged = genres.filter((g) => dna[g] !== undefined);
    const hasSignal = tagged.length > 0;
    const affinity = hasSignal ? tagged.reduce((s, m) => s + dna[m], 0) / tagged.length : 0;
    const bri = Math.round(((1 - affinity) / 2) * 100);

    const hoursResult = self.BR.predictHoursForMechanics(library, genres);
    const predictedHours = hoursResult.predictedHours !== null ? Math.round(hoursResult.predictedHours * 10) / 10 : null;

    if (!hasSignal && !communityEntry) return; // nothing useful to show

    let verdict, verdictClass;
    if (!hasSignal) {
      verdict = "No personal history for this genre yet";
      verdictClass = "moderate";
    } else if (bri >= 70) {
      verdict = "High risk — likely to gather dust";
      verdictClass = "avoid";
    } else if (bri >= 40) {
      verdict = "Moderate — think it over";
      verdictClass = "moderate";
    } else {
      verdict = "Fits your history well";
      verdictClass = "good";
    }

    render({
      verdictClass,
      verdict,
      bri,
      predictedHours,
      hasSignal,
      hasHoursSignal: hoursResult.hasSignal,
      community: communityEntry,
    });
  });
})();
