/* =========================
   Reyes Magos Tracker (GitHub Pages)
   - Modo prueba: timestamp_11am
   - Luego cambiaremos a timestamp_20_30
========================= */

Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiNGQwOGU5Yi0wZGM3LTQyNDgtYTNhYS0zMTZjYTAzNTRkZWIiLCJpZCI6MjY1NzQxLCJpYXQiOjE3MzU3NjQ3NjN9.wYL_fNJNQsAnc2aQFPfEYF3ukqZmm_d3nvaTXz8hX1Y';

/** ✅ Cambia esto a 'timestamp_20_30' cuando me digas */
const ACTIVE_TIMESTAMP_FIELD = 'timestamp_11am';

/** Ruta relativa para GitHub Pages */
const JSON_PATH = './ReyesMagos.json';

document.addEventListener('DOMContentLoaded', () => {
  initViewer().catch((e) => console.error('❌ Error initViewer:', e));
});

async function initViewer() {
  console.log(`📂 Cargando JSON de ${JSON_PATH}...`);
  console.log(`🧭 Campo de tiempo activo: ${ACTIVE_TIMESTAMP_FIELD}`);

  const viewer = new Cesium.Viewer('map', {
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
  });

  viewer._cesiumWidget._creditContainer.style.display = 'none';

  // “Ambiente” algo más nocturno (sin romper tu overlay)
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyBox.show = false;

  const resp = await fetch(JSON_PATH, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`No se pudo cargar ${JSON_PATH} (HTTP ${resp.status})`);

  const raw = await resp.json();
  console.log('✅ JSON cargado correctamente:', raw?.length);

  // Exponer para depuración desde consola
  window.reyesData = raw;

  const frames = normalizeFrames(raw, ACTIVE_TIMESTAMP_FIELD);

  if (frames.length < 2) {
    console.warn('⚠️ El JSON no tiene suficientes puntos para animar.');
    return;
  }

  const firstT = frames[0].t;
  const lastT = frames[frames.length - 1].t;

  console.log('🕕 Primer timestamp:', firstT);
  console.log('🕙 Último timestamp:', lastT);

  // Set inicial “seguro”
  setCameraAndUI(viewer, frames[0], frames[0]);

  // Índice de trabajo (para no hacer búsqueda completa cada frame)
  let i = findStartIndex(frames, nowSec());

  function tick() {
    const now = nowSec();

    // Antes de empezar: fija primer frame, pero sigue esperando para arrancar justo a su hora
    if (now < firstT) {
      setCameraAndUI(viewer, frames[0], frames[0]);
      requestAnimationFrame(tick);
      return;
    }

    // Después de terminar: fija último frame y no animamos más (se queda “final”)
    if (now >= lastT) {
      setCameraAndUI(viewer, frames[frames.length - 1], frames[frames.length - 1]);
      return;
    }

    // Avanza índice mientras pasamos timestamps
    while (i < frames.length - 2 && now >= frames[i + 1].t) i++;

    const a = frames[i];
    const b = frames[i + 1];

    const dt = b.t - a.t;
    const alpha = dt > 0 ? clamp01((now - a.t) / dt) : 0;

    const interp = {
      t: now,
      lat: lerp(a.lat, b.lat, alpha),
      lon: lerp(a.lon, b.lon, alpha),
      alt: lerp(a.alt, b.alt, alpha),
      gifts: lerp(a.gifts, b.gifts, alpha),

      // texto: usamos el “estado” del tramo (puedes ajustar si prefieres b)
      municipioActual: a.municipioActual,
      ultimoMunicipio: a.ultimoMunicipio,
      proximoMunicipio: a.proximoMunicipio,
    };

    setCameraAndUI(viewer, interp, a);

    requestAnimationFrame(tick);
  }

  console.log('🚀 Animación lista. (No reinicia: va por tiempo real)');
  requestAnimationFrame(tick);
}

/* =========================
   Helpers
========================= */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeFrames(raw, tsField) {
  const out = [];

  for (const f of raw) {
    const t = parseTimestampToSec(f?.[tsField]);
    const lat = Number(f?.latitude);
    const lon = Number(f?.longitude);
    const alt = Number(f?.altitude);
    const gifts = Number(f?.['Regalos Entregados']);

    // Filtrado mínimo de datos inválidos
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) continue;

    out.push({
      t,
      lat,
      lon,
      alt,
      gifts: Number.isFinite(gifts) ? gifts : 0,

      municipioActual: String(f?.['Municipio Actual'] ?? ''),
      ultimoMunicipio: String(f?.['Último Municipio'] ?? ''),
      proximoMunicipio: String(f?.['Próximo Municipio'] ?? ''),
    });
  }

  // Aseguramos orden por tiempo ascendente
  out.sort((a, b) => a.t - b.t);

  return out;
}

/**
 * Acepta:
 * - número (segundos epoch)
 * - string ISO (2026-01-05T10:00:00Z)
 */
function parseTimestampToSec(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);

  if (typeof v === 'string') {
    // Si viene como número en string
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return Math.floor(asNum);

    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }

  return NaN;
}

function findStartIndex(frames, tNow) {
  // Queremos i tal que frames[i].t <= now < frames[i+1].t
  let lo = 0;
  let hi = frames.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= tNow) lo = mid + 1;
    else hi = mid - 1;
  }

  // hi queda como el índice del último <= now
  return Math.max(0, Math.min(frames.length - 2, hi));
}

function setCameraAndUI(viewer, frame, textFrame) {
  // Cámara: mantenemos orientación actual; sólo movemos destino.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(frame.lon, frame.lat, frame.alt),
  });

  // UI (popup)
  const cur = document.getElementById('current-location');
  const last = document.getElementById('last-location');
  const next = document.getElementById('next-location');
  const gifts = document.getElementById('gift-count');

  if (cur) cur.innerText = textFrame.municipioActual || '-';
  if (last) last.innerText = textFrame.ultimoMunicipio || '-';
  if (next) next.innerText = textFrame.proximoMunicipio || '-';
  if (gifts) gifts.innerText = formatInt(frame.gifts);
}

function formatInt(n) {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return v.toLocaleString('es-ES');
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
