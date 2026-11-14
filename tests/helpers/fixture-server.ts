import http from "node:http";
import type { LookupFunction } from "node:net";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import type { Fetcher } from "@/lib/scanner/types";

export type FixtureRoute = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

export type FixtureServer = {
  /** Base URL to use in scan inputs, e.g. "http://fixture.example/". */
  url: string;
  port: number;
  fetcher: Fetcher;
  close: () => Promise<void>;
};

/**
 * Local HTTP server on 127.0.0.1 with an ephemeral port, plus a fetcher that
 * routes any hostname through safeFetch's test-only options (mock DNS lookup,
 * checkIp allowing only 127.0.0.1, connectPort pinned to this server). These
 * options are only honored when NODE_ENV === "test" (vitest sets it).
 *
 * Requests are matched by pathname; unmatched paths get a 404.
 */
export async function startFixtureServer(
  routes: Record<string, FixtureRoute>,
): Promise<FixtureServer> {
  const sockets = new Set<import("node:net").Socket>();

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const route = routes[path] ?? routes["/404"];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, {
      "content-type": "text/html; charset=utf-8",
      ...route.headers,
    });
    res.end(route.body ?? "");
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not bind a port");
  }
  const port = address.port;

  // DNS lookup that always answers 127.0.0.1 regardless of hostname.
  const lookup: LookupFunction = ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      (options as { all?: boolean }).all === true;
    if (wantsAll) {
      cb(null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      cb(null, "127.0.0.1", 4);
    }
  }) as LookupFunction;

  const fetcher: Fetcher = (url) =>
    safeFetch(url, {
      lookup,
      checkIp: (ip) => ip !== "127.0.0.1",
      connectPort: port,
    });

  const close = () =>
    new Promise<void>((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });

  return { url: `http://fixture.example/`, port, fetcher, close };
}
