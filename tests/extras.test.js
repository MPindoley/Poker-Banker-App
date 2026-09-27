import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifetimeStats, outstandingIous, chipTotal, standings } from '../js/ledger.js';
import { venmoUrl, cleanHandle } from '../js/venmo.js';

const g = (id, transactions) => ({
  id,
  players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  transactions,
});

test('lifetime stats only count finished nights', () => {
  const games = [
    g('1', [
      { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
      { type: 'buyin', playerId: 'b', amount: 2000, method: 'iou' },
      { type: 'cashout', playerId: 'a', amount: 3000, iouOffset: 0, method: 'cash' },
      { type: 'cashout', playerId: 'b', amount: 1000, iouOffset: 1000, method: 'cash' },
    ]),
    g('2', [
      { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
      { type: 'cashout', playerId: 'a', amount: 500, iouOffset: 0, method: 'cash' },
      { type: 'buyin', playerId: 'b', amount: 2000, method: 'cash' }, // still playing
    ]),
  ];
  const s = lifetimeStats(games);
  assert.deepEqual(
    { games: s.a.games, finished: s.a.finished, wins: s.a.wins, net: s.a.net, best: s.a.best, worst: s.a.worst },
    { games: 2, finished: 2, wins: 1, net: -500, best: 1000, worst: -1500 }
  );
  assert.equal(s.b.games, 2);
  assert.equal(s.b.finished, 1);
  assert.equal(s.b.net, -1000);
  assert.equal(s.b.iouOwed, 1000);

  const ious = outstandingIous(games);
  assert.equal(ious.length, 1);
  assert.equal(ious[0].player.id, 'b');
  assert.equal(ious[0].amount, 1000);
});

test('standings put finished players first', () => {
  const rows = standings(
    g('x', [
      { type: 'buyin', playerId: 'a', amount: 2000, method: 'cash' },
      { type: 'buyin', playerId: 'b', amount: 2000, method: 'cash' },
      { type: 'cashout', playerId: 'b', amount: 100, iouOffset: 0, method: 'cash' },
    ])
  );
  assert.deepEqual(rows.map((r) => [r.player.id, r.out]), [['b', true], ['a', false]]);
});

test('chipTotal', () => {
  const chips = [{ value: 25 }, { value: 100 }, { value: 500 }];
  assert.equal(chipTotal(chips, ['4', 3, '']), 400);
  assert.equal(chipTotal(chips, []), 0);
});

test('venmo links', () => {
  assert.equal(cleanHandle(' @Mike-Smith_1 '), 'Mike-Smith_1');
  const url = new URL(venmoUrl({ handle: '@mike', cents: 1550, note: 'Poker - Fri', kind: 'charge' }));
  assert.equal(url.origin, 'https://venmo.com');
  assert.equal(url.searchParams.get('txn'), 'charge');
  assert.equal(url.searchParams.get('recipients'), 'mike');
  assert.equal(url.searchParams.get('amount'), '15.50');
  assert.equal(url.searchParams.get('note'), 'Poker - Fri');
});
