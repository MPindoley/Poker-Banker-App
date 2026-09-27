# Poker Banker

A phone app for the person running the bank at a home poker game. Track every buy-in, rebuy, IOU and cash-out, and always know exactly how much money should still be on the table.

It is a Progressive Web App: plain HTML/JS, no install from an app store, works offline, and saves everything on the phone.

## What it does

**At the table**
- **Games** – start a game with a standard buy-in and optional starting cash ("float") you bring for making change.
- **Regulars** – everyone you've played with is one tap to add. Their Venmo username is saved.
- **Buy-ins & rebuys** – record how each player paid: **Cash**, **Venmo / App**, or **IOU**.
- **Cash-outs** – type the chip amount or **count stacks by color**. The app subtracts any IOU, tells you exactly what to pay, and warns if you don't have enough cash. Pick Venmo and it opens Venmo with the amount and note filled in.
- **Live bank** – "On the table" total, plus cash in hand, Venmo net and IOUs owed, with a check that the bank balances with the chips in play.
- **Screen stays on** during a live game.
- **Log + undo** – every transaction is timestamped; undo right away or delete any entry later.

**End of the night**
- **Cash out remaining players** – walks you through everyone still seated, one after another.
- **Count the cash** – shows what should be in your hand (including float) and checks your count.
- **Count the chips** – checks the chips left on the table, by dollar amount or by color.
- **Standings, IOUs and a shareable summary** for the group chat.

**Between games**
- **Owed to the bank** – unpaid IOUs from any game stay on the home screen, with a Venmo request button, until marked paid.
- **Leaderboard** – each regular's all-time result, games played, nights up and best night.
- **Backup & import** – save a backup file to iCloud/Drive or text it to yourself; import merges it on a new phone.
- **Chip values** – set your own chip colors and values in Settings.

## Using it on your phone

The app is hosted free on GitHub Pages: **https://mpindoley.github.io/Poker-Banker-App/**

1. Open that link on your phone.
2. iPhone (Safari): Share → **Add to Home Screen**. Android (Chrome): ⋮ menu → **Install app**.
3. Launch it from the home screen icon — it works offline after the first load.

Every change merged to `main` is published automatically within a minute or two. (One-time setup: repo **Settings → Pages → Deploy from a branch → `main` / `(root)`**.)

Data lives only on that phone (browser storage), so use the same phone as the banker each night and use **Settings → Save backup** now and then.

## Development

```sh
npm start   # serves on http://localhost:8080
npm test    # runs the logic tests
```

- `js/ledger.js` – all the money math (pure functions, amounts in cents)
- `js/store.js` – saved-data shape, upgrades between versions, backup merging
- `js/venmo.js` – Venmo pay/request links
- `js/app.js` – screens, modals, wake lock
- `sw.js` – offline cache (bump `CACHE` when you change files)

## Ideas for next steps

- Shared live view so players can check the bank from their own phones (needs a small backend)
- Co-banker who can make entries from a second phone
- Tournament mode: blind timer, levels, payout percentages
- Food / kitty expenses split across players
- Rebuy caps and "way over" warnings
- Season view and year-end awards
- PIN lock
