(function () {
  "use strict";

  const STEAM_GAMES_URL = "https://steamcommunity.com/my/games/?tab=all";

  let library = [];   // [{appid, title, playtimeHours, achUnlocked, achTotal, mechanics: [], tagSource}]
  let taggedMap = {}; // appid -> { mechanics, source: 'auto'|'manual', taggedAt }
  let autoTagStatus = { running: false, done: 0, total: 0 };

  // ---------- tab switching ----------
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    const name = btn.dataset.tab;
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("active", p.id === `panel-${name}`)
    );
  });

  // ---------- storage helpers ----------
  function loadAll(cb) {
    chrome.storage.local.get(
      ["steamLibrary", "backlogRadarTags", "backlogRadarAutoTagStatus", "backlogRadarShareEnabled", "communityAggregate", "steamWishlist", "favoritePairs"],
      (res) => {
        const rawLibrary = res.steamLibrary || [];
        taggedMap = res.backlogRadarTags || {};
        autoTagStatus = res.backlogRadarAutoTagStatus || { running: false, done: 0, total: 0 };
        shareEnabled = res.backlogRadarShareEnabled !== false; // default true (opt-out)
        communityAggregate = res.communityAggregate || [];
        wishlist = res.steamWishlist || [];
        favoritePairs = res.favoritePairs || [];
        library = rawLibrary.map((g) => {
          const entry = BR.normalizeTagEntry(taggedMap[g.appid]) || { mechanics: [], source: null };
          return { ...g, mechanics: entry.mechanics || [], tagSource: entry.source };
        });
        cb();
      }
    );
  }

  // ---------- share toggle ----------
  let shareEnabled = true;
  let communityAggregate = [];

  function renderShareToggle() {
    const input = document.getElementById("share-toggle");
    if (input) input.checked = shareEnabled;
  }

  document.getElementById("share-toggle").addEventListener("change", (e) => {
    shareEnabled = e.target.checked;
    chrome.storage.local.set({ backlogRadarShareEnabled: shareEnabled });
    showToast(shareEnabled ? "Sharing on — next scan will contribute" : "Sharing off");
  });

  function saveTags(appid, mechanics) {
    const entry = { mechanics, source: "manual", taggedAt: Date.now() };
    taggedMap[appid] = entry;
    chrome.storage.local.set({ backlogRadarTags: taggedMap });
    const g = library.find((x) => x.appid === appid);
    if (g) {
      g.mechanics = mechanics;
      g.tagSource = "manual";
    }
  }

  // ---------- library panel ----------
  const STEAM_WISHLIST_URL = "https://store.steampowered.com/wishlist/";
  let wishlist = [];
  let favoritePairs = [];

  function renderAutoTagBanner() {
    const el = document.getElementById("autotag-banner");
    if (!el) return;
    if (autoTagStatus.running && autoTagStatus.total > 0) {
      el.hidden = false;
      el.textContent = `Auto-tagging genres from Steam… ${autoTagStatus.done}/${autoTagStatus.total}`;
    } else {
      el.hidden = true;
    }
  }

  function renderLibrary() {
    const empty = document.getElementById("library-empty");
    const content = document.getElementById("library-content");

    if (!library.length) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    renderAutoTagBanner();

    const stats = BR.libraryStats(library);
    document.getElementById("stat-total").textContent = stats.total;
    document.getElementById("stat-hours").textContent = Math.round(stats.totalHours);
    document.getElementById("stat-unplayed").textContent = stats.neverStartedPct + "%";

    const bucketColors = {
      endless_favorite: "var(--accent)",
      short_finished: "var(--amber)",
      moderate: "var(--ink-faint)",
      unplayed: "var(--risk)",
      flop: "var(--risk)",
    };
    const order = ["endless_favorite", "short_finished", "moderate", "unplayed", "flop"];
    const list = document.getElementById("bucket-list");
    list.innerHTML = order
      .map(
        (key) => `
      <div class="bucket-row">
        <span class="bucket-dot" style="background:${bucketColors[key]}"></span>
        <span class="bucket-name">${BR.ENGAGEMENT_LABEL[key]}</span>
        <span class="bucket-count">${stats.counts[key]}</span>
      </div>`
      )
      .join("");
  }

  function showToast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  }

  document.getElementById("open-steam-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: STEAM_GAMES_URL });
    window.close();
  });
  document.getElementById("rescan-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: STEAM_GAMES_URL });
    window.close();
  });

  document.getElementById("share-btn").addEventListener("click", () => {
    const stats = BR.libraryStats(library);
    const dna = BR.computeDNA(library);
    const topMech = Object.entries(dna).sort((a, b) => a[1] - b[1])[0]; // most negative = most boredom-prone
    const line2 = topMech
      ? `Riskiest genre for me: ${topMech[0]} (${Math.round((1 - topMech[1]) / 2 * 100)}% boredom risk)`
      : "Still auto-tagging — check back in a minute for this line.";
    const text =
      `My Steam backlog, scanned with Shelf Life:\n` +
      `${stats.total} games, ${Math.round(stats.totalHours)}h total.\n` +
      `${stats.neverStartedPct}% never even started, ${stats.flopPct}% dropped within ~3h.\n` +
      `${line2}`;
    navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard"));
  });

  // ---------- tag panel ----------
  function renderTagList() {
    const el = document.getElementById("tag-list");
    const sorted = [...library].sort((a, b) => b.playtimeHours - a.playtimeHours);

    el.innerHTML = sorted
      .map((g) => {
        const chips = BR.MECHANICS.map((m) => {
          const selected = g.mechanics.includes(m);
          return `<span class="chip ${selected ? "selected" : ""}" data-appid="${g.appid}" data-mech="${m}">${m}</span>`;
        }).join("");
        const autoBadge =
          g.tagSource === "auto" && g.mechanics.length
            ? `<span class="auto-badge" title="Auto-tagged from Steam's own genre data — click a chip to override by hand">auto</span>`
            : "";
        return `
        <div class="tag-row">
          <div class="tag-row-top">
            <span class="tag-row-title" title="${g.title}">${g.title}</span>
            <span class="tag-row-hours">${autoBadge}${g.playtimeHours.toFixed(1)}h</span>
          </div>
          <div class="chip-picker">${chips}</div>
        </div>`;
      })
      .join("");
  }

  document.getElementById("tag-list").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const appid = chip.dataset.appid;
    const mech = chip.dataset.mech;
    const g = library.find((x) => x.appid === appid);
    if (!g) return;

    const has = g.mechanics.includes(mech);
    if (has) {
      g.mechanics = g.mechanics.filter((m) => m !== mech);
    } else {
      if (g.mechanics.length >= 3) return; // cap at 3
      g.mechanics = [...g.mechanics, mech];
    }
    // Any manual click promotes this row to "manual" so the
    // auto-tagger will never silently overwrite it again.
    saveTags(appid, g.mechanics);
    renderTagList();
  });

  // ---------- check panel: live Steam search ----------
  let searchDebounce = null;
  let selectedCandidate = null; // { appid, name, priceEur }

  async function searchSteam(term) {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=fi`;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  }

  async function fetchGenreForAppid(appid) {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) return null;
      const json = await res.json();
      const entry = json && json[appid];
      if (!entry || !entry.success || !entry.data || !Array.isArray(entry.data.genres)) return null;
      for (const g of entry.data.genres) {
        const mapped = BR.STEAM_GENRE_MAP[g.description];
        if (mapped) return mapped;
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  function renderSearchResults(items) {
    const box = document.getElementById("check-search-results");
    if (!items.length) {
      box.innerHTML = `<div class="search-empty">No games found.</div>`;
      box.hidden = false;
      return;
    }
    box.innerHTML = items
      .slice(0, 8)
      .map((item) => {
        const price =
          item.price && typeof item.price.final === "number"
            ? item.price.final === 0
              ? "Free"
              : (item.price.final / 100).toFixed(2) + "€"
            : "—";
        return `
        <div class="search-result-row" data-appid="${item.id}" data-name="${escapeHtml(item.name)}" data-price="${
          item.price && typeof item.price.final === "number" ? item.price.final : ""
        }">
          ${item.tiny_image ? `<img src="${item.tiny_image}" alt="" />` : ""}
          <span class="search-result-name">${escapeHtml(item.name)}</span>
          <span class="search-result-price">${price}</span>
        </div>`;
      })
      .join("");
    box.hidden = false;
  }

  document.getElementById("check-search-input").addEventListener("input", (e) => {
    const term = e.target.value.trim();
    clearTimeout(searchDebounce);
    if (term.length < 2) {
      document.getElementById("check-search-results").hidden = true;
      return;
    }
    searchDebounce = setTimeout(async () => {
      const box = document.getElementById("check-search-results");
      box.innerHTML = `<div class="search-loading">Searching…</div>`;
      box.hidden = false;
      const items = await searchSteam(term);
      renderSearchResults(items);
    }, 300);
  });

  document.getElementById("check-search-results").addEventListener("click", async (e) => {
    const row = e.target.closest(".search-result-row");
    if (!row) return;
    const appid = Number(row.dataset.appid);
    const name = row.dataset.name;
    const priceCents = row.dataset.price;
    const priceEur = priceCents !== "" ? Number(priceCents) / 100 : null;

    document.getElementById("check-search-results").hidden = true;
    document.getElementById("check-search-input").value = name;
    selectedCandidate = { appid, name, priceEur };
    renderSelected();
    await evaluateSelected();
  });

  function renderSelected() {
    const box = document.getElementById("check-selected");
    if (!selectedCandidate) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `
      <div>
        <div class="check-selected-name">${escapeHtml(selectedCandidate.name)}</div>
        <div class="check-selected-meta">${selectedCandidate.priceEur !== null ? selectedCandidate.priceEur.toFixed(2) + "€" : "price unknown"}</div>
      </div>
      <button type="button" class="check-selected-change" id="check-change-btn">Change</button>
    `;
    document.getElementById("check-change-btn").addEventListener("click", () => {
      selectedCandidate = null;
      document.getElementById("check-search-input").value = "";
      document.getElementById("check-result").hidden = true;
      renderSelected();
      document.getElementById("check-search-input").focus();
    });
  }

  async function evaluateSelected() {
    if (!selectedCandidate) return;
    const box = document.getElementById("check-result");
    box.hidden = false;

    // Already own it? Show what actually happened, not a hypothetical
    // prediction — a genre-level average can look nothing like this
    // one game's real outcome, especially for an outlier like a
    // 1000+ hour favorite in an otherwise mixed genre.
    const owned = library.find((g) => Number(g.appid) === selectedCandidate.appid);
    if (owned) {
      const bucket = BR.classifyEngagement(owned.playtimeHours, owned.achUnlocked, owned.achTotal);
      box.className = "check-result good";
      box.innerHTML = `
        <div class="verdict">Already in your library — showing real data, not a prediction</div>
        <div class="check-result-grid">
          <div>Hours played<b>${owned.playtimeHours.toFixed(1)}h</b></div>
          <div>Classification<b>${BR.ENGAGEMENT_LABEL[bucket]}</b></div>
          <div>Achievements<b>${owned.achTotal ? owned.achUnlocked + "/" + owned.achTotal : "—"}</b></div>
          <div>Tagged as<b>${owned.mechanics && owned.mechanics.length ? escapeHtml(owned.mechanics.join(", ")) : "untagged"}</b></div>
        </div>
      `;
      return;
    }

    box.className = "check-result";
    box.innerHTML = `<div class="verdict">Looking up genre…</div>`;

    const genre = await fetchGenreForAppid(selectedCandidate.appid);
    const mechanics = genre ? [genre] : [];
    const dna = BR.computeDNA(library);
    const result = BR.evaluateCandidate(
      { priceEur: selectedCandidate.priceEur || 0, mechanics },
      dna,
      library
    );
    const communityEntry = communityAggregate.find((g) => Number(g.appid) === selectedCandidate.appid) || null;

    box.className = `check-result ${result.verdictClass}`;
    box.innerHTML = `
      <div class="verdict">${result.verdict}</div>
      <div class="check-result-grid">
        <div>Your boredom risk<b>${result.hasSignal ? result.bri + "%" : "—"}</b></div>
        <div>Predicted playtime<b>${
          result.predictedHours !== null ? (result.hasHoursSignal ? "" : "~") + result.predictedHours + "h" : "—"
        }</b></div>
        <div>ROI<b>${result.roi !== null ? result.roi + " h/€" : "—"}</b></div>
        <div>Genre<b>${genre ? escapeHtml(genre) : "unknown"}</b></div>
        ${
          communityEntry
            ? `<div>Community risk<b>${Math.round(communityEntry.community_score)}%</b></div>
               <div>Shared by<b>${communityEntry.n}</b></div>`
            : `<div style="grid-column:1/-1">No community data yet for this game.</div>`
        }
      </div>
    `;
  }

  // ---------- discover panel ----------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderDiscoverRow(g) {
    const risk = g.community_score !== null && g.community_score !== undefined ? Math.round(g.community_score) : null;
    return `
      <div class="discover-row">
        <div class="discover-row-top">
          <span class="discover-name" title="${escapeHtml(g.name || "App " + g.appid)}">${escapeHtml(g.name || "App " + g.appid)}</span>
          <span class="discover-risk">${risk !== null ? risk + "% risk" : "—"}</span>
        </div>
        <div class="discover-meta">${escapeHtml(g.genre || "unknown genre")} &middot; ${g.n} shared</div>
      </div>`;
  }

  function renderDiscover() {
    const empty = document.getElementById("discover-empty");
    const content = document.getElementById("discover-content");
    if (!communityAggregate.length) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    empty.hidden = true;
    content.hidden = false;

    const owned = new Set(library.map((g) => String(g.appid)));
    const candidates = communityAggregate.filter(
      (g) => !owned.has(String(g.appid)) && g.community_score !== null && g.community_score !== undefined
    );
    const dna = BR.computeDNA(library);

    const wishlistSet = new Set(wishlist.map(String));
    const wishlistMatches = candidates
      .filter((g) => wishlistSet.has(String(g.appid)))
      .sort((a, b) => a.community_score - b.community_score);
    document.getElementById("discover-wishlist").innerHTML =
      wishlistMatches.map(renderDiscoverRow).join("") ||
      (wishlist.length
        ? `<p class="hint">None of your wishlist games have community data yet.</p>`
        : `<p class="hint">Open your <a href="#" id="open-wishlist-link">Steam wishlist</a> once to compare it against community scores.</p>`);
    const wishlistLink = document.getElementById("open-wishlist-link");
    if (wishlistLink) {
      wishlistLink.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: STEAM_WISHLIST_URL });
      });
    }

    const FAVORITE_BUCKETS = new Set(["endless_favorite", "short_finished"]);
    const myFavorites = new Set(
      library
        .filter((g) => FAVORITE_BUCKETS.has(BR.classifyEngagement(g.playtimeHours, g.achUnlocked, g.achTotal)))
        .map((g) => Number(g.appid))
    );
    const scoreByAppid = new Map();
    for (const pair of favoritePairs) {
      const a = Number(pair.appid_a);
      const b = Number(pair.appid_b);
      if (myFavorites.has(a) && !owned.has(String(b))) {
        scoreByAppid.set(b, (scoreByAppid.get(b) || 0) + pair.pair_count);
      }
      if (myFavorites.has(b) && !owned.has(String(a))) {
        scoreByAppid.set(a, (scoreByAppid.get(a) || 0) + pair.pair_count);
      }
    }
    const aggregateByAppid = new Map(communityAggregate.map((g) => [Number(g.appid), g]));
    const similar = [...scoreByAppid.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([appid, score]) => ({ ...(aggregateByAppid.get(appid) || { appid }), pairScore: score }));
    document.getElementById("discover-similar").innerHTML =
      similar.map(renderDiscoverRow).join("") ||
      (myFavorites.size
        ? `<p class="hint">Not enough overlapping favorites in the community yet.</p>`
        : `<p class="hint">Tag or play more of your library to find favorites to match against.</p>`);

    const personal = candidates
      .filter((g) => g.genre && dna[g.genre] !== undefined && dna[g.genre] > 0)
      .sort((a, b) => a.community_score - dna[a.genre] * 40 - (b.community_score - dna[b.genre] * 40))
      .slice(0, 8);

    const broad = candidates
      .slice()
      .sort((a, b) => a.community_score - b.community_score)
      .slice(0, 8);

    document.getElementById("discover-personal").innerHTML =
      personal.map(renderDiscoverRow).join("") ||
      `<p class="hint">Tag more of your library to unlock personal matches.</p>`;
    document.getElementById("discover-broad").innerHTML =
      broad.map(renderDiscoverRow).join("") || `<p class="hint">Not enough community data yet.</p>`;
  }

  // ---------- init ----------
  loadAll(() => {
    renderLibrary();
    renderTagList();
    renderShareToggle();
    renderDiscover();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      changes.steamLibrary ||
      changes.backlogRadarTags ||
      changes.backlogRadarAutoTagStatus ||
      changes.backlogRadarShareEnabled ||
      changes.communityAggregate ||
      changes.steamWishlist ||
      changes.favoritePairs
    ) {
      loadAll(() => {
        renderLibrary();
        renderTagList();
        renderShareToggle();
        renderDiscover();
      });
    }
  });
})();
