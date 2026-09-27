import {
  METHODS,
  toCents,
  formatMoney as money,
  playerStats,
  bankSummary,
  planCashOut,
  standings,
  isOut,
  outstandingIous,
  lifetimeStats,
  chipTotal,
} from './ledger.js';
import { migrate, emptyDb, rosterFor, mergeBackup, uid } from './store.js';
import { venmoUrl, cleanHandle } from './venmo.js';

const STORAGE_KEY = 'poker-banker:v1';
const BACKUP_NAG_DAYS = 14;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- storage ----------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {}
  return emptyDb();
}

let db = load();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    toast('Could not save — storage is full or blocked');
  }
}
save();

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const regular = (id) => db.roster.find((r) => r.id === id);
const handleOf = (id) => regular(id)?.venmo || '';
const buzz = () => navigator.vibrate?.(12);

// ---------- routing ----------

let route = { screen: 'home', tab: 'games' };
function go(next) {
  route = next;
  render();
  window.scrollTo(0, 0);
}

const currentGame = () => db.games.find((g) => g.id === route.id);

const TABS = {
  home: [
    ['games', 'Games'],
    ['players', 'Regulars'],
    ['settings', 'Settings'],
  ],
  game: [
    ['players', 'Table'],
    ['log', 'Log'],
    ['settle', 'Settle'],
  ],
};

// ---------- rendering ----------

function render() {
  const game = route.screen === 'game' ? currentGame() : null;
  if (route.screen === 'game' && !game) return go({ screen: 'home', tab: 'games' });

  $('#back-btn').hidden = !game;
  $('#menu-btn').hidden = !game;
  $('#title').textContent = game ? game.name : 'Poker Banker';
  $('#tabs').innerHTML = TABS[route.screen]
    .map(([id, label]) => `<button data-tab="${id}" class="${route.tab === id ? 'active' : ''}">${label}</button>`)
    .join('');
  $$('#tabs button').forEach((b) => (b.onclick = () => go({ ...route, tab: b.dataset.tab })));

  syncWakeLock(game);

  if (!game) {
    if (route.tab === 'players') return renderRegulars();
    if (route.tab === 'settings') return renderSettings();
    return renderGames();
  }
  if (route.tab === 'log') renderLog(game);
  else if (route.tab === 'settle') renderSettle(game);
  else renderTable(game);
}

// ----- home: games -----

function renderGames() {
  const games = [...db.games].sort((a, b) => a.ended - b.ended || b.createdAt - a.createdAt);
  const ious = outstandingIous(db.games);
  const lastBackup = db.settings.lastBackupAt;
  const needsBackup =
    db.games.some((g) => g.ended) && (!lastBackup || Date.now() - lastBackup > BACKUP_NAG_DAYS * 864e5);

  $('#view').innerHTML = `
    <button class="btn primary block" id="new-game">+ New game</button>

    ${
      needsBackup
        ? `<div class="card notice" id="backup-nag">
            <b>Back up your games</b>
            <div class="muted">Everything lives on this phone only. ${lastBackup ? `Last backup ${new Date(lastBackup).toLocaleDateString()}.` : 'No backup yet.'}</div>
          </div>`
        : ''
    }

    ${
      ious.length
        ? `<h2>Owed to the bank</h2>
          <div class="card">${ious.map((i) => iouRow(i.game, i.player, i.amount, true)).join('')}</div>`
        : ''
    }

    <h2>Games</h2>
    ${
      games.length
        ? games
            .map((g) => {
              const b = bankSummary(g);
              return `
          <div class="card game-item" data-open="${g.id}">
            <div class="info">
              <div class="name"><b>${esc(g.name)}</b>${g.ended ? '<span class="badge out">Ended</span>' : '<span class="badge live">Live</span>'}</div>
              <div class="muted small">
                ${new Date(g.createdAt).toLocaleDateString()} · ${g.players.length} players · ${money(b.totalBuyIns)} bought in
              </div>
            </div>
            <div class="num gold">${g.ended ? '' : money(b.onTable)}</div>
          </div>`;
            })
            .join('')
        : `<div class="empty">No games yet.<br>Start one when the cards come out.</div>`
    }`;

  $('#new-game').onclick = newGameModal;
  const nag = $('#backup-nag');
  if (nag) nag.onclick = () => go({ screen: 'home', tab: 'settings' });
  $$('[data-open]').forEach((el) => (el.onclick = () => go({ screen: 'game', id: el.dataset.open, tab: 'players' })));
  wireIouRows();
}

function iouRow(game, player, amount, showGame) {
  const handle = handleOf(player.id);
  return `
    <div class="log-item">
      <div class="what">
        <b>${esc(player.name)}</b> owes <b class="num lose">${money(amount)}</b>
        ${showGame ? `<div class="time">${esc(game.name)}</div>` : ''}
      </div>
      ${handle ? `<a class="btn small" href="${esc(venmoUrl({ handle, cents: amount, note: `Poker IOU - ${game.name}`, kind: 'charge' }))}" target="_blank" rel="noopener">Request</a>` : ''}
      <button type="button" class="btn small green" data-repay="${player.id}" data-game="${game.id}">Paid</button>
    </div>`;
}

function wireIouRows() {
  $$('[data-repay]').forEach((btn) => {
    btn.onclick = () => {
      const game = db.games.find((g) => g.id === btn.dataset.game);
      repayModal(game, game.players.find((p) => p.id === btn.dataset.repay));
    };
  });
}

// ----- home: regulars -----

function renderRegulars() {
  const stats = lifetimeStats(db.games);
  const blank = { games: 0, finished: 0, wins: 0, net: 0, best: 0, iouOwed: 0 };
  const rows = db.roster
    .map((r) => ({ r, s: stats[r.id] || blank }))
    .sort((a, b) => b.s.net - a.s.net || b.s.games - a.s.games || a.r.name.localeCompare(b.r.name));

  $('#view').innerHTML = `
    <div class="add-player">
      <input type="text" id="new-regular" placeholder="Add a regular" autocomplete="off" enterkeyhint="done" />
      <button class="btn green" id="add-regular">Add</button>
    </div>
    <h2>Leaderboard</h2>
    ${
      rows.length
        ? rows
            .map(
              ({ r, s }, i) => `
        <div class="card player" data-regular="${r.id}">
          <div class="rank">${s.finished ? i + 1 : '–'}</div>
          <div class="info">
            <div class="name">${esc(r.name)}${s.iouOwed > 0 ? `<span class="badge iou">Owes ${money(s.iouOwed)}</span>` : ''}</div>
            <div class="meta">${r.venmo ? `@${esc(r.venmo)} · ` : ''}${s.games} game${s.games === 1 ? '' : 's'}${
              s.finished ? ` · up ${s.wins} of ${s.finished}${s.best > 0 ? ` · best ${money(s.best, { sign: true })}` : ''}` : ''
            }</div>
          </div>
          <div class="num big ${s.net > 0 ? 'win' : s.net < 0 ? 'lose' : 'muted'}">${money(s.net, { sign: true })}</div>
        </div>`
            )
            .join('')
        : `<div class="empty">Your regulars show up here after their first game,<br>or add them now with their Venmo.</div>`
    }`;

  const input = $('#new-regular');
  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    const r = rosterFor(db, name);
    save();
    render();
    regularModal(r);
  };
  $('#add-regular').onclick = add;
  input.onkeydown = (e) => e.key === 'Enter' && add();
  $$('[data-regular]').forEach((el) => (el.onclick = () => regularModal(regular(el.dataset.regular))));
}

function regularModal(r) {
  const inGames = db.games.some((g) => g.players.some((p) => p.id === r.id));
  openModal(
    `<h3>${esc(r.name)}</h3>
    <label class="field">Name</label>
    <input type="text" id="r-name" value="${esc(r.name)}" />
    <label class="field">Venmo username</label>
    <input type="text" id="r-venmo" value="${esc(r.venmo)}" placeholder="@username" autocapitalize="off" autocorrect="off" />
    <div class="hint">Used for one-tap Venmo payouts and IOU requests.</div>
    ${inGames ? '' : `<button class="btn danger block mt" id="r-remove">Remove regular</button>`}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="r-save">Save</button>
    </div>`,
    () => {
      $('#r-save').onclick = (e) => {
        e.preventDefault();
        updateRegular(r, $('#r-name').value, $('#r-venmo').value);
        modal.close();
        render();
      };
      $('#r-remove')?.addEventListener('click', (e) => {
        e.preventDefault();
        db.roster = db.roster.filter((x) => x.id !== r.id);
        save();
        modal.close();
        render();
      });
    }
  );
}

function updateRegular(r, name, venmo) {
  name = name.trim();
  if (name && name !== r.name) {
    r.name = name;
    for (const g of db.games) for (const p of g.players) if (p.id === r.id) p.name = name;
  }
  if (venmo !== undefined) r.venmo = cleanHandle(venmo);
  save();
}

// ----- home: settings -----

function renderSettings() {
  const chips = db.settings.chips;
  const last = db.settings.lastBackupAt;
  $('#view').innerHTML = `
    <h2>Chip values</h2>
    <div class="card">
      <div class="muted small">Used to count stacks by color at cash-out.</div>
      <div id="chip-rows">
        ${chips
          .map(
            (c, i) => `
          <div class="chip-edit">
            <input type="color" value="${esc(c.color)}" data-chip-color="${i}" aria-label="Chip color" />
            <input type="text" value="${esc(c.name)}" data-chip-name="${i}" aria-label="Chip name" />
            <input type="text" inputmode="decimal" value="${c.value / 100}" data-chip-value="${i}" aria-label="Chip value" />
            <button type="button" class="del" data-chip-del="${i}" aria-label="Remove chip">✕</button>
          </div>`
          )
          .join('')}
      </div>
      <button class="btn small mt" id="chip-add">+ Add chip</button>
    </div>

    <h2>At the table</h2>
    <div class="card">
      <label class="toggle"><input type="checkbox" id="keep-awake" ${db.settings.keepAwake ? 'checked' : ''} /> Keep screen on during a live game</label>
    </div>

    <h2>Backup</h2>
    <div class="card">
      <div class="muted small">All games live on this phone. Save a backup file to iCloud/Google Drive or text it to yourself. Importing adds any games you don't already have.</div>
      <div class="muted small mt">Last backup: ${last ? new Date(last).toLocaleString() : 'never'}</div>
      <div class="row mt">
        <button class="btn primary" id="export">Save backup</button>
        <button class="btn" id="import">Import</button>
      </div>
    </div>

    <p class="muted small center">${db.games.length} games · ${db.roster.length} regulars</p>
  `;

  const saveChips = () => {
    save();
  };
  $$('[data-chip-color]').forEach((el) => (el.oninput = () => ((chips[el.dataset.chipColor].color = el.value), saveChips())));
  $$('[data-chip-name]').forEach((el) => (el.oninput = () => ((chips[el.dataset.chipName].name = el.value), saveChips())));
  $$('[data-chip-value]').forEach(
    (el) => (el.oninput = () => ((chips[el.dataset.chipValue].value = toCents(el.value)), saveChips()))
  );
  $$('[data-chip-del]').forEach(
    (el) => (el.onclick = () => (chips.splice(Number(el.dataset.chipDel), 1), saveChips(), render()))
  );
  $('#chip-add').onclick = () => {
    chips.push({ color: '#8a5cd6', name: 'Purple', value: 50000 });
    saveChips();
    render();
  };
  $('#keep-awake').onchange = (e) => {
    db.settings.keepAwake = e.target.checked;
    save();
  };
  $('#export').onclick = exportBackup;
  $('#import').onclick = () => $('#import-file').click();
}

async function exportBackup() {
  const date = new Date().toISOString().slice(0, 10);
  const name = `poker-banker-backup-${date}.json`;
  const json = JSON.stringify({ ...db, exportedAt: Date.now() }, null, 1);
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Poker Banker backup' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    return toast('Backup failed');
  }
  db.settings.lastBackupAt = Date.now();
  save();
  render();
  toast('Backup saved');
}

$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { games, players } = mergeBackup(db, JSON.parse(await file.text()));
    save();
    render();
    toast(`Added ${games} game${games === 1 ? '' : 's'} and ${players} regular${players === 1 ? '' : 's'}`);
  } catch {
    toast("That file isn't a Poker Banker backup");
  }
};

// ----- game: table -----

function bankCard(game) {
  const b = bankSummary(game);
  const active = game.players.filter((p) => !isOut(game, p.id)).length;
  return `
    <div class="card pot">
      <div class="label">On the table</div>
      <div class="amount">${money(b.onTable)}</div>
      <div class="sub">${active} playing · ${money(b.totalBuyIns)} in · ${money(b.totalCashOuts)} out</div>
      <div class="bank-grid">
        <div><b>${money(game.float + b.cash)}</b><span>Cash in hand${game.float ? `<br>incl. ${money(game.float)} float` : ''}</span></div>
        <div><b>${money(b.digital)}</b><span>Venmo / App</span></div>
        <div><b class="${b.iouOutstanding ? 'lose' : ''}">${money(b.iouOutstanding)}</b><span>IOUs owed</span></div>
      </div>
      ${
        b.balanced
          ? `<div class="balance-ok">✓ Bank balances with chips on the table</div>`
          : `<div class="balance-bad">⚠ Bank is off by ${money(b.held - b.onTable)}</div>`
      }
    </div>`;
}

function renderTable(game) {
  // Players still at the table first (in seat order), then those who left.
  const byId = Object.fromEntries(standings(game).map((r) => [r.player.id, r]));
  const players = game.players.map((p) => byId[p.id]).sort((a, b) => a.out - b.out);
  const inGame = new Set(game.players.map((p) => p.id));
  const stats = lifetimeStats(db.games);
  const suggestions = db.roster
    .filter((r) => !inGame.has(r.id))
    .sort((a, b) => (stats[b.id]?.games || 0) - (stats[a.id]?.games || 0) || a.name.localeCompare(b.name));

  $('#view').innerHTML = `
    ${bankCard(game)}
    ${game.ended ? `<div class="card muted">This game has ended. Reopen it from the ⋮ menu to make changes.</div>` : ''}
    <h2>Players</h2>
    ${
      game.ended
        ? ''
        : `<div class="add-player">
            <input type="text" id="new-player" placeholder="Add player name" autocomplete="off" enterkeyhint="done" />
            <button class="btn green" id="add-player">Add</button>
          </div>
          ${
            suggestions.length
              ? `<div class="quick-add">${suggestions
                  .map((r) => `<button type="button" data-quick="${r.id}">+ ${esc(r.name)}</button>`)
                  .join('')}</div>`
              : ''
          }`
    }
    ${players.length ? players.map((row) => playerRow(game, row)).join('') : `<div class="empty">Add everyone at the table to get started.</div>`}
  `;

  const addPlayer = (entry) => {
    if (inGame.has(entry.id)) return toast(`${entry.name} is already in this game`);
    const player = { id: entry.id, name: entry.name };
    game.players.push(player);
    save();
    render();
    buyInModal(game, player);
  };

  const input = $('#new-player');
  if (input) {
    const add = () => {
      const name = input.value.trim();
      if (name) addPlayer(rosterFor(db, name));
    };
    $('#add-player').onclick = add;
    input.onkeydown = (e) => e.key === 'Enter' && add();
  }
  $$('[data-quick]').forEach((b) => (b.onclick = () => addPlayer(regular(b.dataset.quick))));
  $$('[data-buyin]').forEach((b) => (b.onclick = () => buyInModal(game, findPlayer(game, b.dataset.buyin))));
  $$('[data-cashout]').forEach((b) => (b.onclick = () => cashOutModal(game, findPlayer(game, b.dataset.cashout))));
  $$('[data-player]').forEach((el) => (el.onclick = () => playerModal(game, findPlayer(game, el.dataset.player))));
}

const findPlayer = (game, id) => game.players.find((p) => p.id === id);

function playerRow(game, s) {
  const p = s.player;
  const meta = s.out
    ? `In ${money(s.buyIn)} · Out ${money(s.cashOut)} · <span class="${s.net >= 0 ? 'win' : 'lose'}">${money(s.net, { sign: true })}</span>`
    : `In ${money(s.buyIn)} (${s.buyIns} buy-in${s.buyIns === 1 ? '' : 's'})`;
  return `
    <div class="card player ${s.out ? 'out' : ''}">
      <div class="info" data-player="${p.id}">
        <div class="name">${esc(p.name)}${s.out ? '<span class="badge out">Left</span>' : ''}${
          s.iouOwed > 0 ? `<span class="badge iou">Owes ${money(s.iouOwed)}</span>` : ''
        }</div>
        <div class="meta num">${meta}</div>
      </div>
      ${
        game.ended
          ? ''
          : `<div class="actions">
              <button class="btn small green" data-buyin="${p.id}">${s.out ? 'Rejoin' : '+ Buy'}</button>
              ${s.out ? '' : `<button class="btn small" data-cashout="${p.id}">Cash out</button>`}
            </div>`
      }
    </div>`;
}

// ----- game: log -----

function describe(game, t) {
  const p = findPlayer(game, t.playerId);
  const name = `<b>${esc(p ? p.name : 'Removed player')}</b>`;
  if (t.type === 'buyin') return `${name} bought in <b class="num">${money(t.amount)}</b> · ${METHODS[t.method]}`;
  if (t.type === 'repay') return `${name} repaid IOU <b class="num">${money(t.amount)}</b> · ${METHODS[t.method]}`;
  const offset = t.iouOffset ? ` (${money(t.iouOffset)} to IOU)` : '';
  return `${name} cashed out <b class="num">${money(t.amount)}</b>${offset} · paid ${money(t.amount - (t.iouOffset || 0))} ${METHODS[t.method]}`;
}

function renderLog(game) {
  const items = [...game.transactions].reverse();
  $('#view').innerHTML = `
    <h2>Every transaction</h2>
    ${
      items.length
        ? `<div class="card">${items
            .map(
              (t) => `
          <div class="log-item">
            <div class="what">
              <div>${describe(game, t)}</div>
              <div class="time">${new Date(t.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
            ${game.ended ? '' : `<button class="del" data-del="${t.id}" aria-label="Delete">✕</button>`}
          </div>`
            )
            .join('')}</div>`
        : `<div class="empty">Nothing recorded yet.</div>`
    }`;

  $$('[data-del]').forEach((b) => {
    b.onclick = () => {
      const t = game.transactions.find((x) => x.id === b.dataset.del);
      confirmModal('Delete this entry?', describe(game, t), 'Delete', () => {
        game.transactions = game.transactions.filter((x) => x.id !== t.id);
        save();
        render();
        toast('Entry deleted');
      });
    };
  });
}

// ----- game: settle -----

function renderSettle(game) {
  const b = bankSummary(game);
  const rows = standings(game);
  const playing = rows.filter((r) => !r.out);
  const owing = rows.filter((r) => r.iouOwed > 0);
  const drawer = game.float + b.cash;

  $('#view').innerHTML = `
    ${bankCard(game)}

    ${
      playing.length && !game.ended
        ? `<button class="btn primary block" id="cash-out-all">Cash out remaining ${playing.length} player${playing.length === 1 ? '' : 's'}</button>`
        : ''
    }

    <h2>Count the cash</h2>
    <div class="card">
      <div class="muted small">You should be holding <b class="gold">${money(drawer)}</b> in cash${
        game.float ? ` (${money(b.cash)} from the game + ${money(game.float)} float)` : ''
      }.</div>
      <input type="text" inputmode="decimal" id="cash-count" class="mt" placeholder="Cash counted $" />
      <div id="cash-result" class="mt"></div>
      <div class="muted small mt">${
        b.digital >= 0
          ? `Venmo / App: you should have received <b>${money(b.digital)}</b> net.`
          : `Venmo / App: you've sent <b>${money(-b.digital)}</b> more than you received.`
      }</div>
    </div>

    <h2>Count the chips</h2>
    <div class="card">
      <div class="muted small">Chips still on the table should total <b class="gold">${money(b.onTable)}</b>.</div>
      <input type="text" inputmode="decimal" id="chip-count" class="mt" placeholder="Chips counted $" />
      ${chipCounterHtml('settle')}
      <div id="chip-result" class="mt"></div>
    </div>

    <h2>Standings</h2>
    <div class="card">
      ${
        rows.length
          ? `<table>
        <tr><th>Player</th><th>In</th><th>Out</th><th>Net</th></tr>
        ${rows
          .map(
            (r) => `<tr>
              <td>${esc(r.player.name)}</td>
              <td>${money(r.buyIn)}</td>
              <td>${r.out ? money(r.cashOut) : '<span class="muted">playing</span>'}</td>
              <td class="${r.out ? (r.net >= 0 ? 'win' : 'lose') : 'muted'}">${r.out ? money(r.net, { sign: true }) : '—'}</td>
            </tr>`
          )
          .join('')}
      </table>`
          : `<div class="empty">No players yet.</div>`
      }
    </div>

    ${
      owing.length
        ? `<h2>IOUs outstanding</h2>
      <div class="card">${owing.map((r) => iouRow(game, r.player, r.iouOwed, false)).join('')}</div>`
        : ''
    }

    <div class="row mt">
      <button class="btn" id="share">Share summary</button>
      <button class="btn ${game.ended ? '' : 'primary'}" id="end">${game.ended ? 'Reopen game' : 'End game'}</button>
    </div>
  `;

  const check = (value, expected, el, noun) => {
    if (value === null) return (el.innerHTML = '');
    const diff = value - expected;
    el.innerHTML =
      diff === 0
        ? `<span class="win">✓ Perfect — ${noun} matches.</span>`
        : `<span class="lose">${diff > 0 ? 'Extra' : 'Short'} ${money(Math.abs(diff))} in ${noun}.</span>`;
  };
  $('#cash-count').oninput = (e) =>
    check(e.target.value.trim() ? toCents(e.target.value) : null, drawer, $('#cash-result'), 'cash');
  const chipInput = $('#chip-count');
  chipInput.oninput = () =>
    check(chipInput.value.trim() ? toCents(chipInput.value) : null, b.onTable, $('#chip-result'), 'chips');
  wireChipCounter('settle', (total) => {
    chipInput.value = total / 100;
    chipInput.oninput();
  });

  $('#cash-out-all')?.addEventListener('click', () => cashOutRemaining(game));
  wireIouRows();
  $('#share').onclick = () => shareSummary(game);
  $('#end').onclick = () => toggleEnded(game);
}

function cashOutRemaining(game) {
  const queue = standings(game)
    .filter((r) => !r.out)
    .map((r) => r.player);
  const total = queue.length;
  const next = () => {
    const player = queue.shift();
    if (!player) {
      go({ ...route, tab: 'settle' });
      return toast('Everyone is cashed out');
    }
    cashOutModal(game, player, { step: `${total - queue.length} of ${total}`, onDone: next });
  };
  next();
}

// ---------- chip counter ----------

function chipCounterHtml(key) {
  const chips = db.settings.chips.filter((c) => c.value > 0);
  if (!chips.length) return '';
  return `
    <details class="chip-counter" data-counter="${key}">
      <summary>Count by chip color</summary>
      ${chips
        .map(
          (c, i) => `
        <div class="chip-line">
          <span class="swatch" style="background:${esc(c.color)}"></span>
          <span class="chip-label">${esc(c.name)} <span class="muted">${money(c.value)}</span></span>
          <button type="button" data-step="-1" data-i="${i}">−</button>
          <input type="number" inputmode="numeric" min="0" value="" placeholder="0" data-count="${i}" aria-label="${esc(c.name)} chips" />
          <button type="button" data-step="1" data-i="${i}">+</button>
        </div>`
        )
        .join('')}
    </details>`;
}

function wireChipCounter(key, onTotal) {
  const root = $(`[data-counter="${key}"]`);
  if (!root) return;
  const chips = db.settings.chips.filter((c) => c.value > 0);
  const inputs = $$('[data-count]', root);
  const update = () => onTotal(chipTotal(chips, inputs.map((i) => i.value)));
  inputs.forEach((i) => (i.oninput = update));
  $$('[data-step]', root).forEach((b) => {
    b.onclick = () => {
      const input = inputs[Number(b.dataset.i)];
      input.value = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
      update();
    };
  });
}

// ---------- actions ----------

let lastAdded = null;
function record(game, tx, message) {
  const full = { id: uid(), at: Date.now(), ...tx };
  game.transactions.push(full);
  lastAdded = full.id;
  save();
  buzz();
  render();
  toast(message, () => {
    if (lastAdded !== full.id) return;
    game.transactions = game.transactions.filter((t) => t.id !== full.id);
    lastAdded = null;
    save();
    render();
    toast('Undone');
  });
}

function toggleEnded(game) {
  if (game.ended) {
    game.ended = false;
    save();
    render();
    return;
  }
  const b = bankSummary(game);
  const warn = [];
  const playing = game.players.filter((p) => !isOut(game, p.id)).length;
  if (playing) warn.push(`${playing} player${playing === 1 ? ' has' : 's have'} not cashed out.`);
  if (b.onTable) warn.push(`${money(b.onTable)} is still on the table.`);
  if (b.iouOutstanding) warn.push(`${money(b.iouOutstanding)} in IOUs is unpaid — it stays on the home screen until paid.`);
  confirmModal('End this game?', warn.join('<br>') || 'Everything is settled. Nice banking.', 'End game', () => {
    game.ended = true;
    save();
    render();
  });
}

function summaryText(game) {
  const b = bankSummary(game);
  const lines = [`${game.name} — ${new Date(game.createdAt).toLocaleDateString()}`, ''];
  for (const r of standings(game)) {
    lines.push(
      `${r.player.name}: ${r.out ? money(r.net, { sign: true }) : 'still playing'} (in ${money(r.buyIn)}${r.out ? `, out ${money(r.cashOut)}` : ''})` +
        (r.iouOwed > 0 ? ` — owes ${money(r.iouOwed)}` : '')
    );
  }
  lines.push('', `Total bought in: ${money(b.totalBuyIns)}`);
  if (b.onTable) lines.push(`Still on table: ${money(b.onTable)}`);
  return lines.join('\n');
}

async function shareSummary(game) {
  const text = summaryText(game);
  try {
    if (navigator.share) {
      await navigator.share({ title: game.name, text });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied');
  } catch {
    confirmModal('Summary', `<pre class="pre">${esc(text)}</pre>`, 'Done', () => {});
  }
}

// ---------- wake lock ----------

let wakeLock = null;
async function syncWakeLock(game) {
  const want = !!(game && !game.ended && db.settings.keepAwake && document.visibilityState === 'visible');
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } catch {}
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => syncWakeLock(route.screen === 'game' ? currentGame() : null));

// ---------- modals ----------

const modal = $('#modal');
const body = $('#modal-body');

function openModal(html, wire) {
  body.innerHTML = html;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  wire?.();
  body.querySelector('[data-cancel]')?.addEventListener('click', (e) => {
    e.preventDefault();
    modal.close();
  });
}

function chipGroup(name, options, selected) {
  return `<div class="chips" data-group="${name}">${options
    .map(([value, label]) => `<button type="button" data-value="${value}" class="${value === selected ? 'selected' : ''}">${label}</button>`)
    .join('')}</div>`;
}

function wireChips(name, onChange) {
  const group = body.querySelector(`[data-group="${name}"]`);
  let value = group.querySelector('.selected')?.dataset.value;
  group.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      group.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      value = btn.dataset.value;
      onChange?.(value);
    };
  });
  return () => value;
}

function newGameModal() {
  const defaultName = `Poker night ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const lastGame = [...db.games].sort((a, b) => b.createdAt - a.createdAt)[0];
  openModal(
    `<h3>New game</h3>
    <label class="field">Name</label>
    <input type="text" id="g-name" value="${esc(defaultName)}" />
    <label class="field">Standard buy-in</label>
    <input type="text" inputmode="decimal" id="g-buyin" value="${lastGame ? lastGame.defaultBuyIn / 100 : 20}" />
    <label class="field">Starting cash for making change (optional)</label>
    <input type="text" inputmode="decimal" id="g-float" placeholder="$0" />
    <div class="hint">Cash you bring from your own pocket. It's kept separate so the drawer count still works.</div>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="g-go">Start game</button>
    </div>`,
    () => {
      $('#g-go').onclick = (e) => {
        e.preventDefault();
        const game = {
          id: uid(),
          name: $('#g-name').value.trim() || defaultName,
          defaultBuyIn: toCents($('#g-buyin').value) || 2000,
          float: Math.max(0, toCents($('#g-float').value)),
          createdAt: Date.now(),
          ended: false,
          players: [],
          transactions: [],
        };
        db.games.push(game);
        save();
        modal.close();
        go({ screen: 'game', id: game.id, tab: 'players' });
        setTimeout(() => $('#new-player')?.focus(), 50);
      };
    }
  );
}

function amountOptions(game) {
  const d = game.defaultBuyIn;
  return [...new Set([Math.round(d / 2), d, d * 2])].filter((v) => v > 0).map((v) => [String(v), money(v)]);
}

function buyInModal(game, player) {
  const s = playerStats(game, player.id);
  openModal(
    `<h3>${esc(player.name)} ${s.buyIns ? 'rebuys' : 'buys in'}</h3>
    <div class="muted">${s.buyIns ? `Already in for ${money(s.buyIn)}` : 'First buy-in'}${
      s.iouOwed > 0 ? ` · <span class="lose">owes ${money(s.iouOwed)}</span>` : ''
    }</div>
    <label class="field">Amount</label>
    ${chipGroup('amount', amountOptions(game), String(game.defaultBuyIn))}
    <input type="text" inputmode="decimal" id="b-custom" placeholder="Other amount" class="mt-s" />
    <label class="field">Paid with</label>
    ${chipGroup('method', Object.entries(METHODS), 'cash')}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="b-go">Record buy-in</button>
    </div>`,
    () => {
      const getAmount = wireChips('amount', () => ($('#b-custom').value = ''));
      const getMethod = wireChips('method');
      $('#b-custom').oninput = () => $$('[data-group="amount"] button', body).forEach((b) => b.classList.remove('selected'));
      $('#b-go').onclick = (e) => {
        e.preventDefault();
        const custom = $('#b-custom').value.trim();
        const amount = custom ? toCents(custom) : Number(getAmount());
        if (!(amount > 0)) return toast('Enter an amount');
        modal.close();
        record(game, { type: 'buyin', playerId: player.id, amount, method: getMethod() }, `${player.name} +${money(amount)}`);
      };
    }
  );
}

function cashOutModal(game, player, { step, onDone } = {}) {
  const s = playerStats(game, player.id);
  const b = bankSummary(game);
  const drawer = game.float + b.cash;
  const handle = handleOf(player.id);
  openModal(
    `<h3>${esc(player.name)} cashes out${step ? ` <span class="muted small">${step}</span>` : ''}</h3>
    <div class="muted">Bought in for ${money(s.buyIn)} · ${money(b.onTable)} on the table</div>
    <label class="field">Chips they're leaving with</label>
    <input type="text" inputmode="decimal" id="c-chips" placeholder="$0" />
    ${chipCounterHtml('cashout')}
    <label class="field">Pay them with</label>
    ${chipGroup('method', [['cash', METHODS.cash], ['digital', METHODS.digital]], 'cash')}
    <div id="c-venmo" hidden>
      <label class="field">Their Venmo (optional — opens Venmo with the amount filled in)</label>
      <input type="text" id="c-handle" value="${esc(handle)}" placeholder="@username" autocapitalize="off" autocorrect="off" />
    </div>
    <div class="calc" id="c-calc"></div>
    <div class="modal-actions">
      <button class="btn" data-cancel>${step ? 'Stop' : 'Cancel'}</button>
      <button class="btn primary" id="c-go">Cash out</button>
    </div>`,
    () => {
      const input = $('#c-chips');
      const update = () => {
        const method = getMethod();
        const chips = toCents(input.value);
        const plan = planCashOut(game, player.id, chips);
        const net = chips - s.buyIn;
        $('#c-venmo').hidden = method !== 'digital';
        const venmoReady = method === 'digital' && cleanHandle($('#c-handle').value) && plan.payout > 0;
        $('#c-go').textContent = venmoReady ? 'Cash out & open Venmo' : 'Cash out';
        $('#c-calc').innerHTML = `
          <div><span>Chips turned in</span><b class="num">${money(chips)}</b></div>
          ${plan.iouOffset ? `<div><span>Minus IOU owed</span><b class="num lose">-${money(plan.iouOffset)}</b></div>` : ''}
          <div class="total"><span>You pay them</span><span class="num">${money(plan.payout)}</span></div>
          ${plan.stillOwes > 0 ? `<div class="lose"><span>They still owe you</span><b class="num">${money(plan.stillOwes)}</b></div>` : ''}
          <div class="muted"><span>Night result</span><span class="num ${net >= 0 ? 'win' : 'lose'}">${money(net, { sign: true })}</span></div>
          ${chips > b.onTable ? `<div class="lose"><span>More than is on the table!</span></div>` : ''}
          ${
            method === 'cash' && plan.payout > drawer
              ? `<div class="warn"><span>You only have ${money(drawer)} cash — pay the rest by Venmo?</span></div>`
              : ''
          }`;
      };
      const getMethod = wireChips('method', update);
      input.oninput = update;
      $('#c-handle').oninput = update;
      wireChipCounter('cashout', (total) => {
        input.value = total / 100;
        update();
      });
      update();
      setTimeout(() => input.focus(), 50);
      $('#c-go').onclick = (e) => {
        e.preventDefault();
        const chips = toCents(input.value);
        if (chips < 0) return toast('Enter a valid amount');
        const method = getMethod();
        const plan = planCashOut(game, player.id, chips);
        const newHandle = cleanHandle($('#c-handle').value);
        if (method === 'digital' && newHandle !== handle && regular(player.id)) {
          updateRegular(regular(player.id), player.name, newHandle);
        }
        modal.close();
        record(
          game,
          { type: 'cashout', playerId: player.id, amount: chips, iouOffset: plan.iouOffset, method },
          `${player.name} out · pay ${money(plan.payout)}`
        );
        if (method === 'digital' && newHandle && plan.payout > 0) {
          window.open(venmoUrl({ handle: newHandle, cents: plan.payout, note: `Poker - ${game.name}` }), '_blank', 'noopener');
        }
        onDone?.();
      };
    }
  );
}

function repayModal(game, player) {
  const { iouOwed } = playerStats(game, player.id);
  openModal(
    `<h3>${esc(player.name)} pays back IOU</h3>
    <div class="muted">Owes ${money(iouOwed)} from ${esc(game.name)}</div>
    <label class="field">Amount</label>
    <input type="text" inputmode="decimal" id="r-amt" value="${iouOwed / 100}" />
    <label class="field">Paid with</label>
    ${chipGroup('method', [['cash', METHODS.cash], ['digital', METHODS.digital]], 'digital')}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="r-go">Record</button>
    </div>`,
    () => {
      const getMethod = wireChips('method');
      $('#r-go').onclick = (e) => {
        e.preventDefault();
        const amount = toCents($('#r-amt').value);
        if (!(amount > 0)) return toast('Enter an amount');
        if (amount > iouOwed) return toast(`They only owe ${money(iouOwed)}`);
        modal.close();
        record(game, { type: 'repay', playerId: player.id, amount, method: getMethod() }, `${player.name} repaid ${money(amount)}`);
      };
    }
  );
}

function playerModal(game, player) {
  const s = playerStats(game, player.id);
  const career = lifetimeStats(db.games)[player.id];
  const hasTx = game.transactions.some((t) => t.playerId === player.id);
  const r = regular(player.id);
  openModal(
    `<h3>${esc(player.name)}</h3>
    <div class="muted num">Tonight: in ${money(s.buyIn)} · out ${money(s.cashOut)}${s.iouOwed ? ` · owes ${money(s.iouOwed)}` : ''}</div>
    ${
      career?.finished
        ? `<div class="muted num">All-time: <span class="${career.net >= 0 ? 'win' : 'lose'}">${money(career.net, { sign: true })}</span> over ${career.finished} game${career.finished === 1 ? '' : 's'}</div>`
        : ''
    }
    <label class="field">Name</label>
    <input type="text" id="p-name" value="${esc(player.name)}" />
    <label class="field">Venmo username</label>
    <input type="text" id="p-venmo" value="${esc(r?.venmo || '')}" placeholder="@username" autocapitalize="off" autocorrect="off" />
    ${s.iouOwed > 0 ? `<button class="btn block mt" id="p-repay">Record IOU payment</button>` : ''}
    ${!hasTx && !game.ended ? `<button class="btn danger block mt" id="p-remove">Remove from this game</button>` : ''}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="p-save">Save</button>
    </div>`,
    () => {
      $('#p-save').onclick = (e) => {
        e.preventDefault();
        const name = $('#p-name').value.trim();
        if (r) updateRegular(r, name, $('#p-venmo').value);
        else if (name) player.name = name;
        save();
        modal.close();
        render();
      };
      $('#p-repay')?.addEventListener('click', (e) => {
        e.preventDefault();
        repayModal(game, player);
      });
      $('#p-remove')?.addEventListener('click', (e) => {
        e.preventDefault();
        game.players = game.players.filter((p) => p.id !== player.id);
        save();
        modal.close();
        render();
      });
    }
  );
}

function gameMenu(game) {
  openModal(
    `<h3>Game options</h3>
    <label class="field">Name</label>
    <input type="text" id="m-name" value="${esc(game.name)}" />
    <label class="field">Standard buy-in</label>
    <input type="text" inputmode="decimal" id="m-buyin" value="${game.defaultBuyIn / 100}" />
    <label class="field">Starting cash float</label>
    <input type="text" inputmode="decimal" id="m-float" value="${game.float / 100}" />
    <button class="btn block mt" id="m-share">Share summary</button>
    <button class="btn block mt-s" id="m-end">${game.ended ? 'Reopen game' : 'End game'}</button>
    <button class="btn danger block mt-s" id="m-delete">Delete game</button>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="m-save">Save</button>
    </div>`,
    () => {
      $('#m-save').onclick = (e) => {
        e.preventDefault();
        game.name = $('#m-name').value.trim() || game.name;
        game.defaultBuyIn = toCents($('#m-buyin').value) || game.defaultBuyIn;
        game.float = Math.max(0, toCents($('#m-float').value));
        save();
        modal.close();
        render();
      };
      $('#m-share').onclick = (e) => {
        e.preventDefault();
        modal.close();
        shareSummary(game);
      };
      $('#m-end').onclick = (e) => {
        e.preventDefault();
        modal.close();
        toggleEnded(game);
      };
      $('#m-delete').onclick = (e) => {
        e.preventDefault();
        confirmModal('Delete this game?', 'All players and transactions in it will be gone for good.', 'Delete', () => {
          db.games = db.games.filter((g) => g.id !== game.id);
          save();
          go({ screen: 'home', tab: 'games' });
        });
      };
    }
  );
}

function confirmModal(title, html, action, onConfirm) {
  openModal(
    `<h3>${esc(title)}</h3>
    <div class="muted mt-s">${html}</div>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="x-go">${esc(action)}</button>
    </div>`,
    () => {
      $('#x-go').onclick = (e) => {
        e.preventDefault();
        modal.close();
        onConfirm();
      };
    }
  );
}

// ---------- toast ----------

let toastTimer;
function toast(message, onUndo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${onUndo ? '<button type="button">Undo</button>' : ''}`;
  if (onUndo)
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      onUndo();
    };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), onUndo ? 5000 : 2200);
}

// ---------- wiring ----------

$('#back-btn').onclick = () => go({ screen: 'home', tab: 'games' });
$('#menu-btn').onclick = () => currentGame() && gameMenu(currentGame());
modal.addEventListener('click', (e) => e.target === modal && modal.close());

// Jump straight back into an unfinished game on launch.
const openGame = [...db.games].sort((a, b) => b.createdAt - a.createdAt).find((g) => !g.ended);
if (openGame) route = { screen: 'game', id: openGame.id, tab: 'players' };
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
