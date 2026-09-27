import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatMoney, playerStats, bankSummary, planCashOut, standings } from '../js/ledger.js';

const game = (transactions) => ({
  players: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Cara' },
  ],
  transactions,
});

test('toCents parses user input', () => {
  assert.equal(toCents('20'), 2000);
  assert.equal(toCents('$12.50'), 1250);
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents('abc'), 0);
});

test('formatMoney', () => {
  assert.equal(formatMoney(2000), '$20');
  assert.equal(formatMoney(1250), '$12.50');
  assert.equal(formatMoney(-500), '-$5');
  assert.equal(formatMoney(500, { sign: true }), '+$5');
});

test('pot tracks buy-ins minus cash-outs', () => {
  const g = game([
    { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
    { type: 'buyin', playerId: 'b', amount: 2000, method: 'digital' },
    { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
    { type: 'cashout', playerId: 'b', amount: 3500, iouOffset: 0, method: 'cash' },
  ]);
  const b = bankSummary(g);
  assert.equal(b.totalBuyIns, 6000);
  assert.equal(b.onTable, 2500);
  assert.equal(b.cash, 500);
  assert.equal(b.digital, 2000);
  assert.ok(b.balanced);
  assert.equal(playerStats(g, 'b').net, 1500);
  assert.equal(playerStats(g, 'a').buyIns, 2);
});

test('IOU is deducted from cash-out payout', () => {
  const g = game([{ type: 'buyin', playerId: 'c', amount: 4000, method: 'iou' }]);
  assert.equal(bankSummary(g).iouOutstanding, 4000);

  const plan = planCashOut(g, 'c', 5000);
  assert.deepEqual(plan, { chips: 5000, iouOffset: 4000, payout: 1000, stillOwes: 0 });

  g.transactions.push({ type: 'cashout', playerId: 'c', amount: 5000, iouOffset: plan.iouOffset, method: 'cash' });
  const b = bankSummary(g);
  assert.equal(b.iouOutstanding, 0);
  assert.equal(b.cash, -1000);
  assert.equal(b.onTable, -1000);
  assert.ok(b.balanced);
});

test('losing IOU player still owes after cash-out, then repays', () => {
  const g = game([
    { type: 'buyin', playerId: 'a', amount: 4000, method: 'cash' },
    { type: 'buyin', playerId: 'c', amount: 4000, method: 'iou' },
  ]);
  const plan = planCashOut(g, 'c', 1500);
  assert.equal(plan.payout, 0);
  assert.equal(plan.stillOwes, 2500);
  g.transactions.push({ type: 'cashout', playerId: 'c', amount: 1500, iouOffset: plan.iouOffset, method: 'cash' });
  assert.equal(playerStats(g, 'c').iouOwed, 2500);

  g.transactions.push({ type: 'repay', playerId: 'c', amount: 2500, method: 'digital' });
  const b = bankSummary(g);
  assert.equal(playerStats(g, 'c').iouOwed, 0);
  assert.equal(b.iouOutstanding, 0);
  assert.equal(b.digital, 2500);
  assert.equal(b.onTable, 6500);
  assert.ok(b.balanced);
});

test('standings sort winners first and nets sum to zero when everyone is out', () => {
  const g = game([
    { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
    { type: 'buyin', playerId: 'b', amount: 2000, method: 'cash' },
    { type: 'buyin', playerId: 'c', amount: 2000, method: 'cash' },
    { type: 'cashout', playerId: 'a', amount: 0, iouOffset: 0, method: 'cash' },
    { type: 'cashout', playerId: 'b', amount: 4500, iouOffset: 0, method: 'cash' },
    { type: 'cashout', playerId: 'c', amount: 1500, iouOffset: 0, method: 'cash' },
  ]);
  const rows = standings(g);
  assert.deepEqual(rows.map((r) => r.player.id), ['b', 'c', 'a']);
  assert.equal(rows.reduce((s, r) => s + r.net, 0), 0);
  assert.equal(bankSummary(g).onTable, 0);
  assert.equal(bankSummary(g).cash, 0);
});
