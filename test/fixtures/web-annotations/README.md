# Web Annotations Browser Fixtures

These fixtures support Docker-worker browser validation for the Web Annotations plugin.

- `static/index.html` covers element annotation, free-pin fallback, large text truncation, missing source hints, and cross-origin iframe unavailable handling.
- `react-like/index.html` covers a React-development-style page with stable `data-pibo-id`, `data-testid`, and LocatorJS-compatible source-hint attributes. It is intentionally static so validation does not require package installation or a networked React dev server; Chat Web's Vite app remains the full React UI fixture for end-to-end attachment checks.

Run `node scripts/validate-web-annotations-browser.mjs` after `npm run build` inside the Docker compute worker.
