'use strict';

/* Reads the mirrored JSON written by scripts/fetch_val.py.
   Every figure on the page is derived here; nothing is precomputed server-side
   beyond the per-district vote records themselves. */

const nf = new Intl.NumberFormat('sv-SE');
const pf = (n, d = 2) => (n == null || !isFinite(n)) ? '–' : n.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
const sf = (n, d = 2) => {
  if (n == null || !isFinite(n)) return '–';
  const s = n > 0 ? '+' : (n < 0 ? '−' : '±');
  return s + Math.abs(n).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const si = (n) => {
  if (n == null || !isFinite(n)) return '–';
  const s = n > 0 ? '+' : (n < 0 ? '−' : '±');
  return s + nf.format(Math.abs(n));
};
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : String(kid));
  return n;
};

const S = {};   // loaded state

/* ---------- vote-record helpers ------------------------------------ */
/* A record is {v:[votes per tracked party], t:total, o:övriga, e:eligible, u:isUppsamling}.
   "Övriga" is derived as total minus the tracked parties, which makes it
   comparable between counts: the preliminary count lumps small parties into one
   bucket while the final count names them individually. */

function emptyAgg() {
  return { v: new Array(S.meta.parties.length).fill(0), t: 0, o: 0, e: 0, n: 0 };
}
function addInto(agg, rec) {
  rec.v.forEach((x, i) => agg.v[i] += x);
  agg.t += rec.t; agg.o += rec.o; agg.e += rec.e || 0; agg.n += 1;
  return agg;
}
function shares(agg) {
  return agg.t ? agg.v.map(x => 100 * x / agg.t) : agg.v.map(() => null);
}
function otherShare(agg) { return agg.t ? 100 * agg.o / agg.t : null; }

/* rows = [{key,label,color,a,b}] where a/b are vote counts in two aggregates */
function partyRows(aggA, aggB) {
  const P = S.meta.parties, C = S.meta.partyColors || {};
  const rows = P.map((p, i) => ({
    key: p, label: p, color: C[p] || 'transparent',
    a: aggA ? aggA.v[i] : null, b: aggB ? aggB.v[i] : null
  }));
  rows.push({
    key: 'ÖVR', label: 'Övriga', color: C['ÖVR'] || 'var(--text-muted)',
    a: aggA ? aggA.o : null, b: aggB ? aggB.o : null, other: true
  });
  return rows;
}

/* ---------- diverging bar: direction from a zero line, one ink ------ */
function divBar(value, max) {
  const box = el('div', { class: 'dv' });
  box.append(el('span', { class: 'zero' }));
  if (value != null && isFinite(value) && max > 0) {
    const frac = Math.min(Math.abs(value) / max, 1);
    const fill = el('span', { class: 'fill ' + (value >= 0 ? 'pos' : 'neg') });
    fill.style.width = (frac * 50) + '%';
    if (Math.abs(value) < 1e-9) fill.style.width = '0';
    box.append(fill);
  }
  return box;
}
function partyCell(row) {
  return el('td', {},
    el('span', { class: 'party' },
      el('span', { class: 'chip', style: `background:${row.color}` }),
      row.label));
}
function table(headers, bodyRows, footRow) {
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, headers.map(h =>
    el('th', h.wide ? { class: 'dvcell' } : {}, h.label != null ? h.label : h)))));
  t.append(el('tbody', {}, bodyRows));
  if (footRow) t.append(el('tfoot', {}, footRow));
  return t;
}
/* Always splice the produced node's children into the host, so tiles land as
   direct grid items and thead/tbody land directly inside the host <table>. */
function mount(id, frag) {
  document.getElementById(id).replaceChildren(...[...frag.childNodes]);
}
function emptyTable(headers, message) {
  return table(headers, [el('tr', {},
    el('td', { colspan: headers.length, class: 'empty' }, message))]);
}
function tile(label, value, sub, pct) {
  const t = el('div', { class: 'tile' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value));
  if (sub) t.append(el('div', { class: 'sub' }, sub));
  if (pct != null) {
    const bar = el('div', { class: 'progress' });
    bar.append(el('span', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
    t.append(bar);
  }
  return t;
}

/* ---------- view 1: uppsamlingsdistrikt ---------------------------- */
function renderUppsamling() {
  const rows = [];                       // one per uppsamlingsdistrikt
  const counted = emptyAgg(), national = emptyAgg(), rest = emptyAgg();

  for (const [path, area] of Object.entries(S.areas)) {
    const dists = S.prelim[path] || {};
    for (const [namn, rec] of Object.entries(dists)) {
      addInto(national, rec);
      if (rec.u) { addInto(counted, rec); rows.push({ path, namn, area, rec }); }
      else addInto(rest, rec);
    }
  }
  // Every uppsamlingsdistrikt, counted or not, comes from the area index:
  // 314 areas each hold exactly one, so any area without a counted one is pending.
  const seen = new Set(rows.map(r => r.path));
  for (const [path, area] of Object.entries(S.areas)) {
    if (!seen.has(path)) rows.push({ path, namn: null, area, rec: null });
  }

  const total = rows.length, done = counted.n;
  const natVotes = S.meta.preliminar.roster || national.t;

  mount('upp-tiles', el('div', {},
    tile('Räknade uppsamlingsdistrikt', `${nf.format(done)} / ${nf.format(total)}`,
      `${nf.format(total - done)} återstår`, total ? 100 * done / total : 0),
    tile('Röster i dessa distrikt', nf.format(counted.t),
      natVotes ? `${pf(100 * counted.t / natVotes, 2)} av alla räknade röster` : ''),
    tile('Snitt per distrikt', done ? nf.format(Math.round(counted.t / done)) : '–',
      'röster i de räknade'),
    tile('Preliminärt räknade totalt', `${nf.format(S.meta.preliminar.raknade || 0)} / ${nf.format(S.meta.preliminar.ska_raknas || 0)}`,
      `valdistrikt · uppdaterat ${S.meta.preliminar.uppdaterad || '–'}`,
      S.meta.preliminar.ska_raknas ? 100 * S.meta.preliminar.raknade / S.meta.preliminar.ska_raknas : 0)
  ));

  // party table: share inside uppsamlingsdistrikt vs share in the rest of the country
  const pr = partyRows(counted, rest);
  const shU = counted.t ? pr.map(r => 100 * r.a / counted.t) : pr.map(() => null);
  const shR = rest.t ? pr.map(r => 100 * r.b / rest.t) : pr.map(() => null);
  const diff = pr.map((_, i) => (shU[i] == null || shR[i] == null) ? null : shU[i] - shR[i]);
  const maxd = Math.max(0.5, ...diff.filter(d => d != null).map(Math.abs));

  const body = pr.map((r, i) => el('tr', {},
    partyCell(r),
    el('td', {}, nf.format(r.a || 0)),
    el('td', {}, pf(shU[i], 2)),
    el('td', {}, pf(shR[i], 2)),
    el('td', {}, sf(diff[i], 2)),
    el('td', { class: 'dvcell' }, divBar(diff[i], maxd))
  ));
  const foot = el('tr', {},
    el('td', {}, 'Summa'),
    el('td', {}, nf.format(counted.t)),
    el('td', {}, counted.t ? '100,00 %' : '–'),
    el('td', {}, rest.t ? '100,00 %' : '–'),
    el('td', {}, ''), el('td', {}, ''));
  mount('upp-parties', table(
    ['Parti', 'Röster', 'Andel här', 'Andel i övriga landet', 'Diff (p.e.)', { label: 'Avvikelse', wide: true }],
    body, foot));

  S._uppRows = rows.sort((a, b) =>
    (a.area.vkn || '').localeCompare(b.area.vkn || '', 'sv') ||
    (a.area.n || '').localeCompare(b.area.n || '', 'sv'));
  filterUppList();
}

function filterUppList() {
  const q = document.getElementById('upp-search').value.trim().toLowerCase();
  const st = document.getElementById('upp-status').value;
  const rows = S._uppRows.filter(r => {
    if (st === 'counted' && !r.rec) return false;
    if (st === 'pending' && r.rec) return false;
    if (!q) return true;
    return (r.area.n + ' ' + (r.area.vkn || '')).toLowerCase().includes(q);
  });
  document.getElementById('upp-count').textContent =
    `${nf.format(rows.length)} av ${nf.format(S._uppRows.length)}`;

  const body = rows.map(r => el('tr', {},
    el('td', {}, r.area.n),
    el('td', {}, r.area.vkn || '–'),
    el('td', {}, el('span', { class: 'status' },
      el('span', { class: 'dot ' + (r.rec ? 'on' : 'off') }),
      r.rec ? 'Räknat' : 'Väntar')),
    el('td', {}, r.rec ? nf.format(r.rec.t) : '–'),
    el('td', {}, r.rec ? leadingParty(r.rec) : '–')
  ));
  const t = table(['Område', 'Riksdagsvalkrets', 'Status', 'Röster', 'Största parti'],
    body.length ? body : [el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Inga träffar'))]);
  mount('upp-list', t);
}
function leadingParty(rec) {
  let bi = -1, bv = -1;
  rec.v.forEach((x, i) => { if (x > bv) { bv = x; bi = i; } });
  if (bi < 0 || bv <= 0) return '–';
  const p = S.meta.parties[bi];
  return el('span', { class: 'party' },
    el('span', { class: 'chip', style: `background:${(S.meta.partyColors || {})[p] || 'transparent'}` }),
    `${p} ${pf(100 * bv / rec.t, 1)}`);
}

/* ---------- view 2: preliminary vs final --------------------------- */
function renderDelta() {
  const P = emptyAgg(), F = emptyAgg();
  const byVk = new Map();
  let matched = 0;

  for (const [path, area] of Object.entries(S.areas)) {
    const fin = S.final[path], pre = S.prelim[path];
    if (!fin || !pre) continue;
    for (const [namn, fr] of Object.entries(fin)) {
      const pr = pre[namn];
      if (!pr) continue;                   // only districts present in BOTH counts
      matched++;
      addInto(P, pr); addInto(F, fr);
      const k = area.vk || '–';
      if (!byVk.has(k)) byVk.set(k, { namn: area.vkn || '–', p: emptyAgg(), f: emptyAgg(), tot: 0 });
      const v = byVk.get(k);
      addInto(v.p, pr); addInto(v.f, fr);
    }
  }
  for (const [path, area] of Object.entries(S.areas)) {
    const k = area.vk || '–';
    if (byVk.has(k)) byVk.get(k).tot += area.a;
  }

  const natFinal = S.meta.slutlig || {};
  mount('delta-tiles', el('div', {},
    tile('Distrikt i jämförelsen', nf.format(matched),
      `av ${nf.format(S.meta.preliminar.ska_raknas || 0)} totalt`,
      S.meta.preliminar.ska_raknas ? 100 * matched / S.meta.preliminar.ska_raknas : 0),
    tile('Nettoförändring röster', si(F.t - P.t),
      P.t ? `${sf(100 * (F.t - P.t) / P.t, 3)} % mot preliminärt` : ''),
    tile('Röster i jämförelsen', nf.format(F.t), 'slutligt räknade'),
    tile('Slutligt räknat totalt', `${nf.format(natFinal.raknade || 0)} / ${nf.format(natFinal.ska_raknas || 0)}`,
      `valdistrikt · uppdaterat ${natFinal.uppdaterad || '–'}`,
      natFinal.ska_raknas ? 100 * (natFinal.raknade || 0) / natFinal.ska_raknas : 0)
  ));

  document.getElementById('delta-method').innerHTML =
    '<strong>Om “Övriga”:</strong> i den preliminära räkningen buntas småpartier ihop i en ' +
    'restpost, medan den slutliga räkningen särredovisar dem. Därför räknas Övriga här som ' +
    '<em>totalen minus de åtta riksdagspartierna</em> i båda räkningarna – annars skulle posten ' +
    'visa en skenbar ras på flera tusen röster som bara beror på omklassificering.';

  if (!matched) {
    mount('delta-parties', emptyTable(
      ['Parti', 'Preliminärt', 'Slutligt', 'Diff röster', 'Andel prel.', 'Andel slutl.', 'Diff (p.e.)', 'Förändring'],
      'Inga distrikt är slutligt räknade ännu.'));
    mount('delta-vk', emptyTable(
      ['Riksdagsvalkrets', 'Slutligt räknade distrikt', 'Andel', 'Röster', 'Diff röster', 'Nettoförändring'],
      'Väntar på slutlig räkning.'));
    return;
  }

  const pr = partyRows(P, F);
  const shP = pr.map(r => P.t ? 100 * r.a / P.t : null);
  const shF = pr.map(r => F.t ? 100 * r.b / F.t : null);
  const pp = pr.map((_, i) => (shP[i] == null || shF[i] == null) ? null : shF[i] - shP[i]);
  const maxpp = Math.max(0.05, ...pp.filter(d => d != null).map(Math.abs));

  const body = pr.map((r, i) => el('tr', {},
    partyCell(r),
    el('td', {}, nf.format(r.a || 0)),
    el('td', {}, nf.format(r.b || 0)),
    el('td', {}, si((r.b || 0) - (r.a || 0))),
    el('td', {}, pf(shP[i], 2)),
    el('td', {}, pf(shF[i], 2)),
    el('td', {}, sf(pp[i], 3)),
    el('td', { class: 'dvcell' }, divBar(pp[i], maxpp))
  ));
  const foot = el('tr', {},
    el('td', {}, 'Summa'),
    el('td', {}, nf.format(P.t)),
    el('td', {}, nf.format(F.t)),
    el('td', {}, si(F.t - P.t)),
    el('td', {}, '100,00 %'), el('td', {}, '100,00 %'),
    el('td', {}, ''), el('td', {}, ''));
  mount('delta-parties', table(
    ['Parti', 'Preliminärt', 'Slutligt', 'Diff röster', 'Andel prel.', 'Andel slutl.', 'Diff (p.e.)',
      { label: 'Förändring', wide: true }],
    body, foot));

  S._vkRows = [...byVk.entries()]
    .map(([kod, v]) => ({ kod, ...v }))
    .sort((a, b) => b.f.n / (b.tot || 1) - a.f.n / (a.tot || 1) || a.namn.localeCompare(b.namn, 'sv'));
  filterVkList();
}

function filterVkList() {
  const q = document.getElementById('delta-search').value.trim().toLowerCase();
  const rows = S._vkRows.filter(r => !q || r.namn.toLowerCase().includes(q));
  document.getElementById('delta-count').textContent =
    `${nf.format(rows.length)} av ${nf.format(S._vkRows.length)}`;

  const maxNet = Math.max(1, ...S._vkRows.map(r => Math.abs(r.f.t - r.p.t)));
  const body = rows.map(r => el('tr', {},
    el('td', {}, r.namn),
    el('td', {}, `${nf.format(r.f.n)} / ${nf.format(r.tot)}`),
    el('td', {}, pf(r.tot ? 100 * r.f.n / r.tot : 0, 1)),
    el('td', {}, nf.format(r.f.t)),
    el('td', {}, si(r.f.t - r.p.t)),
    el('td', { class: 'dvcell' }, divBar(r.f.t - r.p.t, maxNet))
  ));
  const t = table(['Riksdagsvalkrets', 'Slutligt räknade distrikt', 'Andel', 'Röster', 'Diff röster',
    { label: 'Nettoförändring', wide: true }],
    body.length ? body : [el('tr', {}, el('td', { colspan: 6, class: 'empty' }, 'Inga träffar'))]);
  mount('delta-vk', t);
}

/* ---------- boot ---------------------------------------------------- */
function selectTab(which) {
  for (const k of ['upp', 'delta']) {
    const on = k === which;
    document.getElementById('tab-' + k).setAttribute('aria-selected', String(on));
    document.getElementById('panel-' + k).classList.toggle('hidden', !on);
  }
  history.replaceState(null, '', '#' + which);
}

async function boot() {
  try {
    const [meta, areas, prelim, final] = await Promise.all(
      ['meta', 'areas', 'prelim', 'final'].map(n =>
        fetch(`data/${n}.json`, { cache: 'no-cache' })
          .then(r => r.ok ? r.json() : (n === 'final' ? {} : Promise.reject(new Error(n))))));
    Object.assign(S, { meta, areas, prelim, final });
  } catch (e) {
    document.getElementById('boot').textContent =
      'Kunde inte läsa in data. Har hämtningsjobbet körts?';
    return;
  }

  const stamp = S.meta.hamtad ? new Date(S.meta.hamtad) : null;
  const ageMin = stamp ? (Date.now() - stamp) / 60000 : null;
  const u = document.getElementById('updated');
  u.textContent = stamp
    ? `· hämtat ${stamp.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}`
    : '';
  if (ageMin != null && ageMin > 90) u.classList.add('stale');

  document.getElementById('boot').classList.add('hidden');
  renderUppsamling();
  renderDelta();

  document.getElementById('tab-upp').onclick = () => selectTab('upp');
  document.getElementById('tab-delta').onclick = () => selectTab('delta');
  document.getElementById('upp-search').oninput = filterUppList;
  document.getElementById('upp-status').onchange = filterUppList;
  document.getElementById('delta-search').oninput = filterVkList;
  selectTab(location.hash === '#delta' ? 'delta' : 'upp');
}
boot();
