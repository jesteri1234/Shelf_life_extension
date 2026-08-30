/**
 * Backlog Radar — wishlist reader
 *
 * Steam's wishlist page is client-rendered, so the same rule as
 * content.js applies: don't trust internal CSS class names (they're
 * auto-generated and change often) — anchor only on the one stable
 * signal, a link to a game's store page (`/app/<id>/`).
 *
 * Only the set of app IDs is needed here — no playtime, you don't own
 * these yet. Read locally and saved to chrome.storage.local; this
 * script itself sends nothing anywhere. Matching against community
 * data happens entirely inside the popup.
 */
(function () {
  "use strict";

  function distinctWishlistAppIds() {
    const links = document.querySelectorAll('a[href*="/app/"]');
    const ids = new Set();
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/app\/(\d+)/);
      if (m) ids.add(Number(m[1]));
    }
    return [...ids];
  }

  function save(appids) {
    if (!appids.length) return;
    chrome.storage.local.set({ steamWishlist: appids, steamWishlistScannedAt: Date.now() });
    console.log(`Backlog Radar: found ${appids.length} games on your wishlist.`);
  }

  // The wishlist list renders asynchronously after the page's initial
  // load, so one scan at document_idle can still be too early.
  // Instead of guessing a fixed delay, watch for DOM changes for a
  // few seconds and keep the largest distinct-appid set seen.
  let best = [];
  function scanOnce() {
    const found = distinctWishlistAppIds();
    if (found.length > best.length) best = found;
  }

  scanOnce();
  const observer = new MutationObserver(() => scanOnce());
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    scanOnce();
    save(best);
  }, 4000);
})();
