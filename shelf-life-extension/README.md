# Shelf Life

A Chrome extension that reads **your own** Steam library and predicts
which games you'll actually finish before you buy them — plus, now,
recommendations built from everyone else running it too. Built to
answer one question: *"will this be a flop, or will I actually play
it?"*

**v0.5 — crowd-sourced recommendations, a store-page overlay, live
Steam search.**
- 100% rule-based math. No AI/ML anywhere, no accounts, no login.
- Your own library data (titles, playtime, achievements, manual tags)
  always lives locally in `chrome.storage.local` — that part never
  changes.
- **New:** an anonymized slice of that data (see "Data sharing"
  below) can also be sent to a small community server, so the
  extension can tell you things your own library alone can't: which
  wishlist games are actually worth it, what similarly-styled players
  finished and loved, and what's broadly well-regarded across
  everyone sharing data. This is **on by default** and easy to turn
  off — see below for exactly why and exactly what that means.

## Data sharing — please read this part

Turning genre auto-tagging into something more useful than "compare
against just your own handful of tagged games" needs data from more
than one person. So starting in this version, Shelf Life shares a
small, anonymized slice of your library with a community server I
run, **on by default**.

**What gets sent**, per game in your library: its Steam app ID, hours
played, achievements unlocked/total, and its coarse Steam genre (e.g.
"RPG", "Strategy") — nothing else.

**What never gets sent**: your Steam ID, your username, your profile,
anything about *which* games you own beyond that list, your
fine-grained manual tags (roguelike, souls-like, etc. — those stay
local), or anything else about you. The extension identifies your
install only by a random ID it generates once on your own machine
(`crypto.randomUUID()`); the server salts and hashes that ID before
storing anything, so even the server operator can't connect a
submission back to a specific Steam account.

**Where it goes**: a Cloudflare Worker + database I run
(`backlog-radar-api`), source at `../backlog-radar-backend`. It
validates and rate-limits submissions, folds them into per-game
aggregate stats (median hours, drop-off rate, community score) and a
"which games tend to be favorited together" table, and publishes only
those aggregates back — never anyone's raw per-user data.

**Turning it off**: Library tab → the toggle at the top ("Share
anonymized play data"). Off takes effect on your next scan/rescan.
You can still use everything personal (scan, tag, Check a game
against your own history) with sharing off — you just won't
contribute to or benefit as much from the community-driven parts of
Discover, since those need submitted data to have anything to show.

Why opt-out instead of opt-in: a crowd feature nobody's data feeds
never becomes useful, so an opt-in default would likely mean an
always-empty Discover tab for everyone. Opt-out means the feature can
actually work, as long as it's easy to disable and completely honest
about what it does — which is the point of this whole section.

## How it works

1. **Scan**: open your own Steam games list
   (`steamcommunity.com/my/games`). The content script reads the page
   you're already looking at (titles, hours played, achievements) and
   saves it locally.
2. **Auto-tag**: a background step then asks Steam's public catalog for
   each game's genre and fills that in automatically — you'll see
   "Auto-tagging genres… 34/82" in the popup while it works. This can
   take a minute or so for a large library since it's deliberately
   throttled (~1.5 requests/second) to be a well-behaved client. Once
   this finishes, your library (with genres) is submitted to the
   community server if sharing is on.
3. **Refine (optional)**: in "Tag mechanics", click any chip to add a
   more specific mechanic (roguelike, crafting, open world, ...) beyond
   Steam's broad genre. A game you touch by hand is marked "manual" and
   the auto-tagger will never overwrite it again. Manual tags stay
   local and are never shared.
4. **Check a game**: search for a game by name (Steam's own live
   search, same as the store's search box) instead of typing in a
   price or genre by hand. If you already own it, you get your real
   playtime and achievement history instead of a prediction. If you
   don't, you get a boredom-risk estimate blending your own tagged
   history with community data for that game, plus predicted playtime
   and hours/euro.
5. **Discover**: the extension's own recommendations tab, four
   sections: games from your Steam wishlist worth a second look,
   games that players with similar favorites played a lot ("players
   like you"), games that match your personal affinity profile, and
   games broadly loved across everyone sharing data. All four skip
   anything already in your library, and all fill in gradually as
   more people share data — an empty or thin section early on is
   expected, not broken.
6. **Overlay**: browsing an individual game's Steam store page shows a
   small dismissible card with the same risk/prediction info, so you
   don't have to open the popup while browsing. It stays out of the
   way entirely for games you already own, or when there's genuinely
   no signal to show yet.

The scoring model (engagement classification, affinity, boredom-risk
index, ROI, predicted hours) is the same rule-based design worked out
on paper first — see `mechanics.js`, it's short and fully commented.
The auto-tagging and data-sharing queue is in `background.js`.

## Install (unpacked, for testing)

Chrome doesn't allow installing from a `.zip` — load the unpacked folder:

1. Unzip this folder somewhere on disk.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `shelf-life-extension`
   folder.
5. Open `steamcommunity.com/my/games` once to run your first scan, then
   click the extension icon. Auto-tagging starts on its own right after.

If you're updating from an earlier build: click the reload icon on the
extension's card in `chrome://extensions`, then re-open your Steam
games page once to trigger a fresh scan.

The community server is already live and shared — you don't need to
set up anything yourself to use Shelf Life. `../backlog-radar-backend`
and its `DEPLOY.md` are only relevant if you want to run your own
separate instance (e.g. to contribute to or fork this project).

## Known limitations (honest list, please read before reporting bugs)

- **English Steam UI assumed.** The scraper looks for text patterns like
  `"374.6 hours"`. If your Steam interface language isn't English,
  scanning will likely find 0 games — this is a known gap, not a crash.
- **Valve can change the page layout at any time.** The scraper avoids
  Steam's internal CSS class names (they're auto-generated and change
  often) and anchors only on the `/app/<id>/` links plus nearby playtime
  text. If Steam ships a structural redesign, the console will log
  `Scanned 0 games` — please report that detail rather than a silent
  "it's broken."
- **Auto-tag genres are coarse.** Steam's public catalog only exposes
  ~12 broad genres (Action, Simulation, Strategy, RPG, ...), not the
  finer mechanics (roguelike, deckbuilder, souls-like...) the scoring
  model can use. Auto-tagging gives every game *something* right away;
  tagging your favorites by hand still gives better personal
  predictions.
- **Auto-tagging needs the service worker running.** It's triggered by
  a library scan and by the browser starting up. If it looks stuck at
  "0/82" for a while, check `chrome://extensions` → this extension's
  card → **service worker** (Inspect) for errors in that console.
- **Community data is early and small.** The whole point of sharing is
  crowd size, and right now there aren't many contributors yet — so
  Discover and community-blended scores can be thin, or missing for
  less-common games, until more people are running this and sharing.
  This gets better over time, not worse.
- **Community aggregation runs on a schedule, not instantly.** Shared
  data is folded into the public aggregates every few hours, not the
  moment you submit — so a fresh submission won't change what you (or
  anyone) sees in Discover right away.
- **"Check a game" search relies on an undocumented Steam endpoint.**
  It's the same one the Steam store's own search box uses, but Valve
  could change its shape without notice; the extension parses it
  defensively and just shows fewer/no results if that ever breaks,
  rather than crashing.
- **Overlay is store pages only, for now.** It doesn't (yet) show up
  while browsing genre/tag listing pages or search results — only on
  a specific game's own store page.

## Feedback

This is an early test build shared for feedback, not a finished
product. If the boredom-risk numbers feel wrong for games you know
well — personal or community-blended — that's the most useful kind of
bug report. Same goes for anything in Discover that looks obviously
off: with a small early group of contributors, weird outliers are
expected and worth flagging so they can be tuned.
MESSAGE ME THE FEEDBACK ON THE REDDIT POST YOU FOUND THIS OR DM u/lik_manat