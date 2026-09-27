# Poker Banker

A phone app for the person running the bank at a home poker game. Track every buy-in, rebuy, IOU and cash-out, and always know exactly how much money should still be on the table.

It is a Progressive Web App: plain HTML/JS, no install from an app store, works offline, and saves everything on the phone.

## What it does

- **Games** – start a game with a name and a standard buy-in (quick buttons for ½×, 1×, 2×, or any amount).
- **Buy-ins & rebuys** – record how each player paid: **Cash**, **Venmo / App**, or **IOU**.
- **Cash-outs** – enter the chips a player leaves with. The app subtracts any IOU they owe, tells you exactly what to pay them, and shows their result for the night.
- **Live bank** – "On the table" total, plus a breakdown of cash in hand, digital money received and IOUs outstanding. A check confirms the bank always balances with the chips in play.
- **Chip count check** – count the chips on the table and the app tells you whether anything is missing.
- **Standings & IOUs** – who's up, who's down, who still owes you; record IOU repayments.
- **Log + undo** – every transaction is timestamped; undo right away or delete any entry later.
- **Share summary** – send the night's results to the group chat.

## Using it on your phone

The app must be served over HTTPS for "Add to Home Screen" and offline mode. The easiest free option is GitHub Pages:

1. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and `/ (root)`.
2. Open `https://<your-username>.github.io/Poker-Banker-App/` on your phone.
3. iPhone: Share → **Add to Home Screen**. Android: ⋮ menu → **Install app**.

Data lives only on that phone (browser storage), so use the same phone as the banker each night.

## Development

```sh
npm start   # serves on http://localhost:8080
npm test    # runs the money-math tests
```

- `js/ledger.js` – all the money math (pure functions, amounts in cents)
- `js/app.js` – screens, modals and storage
- `sw.js` – offline cache (bump `CACHE` when you change files)

## Ideas for next steps

**Money & settling up**
- End-of-night "who pays whom" list that settles Venmo debts between players with the fewest payments
- Venmo / Cash App deep links with the amount pre-filled
- Chip denominations: set the chip values and count stacks by color instead of adding up dollars
- A "bank float" field for starting cash you bring before anyone buys in
- Tips / rake / food kitty taken out of the pot
- Buy-in limits and rebuy caps, plus a warning when someone is way over

**Players & history**
- Saved player list so regulars are one tap to add
- Lifetime stats per player: nights played, total won or lost, biggest win
- Running IOU balances that carry over from one game to the next
- Leaderboards and a season view

**Game night extras**
- Tournament mode with a blind timer, levels and payout percentages
- Seat and dealer tracking
- Photo of the final chip count attached to the game

**Trust & backup**
- Export and import (CSV/JSON) and cloud backup so a lost phone doesn't lose the history
- Shared, read-only live view so players can check the bank from their own phones
- A second banker/co-host who can make entries too
- PIN lock so nobody else edits the bank
