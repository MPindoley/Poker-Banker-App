import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, mergeBackup, rosterFor, emptyDb, VERSION } from '../js/store.js';

const v1 = () => ({
  games: [
    {
      id: 'g1',
      name: 'Night 1',
      players: [{ id: 'x1', name: 'Mike' }, { id: 'x2', name: 'Sam' }],
      transactions: [
        { type: 'buyin', playerId: 'x1', amount: 2000, method: 'cash' },
        { type: 'buyin', playerId: 'x2', amount: 2000, method: 'cash' },
      ],
    },
    {
      id: 'g2',
      name: 'Night 2',
      players: [{ id: 'y1', name: 'mike' }],
      transactions: [{ type: 'buyin', playerId: 'y1', amount: 2000, method: 'cash' }],
    },
  ],
});

test('junk input becomes an empty db', () => {
  assert.deepEqual(migrate(null), emptyDb());
  assert.deepEqual(migrate({ foo: 1 }), emptyDb());
});

test('v1 players are linked to one regular across games by name', () => {
  const db = migrate(v1());
  assert.equal(db.version, VERSION);
  assert.equal(db.roster.length, 2);
  const mike = db.roster.find((r) => r.name === 'Mike');
  assert.equal(db.games[0].players[0].id, mike.id);
  assert.equal(db.games[1].players[0].id, mike.id);
  assert.equal(db.games[1].transactions[0].playerId, mike.id);
  assert.equal(db.games[0].float, 0);
  assert.ok(db.settings.chips.length > 0);
});

test('migrate is idempotent', () => {
  const once = migrate(v1());
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test('rosterFor reuses names case-insensitively', () => {
  const db = emptyDb();
  const a = rosterFor(db, 'Jess ');
  const b = rosterFor(db, 'jess');
  assert.equal(a, b);
  assert.equal(a.name, 'Jess');
});

test('mergeBackup adds only new games and maps same-name players to existing ids', () => {
  const db = migrate(v1());
  const other = migrate(v1()); // same people and games, but fresh roster ids
  other.games.push({
    id: 'g3',
    name: 'Night 3',
    players: [{ id: other.roster[0].id, name: 'Mike' }, { id: 'new', name: 'Tony' }],
    transactions: [{ type: 'buyin', playerId: other.roster[0].id, amount: 500, method: 'cash' }],
  });
  other.roster.push({ id: 'new', name: 'Tony', venmo: 'tony-v' });

  const res = mergeBackup(db, other);
  assert.deepEqual(res, { games: 1, players: 1 });
  const mikeId = db.roster.find((r) => r.name === 'Mike').id;
  const g3 = db.games.find((g) => g.id === 'g3');
  assert.equal(g3.players[0].id, mikeId);
  assert.equal(g3.transactions[0].playerId, mikeId);
  assert.equal(db.roster.find((r) => r.name === 'Tony').venmo, 'tony-v');
});
