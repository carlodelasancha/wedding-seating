/* ============================================
   Wedding Seating Chart · Carlo & Laura
   Vanilla JS · zero dependencies · XSS-safe (no innerHTML)
   ============================================ */

const STORAGE_KEY = 'wedding-seating-state-v1';

const state = {
  tables: [],
  guests: [],       // {id, name, side, groups:[], tableId:null}
  groups: [],       // {id, name, color}
  rules: [],        // {id, type:'must'|'avoid', a:guestId, b:guestId}
  selectedGuestId: null,
  selectedTableId: null,
  filters: { carlo: true, laura: true, ambos: true, otro: true, search: '' }
};

/* ── DOM HELPERS (safe, no innerHTML) ──────── */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') node.className = props[k];
    else if (k === 'dataset') Object.assign(node.dataset, props[k]);
    else if (k === 'style') Object.assign(node.style, props[k]);
    else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
    else if (k === 'draggable') node.draggable = props[k];
    else if (k === 'text') node.textContent = props[k];
    else if (k === 'html') { /* disallow */ }
    else if (k === 'value') node.value = props[k];
    else if (k === 'type') node.type = props[k];
    else if (k === 'checked') node.checked = props[k];
    else if (k === 'selected') node.selected = props[k];
    else if (k === 'title') node.title = props[k];
    else node.setAttribute(k, props[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  });
  return node;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function $(sel) { return document.querySelector(sel); }

/* ── BOOT ──────────────────────────────────── */
async function boot() {
  const persisted = loadLocal();
  if (persisted && persisted.guests && persisted.guests.length > 10) {
    Object.assign(state, persisted);
    toast('Estado cargado desde el navegador');
  } else {
    await loadPreset('merged');
  }
  attachEvents();
  render();
}

async function loadPreset(which) {
  const files = {
    merged: 'data/preset-merged.json',
    mama: 'data/preset-familia-mama.json',
    laura: 'data/preset-familia-laura.json',
    zola: 'data/preset-zola.json',
    sample: 'data/guests-sample.json'
  };
  const file = files[which] || files.merged;
  try {
    const [tablesRes, dataRes] = await Promise.all([
      fetch('data/tables.json').then(r => r.json()),
      fetch(file).then(r => r.json())
    ]);
    state.tables = tablesRes.tables;
    state.guests = (dataRes.guests || []).map(g => ({ ...g, tableId: g.tableId || null }));
    state.groups = dataRes.groups || [];
    state.rules = dataRes.rules || [];
    toast(`Cargado: ${state.guests.length} invitados, ${state.groups.length} grupos`);
  } catch (e) {
    toast('Error cargando preset. Abre con servidor local (python3 -m http.server)');
    console.error(e);
  }
}

/* ── PERSISTENCE ───────────────────────────── */
function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
    tables: state.tables, guests: state.guests, groups: state.groups, rules: state.rules
  })); } catch(e) { console.warn(e); }
}
function loadLocal() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
  catch(e) { return null; }
}

/* ── RENDER ────────────────────────────────── */
function render() {
  renderUnassigned();
  renderTables();
  renderStats();
  renderRightPanel();
  saveLocal();
}

function renderStats() {
  const assigned = state.guests.filter(g => g.tableId).length;
  const total = state.guests.length;
  const capacity = state.tables.reduce((s,t) => s + t.capacity, 0);
  $('#stat-assigned').textContent = `${assigned} / ${total}`;
  $('#stat-capacity').textContent = `${assigned} / ${capacity}`;
  $('#stat-score').textContent = scoreToString(computeScore());
}

function renderUnassigned() {
  const ul = $('#unassigned-list');
  // Attach drop handlers once
  if (!ul.dataset.dropBound) {
    ul.addEventListener('dragover', (e) => { e.preventDefault(); ul.classList.add('drag-over'); });
    ul.addEventListener('dragleave', (e) => { if (!ul.contains(e.relatedTarget)) ul.classList.remove('drag-over'); });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      ul.classList.remove('drag-over');
      if (!dragPayload) return;
      const g = state.guests.find(x => x.id === dragPayload.guestId);
      if (!g) return;
      if (g.tableId) {
        g.tableId = null;
        toast(`${g.name} → pendientes`);
        render();
      }
    });
    ul.dataset.dropBound = '1';
  }
  clear(ul);
  const q = state.filters.search.toLowerCase();
  const unassigned = state.guests
    .filter(g => !g.tableId)
    .filter(g => state.filters[g.side || 'otro'])
    .filter(g => !q || g.name.toLowerCase().includes(q))
    .sort((a,b) => a.name.localeCompare(b.name));

  if (unassigned.length === 0) {
    ul.appendChild(el('li', { class: 'empty', style: { padding: '16px', fontSize: '12px' }, text: 'Sin invitados pendientes' }));
    return;
  }

  unassigned.forEach(g => {
    const sideTag = el('span', { class: `side side-${g.side||'otro'}`, text: (g.side||'otro').slice(0,1).toUpperCase() });
    const nameSpan = el('span', { class: 'name', text: g.name });
    const li = el('li', {
      class: 'guest-item' + (g.id === state.selectedGuestId ? ' selected' : ''),
      draggable: true,
      dataset: { guestId: g.id },
      onclick: () => selectGuest(g.id),
      ondragstart: handleDragStart,
      ondragend: handleDragEnd
    }, [sideTag, nameSpan]);
    ul.appendChild(li);
  });
}

function renderTables() {
  let wrap = $('.canvas-inner');
  if (!wrap) {
    wrap = el('div', { class: 'canvas-inner' });
    $('#canvas').appendChild(wrap);
  }
  clear(wrap);

  state.tables.forEach(t => {
    const occupants = state.guests.filter(g => g.tableId === t.id);
    const emptySeats = t.capacity - occupants.length;
    const tScore = scoreTable(t.id);

    const classes = ['table', t.shape];
    if (t.kind === 'novios') classes.push('novios');
    if (t.id === state.selectedTableId) classes.push('highlight');
    if (emptySeats === 0) classes.push('full');
    if (tScore.conflicts > 0) classes.push('conflict');
    else if (occupants.length > 0 && tScore.happy > 0) classes.push('happy');

    const canToggle = t.kind === 'redonda' || t.kind === 'rectangular';
    const capBadge = el('span', {
      class: 'count cap-toggle' + (canToggle ? ' clickable' : ''),
      text: `${occupants.length}/${t.capacity}`,
      title: canToggle ? 'Clic para alternar 8 ↔ 10' : '',
      onclick: canToggle ? (e) => { e.stopPropagation(); toggleCapacity(t.id); } : null
    });
    const header = el('div', { class: 'table-header' }, [
      el('span', { text: t.name }),
      capBadge
    ]);
    const seatsDiv = el('div', { class: 'seats' });

    occupants.forEach(g => {
      const sideTag = el('span', { class: `side side-${g.side||'otro'}`, text: (g.side||'otro').slice(0,1).toUpperCase() });
      const nameSpan = el('span', { text: g.name });
      const seat = el('div', {
        class: 'seat occupied',
        draggable: true,
        dataset: { guestId: g.id, tableId: t.id },
        onclick: (e) => { e.stopPropagation(); selectGuest(g.id); },
        ondragstart: handleDragStart,
        ondragend: handleDragEnd,
        ondragover: handleSeatDragOver,
        ondragleave: handleSeatDragLeave,
        ondrop: handleSeatDrop
      }, [sideTag, nameSpan]);
      seatsDiv.appendChild(seat);
    });
    for (let i = 0; i < emptySeats; i++) {
      const emptySeat = el('div', {
        class: 'seat empty',
        text: '· vacío ·',
        dataset: { tableId: t.id },
        ondragover: handleSeatDragOver,
        ondragleave: handleSeatDragLeave,
        ondrop: handleSeatDrop
      });
      seatsDiv.appendChild(emptySeat);
    }

    const div = el('div', {
      class: classes.join(' '),
      dataset: { tableId: t.id },
      onclick: () => selectTable(t.id),
      ondragover: handleDragOver,
      ondragleave: handleDragLeave,
      ondrop: handleDrop
    }, [header, seatsDiv]);
    wrap.appendChild(div);
  });
}

function renderRightPanel() {
  renderGuestTab();
  renderTableTab();
  renderGroupsAndRules();
}

function renderGuestTab() {
  const gd = $('#guest-detail');
  clear(gd);
  gd.className = 'tab-pane';
  if (!state.selectedGuestId) {
    gd.classList.add('empty');
    gd.textContent = 'Selecciona un invitado';
    gd.parentElement.classList.toggle('active', gd.parentElement.dataset.pane === 'guest');
    // Keep parent tab-pane class
    return;
  }
  const g = state.guests.find(x => x.id === state.selectedGuestId);
  if (!g) { gd.textContent = ''; return; }

  const table = state.tables.find(t => t.id === g.tableId);
  const tableMates = g.tableId ? state.guests.filter(x => x.tableId === g.tableId && x.id !== g.id) : [];

  gd.appendChild(el('h2', { style: { fontSize: '16px', color: 'var(--burgundy)', marginBottom: '2px' }, text: g.name }));
  gd.appendChild(el('div', { class: 'hint', style: { margin: '0 0 14px' }, text: `${labelSide(g.side)} · ${table ? 'Mesa: ' + table.name : 'Sin asignar'}` }));

  gd.appendChild(el('h3', { text: 'Lado' }));
  const sideSel = el('select', { id: 'edit-side', onchange: e => { g.side = e.target.value; render(); } });
  ['carlo','laura','ambos','otro'].forEach(v => {
    const o = el('option', { value: v, text: labelSide(v).replace('Lado ','') });
    if (g.side === v) o.selected = true;
    sideSel.appendChild(o);
  });
  gd.appendChild(sideSel);

  gd.appendChild(el('h3', { style: { marginTop: '14px' }, text: 'Grupos' }));
  const groupsDiv = el('div', { id: 'guest-groups' });
  g.groups.forEach(gid => {
    const gr = state.groups.find(x => x.id === gid);
    if (!gr) return;
    const tag = el('span', {
      style: {
        background: gr.color+'22', color: gr.color, border: '1px solid '+gr.color+'55',
        padding: '3px 8px', borderRadius: '4px', fontSize: '11px', margin: '2px',
        display: 'inline-block', cursor: 'pointer'
      },
      title: 'Clic para quitar',
      text: gr.name + ' ✕',
      onclick: () => { g.groups = g.groups.filter(x => x !== gid); render(); }
    });
    groupsDiv.appendChild(tag);
  });
  gd.appendChild(groupsDiv);

  const addSel = el('select', {
    style: { marginTop: '8px' },
    onchange: e => { if (e.target.value) { g.groups.push(e.target.value); render(); } }
  });
  addSel.appendChild(el('option', { value: '', text: '+ Agregar a grupo...' }));
  state.groups.filter(gr => !g.groups.includes(gr.id)).forEach(gr => {
    addSel.appendChild(el('option', { value: gr.id, text: gr.name }));
  });
  gd.appendChild(addSel);

  if (tableMates.length) {
    gd.appendChild(el('h3', { style: { marginTop: '16px' }, text: 'Compañeros de mesa' }));
    const ul = el('ul', { style: { listStyle: 'none', fontSize: '12px' } });
    tableMates.forEach(m => ul.appendChild(el('li', { text: '· ' + m.name })));
    gd.appendChild(ul);
  }

  gd.appendChild(el('h3', { style: { marginTop: '16px' }, text: 'Acciones' }));
  gd.appendChild(el('button', {
    class: 'secondary', text: 'Sacar de mesa',
    onclick: () => { g.tableId = null; render(); }
  }));
  gd.appendChild(el('button', {
    class: 'secondary danger', style: { marginTop: '6px' }, text: 'Eliminar invitado',
    onclick: () => {
      if (confirm(`¿Eliminar a ${g.name}?`)) {
        state.guests = state.guests.filter(x => x.id !== g.id);
        state.selectedGuestId = null;
        render();
      }
    }
  }));
}

function renderTableTab() {
  const td = $('#table-detail');
  clear(td);
  td.className = 'tab-pane';
  if (!state.selectedTableId) {
    td.classList.add('empty');
    td.textContent = 'Selecciona una mesa';
    return;
  }
  const t = state.tables.find(x => x.id === state.selectedTableId);
  if (!t) return;
  const occ = state.guests.filter(g => g.tableId === t.id);
  const s = scoreTable(t.id);

  td.appendChild(el('h2', { style: { fontSize: '16px', color: 'var(--burgundy)', marginBottom: '2px' }, text: t.name }));
  td.appendChild(el('div', { class: 'hint', style: { margin: '0 0 14px' }, text: `${t.kind} · ${occ.length}/${t.capacity} ocupados` }));

  td.appendChild(el('h3', { text: 'Score' }));
  const box = el('div', { style: { fontSize: '12px', lineHeight: '1.8' } });
  box.appendChild(el('div', { text: `· Pares felices (mismo grupo): ${s.happy}` }));
  const conflictLine = el('div', {}, [ '· Conflictos (regla ✗): ', el('b', { style: { color: 'var(--bad)' }, text: String(s.conflicts) }) ]);
  box.appendChild(conflictLine);
  const mustLine = el('div', {}, [ '· Reglas ✓ cumplidas: ', el('b', { style: { color: 'var(--ok)' }, text: String(s.musts) }) ]);
  box.appendChild(mustLine);
  box.appendChild(el('div', { text: `· Lado: ${s.sides}` }));
  td.appendChild(box);

  td.appendChild(el('h3', { style: { marginTop: '14px' }, text: 'Ocupantes' }));
  if (occ.length) {
    const ul = el('ul', { style: { listStyle: 'none', fontSize: '12px' } });
    occ.forEach(g => ul.appendChild(el('li', { text: '· ' + g.name })));
    td.appendChild(ul);
  } else {
    td.appendChild(el('p', { class: 'hint', text: 'Vacía' }));
  }

  td.appendChild(el('h3', { style: { marginTop: '14px' }, text: 'Capacidad' }));
  td.appendChild(el('input', {
    type: 'number', value: t.capacity, min: '1', max: '20',
    onchange: e => { const v = parseInt(e.target.value); if (v >= 1) { t.capacity = v; render(); } }
  }));
  td.appendChild(el('p', { class: 'hint', text: 'Cambiar si confirmas con Fernanda mesas de 8 vs 10.' }));
}

function renderGroupsAndRules() {
  const gl = $('#groups-list');
  clear(gl);
  if (state.groups.length === 0) {
    gl.appendChild(el('p', { class: 'hint', text: 'Aún no hay grupos. Crea grupos para mantener juntos a familias, compañeros de escuela, etc.' }));
  } else {
    state.groups.forEach(gr => {
      const members = state.guests.filter(g => g.groups.includes(gr.id));
      const card = el('div', { class: 'group-card' }, [
        el('div', { class: 'group-name', style: { color: gr.color }, text: gr.name }),
        el('div', { class: 'members', text: `${members.length} miembros` })
      ]);
      if (members.length) {
        card.appendChild(el('div', { class: 'members', text: members.map(m => m.name).join(', ') }));
      }
      card.appendChild(el('button', {
        class: 'secondary danger',
        style: { marginTop: '6px', fontSize: '11px' },
        text: 'Eliminar grupo',
        onclick: () => {
          state.groups = state.groups.filter(x => x.id !== gr.id);
          state.guests.forEach(g => g.groups = g.groups.filter(x => x !== gr.id));
          render();
        }
      }));
      gl.appendChild(card);
    });
  }

  const rl = $('#rules-list');
  clear(rl);
  if (state.rules.length === 0) {
    rl.appendChild(el('p', { class: 'hint', text: 'Sin reglas duras.' }));
  } else {
    state.rules.forEach(r => {
      const a = state.guests.find(g => g.id === r.a);
      const b = state.guests.find(g => g.id === r.b);
      const symbol = r.type === 'must' ? '✓' : '✗';
      const color = r.type === 'must' ? 'var(--ok)' : 'var(--bad)';
      const card = el('div', { class: 'rule-card' }, [
        el('div', { style: { color, fontWeight: '600' }, text: `${symbol} ${r.type === 'must' ? 'Juntar' : 'Separar'}` }),
        el('div', { class: 'members', text: `${a?.name||'?'} ↔ ${b?.name||'?'}` }),
        el('button', {
          class: 'secondary danger',
          style: { marginTop: '4px', fontSize: '11px' },
          text: 'Quitar',
          onclick: () => { state.rules = state.rules.filter(x => x.id !== r.id); render(); }
        })
      ]);
      rl.appendChild(card);
    });
  }
}

/* ── SCORING ───────────────────────────────── */
function scoreTable(tableId) {
  const occ = state.guests.filter(g => g.tableId === tableId);
  let happy = 0, conflicts = 0, musts = 0;
  const sides = {};
  occ.forEach(g => { sides[g.side || 'otro'] = (sides[g.side||'otro']||0)+1; });
  for (let i = 0; i < occ.length; i++) {
    for (let j = i+1; j < occ.length; j++) {
      const a = occ[i], b = occ[j];
      const shared = a.groups.filter(x => b.groups.includes(x));
      if (shared.length > 0) happy++;
      const rule = state.rules.find(r =>
        (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
      if (rule) {
        if (rule.type === 'must') musts++;
        else conflicts++;
      }
    }
  }
  const sideStr = Object.entries(sides).map(([k,v]) => `${k.slice(0,1).toUpperCase()}:${v}`).join(' ') || '—';
  return { happy, conflicts, musts, sides: sideStr };
}

function computeScore() {
  let total = 0, conflicts = 0, brokenMusts = 0;
  state.tables.forEach(t => {
    const s = scoreTable(t.id);
    total += s.happy * 3 + s.musts * 5 - s.conflicts * 10;
    conflicts += s.conflicts;
  });
  state.rules.filter(r => r.type === 'must').forEach(r => {
    const a = state.guests.find(g => g.id === r.a);
    const b = state.guests.find(g => g.id === r.b);
    if (a?.tableId && b?.tableId && a.tableId !== b.tableId) {
      brokenMusts++;
      total -= 15;
    }
  });
  return { total, conflicts, brokenMusts };
}
function scoreToString(s) {
  if (s.total === 0 && state.guests.filter(g=>g.tableId).length === 0) return '—';
  const parts = [String(s.total)];
  if (s.conflicts) parts.push(`${s.conflicts}✗`);
  if (s.brokenMusts) parts.push(`${s.brokenMusts}⚠`);
  return parts.join(' ');
}

/* ── DRAG & DROP ───────────────────────────── */
let dragPayload = null;
function handleDragStart(e) {
  dragPayload = { guestId: e.currentTarget.dataset.guestId };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  if (e.stopPropagation) e.stopPropagation();
}
function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragPayload) return;
  const tableId = e.currentTarget.dataset.tableId;
  const t = state.tables.find(x => x.id === tableId);
  const g = state.guests.find(x => x.id === dragPayload.guestId);
  if (!t || !g) return;
  const occupants = state.guests.filter(x => x.tableId === tableId).length;
  if (g.tableId !== tableId && occupants >= t.capacity) {
    toast(`Mesa ${t.name} llena (${t.capacity}) — arrastra directo a un asiento ocupado para hacer swap`);
    return;
  }
  g.tableId = tableId;
  render();
}

// Seat-level drop: if target is empty seat → place there; if occupied → swap, displace prior to pending
function handleSeatDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function handleSeatDragLeave(e) {
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
}
function handleSeatDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  if (!dragPayload) return;
  const seat = e.currentTarget;
  const tableId = seat.dataset.tableId;
  const targetGuestId = seat.dataset.guestId; // only set on occupied seats
  const draggedGuest = state.guests.find(x => x.id === dragPayload.guestId);
  if (!draggedGuest || !tableId) return;

  // Same guest dropped on itself: no-op
  if (targetGuestId && targetGuestId === dragPayload.guestId) return;

  if (targetGuestId) {
    // Occupied seat → SWAP: target goes where dragged was; dragged takes target's spot
    const targetGuest = state.guests.find(x => x.id === targetGuestId);
    if (!targetGuest) return;
    const sourceTableId = draggedGuest.tableId; // may be null (was pending)
    targetGuest.tableId = sourceTableId; // if dragged was pending, target becomes pending
    draggedGuest.tableId = tableId;
    toast(sourceTableId
      ? `Swap: ${targetGuest.name} ↔ ${draggedGuest.name}`
      : `${targetGuest.name} desplazado a pendientes`);
  } else {
    // Empty seat → place there if space
    const t = state.tables.find(x => x.id === tableId);
    const occupants = state.guests.filter(x => x.tableId === tableId).length;
    if (draggedGuest.tableId !== tableId && occupants >= t.capacity) {
      toast(`Mesa ${t.name} llena`);
      return;
    }
    draggedGuest.tableId = tableId;
  }
  render();
}

/* ── CAPACITY TOGGLE ───────────────────────── */
function toggleCapacity(tableId) {
  const t = state.tables.find(x => x.id === tableId);
  if (!t) return;
  const newCap = t.capacity === 10 ? 8 : 10;
  const occ = state.guests.filter(g => g.tableId === tableId);

  if (occ.length > newCap) {
    const excess = occ.length - newCap;
    const lines = occ.map((g, i) => `${i+1}. ${g.name}`).join('\n');
    const answer = prompt(
      `${t.name}: reducir de ${t.capacity} a ${newCap}.\n` +
      `Sobran ${excess} persona(s) — ¿cuáles mandamos a pendientes?\n\n` +
      `Escribe los números separados por comas (ej: 3,7):\n\n${lines}`,
      Array.from({length: excess}, (_, i) => occ.length - i).reverse().join(',')
    );
    if (answer === null) return; // cancelled
    const indices = answer.split(',')
      .map(s => parseInt(s.trim(), 10) - 1)
      .filter(i => !isNaN(i) && i >= 0 && i < occ.length);
    if (indices.length !== excess) {
      toast(`Necesitas escoger exactamente ${excess} persona(s)`);
      return;
    }
    indices.forEach(i => { occ[i].tableId = null; });
    t.capacity = newCap;
    toast(`${t.name}: ${newCap} personas (${excess} → pendientes)`);
  } else {
    t.capacity = newCap;
    toast(`${t.name}: capacidad cambiada a ${newCap}`);
  }
  render();
}

/* ── SELECTION ─────────────────────────────── */
function selectGuest(id) {
  state.selectedGuestId = id;
  state.selectedTableId = null;
  activateTab('guest');
  render();
}
function selectTable(id) {
  state.selectedTableId = id;
  state.selectedGuestId = null;
  activateTab('table');
  render();
}
function activateTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}

/* ── IMPORT / EXPORT ───────────────────────── */
function importFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    if (file.name.endsWith('.json')) {
      try {
        const data = JSON.parse(text);
        if (data.guests) state.guests = data.guests.map(g => ({...g, tableId: g.tableId||null}));
        if (data.groups) state.groups = data.groups;
        if (data.rules) state.rules = data.rules;
        if (data.tables) state.tables = data.tables;
        toast(`Cargados ${state.guests.length} invitados`);
        render();
      } catch (err) { toast('Error parseando JSON'); }
    } else if (file.name.endsWith('.csv')) {
      const imported = parseZolaCSV(text);
      const existingIds = new Set(state.guests.map(g => g.id));
      const newOnes = imported.filter(g => !existingIds.has(g.id));
      state.guests.push(...newOnes);
      toast(`Importados ${newOnes.length} nuevos (${imported.length} en CSV)`);
      render();
    }
  };
  reader.readAsText(file);
}

function parseZolaCSV(text) {
  const lines = [];
  let cur = '', inQ = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i+1] === '"') { cur += '"'; i++; }
    else if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { row.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (cur !== '' || row.length) { row.push(cur); lines.push(row); row = []; cur = ''; }
      if (c === '\r' && text[i+1] === '\n') i++;
    }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); lines.push(row); }

  if (lines.length < 2) return [];
  const headers = lines[0].map(h => (h||'').trim().toLowerCase());

  const findCol = (...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const firstI = findCol('first name','first','nombre');
  const lastI = findCol('last name','last','apellido');
  const fullI = findCol('full name','name','guest','invitado');
  const rsvpI = findCol('rsvp','status','confirm');
  const partyI = findCol('party','group');
  const sideI = findCol('side');
  const mealI = findCol('meal');

  const guests = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i];
    if (r.length < 2 || !r.some(x => x && x.trim())) continue;
    let name = '';
    if (firstI >= 0 || lastI >= 0) {
      name = `${r[firstI]||''} ${r[lastI]||''}`.trim();
    } else if (fullI >= 0) {
      name = (r[fullI]||'').trim();
    } else {
      name = (r[0]||'').trim();
    }
    if (!name) continue;
    const rsvp = rsvpI >= 0 ? (r[rsvpI]||'').toLowerCase() : '';
    if (rsvp.includes('decline')) continue;
    guests.push({
      id: 'z_'+slug(name)+'_'+i,
      name,
      side: sideI >= 0 ? (r[sideI]||'otro').toLowerCase() : 'otro',
      groups: partyI >= 0 && r[partyI] ? [slug(r[partyI])] : [],
      tableId: null,
      meal: mealI >= 0 ? r[mealI] : '',
      rsvp
    });
  }
  return guests;
}

function exportJSON() {
  const data = {
    tables: state.tables, guests: state.guests, groups: state.groups, rules: state.rules,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seating-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Estado guardado');
}

/* ── AUTO-SEAT (group-aware, couple-safe) ──── */
function autoSeat() {
  if (!confirm('Esto acomoda a todos los invitados sin asignar respetando grupos y reglas. ¿Continuar?')) return;

  // Step 1: Build "units" using must-sit-with rules as connected components
  // A unit is an atomic group of people that MUST go on the same table
  const guestById = new Map(state.guests.map(g => [g.id, g]));
  const parent = new Map();
  state.guests.forEach(g => parent.set(g.id, g.id));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  state.rules.filter(r => r.type === 'must').forEach(r => {
    if (guestById.has(r.a) && guestById.has(r.b)) union(r.a, r.b);
  });

  // Build units from unassigned guests only
  const unassigned = state.guests.filter(g => !g.tableId);
  const unitMap = new Map();
  unassigned.forEach(g => {
    const root = find(g.id);
    if (!unitMap.has(root)) unitMap.set(root, []);
    unitMap.get(root).push(g);
  });
  const units = Array.from(unitMap.values());

  // Step 2: Score units — prefer grouping by affinity groups
  // Sort units by:
  //   1. Has must-sit-with partners (units of size > 1) first
  //   2. Then by number of groups (more group ties = harder to place, so earlier)
  //   3. Then by side (Carlo first, Laura second — just for stability)
  units.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    const aGroups = new Set(a.flatMap(g => g.groups)).size;
    const bGroups = new Set(b.flatMap(g => g.groups)).size;
    return bGroups - aGroups;
  });

  // Step 3: For each unit, find the best table
  for (const unit of units) {
    const unitSize = unit.length;
    const unitGroups = new Set(unit.flatMap(g => g.groups));
    const unitSides = new Set(unit.map(g => g.side));

    let best = null, bestScore = -Infinity;
    for (const t of state.tables) {
      if (t.kind === 'novios') continue;
      const occ = state.guests.filter(x => x.tableId === t.id);
      const free = t.capacity - occ.length;
      if (free < unitSize) continue; // entire unit must fit

      // Check for any avoid rule blocking any member of unit against any occupant
      const blocked = unit.some(u => occ.some(o => state.rules.some(r =>
        r.type === 'avoid' &&
        ((r.a === u.id && r.b === o.id) || (r.b === u.id && r.a === o.id)))));
      if (blocked) continue;

      // Score: prefer tables where there are groupmates already
      let score = 0;
      const occGroups = new Set(occ.flatMap(o => o.groups));
      const sharedGroups = [...unitGroups].filter(gr => occGroups.has(gr)).length;
      score += sharedGroups * 50; // strong bonus for group match

      // Count actual person-pair affinities (existing occupants who share a group with unit)
      const mates = occ.filter(o => o.groups.some(gr => unitGroups.has(gr))).length;
      score += mates * 10;

      // Same side is a MAJOR factor: mesas should be same-side as much as possible
      const sameSide = occ.filter(o => unitSides.has(o.side)).length;
      const diffSide = occ.filter(o => !unitSides.has(o.side) && o.side !== 'ambos').length;
      score += sameSide * 5;
      score -= diffSide * 30; // heavy penalty for mixing Carlo/Laura sides

      // If table is empty, small bonus so we open new tables for new groups
      if (occ.length === 0) score += 8;

      // Prefer tables where the free space matches unit size (pack tightly)
      // e.g. couple of 2 prefers mesa with exactly 2 free
      if (free === unitSize) score += 3;

      if (score > bestScore) { bestScore = score; best = t; }
    }

    if (best) {
      unit.forEach(u => { u.tableId = best.id; });
    }
  }
  render();
  toast('Auto-seating completado (v2: couples-safe, group-first)');
}

/* ── UTILITIES ─────────────────────────────── */
function slug(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
function labelSide(s) { return {carlo:'Lado Carlo',laura:'Lado Laura',ambos:'Ambos',otro:'Otro'}[s||'otro']; }
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ── EVENTS ────────────────────────────────── */
function attachEvents() {
  $('#btn-import').onclick = () => $('#file-input').click();
  $('#file-input').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); };
  $('#btn-export-json').onclick = exportJSON;
  $('#btn-export-print').onclick = () => window.print();
  $('#btn-autoseat').onclick = autoSeat;
  $('#btn-reset').onclick = async () => {
    const choice = prompt('Reset:\n1 = Solo vaciar asignaciones (mantener invitados)\n2 = Recargar preset MERGED (Zola+mamá+Laura)\n3 = Recargar solo Zola\n4 = Recargar solo mamá\n5 = Recargar solo Laura\n\nElige número:', '1');
    if (choice === '1') {
      state.guests.forEach(g => g.tableId = null);
      render();
    } else if (choice === '2') { localStorage.removeItem(STORAGE_KEY); await loadPreset('merged'); render(); }
    else if (choice === '3') { localStorage.removeItem(STORAGE_KEY); await loadPreset('zola'); render(); }
    else if (choice === '4') { localStorage.removeItem(STORAGE_KEY); await loadPreset('mama'); render(); }
    else if (choice === '5') { localStorage.removeItem(STORAGE_KEY); await loadPreset('laura'); render(); }
  };
  $('#search-guests').oninput = e => { state.filters.search = e.target.value; renderUnassigned(); };
  document.querySelectorAll('.filter').forEach(f => f.onchange = e => {
    state.filters[e.target.value] = e.target.checked;
    renderUnassigned();
  });
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => activateTab(t.dataset.tab));
  $('#zoom').oninput = e => {
    const elx = $('.canvas-inner');
    if (elx) elx.style.transform = `scale(${e.target.value})`;
  };
  $('#btn-add-guest').onclick = () => {
    const name = prompt('Nombre del invitado:');
    if (!name || !name.trim()) return;
    const side = (prompt('Lado (carlo/laura/ambos/otro):', 'otro')||'').toLowerCase();
    state.guests.push({
      id: 'm_'+slug(name)+'_'+Date.now(),
      name: name.trim(),
      side: ['carlo','laura','ambos','otro'].includes(side) ? side : 'otro',
      groups: [],
      tableId: null
    });
    render();
  };
  $('#btn-add-group').onclick = () => {
    const name = prompt('Nombre del grupo (ej: "Primos Carlo", "UCSF compañeros"):');
    if (!name || !name.trim()) return;
    state.groups.push({
      id: 'gr_'+slug(name)+'_'+Date.now(),
      name: name.trim(),
      color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')
    });
    render();
  };
  $('#btn-add-rule').onclick = () => {
    const type = prompt('Tipo: "must" (juntar) o "avoid" (separar)', 'must');
    if (!['must','avoid'].includes(type)) return;
    const a = prompt('Nombre exacto del primer invitado:');
    const b = prompt('Nombre exacto del segundo invitado:');
    const ga = state.guests.find(g => g.name === a);
    const gb = state.guests.find(g => g.name === b);
    if (!ga || !gb) { toast('Invitado no encontrado'); return; }
    state.rules.push({ id: 'r_'+Date.now(), type, a: ga.id, b: gb.id });
    render();
  };
}

boot();
