// Saved data shape and upgrades between versions. No DOM here — easy to test.
//
// db = {
//   version: 2,
//   games:    [{ id, name, createdAt, ended, defaultBuyIn, float, players: [{ id, name }], transactions: [...] }],
//   roster:   [{ id, name, venmo }]   // regulars; a game player's id is their roster id
//   settings: { chips: [{ color, value }], keepAwake, lastBackupAt }
// }

export const VERSION = 2;

export const DEFAULT_CHIPS = [
  { color: '#f4f4f4', name: 'White', value: 100 },
  { color: '#d33b3b', name: 'Red', value: 500 },
  { color: '#2f6fd6', name: 'Blue', value: 1000 },
  { color: '#2f9e5a', name: 'Green', value: 2500 },
  { color: '#222222', name: 'Black', value: 10000 },
];

export function emptyDb() {
  return {
    version: VERSION,
    games: [],
    roster: [],
    settings: { chips: DEFAULT_CHIPS.map((c) => ({ ...c })), keepAwake: true, lastBackupAt: null },
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Find a regular by name (case-insensitive), creating them if new.
export function rosterFor(db, name) {
  const key = name.trim().toLowerCase();
  let entry = db.roster.find((r) => r.name.toLowerCase() === key);
  if (!entry) {
    entry = { id: uid(), name: name.trim(), venmo: '' };
    db.roster.push(entry);
  }
  return entry;
}

// Bring any saved data up to the current shape. Never throws on junk input.
export function migrate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.games)) return emptyDb();
  const db = { ...emptyDb(), ...data };
  db.settings = { ...emptyDb().settings, ...(data.settings || {}) };
  db.roster = Array.isArray(data.roster) ? data.roster : [];

  if (!data.version || data.version < 2) {
    // v1 gave each player a fresh id per game. Link them to one roster entry by name
    // so lifetime stats work across games.
    for (const game of db.games) {
      const remap = {};
      for (const p of game.players) {
        const entry = rosterFor(db, p.name);
        remap[p.id] = entry.id;
        p.id = entry.id;
      }
      for (const t of game.transactions) {
        if (remap[t.playerId]) t.playerId = remap[t.playerId];
      }
    }
  }

  for (const game of db.games) {
    if (typeof game.float !== 'number') game.float = 0;
  }
  db.version = VERSION;
  return db;
}

// Add games and regulars from a backup that aren't already here. Returns counts.
export function mergeBackup(db, incoming) {
  const other = migrate(incoming);
  let games = 0;
  let players = 0;
  // Same person saved under a different id on another phone → use the id we already have.
  const idMap = {};
  for (const r of other.roster) {
    const existing =
      db.roster.find((x) => x.id === r.id) || db.roster.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
    if (existing) {
      idMap[r.id] = existing.id;
      if (!existing.venmo && r.venmo) existing.venmo = r.venmo;
    } else {
      db.roster.push(r);
      players++;
    }
  }
  for (const g of other.games) {
    if (db.games.some((x) => x.id === g.id)) continue;
    for (const p of g.players) p.id = idMap[p.id] || p.id;
    for (const t of g.transactions) t.playerId = idMap[t.playerId] || t.playerId;
    db.games.push(g);
    games++;
  }
  return { games, players };
}
