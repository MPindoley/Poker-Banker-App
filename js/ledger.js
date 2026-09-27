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

// A player has left if their latest buy-in/cash-out was a cash-out.
export function isOut(game, playerId) {
  for (let i = game.transactions.length - 1; i >= 0; i--) {
    const t = game.transactions[i];
    if (t.playerId !== playerId) continue;
    if (t.type === 'cashout') return true;
    if (t.type === 'buyin') return false;
  }
  return false;
}

// Final standings, sorted biggest winner first; players still at the table go last.
export function standings(game) {
  return game.players
    .map((p) => ({ player: p, out: isOut(game, p.id), ...playerStats(game, p.id) }))
    .sort((a, b) => b.out - a.out || b.net - a.net);
}

// Every unpaid IOU across all games, biggest first.
export function outstandingIous(games) {
  const list = [];
  for (const game of games) {
    for (const p of game.players) {
      const { iouOwed } = playerStats(game, p.id);
      if (iouOwed > 0) list.push({ game, player: p, amount: iouOwed });
    }
  }
  return list.sort((a, b) => b.amount - a.amount);
}

// Career numbers per player id. Only counts nights a player finished (cashed out).
export function lifetimeStats(games) {
  const by = {};
  for (const game of games) {
    for (const p of game.players) {
      const s = playerStats(game, p.id);
      if (!s.buyIns) continue;
      const row = (by[p.id] ||= { games: 0, finished: 0, wins: 0, buyIn: 0, net: 0, best: 0, worst: 0, iouOwed: 0 });
      row.games++;
      row.iouOwed += s.iouOwed;
      if (!isOut(game, p.id)) continue;
      row.finished++;
      row.buyIn += s.buyIn;
      row.net += s.net;
      if (s.net > 0) row.wins++;
      row.best = Math.max(row.best, s.net);
      row.worst = Math.min(row.worst, s.net);
    }
  }
  return by;
}

// Dollar value of a stack counted by chip color. counts[i] matches chips[i].
export function chipTotal(chips, counts) {
  return chips.reduce((sum, c, i) => sum + c.value * (Number(counts[i]) || 0), 0);
}
