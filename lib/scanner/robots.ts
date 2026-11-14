/**
 * Minimal robots.txt parser — no dependency.
 *
 * Supports: comments (#), multiple groups, `User-agent:` (specific agent takes
 * precedence over `*`), `Allow:`/`Disallow:` with longest-match precedence,
 * empty `Disallow:` meaning allow-all, and the `*` and `$` wildcards.
 * Unparseable or empty input means "allow everything".
 */

export type RobotsRule = {
  pattern: string;
  allow: boolean;
};

export type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export type RobotsParsed = {
  groups: RobotsGroup[];
};

export function parseRobots(text: string): RobotsParsed {
  const groups: RobotsGroup[] = [];
  let currentAgents: string[] | null = null;
  let currentRules: RobotsRule[] = [];
  let seenRule = false;

  const flush = () => {
    if (currentAgents && currentAgents.length > 0) {
      groups.push({ agents: currentAgents, rules: currentRules });
    }
    currentAgents = null;
    currentRules = [];
    seenRule = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") {
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (seenRule) {
        // A User-agent line after rules starts a new group.
        flush();
      }
      currentAgents ??= [];
      currentAgents.push(value.toLowerCase());
      continue;
    }

    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything" — it is not a rule.
      if (value === "") {
        continue;
      }
      if (currentAgents === null) {
        // Rules before any User-agent are ignored.
        continue;
      }
      seenRule = true;
      currentRules.push({ pattern: value, allow: field === "allow" });
    }
    // Other fields (Crawl-delay, Sitemap, ...) are ignored.
  }
  flush();

  return { groups };
}

function agentMatches(groupAgent: string, userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (groupAgent === "*") {
    return true;
  }
  // Robots matching is prefix-based on the product token: "LaunchCheckBot"
  // matches "LaunchCheckBot" and "LaunchCheckBot/1.0" style entries.
  return ua === groupAgent || ua.startsWith(groupAgent);
}

function ruleMatchesPath(pattern: string, path: string): number | null {
  const endAnchored = pattern.endsWith("$");
  const body = endAnchored ? pattern.slice(0, -1) : pattern;

  // Escape regex specials in each literal segment, then join on the `*`
  // wildcard (which matches any sequence, including "/").
  const escapeSegment = (segment: string) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexBody = body.split("*").map(escapeSegment).join(".*");
  const regex = new RegExp(`^${regexBody}${endAnchored ? "$" : ""}`);

  return regex.test(path) ? body.length : null;
}

/**
 * Whether `path` may be fetched for `userAgent`. Specific agent groups win over
 * `*`; longest matching rule wins; ties go to Allow (least restrictive).
 */
export function isAllowed(parsed: RobotsParsed, userAgent: string, path: string): boolean {
  const specific = parsed.groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agentMatches(a, userAgent)),
  );
  const applicable =
    specific.length > 0 ? specific : parsed.groups.filter((g) => g.agents.includes("*"));

  let best: { length: number; allow: boolean } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      const length = ruleMatchesPath(rule.pattern, path);
      if (length === null) {
        continue;
      }
      if (
        best === null ||
        length > best.length ||
        (length === best.length && rule.allow && !best.allow)
      ) {
        best = { length, allow: rule.allow };
      }
    }
  }

  // No matching rule means allowed; a matching Allow also means allowed.
  return best === null || best.allow;
}
