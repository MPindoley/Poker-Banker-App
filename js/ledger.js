// Pure money math for a game. No DOM, no storage — easy to test.
//
// A game holds players and an append-only list of transactions:
//   { type: 'buyin',   playerId, amount, method }            method: cash | digital | iou
//   { type: 'cashout', playerId, amount, iouOffset, method } amount = chips turned in
//   { type: 'repay',   playerId, amount, method }            player pays back an IOU
//
// All amounts are stored in cents to avoid floating point drift.

export const METHODS = {
  cash: 'Cash',
  digital: 'Venmo / App',
  iou: 'IOU',
};

export function toCents(value) {
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formatMoney(cents, { sign = false } = {}) {
  const abs = Math.abs(cents) / 100;
  const str = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  if (cents < 0) return '-' + str;
  if (sign && cents > 0) return '+' + str;
  return str;
}

export function playerStats(game, playerId) {
  const s = {
    buyIn: 0,
    buyIns: 0,
    cashOut: 0,
    payout: 0,
    iouBorrowed: 0,
    iouOffset: 0,
    iouRepaid: 0,
  };
  for (const t of game.transactions) {
    if (t.playerId !== playerId) continue;
    if (t.type === 'buyin') {
      s.buyIn += t.amount;
      s.buyIns += 1;
      if (t.method === 'iou') s.iouBorrowed += t.amount;
    } else if (t.type === 'cashout') {
      s.cashOut += t.amount;
      s.iouOffset += t.iouOffset || 0;
      s.payout += t.amount - (t.iouOffset || 0);
    } else if (t.type === 'repay') {
      s.iouRepaid += t.amount;
    }
  }
  s.iouOwed = s.iouBorrowed - s.iouOffset - s.iouRepaid;
  s.net = s.cashOut - s.buyIn;
  return s;
}

export function bankSummary(game) {
  const b = {
    totalBuyIns: 0,
    totalCashOuts: 0,
    cash: 0,
    digital: 0,
    iouOutstanding: 0,
  };
  for (const t of game.transactions) {
    if (t.type === 'buyin') {
      b.totalBuyIns += t.amount;
      if (t.method === 'iou') b.iouOutstanding += t.amount;
      else b[t.method] += t.amount;
    } else if (t.type === 'cashout') {
      const offset = t.iouOffset || 0;
      b.totalCashOuts += t.amount;
      b.iouOutstanding -= offset;
      b[t.method] -= t.amount - offset;
    } else if (t.type === 'repay') {
      b.iouOutstanding -= t.amount;
      b[t.method] += t.amount;
    }
  }
  // Chips that should still be in play on the table.
  b.onTable = b.totalBuyIns - b.totalCashOuts;
  // Money the bank holds or is owed. Must always equal onTable.
  b.held = b.cash + b.digital + b.iouOutstanding;
  b.balanced = b.held === b.onTable;
  return b;
}

// How a cash-out would split between clearing the player's IOU and a real payout.
export function planCashOut(game, playerId, chipsCents) {
  const { iouOwed } = playerStats(game, playerId);
  const iouOffset = Math.max(0, Math.min(chipsCents, iouOwed));
  return {
    chips: chipsCents,
    iouOffset,
    payout: chipsCents - iouOffset,
    stillOwes: iouOwed - iouOffset,
  };
}

// Final standings, sorted biggest winner first.
export function standings(game) {
  return game.players
    .map((p) => ({ player: p, ...playerStats(game, p.id) }))
    .sort((a, b) => b.net - a.net);
}
