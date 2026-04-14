const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const SIREN_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const ALERT_CACHE_TTL_MS = 1000 * 60;
const STATUS_CACHE_TTL_MS = 1000 * 20;

const DATA_SOURCES = [
  {
    id: "brown-county",
    name: "Brown County Outdoor Warning Sirens",
    coverage: "Brown County, Wisconsin",
    attribution: "Brown County GIS",
    url:
      "https://bcgis.browncountywi.gov/arcgis/rest/services/EmergencyOps/OutdoorWarningSirens/MapServer/20/query?where=1%3D1&outFields=SirenName%2CFullAddress%2CRange_MI%2CLatitude%2CLongitude&returnGeometry=true&f=geojson",
    fallbackPath: path.join(DATA_DIR, "brown-county-sirens.geojson")
  }
];

const NWS_TORNADO_ALERTS_URL =
  "https://api.weather.gov/alerts/active?area=WI&event=Tornado%20Warning";

const cache = {
  sirens: null,
  sirensFetchedAt: 0,
  alerts: null,
  alertsFetchedAt: 0,
  status: null,
  statusFetchedAt: 0
};

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function polygonContainsPoint(point, polygonCoordinates) {
  if (!polygonCoordinates?.length) {
    return false;
  }

  if (!pointInRing(point, polygonCoordinates[0])) {
    return false;
  }

  for (let i = 1; i < polygonCoordinates.length; i += 1) {
    if (pointInRing(point, polygonCoordinates[i])) {
      return false;
    }
  }

  return true;
}

function geometryContainsPoint(geometry, point) {
  if (!geometry) {
    return false;
  }

  if (geometry.type === "Polygon") {
    return polygonContainsPoint(point, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygonCoordinates) =>
      polygonContainsPoint(point, polygonCoordinates)
    );
  }

  return false;
}

async function fetchJson(url, { headers = {}, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

function normalizeSirenFeature(feature, source, fallbackUsed) {
  if (feature?.geometry?.type !== "Point") {
    return null;
  }

  const [longitude, latitude] = feature.geometry.coordinates || [];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  const properties = feature.properties || {};
  const name = properties.SirenName || "Unnamed siren";
  const address = properties.FullAddress || "Address unavailable";
  const rangeMiles = Number(properties.Range_MI) || null;

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [longitude, latitude]
    },
    properties: {
      id: `${source.id}:${name}:${longitude.toFixed(5)}:${latitude.toFixed(5)}`,
      name,
      address,
      rangeMiles,
      sourceId: source.id,
      sourceName: source.name,
      coverage: source.coverage,
      attribution: source.attribution,
      fallbackUsed
    }
  };
}

async function loadSource(source) {
  let featureCollection;
  let fallbackUsed = false;
  let warning = null;

  try {
    featureCollection = await fetchJson(source.url, {
      headers: {
        Accept: "application/geo+json, application/json"
      },
      timeoutMs: 12000
    });
  } catch (error) {
    fallbackUsed = true;
    warning = `Live source unavailable, using bundled fallback. ${error.message}`;
    featureCollection = await readJson(source.fallbackPath);
  }

  const features = (featureCollection.features || [])
    .map((feature) => normalizeSirenFeature(feature, source, fallbackUsed))
    .filter(Boolean);

  return {
    id: source.id,
    name: source.name,
    coverage: source.coverage,
    attribution: source.attribution,
    fallbackUsed,
    warning,
    features
  };
}

async function getSirens() {
  const isFresh = cache.sirens && Date.now() - cache.sirensFetchedAt < SIREN_CACHE_TTL_MS;
  if (isFresh) {
    return cache.sirens;
  }

  const loadedSources = await Promise.all(DATA_SOURCES.map(loadSource));
  const features = loadedSources.flatMap((source) => source.features);

  const payload = {
    type: "FeatureCollection",
    features,
    meta: {
      updatedAt: new Date().toISOString(),
      totalCount: features.length,
      coverageNote:
        "Wisconsin map, but current siren point coverage is only as complete as the public county datasets we have loaded. This MVP ships with Brown County data and statewide tornado-warning polygons.",
      sources: loadedSources.map((source) => ({
        id: source.id,
        name: source.name,
        coverage: source.coverage,
        attribution: source.attribution,
        count: source.features.length,
        fallbackUsed: source.fallbackUsed,
        warning: source.warning
      }))
    }
  };

  cache.sirens = payload;
  cache.sirensFetchedAt = Date.now();
  return payload;
}

function normalizeAlertFeature(feature) {
  if (!feature?.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
    return null;
  }

  const properties = feature.properties || {};

  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      id: properties.id || feature.id,
      areaDesc: properties.areaDesc || "",
      certainty: properties.certainty || "",
      description: properties.description || "",
      ends: properties.ends || properties.expires || null,
      event: properties.event || "",
      headline: properties.headline || "",
      instruction: properties.instruction || "",
      senderName: properties.senderName || "",
      severity: properties.severity || "",
      sent: properties.sent || null,
      urgency: properties.urgency || ""
    }
  };
}

async function getAlerts() {
  const isFresh = cache.alerts && Date.now() - cache.alertsFetchedAt < ALERT_CACHE_TTL_MS;
  if (isFresh) {
    return cache.alerts;
  }

  const featureCollection = await fetchJson(NWS_TORNADO_ALERTS_URL, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "tornado-siren-tracker/0.1 (vercel)"
    },
    timeoutMs: 12000
  });

  const features = (featureCollection.features || [])
    .map(normalizeAlertFeature)
    .filter(Boolean);

  const payload = {
    type: "FeatureCollection",
    features,
    meta: {
      title: featureCollection.title || "Current Tornado Warning events for Wisconsin",
      updatedAt: featureCollection.updated || new Date().toISOString(),
      totalCount: features.length
    }
  };

  cache.alerts = payload;
  cache.alertsFetchedAt = Date.now();
  return payload;
}

function summarizeAlert(feature) {
  return {
    id: feature.properties.id,
    areaDesc: feature.properties.areaDesc,
    certainty: feature.properties.certainty,
    ends: feature.properties.ends,
    event: feature.properties.event,
    headline: feature.properties.headline,
    senderName: feature.properties.senderName,
    severity: feature.properties.severity,
    sent: feature.properties.sent,
    urgency: feature.properties.urgency
  };
}

function buildStatusPayload(sirens, alerts) {
  const alertSummaries = alerts.features.map(summarizeAlert);

  const statusFeatures = sirens.features.map((feature) => {
    const matchingAlerts = alerts.features
      .filter((alertFeature) =>
        geometryContainsPoint(alertFeature.geometry, feature.geometry.coordinates)
      )
      .map(summarizeAlert);

    const likelyActive = matchingAlerts.length > 0;

    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        status: likelyActive ? "likely-active" : "likely-inactive",
        likelyActive,
        matchingAlerts
      }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sirens: {
      type: "FeatureCollection",
      features: statusFeatures,
      meta: {
        ...sirens.meta,
        activeCount: statusFeatures.filter((feature) => feature.properties.likelyActive).length,
        inactiveCount: statusFeatures.filter((feature) => !feature.properties.likelyActive).length
      }
    },
    alerts: {
      ...alerts,
      summaries: alertSummaries
    },
    assumptions: [
      "This MVP treats a siren as likely active when its point falls inside an active Wisconsin tornado-warning polygon from the National Weather Service.",
      "This is not confirmed municipal siren telemetry. Different counties may trigger sirens differently, and some also sound for destructive severe thunderstorm warnings."
    ]
  };
}

async function getStatus() {
  const isFresh = cache.status && Date.now() - cache.statusFetchedAt < STATUS_CACHE_TTL_MS;
  if (isFresh) {
    return cache.status;
  }

  const [sirens, alerts] = await Promise.all([getSirens(), getAlerts()]);
  const payload = buildStatusPayload(sirens, alerts);
  cache.status = payload;
  cache.statusFetchedAt = Date.now();
  return payload;
}

module.exports = {
  buildStatusPayload,
  getAlerts,
  getSirens,
  getStatus
};
