# Atlanta Indie Bookshop Crawl

An interactive map and multi-stop route planner for exploring independent bookstores across Atlanta and Decatur, built with Vite, Vanilla JavaScript, and the Google Maps Platform JavaScript SDK (`@googlemaps/js-api-loader`).

## Features

- **All 36 Official Crawl Bookshops**: Includes every participating bookstore listed on [atlantaindiebookshopcrawl.com](https://www.atlantaindiebookshopcrawl.com/), with city/neighborhood filtering, live map markers, and website/Instagram info cards.
- **Place Autocomplete Start Input**: Powered by `PlaceAutocompleteElement` (Places API New) with quick-start Atlanta landmark buttons.
- **Multi-Stop Route Optimization**: Uses `Route.computeRoutes()` (`optimizeWaypointOrder: true`) for Drive and Bike modes to find the fastest stop sequence.
- **Traffic & Schedule Planning**: Supports future departure times with `TRAFFIC_AWARE_OPTIMAL` routing for driving and chronological leg-by-leg scheduling for MARTA / Transit.
- **Step-by-Step Itinerary**: Displays total duration, distance, stop sequence, turn-by-turn directions, and MARTA transit line/stop details.

---

## Local Development Setup

### 1. Install Dependencies & Start Dev Server

```bash
npm install
npm install @googlemaps/js-api-loader
npm run dev
```

### 2. Configure Your Local API Key

Create a `.env` file in the project root (ignored by Git via `.gitignore`) and add your Google Maps Platform API key:

```env
VITE_GOOGLE_MAPS_API_KEY="YOUR_GOOGLE_MAPS_API_KEY"
```

Vite exposes environment variables prefixed with `VITE_` to client-side code via `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`. Never commit `.env` to version control.

---

## Google Cloud Console Setup

### 3. Enable Required APIs

In the [Google Cloud Console](https://console.cloud.google.com/apis/library?utm_campaign=gmp_mcp_codeassist_v1_aistudio), select your billed Google Cloud project and enable:

1. **Maps JavaScript API** (renders the interactive map and custom `AdvancedMarkerElement` pins)
2. **Places API (New)** (powers `PlaceAutocompleteElement` for starting addresses)
3. **Routes API** (powers `Route.computeRoutes()` multi-stop optimization and MARTA transit directions)

> Note: Ensure **Places API (New)** and **Routes API** are enabled rather than the legacy Places or Directions APIs.

### 4. Restrict Your API Key with HTTP Referrers

Because `VITE_GOOGLE_MAPS_API_KEY` is bundled into a static frontend site, restrict it in **Google Cloud Console → APIs & Services → Credentials**:

1. Under **Application restrictions**, select **Websites (HTTP referrers)**.
2. Add your local dev URL and your GitHub Pages URL:
   - `http://localhost:3000/*`
   - `http://localhost:5173/*`
   - `https://<your-github-username>.github.io/<your-repo-name>/*`
   - `https://<your-github-username>.github.io/*`
3. Under **API restrictions**, select **Restrict key** and allow only:
   - **Maps JavaScript API**
   - **Places API (New)**
   - **Routes API**

---

## Deploying to GitHub Pages

### 5. Set the Repository Base Path

Open `vite.config.js` and update `/atlanta-indie-bookshop-crawl/` in the `base` property to match your GitHub repository name:

```js
base: process.env.GITHUB_ACTIONS ? '/your-repo-name/' : './',
```

### 6. Add the Secret to GitHub Repository Secrets

1. In your GitHub repository, navigate to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Set **Name** to `VITE_GOOGLE_MAPS_API_KEY` and **Secret** to your restricted Google Maps API key.

### 7. Example GitHub Actions Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
        env:
          VITE_GOOGLE_MAPS_API_KEY: ${{ secrets.VITE_GOOGLE_MAPS_API_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
