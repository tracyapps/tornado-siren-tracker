# Tornado Siren Tracker

Small Wisconsin-first Node app that plots public tornado siren locations on a map and marks each one as `likely active` or `likely inactive`.

## How status is calculated

This MVP does **not** use confirmed siren telemetry.

Instead, it:

1. Loads public siren point data for Wisconsin counties we have available.
2. Pulls active Wisconsin tornado-warning polygons from the National Weather Service.
3. Marks a siren as `likely active` when the siren point falls inside an active tornado-warning polygon.

That means the app is directionally useful, but not authoritative. Counties can have different activation rules, and some also sound sirens for severe thunderstorm warnings with a destructive tag.

## Current coverage

- Wisconsin map extent
- Statewide live tornado-warning polygons from NWS
- Brown County siren points from public GIS data

The code is structured so we can add more county sources later.

## Run locally

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Data sources

- Brown County public ArcGIS siren layer
- National Weather Service active alerts API
