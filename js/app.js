import {
  METHODS,
  toCents,
  formatMoney as money,
  playerStats,
  bankSummary,
  planCashOut,
  standings,
} from './ledger.js';

const STORAGE_KEY = 'poker-banker:v1';
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- storage ----------

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.games)) return data;
  } catch {}
  return { games: [] };
}

let db = load();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    toast('Could not save — storage is full or blocked');
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- routing ----------

let route = { screen: 'home' };
function go(next) {
  route = next;
  render();
  window.scrollTo(0, 0);
}

const currentGame = () => db.games.find((g) => g.id === route.id);

function isOut(game, playerId) {
  for (let i = game.transactions.length - 1; i >= 0; i--) {
    const t = game.transactions[i];
    if (t.playerId !== playerId) continue;
    if (t.type === 'cashout') return true;
    if (t.type === 'buyin') return false;
  }
  return false;
}

// ---------- rendering ----------

function render() {
  const game = route.screen === 'game' ? currentGame() : null;
  if (route.screen === 'game' && !game) return go({ screen: 'home' });

  $('#back-btn').hidden = !game;
  $('#menu-btn').hidden = !game;
  $('#tabs').hidden = !game;
  $('#title').textContent = game ? game.name : 'Poker Banker';

  if (!game) return renderHome();

  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === route.tab);
  });
  if (route.tab === 'log') renderLog(game);
  else if (route.tab === 'settle') renderSettle(game);
  else renderPlayers(game);
}

function renderHome() {
  const games = [...db.games].sort((a, b) => b.createdAt - a.createdAt);
  $('#view').innerHTML = `
    <button class="btn primary block" id="new-game">+ New game</button>
    <h2>Games</h2>
    ${
      games.length
        ? games
            .map((g) => {
              const b = bankSummary(g);
              return `
          <div class="card game-item" data-open="${g.id}">
            <div class="info">
              <div class="name"><b>${esc(g.name)}</b>${g.ended ? '<span class="badge out">Ended</span>' : ''}</div>
              <div class="muted" style="font-size:13px">
                ${new Date(g.createdAt).toLocaleDateString()} · ${g.players.length} players · ${money(b.totalBuyIns)} bought in
              </div>
            </div>
            <div class="num" style="color:var(--gold);font-weight:700">${g.ended ? '' : money(b.onTable)}</div>
          </div>`;
            })
            .join('')
        : `<div class="empty">No games yet.<br>Start one when the cards come out.</div>`
    }`;

  $('#new-game').onclick = newGameModal;
  document.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => go({ screen: 'game', id: el.dataset.open, tab: 'players' });
  });
}

function bankCard(game) {
  const b = bankSummary(game);
  const active = game.players.filter((p) => !isOut(game, p.id)).length;
  return `
    <div class="card pot">
      <div class="label">On the table</div>
      <div class="amount">${money(b.onTable)}</div>
      <div class="sub">${active} playing · ${money(b.totalBuyIns)} in · ${money(b.totalCashOuts)} out</div>
      <div class="bank-grid">
        <div><b>${money(b.cash)}</b><span>Cash held</span></div>
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

function renderPlayers(game) {
  const players = [...game.players].sort((a, b) => isOut(game, a.id) - isOut(game, b.id));
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
          </div>`
    }
    ${players.length ? players.map((p) => playerRow(game, p)).join('') : `<div class="empty">Add everyone at the table to get started.</div>`}
  `;

  const input = $('#new-player');
  if (input) {
    const add = () => {
      const name = input.value.trim();
      if (!name) return;
      if (game.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        toast(`${name} is already in this game`);
        return;
      }
      const player = { id: uid(), name };
      game.players.push(player);
      save();
      render();
      buyInModal(game, player);
    };
    $('#add-player').onclick = add;
    input.onkeydown = (e) => e.key === 'Enter' && add();
  }

  document.querySelectorAll('[data-buyin]').forEach((b) => {
    b.onclick = () => buyInModal(game, game.players.find((p) => p.id === b.dataset.buyin));
  });
  document.querySelectorAll('[data-cashout]').forEach((b) => {
    b.onclick = () => cashOutModal(game, game.players.find((p) => p.id === b.dataset.cashout));
  });
  document.querySelectorAll('[data-player]').forEach((el) => {
    el.onclick = () => playerModal(game, game.players.find((p) => p.id === el.dataset.player));
  });
}

function playerRow(game, p) {
  const s = playerStats(game, p.id);
  const out = isOut(game, p.id);
  const meta = out
    ? `In ${money(s.buyIn)} · Out ${money(s.cashOut)} · <span class="${s.net >= 0 ? 'win' : 'lose'}">${money(s.net, { sign: true })}</span>`
    : `In ${money(s.buyIn)} (${s.buyIns} buy-in${s.buyIns === 1 ? '' : 's'})`;
  return `
    <div class="card player ${out ? 'out' : ''}">
      <div class="info" data-player="${p.id}">
        <div class="name">${esc(p.name)}${out ? '<span class="badge out">Left</span>' : ''}${
          s.iouOwed > 0 ? `<span class="badge iou">Owes ${money(s.iouOwed)}</span>` : ''
        }</div>
        <div class="meta num">${meta}</div>
      </div>
      ${
        game.ended
          ? ''
          : `<div class="actions">
              <button class="btn small green" data-buyin="${p.id}">${out ? 'Rejoin' : '+ Buy'}</button>
              ${out ? '' : `<button class="btn small" data-cashout="${p.id}">Cash out</button>`}
            </div>`
      }
    </div>`;
}

function describe(game, t) {
  const p = game.players.find((x) => x.id === t.playerId);
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

  document.querySelectorAll('[data-del]').forEach((b) => {
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

function renderSettle(game) {
  const b = bankSummary(game);
  const rows = standings(game);
  const stillPlaying = rows.filter((r) => !isOut(game, r.player.id));
  const owing = rows.filter((r) => r.iouOwed > 0);

  $('#view').innerHTML = `
    ${bankCard(game)}

    <h2>Chip count check</h2>
    <div class="card">
      <div class="muted" style="font-size:14px">Count the chips still on the table and enter the total. It should match ${money(b.onTable)}.</div>
      <div class="row" style="margin-top:10px">
        <input type="text" inputmode="decimal" id="count" placeholder="Counted chips $" />
      </div>
      <div id="count-result" style="margin-top:8px"></div>
    </div>

    ${
      stillPlaying.length && !game.ended
        ? `<div class="card muted" style="font-size:14px">${stillPlaying.length} player${stillPlaying.length === 1 ? ' is' : 's are'} still at the table. Cash everyone out on the Players tab to finish the night.</div>`
        : ''
    }

    <h2>Standings</h2>
    <div class="card">
      ${
        rows.length
          ? `<table>
        <tr><th>Player</th><th>In</th><th>Out</th><th>Net</th></tr>
        ${rows
          .map((r) => {
            const out = isOut(game, r.player.id);
            return `<tr>
              <td>${esc(r.player.name)}</td>
              <td>${money(r.buyIn)}</td>
              <td>${out ? money(r.cashOut) : '<span class="muted">playing</span>'}</td>
              <td class="${out ? (r.net >= 0 ? 'win' : 'lose') : 'muted'}">${out ? money(r.net, { sign: true }) : '—'}</td>
            </tr>`;
          })
          .join('')}
      </table>`
          : `<div class="empty">No players yet.</div>`
      }
    </div>

    ${
      owing.length
        ? `<h2>IOUs outstanding</h2>
      <div class="card">${owing
        .map(
          (r) => `<div class="log-item"><div class="what"><b>${esc(r.player.name)}</b> owes the bank</div>
          <b class="num lose">${money(r.iouOwed)}</b>
          ${game.ended ? '' : `<button class="btn small" data-repay="${r.player.id}">Repaid</button>`}</div>`
        )
        .join('')}</div>`
        : ''
    }

    <div class="row" style="margin-top:18px">
      <button class="btn" id="share">Share summary</button>
      <button class="btn ${game.ended ? '' : 'primary'}" id="end">${game.ended ? 'Reopen game' : 'End game'}</button>
    </div>
  `;

  $('#count').oninput = (e) => {
    const out = $('#count-result');
    if (!e.target.value.trim()) return (out.innerHTML = '');
    const diff = toCents(e.target.value) - b.onTable;
    out.innerHTML =
      diff === 0
        ? `<span class="win">✓ Perfect — chips match the bank.</span>`
        : `<span class="lose">${diff > 0 ? 'Extra' : 'Missing'} ${money(Math.abs(diff))} in chips.</span>`;
  };
  document.querySelectorAll('[data-repay]').forEach((btn) => {
    btn.onclick = () => repayModal(game, game.players.find((p) => p.id === btn.dataset.repay));
  });
  $('#share').onclick = () => shareSummary(game);
  $('#end').onclick = () => toggleEnded(game);
}

// ---------- actions ----------

let lastAdded = null;
function record(game, tx, message) {
  const full = { id: uid(), at: Date.now(), ...tx };
  game.transactions.push(full);
  lastAdded = { gameId: game.id, txId: full.id };
  save();
  render();
  toast(message, () => {
    if (!lastAdded || lastAdded.txId !== full.id) return;
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
  if (b.iouOutstanding) warn.push(`${money(b.iouOutstanding)} in IOUs is unpaid.`);
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
    const out = isOut(game, r.player.id);
    lines.push(
      `${r.player.name}: in ${money(r.buyIn)}, ${out ? `out ${money(r.cashOut)} → ${money(r.net, { sign: true })}` : 'still playing'}` +
        (r.iouOwed > 0 ? ` (owes ${money(r.iouOwed)})` : '')
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
    confirmModal('Summary', `<pre style="white-space:pre-wrap">${esc(text)}</pre>`, 'Done', () => {});
  }
}

// ---------- modals ----------

const modal = $('#modal');
const body = $('#modal-body');

function openModal(html, wire) {
  body.innerHTML = html;
  modal.showModal();
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
  openModal(
    `<h3>New game</h3>
    <label class="field">Name</label>
    <input type="text" id="g-name" value="${esc(defaultName)}" />
    <label class="field">Standard buy-in</label>
    <input type="text" inputmode="decimal" id="g-buyin" value="20" />
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
    `<h3>${esc(player.name)} buys in</h3>
    <div class="muted">${s.buyIns ? `Already in for ${money(s.buyIn)}` : 'First buy-in'}</div>
    <label class="field">Amount</label>
    ${chipGroup('amount', amountOptions(game), String(game.defaultBuyIn))}
    <input type="text" inputmode="decimal" id="b-custom" placeholder="Other amount" style="margin-top:8px" />
    <label class="field">Paid with</label>
    ${chipGroup('method', Object.entries(METHODS), 'cash')}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="b-go">Record buy-in</button>
    </div>`,
    () => {
      const getAmount = wireChips('amount', () => ($('#b-custom').value = ''));
      const getMethod = wireChips('method');
      $('#b-custom').oninput = () =>
        body.querySelectorAll('[data-group="amount"] button').forEach((b) => b.classList.remove('selected'));
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

function cashOutModal(game, player) {
  const s = playerStats(game, player.id);
  const onTable = bankSummary(game).onTable;
  openModal(
    `<h3>${esc(player.name)} cashes out</h3>
    <div class="muted">Bought in for ${money(s.buyIn)} · ${money(onTable)} on the table</div>
    <label class="field">Chips they're leaving with</label>
    <input type="text" inputmode="decimal" id="c-chips" placeholder="$0" />
    <label class="field">Pay them with</label>
    ${chipGroup('method', [['cash', METHODS.cash], ['digital', METHODS.digital]], 'cash')}
    <div class="calc" id="c-calc"></div>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="c-go">Cash out</button>
    </div>`,
    () => {
      const getMethod = wireChips('method');
      const input = $('#c-chips');
      const update = () => {
        const chips = toCents(input.value);
        const plan = planCashOut(game, player.id, chips);
        const net = chips - s.buyIn;
        $('#c-calc').innerHTML = `
          <div><span>Chips turned in</span><b class="num">${money(chips)}</b></div>
          ${plan.iouOffset ? `<div><span>Minus IOU owed</span><b class="num lose">-${money(plan.iouOffset)}</b></div>` : ''}
          <div class="total"><span>You pay them</span><span class="num">${money(plan.payout)}</span></div>
          ${plan.stillOwes > 0 ? `<div class="lose"><span>They still owe you</span><b class="num">${money(plan.stillOwes)}</b></div>` : ''}
          <div class="muted"><span>Night result</span><span class="num ${net >= 0 ? 'win' : 'lose'}">${money(net, { sign: true })}</span></div>
          ${chips > onTable ? `<div class="lose"><span>More than is on the table!</span></div>` : ''}`;
      };
      input.oninput = update;
      update();
      setTimeout(() => input.focus(), 50);
      $('#c-go').onclick = (e) => {
        e.preventDefault();
        const chips = toCents(input.value);
        if (chips < 0) return toast('Enter a valid amount');
        const plan = planCashOut(game, player.id, chips);
        modal.close();
        record(
          game,
          { type: 'cashout', playerId: player.id, amount: chips, iouOffset: plan.iouOffset, method: getMethod() },
          `${player.name} out · pay ${money(plan.payout)}`
        );
      };
    }
  );
}

function repayModal(game, player) {
  const { iouOwed } = playerStats(game, player.id);
  openModal(
    `<h3>${esc(player.name)} repays IOU</h3>
    <div class="muted">Owes ${money(iouOwed)}</div>
    <label class="field">Amount</label>
    <input type="text" inputmode="decimal" id="r-amt" value="${iouOwed / 100}" />
    <label class="field">Paid with</label>
    ${chipGroup('method', [['cash', METHODS.cash], ['digital', METHODS.digital]], 'cash')}
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
  const hasTx = game.transactions.some((t) => t.playerId === player.id);
  openModal(
    `<h3>${esc(player.name)}</h3>
    <div class="muted num">In ${money(s.buyIn)} · Out ${money(s.cashOut)}${s.iouOwed ? ` · Owes ${money(s.iouOwed)}` : ''}</div>
    <label class="field">Name</label>
    <input type="text" id="p-name" value="${esc(player.name)}" />
    ${!game.ended && s.iouOwed > 0 ? `<button class="btn block" id="p-repay" style="margin-top:12px">Record IOU repayment</button>` : ''}
    ${!hasTx ? `<button class="btn danger block" id="p-remove" style="margin-top:12px">Remove player</button>` : ''}
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="p-save">Save</button>
    </div>`,
    () => {
      $('#p-save').onclick = (e) => {
        e.preventDefault();
        const name = $('#p-name').value.trim();
        if (name) player.name = name;
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
    <button class="btn block" id="m-share" style="margin-top:14px">Share summary</button>
    <button class="btn block" id="m-end" style="margin-top:8px">${game.ended ? 'Reopen game' : 'End game'}</button>
    <button class="btn danger block" id="m-delete" style="margin-top:8px">Delete game</button>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" id="m-save">Save</button>
    </div>`,
    () => {
      $('#m-save').onclick = (e) => {
        e.preventDefault();
        game.name = $('#m-name').value.trim() || game.name;
        game.defaultBuyIn = toCents($('#m-buyin').value) || game.defaultBuyIn;
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
        confirmModal('Delete this game?', 'All players and transactions will be gone for good.', 'Delete', () => {
          db.games = db.games.filter((g) => g.id !== game.id);
          save();
          go({ screen: 'home' });
        });
      };
    }
  );
}

function confirmModal(title, html, action, onConfirm) {
  openModal(
    `<h3>${esc(title)}</h3>
    <div class="muted" style="margin-top:6px">${html}</div>
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
  if (onUndo) el.querySelector('button').onclick = () => {
    el.classList.remove('show');
    onUndo();
  };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), onUndo ? 5000 : 2200);
}

// ---------- wiring ----------

$('#back-btn').onclick = () => go({ screen: 'home' });
$('#menu-btn').onclick = () => currentGame() && gameMenu(currentGame());
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => go({ ...route, tab: b.dataset.tab });
});
modal.addEventListener('click', (e) => e.target === modal && modal.close());

// Jump straight back into an unfinished game on launch.
const openGame = [...db.games].sort((a, b) => b.createdAt - a.createdAt).find((g) => !g.ended);
if (openGame) route = { screen: 'game', id: openGame.id, tab: 'players' };
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
