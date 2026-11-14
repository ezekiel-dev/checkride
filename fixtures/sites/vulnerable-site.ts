import type { FixtureRoute } from "../../tests/helpers/fixture-server";

const HOME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Fixture App</title>
    <script src="/static/app.js"></script>
    <link rel="modulepreload" href="/static/vendor.js" />
  </head>
  <body>
    <h1>Fixture App</h1>
    <p>A small fixture site for scanner tests.</p>
  </body>
</html>`;

const APP_JS = `console.log("fixture app bundle");`;
const VENDOR_JS = `export const vendor = true;`;

/**
 * A fixture site with several issues: no HSTS header at all (and served over
 * plain HTTP). Deliberately contains no real-looking secrets.
 */
export const vulnerableSite: Record<string, FixtureRoute> = {
  "/": { body: HOME_HTML },
  "/static/app.js": { headers: { "content-type": "text/javascript" }, body: APP_JS },
  "/static/vendor.js": { headers: { "content-type": "text/javascript" }, body: VENDOR_JS },
  "/robots.txt": {
    headers: { "content-type": "text/plain" },
    body: "User-agent: *\nAllow: /\n",
  },
};
