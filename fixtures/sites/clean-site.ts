import type { FixtureRoute } from "../../tests/helpers/fixture-server";

const HOME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Clean Fixture</title>
    <script src="/static/main.js"></script>
  </head>
  <body>
    <h1>Clean Fixture</h1>
    <p>A fixture site that passes the Phase 2A checks.</p>
  </body>
</html>`;

const MAIN_JS = `console.log("clean fixture bundle");`;

/**
 * A fixture site that passes the Phase 2A checks: strong HSTS header and a
 * single same-origin script. No real-looking secrets anywhere.
 */
export const cleanSite: Record<string, FixtureRoute> = {
  "/": {
    headers: {
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    },
    body: HOME_HTML,
  },
  "/static/main.js": { headers: { "content-type": "text/javascript" }, body: MAIN_JS },
  "/robots.txt": {
    headers: { "content-type": "text/plain" },
    body: "User-agent: *\nAllow: /\n",
  },
};
