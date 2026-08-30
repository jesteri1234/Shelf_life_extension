# Shelf Life

A Chrome extension that reads **your own** Steam library and predicts
which games you'll actually finish before you buy them. Built to answer
one question: *"will this be a flop, or will I actually play it?"*

**v0.2 — now with automatic genre tagging.**
- 100% rule-based math. No AI/ML anywhere, no analytics, no accounts.
- Your library data (titles, playtime, achievements) is read locally and
  stored only in `chrome.storage.local` — it is never sent anywhere.
  There is still no server and no crowdsourced data; this is the
  personal-only MVP.
- **New in v0.2:** a background step now fetches each game's genre
  automatically from Steam's own public store catalog
  (`store.steampowered.com/api/appdetails`) — one request per game, at a
  polite pace, sending only the game's Steam app ID (nothing about you
  or your library). This is the one part of the extension that talks to
  the network; everything else stays local. Manual tagging is still
  there for when you want more precise mechanic tags than Steam's broad
  genres (e.g. "Roguelike" instead of just "Action").

## How it works

1. **Scan**: open your own Steam games list
   (`steamcommunity.com/my/games`). The content script reads the page
   you're already looking at (titles, hours played, achievements) and
   saves it locally.
2. **Auto-tag**: a background step then asks Steam's public catalog for
   each game's genre and fills that in automatically — you'll see
   "Auto-tagging genres… 34/82" in the popup while it works. This can
   take a minute or so for a large library since it's deliberately
   throttled (~1.5 requests/second) to be a well-behaved client.
3. **Refine (optional)**: in "Tag mechanics", click any chip to add a
   more specific mechanic (roguelike, crafting, open world, ...) beyond
   Steam's broad genre. A game you touch by hand is marked "manual" and
   the auto-tagger will never overwrite it again.
4. **Check**: before buying something new, enter its price and its
   mechanics/genres. You get a boredom-risk estimate, plus predicted
   playtime and hours/euro — derived from your own historical playtime
   for games sharing those mechanics, not a manual guess.

The scoring model (engagement classification, affinity, boredom-risk
index, ROI) is the same rule-based design worked out on paper first —
see `mechanics.js`, it's short and fully commented. The auto-tagging
queue is in `background.js`.

## Install (unpacked, for testing)

Chrome doesn't allow installing from a `.zip` — load the unpacked folder:

1. Unzip this folder somewhere on disk.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `backlog-radar-extension`
   folder.
5. Open `steamcommunity.com/my/games` once to run your first scan, then
   click the extension icon. Auto-tagging starts on its own right after.

If you're updating from an earlier build: click the reload icon on the
extension's card in `chrome://extensions`, then re-open your Steam
games page once to trigger a fresh scan.

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
  tagging your favorites by hand still gives better predictions.
- **Auto-tagging needs the service worker running.** It's triggered by
  a library scan and by the browser starting up. If it looks stuck at
  "0/82" for a while, check `chrome://extensions` → this extension's
  card → **service worker** (Inspect) for errors in that console.
- **No crowd data yet.** "Check a game" only uses *your own* tagged
  history, so it needs a reasonable number of tagged games to say
  anything useful. This is the intended v1 scope, not a bug.

## Feedback

This is an early test build shared for feedback, not a finished product.
If the boredom-risk numbers feel wrong for games you know well, that's
the most useful kind of bug report.
