import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEffectiveOptions, safeFetch } from "@/lib/scanner/safe-fetch";
import { isBlockedIp, validateTargetUrl } from "@/lib/scanner/url-validation";

const APP_URL = "https://launchcheck.example";

type MockLookup = {
  lookup: LookupFunction;
  calls: string[];
};

function mockLookup(resolver: (hostname: string) => string | string[]): MockLookup {
  const calls: string[] = [];
  const lookup: LookupFunction = ((
    hostname: string,
    options: unknown,
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ) => {
    const cb =
      typeof options === "function"
        ? (options as (
            err: NodeJS.ErrnoException | null,
            address: string | { address: string; family: number }[],
            family?: number,
          ) => void)
        : callback;
    if (!cb) {
      throw new Error("lookup callback missing");
    }

    calls.push(hostname);
    const resolved = resolver(hostname);
    const list = (Array.isArray(resolved) ? resolved : [resolved]).map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));

    const wantsAll =
      typeof options === "object" && options !== null && "all" in options && options.all === true;

    if (wantsAll) {
      cb(null, list);
      return;
    }

    cb(null, list[0].address, list[0].family);
  }) as LookupFunction;

  return { lookup, calls };
}

async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Allow connecting to the local test server while still exercising DNS pin path. */
function allowLoopbackForTests(ip: string): boolean {
  return ip !== "127.0.0.1" && isBlockedIp(ip);
}

function fixtureFetch(
  url: string,
  port: number,
  extra: Omit<Parameters<typeof safeFetch>[1], "connectPort" | "appUrl"> = {},
) {
  return safeFetch(url, {
    ...extra,
    connectPort: port,
    appUrl: APP_URL,
  });
}

describe("validateTargetUrl", () => {
  it.each([
    ["ftp://example.com/", "blocked_scheme"],
    ["file:///etc/passwd", "blocked_scheme"],
    ["javascript:alert(1)", "blocked_scheme"],
    ["http://user:pass@example.com/", "credentials"],
    ["http://example.com:22/", "blocked_port"],
    ["http://example.com:8080/", "blocked_port"],
    ["http://example.com:3306/", "blocked_port"],
    ["http://127.0.0.1/", "ip_literal"],
    ["http://169.254.169.254/", "ip_literal"],
    ["http://[::1]/", "ip_literal"],
    ["http://10.0.0.1/", "ip_literal"],
    ["http://2130706433/", "ip_literal"],
    ["http://0x7f000001/", "ip_literal"],
    ["http://localhost/", "blocked_hostname"],
    ["http://foo.local/", "blocked_hostname"],
    ["http://service.internal/", "blocked_hostname"],
    ["http://box.lan/", "blocked_hostname"],
    ["http://app.localhost/", "blocked_hostname"],
  ] as const)("rejects %s (%s)", (input, reason) => {
    const result = validateTargetUrl(input, { appUrl: APP_URL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
    }
  });

  it("rejects the app's own host", () => {
    const result = validateTargetUrl("https://launchcheck.example/scan", { appUrl: APP_URL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("app_host");
    }
  });

  it("allows a normal public https URL (allowed counterpart)", () => {
    const result = validateTargetUrl("https://Example.COM/path?q=1", { appUrl: APP_URL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.protocol).toBe("https:");
      expect(result.url.hostname).toBe("example.com");
      expect(result.url.pathname).toBe("/path");
    }
  });

  it("allows empty / 80 / 443 ports (allowed counterpart)", () => {
    expect(validateTargetUrl("http://example.com/", { appUrl: APP_URL }).ok).toBe(true);
    expect(validateTargetUrl("http://example.com:80/", { appUrl: APP_URL }).ok).toBe(true);
    expect(validateTargetUrl("https://example.com:443/", { appUrl: APP_URL }).ok).toBe(true);
  });
});

describe("isBlockedIp", () => {
  it.each([
    ["0.1.2.3", true],
    ["10.0.0.1", true],
    ["100.64.0.1", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.0.0.1", true],
    ["192.0.2.1", true],
    ["192.168.1.1", true],
    ["198.18.0.1", true],
    ["198.51.100.1", true],
    ["203.0.113.1", true],
    ["224.0.0.1", true],
    ["240.0.0.1", true],
    ["255.255.255.255", true],
    ["::", true],
    ["::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["ff02::1", true],
    ["2001:db8::1", true],
    ["fd00:ec2::254", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:7f00:1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
    ["2001:4860:4860::8888", false],
    ["::ffff:8.8.8.8", false],
  ] as const)("%s -> %s", (ip, blocked) => {
    expect(isBlockedIp(ip)).toBe(blocked);
  });
});

describe("safeFetch DNS and connect-time checks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks a hostname that resolves only to a private address", async () => {
    const { lookup } = mockLookup(() => "10.0.0.5");
    const result = await safeFetch("https://private.example/", {
      lookup,
      appUrl: APP_URL,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked_ip");
      expect(result.message).not.toMatch(/10\.0\.0\.5/);
    }
  });

  it("blocks when DNS returns one public and one private address", async () => {
    const { lookup } = mockLookup(() => ["8.8.8.8", "192.168.0.2"]);
    const result = await safeFetch("https://mixed.example/", {
      lookup,
      appUrl: APP_URL,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked_ip");
    }
  });

  it("passes a pinned lookup that keeps returning the validated IP", async () => {
    let resolverCalls = 0;
    const { lookup } = mockLookup(() => {
      resolverCalls += 1;
      return resolverCalls === 1 ? "8.8.8.8" : "127.0.0.1";
    });

    let pinnedLookup: LookupFunction | undefined;
    const spy = vi.spyOn(https, "request").mockImplementation(((opts: https.RequestOptions) => {
      pinnedLookup = opts.lookup as LookupFunction;
      throw new Error("stop");
    }) as unknown as typeof https.request);

    // The mocked request throws before any connection is made, so safeFetch rejects.
    await safeFetch("https://rebind.example/", { lookup, appUrl: APP_URL, timeoutMs: 500 }).catch(
      () => undefined,
    );
    spy.mockRestore();

    expect(resolverCalls).toBe(1);
    expect(pinnedLookup).toBeDefined();
    const address = await new Promise<string>((resolve) => {
      (pinnedLookup as (h: string, o: object, cb: (e: null, a: string) => void) => void)(
        "rebind.example",
        {},
        (_e, a) => resolve(a),
      );
    });
    expect(address).toBe("8.8.8.8");
  });

  it("allows a hostname that resolves only to a public address (allowed counterpart)", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok-public");
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://public.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.toString("utf8")).toBe("ok-public");
        expect(result.truncated).toBe(false);
      }
    } finally {
      await fixture.close();
    }
  });
});

describe("safeFetch redirects, size, timeout, headers", () => {
  it("blocks a redirect to a private IP literal", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(302, { Location: "http://127.0.0.1/" });
      res.end();
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://redir.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("blocked_url");
      }
    } finally {
      await fixture.close();
    }
  });

  it("blocks a redirect to localhost", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(302, { Location: "http://localhost/" });
      res.end();
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://redir.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("blocked_url");
      }
    } finally {
      await fixture.close();
    }
  });

  it("blocks a redirect to a blocked scheme", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(302, { Location: "file:///etc/passwd" });
      res.end();
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://redir.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("blocked_url");
      }
    } finally {
      await fixture.close();
    }
  });

  it("fails with too_many_redirects after more than 3 hops", async () => {
    let hits = 0;
    const fixture = await listen((_req, res) => {
      hits += 1;
      res.writeHead(302, { Location: `http://redir.example/h${hits}` });
      res.end();
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://redir.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 3000,
        maxRedirects: 3,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("too_many_redirects");
      }
      expect(hits).toBe(4); // initial + 3 redirects attempted
    } finally {
      await fixture.close();
    }
  });

  it("follows a short safe redirect chain (allowed counterpart)", async () => {
    const fixture = await listen((req, res) => {
      if (req.url === "/a") {
        res.writeHead(302, { Location: "/b" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("landed");
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://ok.example/a", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.toString("utf8")).toBe("landed");
        expect(result.status).toBe(200);
      }
    } finally {
      await fixture.close();
    }
  });

  it("returns timeout when the server never responds", async () => {
    const fixture = await listen((_req, _res) => {
      // Never respond.
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const started = Date.now();
      const result = await fixtureFetch("http://slow.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 100,
      });
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("timeout");
      }
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await fixture.close();
    }
  });

  it("truncates bodies over the size limit and flags truncated", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(Buffer.alloc(100, 1));
      res.write(Buffer.alloc(100, 2));
      res.end();
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://big.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
        maxBytes: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(true);
        expect(result.body.length).toBe(50);
      }
    } finally {
      await fixture.close();
    }
  });

  it("returns a small body intact (allowed counterpart)", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("small");
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://small.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
        maxBytes: 5 * 1024 * 1024,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(false);
        expect(result.body.toString("utf8")).toBe("small");
      }
    } finally {
      await fixture.close();
    }
  });

  it("does not send cookies or authorization headers", async () => {
    // Capture on an object property: TypeScript narrows a bare `let seen = null`
    // to `never` after callback assignment, which caused TS2339 errors.
    const captured: { headers?: http.IncomingHttpHeaders } = {};
    const fixture = await listen((req, res) => {
      captured.headers = req.headers;
      res.writeHead(200);
      res.end("hdr");
    });

    try {
      const { lookup } = mockLookup(() => "127.0.0.1");
      const result = await fixtureFetch("http://hdr.example/", fixture.port, {
        lookup,
        checkIp: allowLoopbackForTests,
        timeoutMs: 2000,
      });
      expect(result.ok).toBe(true);
      expect(captured.headers).toBeDefined();
      expect(captured.headers?.cookie).toBeUndefined();
      expect(captured.headers?.authorization).toBeUndefined();
      expect(captured.headers?.["user-agent"]).toBe(`LaunchCheckBot/1.0 (+${APP_URL}/bot)`);
      expect(captured.headers?.["accept-encoding"]).toBe("identity");
    } finally {
      await fixture.close();
    }
  });
});

describe("DNS rebinding at connect time", () => {
  it("re-validates addresses on each hop so a rebound private IP is blocked", async () => {
    const fixture = await listen((req, res) => {
      if (req.url === "/one") {
        res.writeHead(302, { Location: "http://victim.example/two" });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end("nope");
    });

    try {
      const result = await fixtureFetch("http://first.example/one", fixture.port, {
        lookup: ((hostname, options, callback) => {
          const cb =
            typeof options === "function"
              ? options
              : (callback as (
                  err: NodeJS.ErrnoException | null,
                  address: string | { address: string; family: number }[],
                  family?: number,
                ) => void);
          const wantsAll =
            typeof options === "object" &&
            options !== null &&
            "all" in options &&
            options.all === true;

          if (hostname === "first.example") {
            const entry = { address: "127.0.0.1", family: 4 };
            if (wantsAll) {
              cb(null, [entry]);
            } else {
              cb(null, entry.address, entry.family);
            }
            return;
          }

          // Rebinding target: private address discovered at connect/lookup time.
          const entry = { address: "169.254.169.254", family: 4 };
          if (wantsAll) {
            cb(null, [entry]);
          } else {
            cb(null, entry.address, entry.family);
          }
        }) as LookupFunction,
        checkIp: (ip: string) => {
          if (ip === "127.0.0.1") {
            return false;
          }
          return isBlockedIp(ip);
        },
        timeoutMs: 2000,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("blocked_ip");
        expect(result.message).not.toMatch(/169\.254/);
      }
    } finally {
      await fixture.close();
    }
  });
});

describe("resolveEffectiveOptions", () => {
  const evil = {
    checkIp: () => false,
    lookup: (() => {}) as unknown as LookupFunction,
    connectPort: 1234,
    timeoutMs: 600_000,
    maxBytes: 10 ** 9,
    maxRedirects: 50,
  };

  it("ignores test-only overrides and clamps limits in production", () => {
    const eff = resolveEffectiveOptions(evil, "production");
    expect(eff.checkIp("127.0.0.1")).toBe(true);
    expect(eff.lookupFn).toBe(dns.lookup);
    expect(eff.connectPort).toBeUndefined();
    expect(eff.timeoutMs).toBe(10_000);
    expect(eff.maxBytes).toBe(5 * 1024 * 1024);
    expect(eff.maxRedirects).toBe(3);
  });

  it("honors overrides only when NODE_ENV is test (allowed counterpart)", () => {
    const eff = resolveEffectiveOptions(evil, "test");
    expect(eff.checkIp("127.0.0.1")).toBe(false);
    expect(eff.connectPort).toBe(1234);
  });

  it("lets callers lower limits in any environment (allowed counterpart)", () => {
    const eff = resolveEffectiveOptions(
      { timeoutMs: 500, maxBytes: 100, maxRedirects: 1 },
      "production",
    );
    expect(eff.timeoutMs).toBe(500);
    expect(eff.maxBytes).toBe(100);
    expect(eff.maxRedirects).toBe(1);
  });
});
