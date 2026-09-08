// ======================================================================
// PETA DISTRIBUTOR ELITECH — app.js
// ======================================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzGDodcTkLUQsO8er-VucZ2wgsSiXK67zq3cF0grEaoY61Cz54s_mgitXmLDs7iyf6n/exec';
const GEOJSON_PATH = 'assets/indonesia-provinces-elitech.geojson';

// Kabupaten/kota NTT -> region kustom (harus sama dengan pembagian di build_map_data.js)
const NTT_KUPANG_NAMES = ['Kupang', 'Timor Tengah Selatan', 'Timor Tengah Utara',
  'Belu', 'Malaka', 'Alor', 'Rote Ndao', 'Sabu Raijua',
  'Sumba Barat', 'Sumba Timur', 'Sumba Tengah', 'Sumba Barat Daya'];
const NTT_FLORES_NAMES = ['Ende', 'Sikka', 'Flores Timur', 'Ngada', 'Nagekeo',
  'Manggarai', 'Manggarai Barat', 'Manggarai Timur', 'Lembata'];

function resolveNttRegion(kabupatenLabel) {
  const s = kabupatenLabel.toUpperCase();
  if (NTT_KUPANG_NAMES.some(n => s.includes(n.toUpperCase()))) return 'KEPULAUAN KUPANG';
  if (NTT_FLORES_NAMES.some(n => s.includes(n.toUpperCase()))) return 'KEPULAUAN FLORES';
  return null;
}

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------
const state = {
  geojson: null,
  wilayah: [],       // [{no, provinsi, distributors:[nama,...]}]
  distributor: [],   // [{nama, alamat, provinsi, telepon}]
  kabupaten: [],      // [{provinsi, kabupaten}]

  featureByProvinsi: new Map(),   // provinsi(upper) -> geojson feature
  wilayahByProvinsi: new Map(),   // provinsi(upper) -> string[] nama distributor
  distributorInfo: new Map(),    // nama -> {alamat, provinsi, telepon}
  distributorCoverage: new Map(), // nama -> Set(provinsi)
  searchIndex: [],                // combined search entries

  projection: null,
  path: null,
  zoom: null,
  svg: null,
  mapGroup: null,
  width: 1200,
  height: 620,

  isMobile: window.matchMedia('(max-width: 768px)').matches,
};

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------
init();

async function init() {
  try {
    const [geojson, apiData] = await Promise.all([
      d3.json(GEOJSON_PATH),
      fetch(GAS_URL + '?action=all').then(r => r.json()),
    ]);

    state.geojson = geojson;
    state.wilayah = apiData.wilayah || [];
    state.distributor = apiData.distributor || [];
    state.kabupaten = apiData.kabupaten || [];

    buildIndices();
    renderMap();
    bindUiEvents();
  } catch (err) {
    console.error('Gagal memuat data:', err);
    document.getElementById('mapStage').innerHTML =
      '<p style="text-align:center;margin-top:40px;color:#999">Gagal memuat data peta. Coba muat ulang halaman.</p>';
  }
}

// ----------------------------------------------------------------------
// Build lookup indices
// ----------------------------------------------------------------------
function buildIndices() {
  state.geojson.features.forEach(f => {
    state.featureByProvinsi.set(f.properties.provinsi.toUpperCase(), f);
  });

  state.wilayah.forEach(row => {
    const key = row.provinsi.toUpperCase();
    state.wilayahByProvinsi.set(key, row.distributors || []);
    (row.distributors || []).forEach(nama => {
      if (!state.distributorCoverage.has(nama)) state.distributorCoverage.set(nama, new Set());
      state.distributorCoverage.get(nama).add(row.provinsi);
    });
  });

  state.distributor.forEach(d => {
    state.distributorInfo.set(d.nama, d);
  });

  // ---- Search index ----
  const idx = [];

  state.geojson.features.forEach(f => {
    idx.push({ type: 'PROVINSI', label: f.properties.provinsi, target: f.properties.provinsi });
  });

  state.kabupaten.forEach(row => {
    let targetProvinsi = row.provinsi.toUpperCase();
    let displayProvinsi = row.provinsi;
    if (targetProvinsi === 'NUSA TENGGARA TIMUR') {
      const resolved = resolveNttRegion(row.kabupaten);
      if (resolved) { targetProvinsi = resolved; displayProvinsi = resolved; }
    }
    idx.push({
      type: 'KABUPATEN',
      label: `${row.kabupaten} | ${displayProvinsi}`,
      target: targetProvinsi,
    });
  });

  state.distributorCoverage.forEach((provSet, nama) => {
    idx.push({ type: 'DISTRIBUTOR', label: nama, target: nama });
  });

  state.searchIndex = idx;
}

// ----------------------------------------------------------------------
// Map rendering
// ----------------------------------------------------------------------
function renderMap() {
  const svg = d3.select('#map');
  state.svg = svg;

  const projection = d3.geoMercator().fitSize([state.width, state.height], state.geojson);
  const path = d3.geoPath(projection);
  state.projection = projection;
  state.path = path;

  const g = svg.append('g').attr('id', 'mapGroup');
  state.mapGroup = g;

  g.selectAll('path.province-path')
    .data(state.geojson.features)
    .enter()
    .append('path')
    .attr('class', 'province-path')
    .attr('data-provinsi', d => d.properties.provinsi)
    .attr('d', path)
    .on('mouseenter', onProvinceHoverIn)
    .on('mousemove', onProvinceHoverMove)
    .on('mouseleave', onProvinceHoverOut)
    .on('click', onProvinceClick);

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
  state.zoom = zoom;
  svg.call(zoom).on('dblclick.zoom', null);
}

function onProvinceHoverIn(event, d) {
  if (state.isMobile) return; // no hover state on touch
  d3.select(this).classed('hovered', true);
  const label = document.getElementById('hoverLabel');
  label.textContent = titleCase(d.properties.provinsi);
  label.classList.remove('hidden');
}

function onProvinceHoverMove(event) {
  if (state.isMobile) return;
  const label = document.getElementById('hoverLabel');
  const [x, y] = d3.pointer(event, document.getElementById('mapStage'));
  label.style.left = x + 'px';
  label.style.top = y + 'px';
}

function onProvinceHoverOut(event, d) {
  if (state.isMobile) return;
  d3.select(this).classed('hovered', false);
  document.getElementById('hoverLabel').classList.add('hidden');
}

function onProvinceClick(event, d) {
  clearSelection();
  zoomToFeature(d);
  openPanelForProvince(d.properties.provinsi);
}

// ----------------------------------------------------------------------
// Zoom helpers
// ----------------------------------------------------------------------
function zoomToFeature(feature) {
  const [[x0, y0], [x1, y1]] = state.path.bounds(feature);
  const dx = x1 - x0, dy = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const scale = Math.max(1, Math.min(8, 0.85 / Math.max(dx / state.width, dy / state.height)));
  const translate = [state.width / 2 - scale * cx, state.height / 2 - scale * cy];

  state.svg.transition()
    .duration(700)
    .ease(d3.easeCubicInOut)
    .call(state.zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));

  d3.select(`path[data-provinsi="${cssEscape(feature.properties.provinsi)}"]`)
    .classed('selected', true);
}

function resetZoom() {
  state.svg.transition()
    .duration(700)
    .ease(d3.easeCubicInOut)
    .call(state.zoom.transform, d3.zoomIdentity);
}

function clearSelection() {
  d3.selectAll('.province-path').classed('selected', false).classed('hovered', false);
}

// ----------------------------------------------------------------------
// Panel
// ----------------------------------------------------------------------
function openPanelForProvince(provinsi) {
  const key = provinsi.toUpperCase();
  const distributors = state.wilayahByProvinsi.get(key) || [];

  document.getElementById('panelTitle').textContent = titleCase(provinsi);

  const body = document.getElementById('panelBody');
  if (distributors.length === 0) {
    body.innerHTML = '<p class="empty-note">Belum ada distributor terdaftar untuk provinsi ini.</p>';
  } else {
    body.innerHTML = distributors.map(nama => distCardHtml(nama, provinsi)).join('');
  }
  bindShareButtons(body);
  showPanel();
}

function openPanelForDistributor(nama) {
  clearSelection();
  const coverage = Array.from(state.distributorCoverage.get(nama) || []);
  coverage.forEach(p => {
    d3.select(`path[data-provinsi="${cssEscape(p)}"]`).classed('selected', true);
  });
  resetZoom();

  document.getElementById('panelTitle').textContent = titleCase(nama);

  const info = state.distributorInfo.get(nama) || {};
  const body = document.getElementById('panelBody');
  const primaryProvinsi = info.provinsi || (coverage[0] || '');

  let html = distCardHtml(nama, primaryProvinsi);
  html += '<div style="margin-top:14px;font-size:12px;color:#999;font-weight:700;letter-spacing:.3px;">MENCAKUP WILAYAH</div>';
  html += '<div style="margin-top:8px;">' + coverage.map(p =>
    `<span class="coverage-chip" data-goto="${escapeAttr(p)}">${titleCase(p)}</span>`
  ).join('') + '</div>';

  body.innerHTML = html;
  bindShareButtons(body);

  body.querySelectorAll('.coverage-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.getAttribute('data-goto');
      const feature = state.featureByProvinsi.get(p.toUpperCase());
      clearSelection();
      if (feature) zoomToFeature(feature);
      openPanelForProvince(p);
    });
  });

  showPanel();
}

function distCardHtml(nama, provinsiContext) {
  const info = state.distributorInfo.get(nama) || {};
  return `
    <div class="dist-card">
      <div class="dist-name-row">
        <div>
          <div class="dist-name">${escapeHtml(nama)}</div>
          <div class="dist-addr">${escapeHtml(info.alamat || '-')}</div>
          <div class="dist-phone">${escapeHtml(info.telepon || '-')}</div>
        </div>
        <button class="share-btn"
          data-nama="${escapeAttr(nama)}"
          data-alamat="${escapeAttr(info.alamat || '')}"
          data-telepon="${escapeAttr(info.telepon || '')}"
          data-provinsi="${escapeAttr(provinsiContext || '')}">SHARE</button>
      </div>
    </div>`;
}

function bindShareButtons(scope) {
  scope.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = [
        titleCase(btn.getAttribute('data-provinsi')),
        btn.getAttribute('data-nama'),
        btn.getAttribute('data-alamat'),
        btn.getAttribute('data-telepon'),
      ].join('\n');
      copyToClipboard(text);
      showToast();
    });
  });
}

function showPanel() {
  document.getElementById('panel').classList.remove('hidden');
  requestAnimationFrame(() => {
    document.getElementById('panel').classList.add('open');
    document.getElementById('overlay').classList.remove('hidden');
    requestAnimationFrame(() => document.getElementById('overlay').classList.add('visible'));
  });
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
  clearSelection();
  resetZoom();
  setTimeout(() => {
    document.getElementById('panel').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  }, 700);
}

// ----------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------
let searchDebounce = null;

function bindUiEvents() {
  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('overlay').addEventListener('click', closePanel);

  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(input.value), 150);
  });
  input.addEventListener('focus', () => runSearch(input.value));
  document.getElementById('searchBtn').addEventListener('click', () => runSearch(input.value));

  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.search-wrap');
    if (!wrap.contains(e.target)) hideDropdown();
  });

  window.addEventListener('resize', () => {
    state.isMobile = window.matchMedia('(max-width: 768px)').matches;
  });
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (q.length === 0) { hideDropdown(); return; }

  const results = state.searchIndex
    .filter(e => e.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    })
    .slice(0, 8);

  renderDropdown(results);
}

function renderDropdown(results) {
  const dd = document.getElementById('searchDropdown');
  if (results.length === 0) {
    dd.innerHTML = '<div class="empty-note" style="padding:10px;text-align:center;">Tidak ditemukan</div>';
  } else {
    dd.innerHTML = results.map((r, i) =>
      `<button class="search-item" data-idx="${i}">${escapeHtml(r.label)}</button>`
    ).join('');
  }
  dd.classList.remove('hidden');

  dd.querySelectorAll('.search-item').forEach((btn, i) => {
    btn.addEventListener('click', () => selectSearchResult(results[i]));
  });
}

function hideDropdown() {
  document.getElementById('searchDropdown').classList.add('hidden');
}

function selectSearchResult(result) {
  hideDropdown();
  document.getElementById('searchInput').value = result.label;

  if (result.type === 'DISTRIBUTOR') {
    openPanelForDistributor(result.target);
  } else {
    clearSelection();
    const feature = state.featureByProvinsi.get(result.target.toUpperCase());
    if (feature) zoomToFeature(feature);
    openPanelForProvince(result.target);
  }
}

// ----------------------------------------------------------------------
// Clipboard + toast
// ----------------------------------------------------------------------
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

let toastTimer = null;
function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 1600);
}

// ----------------------------------------------------------------------
// Small utils
// ----------------------------------------------------------------------
function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
function cssEscape(str) {
  return String(str).replace(/["\\]/g, '\\$&');
}
