Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiNGQwOGU5Yi0wZGM3LTQyNDgtYTNhYS0zMTZjYTAzNTRkZWIiLCJpZCI6MjY1NzQxLCJpYXQiOjE3MzU3NjQ3NjN9.wYL_fNJNQsAnc2aQFPfEYF3ukqZmm_d3nvaTXz8hX1Y";

document.addEventListener("DOMContentLoaded", () => {
  // ✅ Cambia aquí el horario activo
  const ACTIVE_TIMESTAMP_KEY = "timestamp_20_30"; // <- AHORA 20:30
  // const ACTIVE_TIMESTAMP_KEY = "timestamp_11am"; // <- (por si quieres volver a probar 11am)

  // Control de suavidad: FPS “lógico” (no hace falta 60)
  const TICK_MS = 50; // 20 FPS aprox

  // Fetch robusto para GitHub Pages (evita el /ReyesMagos.json)
  const jsonUrl = new URL("./ReyesMagos.json", window.location.href).toString();

  function toEpochSeconds(value) {
    // Acepta:
    // - number (1735902002)
    // - string number ("1735902002")
    // - ISO string ("2025-01-03T19:30:00Z")
    if (value == null) return NaN;

    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      // ¿es numérico?
      if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.floor(Number(trimmed));
      // ¿es ISO?
      const ms = Date.parse(trimmed);
      if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
    }
    return NaN;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function updatePopup(frame, giftsInterpolated) {
    const currentEl = document.getElementById("current-location");
    const lastEl = document.getElementById("last-location");
    const nextEl = document.getElementById("next-location");
    const giftsEl = document.getElementById("gift-count");

    if (currentEl) currentEl.innerText = frame["Municipio Actual"] ?? "-";
    if (lastEl) lastEl.innerText = frame["Último Municipio"] ?? "-";
    if (nextEl) nextEl.innerText = frame["Próximo Municipio"] ?? "-";
    if (giftsEl) giftsEl.innerText = `${Math.round(giftsInterpolated ?? frame["Regalos Entregados"] ?? 0)}`;
  }

  function setCamera(viewer, lon, lat, alt) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    });
  }

  async function initViewer() {
    console.log("📂 Cargando JSON:", jsonUrl);

    const viewer = new Cesium.Viewer("map", {
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

    viewer._cesiumWidget._creditContainer.style.display = "none";

    // ✅ Carga JSON
    const res = await fetch(jsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo cargar ReyesMagos.json (${res.status})`);
    const rawData = await res.json();
    console.log("✅ JSON cargado:", rawData?.length);

    // ✅ Normaliza timestamps al horario activo
    const data = rawData
      .map((f) => {
        const t = toEpochSeconds(f[ACTIVE_TIMESTAMP_KEY]);
        return { ...f, __t: t };
      })
      .filter((f) => Number.isFinite(f.__t))
      .sort((a, b) => a.__t - b.__t);

    if (!data.length) {
      console.error("❌ No hay datos válidos con el campo:", ACTIVE_TIMESTAMP_KEY);
      return;
    }

    const startT = data[0].__t;
    const endT = data[data.length - 1].__t;

    console.log("🧭 Horario activo:", ACTIVE_TIMESTAMP_KEY);
    console.log("🕗 Inicio (epoch):", startT, "Fin (epoch):", endT);

    // ✅ Coloca cámara al inicio (siempre)
    setCamera(viewer, data[0].longitude, data[0].latitude, data[0].altitude);
    updatePopup(data[0], data[0]["Regalos Entregados"] ?? 0);

    // ✅ Búsqueda binaria para encontrar el tramo actual (t entre i e i+1)
    const times = data.map((f) => f.__t);

    function findLeftIndex(t) {
      // mayor i tal que times[i] <= t
      let lo = 0;
      let hi = times.length - 1;

      if (t <= times[0]) return 0;
      if (t >= times[hi]) return hi - 1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid + 1;
        else hi = mid - 1;
      }
      return Math.max(0, hi);
    }

    // ✅ Loop sincronizado a reloj real
    let timer = null;

    function tick() {
      const now = Math.floor(Date.now() / 1000);

      if (now < startT) {
        // Aún no arranca: deja el primer punto y “espera”
        updatePopup(data[0], data[0]["Regalos Entregados"] ?? 0);
        return;
      }

      if (now >= endT) {
        // Fin: fija último punto
        const last = data[data.length - 1];
        setCamera(viewer, last.longitude, last.latitude, last.altitude);
        updatePopup(last, last["Regalos Entregados"] ?? 0);
        return;
      }

      const i = findLeftIndex(now);
      const a = data[i];
      const b = data[i + 1] ?? a;

      const dt = Math.max(1, b.__t - a.__t);
      const alpha = clamp01((now - a.__t) / dt);

      const lat = lerp(a.latitude, b.latitude, alpha);
      const lon = lerp(a.longitude, b.longitude, alpha);
      const alt = lerp(a.altitude, b.altitude, alpha);

      const giftsA = Number(a["Regalos Entregados"] ?? 0);
      const giftsB = Number(b["Regalos Entregados"] ?? giftsA);
      const gifts = lerp(giftsA, giftsB, alpha);

      setCamera(viewer, lon, lat, alt);
      updatePopup(a, gifts);
    }

    // ✅ Arranque inmediato si ya es la hora, o espera hasta que lo sea
    const now0 = Math.floor(Date.now() / 1000);
    if (now0 < startT) {
      console.log("⏳ Aún no son las 20:30 (según JSON). Quedará esperando y arrancará cuando toque.");
    } else {
      console.log("✅ Ya estamos dentro de la ventana del recorrido. Arrancando en el punto correcto.");
    }

    tick(); // primera pintura
    timer = setInterval(tick, TICK_MS);
  }

  initViewer().catch((err) => console.error("❌ Error initViewer:", err));
});

