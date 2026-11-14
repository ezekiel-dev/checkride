import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "@/lib/scanner/robots";

const UA = "LaunchCheckBot";

describe("parseRobots / isAllowed", () => {
  it("allows everything when the file is missing or empty", () => {
    const parsed = parseRobots("");
    expect(isAllowed(parsed, UA, "/anything")).toBe(true);
  });

  it("allows everything on garbage input", () => {
    const parsed = parseRobots("this is not robots.txt\n:::\n\x00\x01");
    expect(isAllowed(parsed, UA, "/private")).toBe(true);
  });

  it("honors a Disallow rule", () => {
    const parsed = parseRobots("User-agent: *\nDisallow: /admin\n");
    expect(isAllowed(parsed, UA, "/admin")).toBe(false);
    expect(isAllowed(parsed, UA, "/public")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    const parsed = parseRobots("User-agent: *\nDisallow:\n");
    expect(isAllowed(parsed, UA, "/anything")).toBe(true);
  });

  it("supports comments", () => {
    const parsed = parseRobots("# comment\nUser-agent: * # inline\nDisallow: /x # why\n");
    expect(isAllowed(parsed, UA, "/x")).toBe(false);
    expect(isAllowed(parsed, UA, "/y")).toBe(true);
  });

  it("supports multiple groups", () => {
    const parsed = parseRobots(
      "User-agent: Googlebot\nDisallow: /google-only\n\nUser-agent: *\nDisallow: /all\n",
    );
    expect(isAllowed(parsed, UA, "/google-only")).toBe(true);
    expect(isAllowed(parsed, UA, "/all")).toBe(false);
  });

  it("prefers the LaunchCheckBot group over *", () => {
    const parsed = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: LaunchCheckBot\nDisallow: /private\n",
    );
    expect(isAllowed(parsed, UA, "/private")).toBe(false);
    expect(isAllowed(parsed, UA, "/public")).toBe(true);
  });

  it("uses longest-match precedence between Allow and Disallow", () => {
    const parsed = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
    expect(isAllowed(parsed, UA, "/private/public/page")).toBe(true);
    expect(isAllowed(parsed, UA, "/private/secret")).toBe(false);
  });

  it("supports the * wildcard inside patterns", () => {
    const parsed = parseRobots("User-agent: *\nDisallow: /*.pdf$\n");
    expect(isAllowed(parsed, UA, "/files/report.pdf")).toBe(false);
    expect(isAllowed(parsed, UA, "/files/report.pdf.exe")).toBe(true);
  });

  it("supports the $ end anchor", () => {
    const parsed = parseRobots("User-agent: *\nDisallow: /tmp$\n");
    expect(isAllowed(parsed, UA, "/tmp")).toBe(false);
    expect(isAllowed(parsed, UA, "/tmp/file")).toBe(true);
  });
});
