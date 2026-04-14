const map = L.map("map", {
  zoomControl: true
}).setView([44.75, -89.8], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const sirenLayer = L.layerGroup().addTo(map);
const warningLayer = L.layerGroup().addTo(map);
let hasFitMap = false;

function formatTime(value) {
  if (!value) {
    return "Unknown time";
  }

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderAssumptions(items) {
  const element = document.getElementById("assumptions");
  element.innerHTML = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderSources(meta) {
  setText("coverage-count", `${meta.sources.length} source${meta.sources.length === 1 ? "" : "s"}`);
  setText("coverage-note", meta.coverageNote);

  const sourceList = document.getElementById("source-list");
  sourceList.innerHTML = meta.sources
    .map((source) => {
      const warningMarkup = source.warning
        ? `<p class="source-warning">${escapeHtml(source.warning)}</p>`
        : "";

      return `
        <article class="source-card">
          <h3>${escapeHtml(source.name)}</h3>
          <p>${escapeHtml(source.coverage)}</p>
          <p>${source.count} sirens loaded</p>
          <p>${source.fallbackUsed ? "Using bundled fallback copy" : "Using live public GIS feed"}</p>
          ${warningMarkup}
        </article>
      `;
    })
    .join("");
}

function renderWarnings(alerts) {
  setText("warning-count", alerts.meta.totalCount);
  const warningList = document.getElementById("warning-list");

  if (!alerts.summaries.length) {
    warningList.innerHTML =
      '<p class="muted">No active Wisconsin tornado warnings right now.</p>';
    return;
  }

  warningList.innerHTML = alerts.summaries
    .map(
      (warning) => `
        <article class="warning-card">
          <h3>${escapeHtml(warning.areaDesc || warning.headline)}</h3>
          <p>${escapeHtml(warning.headline)}</p>
          <p>Issued by ${escapeHtml(warning.senderName || "NWS")}</p>
          <p>Ends ${escapeHtml(formatTime(warning.ends))}</p>
        </article>
      `
    )
    .join("");
}

function renderLiveStatus(data) {
  const warningCount = data.alerts.meta.totalCount;
  setText("status-updated", `Updated ${formatTime(data.generatedAt)}`);
  setText(
    "status-warning-brief",
    `${warningCount} warning${warningCount === 1 ? "" : "s"} in WI`
  );
}

function createPopup(feature) {
  const props = feature.properties;
  const alertMarkup = props.matchingAlerts.length
    ? props.matchingAlerts
        .map(
          (alert) => `
            <li>
              <strong>${escapeHtml(alert.areaDesc || alert.event)}</strong><br />
              Ends ${escapeHtml(formatTime(alert.ends))}
            </li>
          `
        )
        .join("")
    : "<li>No active Wisconsin tornado warning polygon currently intersects this siren point.</li>";

  return `
    <div class="popup">
      <h3>${escapeHtml(props.name)}</h3>
      <p>${escapeHtml(props.address)}</p>
      <p><strong>Status:</strong> ${
        props.likelyActive ? "Likely active" : "Likely inactive"
      }</p>
      <p><strong>Coverage source:</strong> ${escapeHtml(props.sourceName)}</p>
      <p><strong>Estimated outdoor range:</strong> ${
        props.rangeMiles ? `${escapeHtml(props.rangeMiles)} mi` : "Unknown"
      }</p>
      <ul>${alertMarkup}</ul>
    </div>
  `;
}

function createSirenMarker(feature) {
  if (feature.properties.likelyActive) {
    return L.marker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], {
      icon: L.divIcon({
        className: "leaflet-div-icon",
        html:
          '<div class="map-marker map-marker-active"><span class="map-marker-core">!</span><span class="map-wave map-wave-left"></span><span class="map-wave map-wave-right"></span></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -10]
      })
    });
  }

  return L.marker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], {
    icon: L.divIcon({
      className: "leaflet-div-icon",
      html: '<div class="map-marker map-marker-inactive"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -8]
    })
  });
}

function renderMap(data) {
  sirenLayer.clearLayers();
  warningLayer.clearLayers();

  const bounds = [];

  data.alerts.features.forEach((feature) => {
    const layer = L.geoJSON(feature, {
      style: {
        color: "#f97316",
        weight: 2,
        fillColor: "#fb923c",
        fillOpacity: 0.2
      }
    });

    layer.eachLayer((child) => {
      bounds.push(child.getBounds());
      child.bindPopup(
        `<strong>${escapeHtml(feature.properties.areaDesc || feature.properties.event)}</strong><br />${escapeHtml(
          feature.properties.headline
        )}`
      );
    });

    layer.addTo(warningLayer);
  });

  data.sirens.features.forEach((feature) => {
    const marker = createSirenMarker(feature);
    marker.bindPopup(createPopup(feature));
    marker.addTo(sirenLayer);
    bounds.push(marker.getLatLng());
  });

  if (!hasFitMap && bounds.length) {
    const group = L.featureGroup([
      ...warningLayer.getLayers(),
      ...sirenLayer.getLayers()
    ]);
    map.fitBounds(group.getBounds().pad(0.08));
    hasFitMap = true;
  }
}

function renderSummary(data) {
  setText("active-count", data.sirens.meta.activeCount);
  setText("total-count", data.sirens.meta.totalCount);
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const data = await response.json();
    renderSummary(data);
    renderLiveStatus(data);
    renderAssumptions(data.assumptions);
    renderSources(data.sirens.meta);
    renderWarnings(data.alerts);
    renderMap(data);
  } catch (error) {
    setText("status-updated", "Update failed");
    setText("status-warning-brief", error.message);
  }
}

refresh();
window.setInterval(refresh, 60_000);
