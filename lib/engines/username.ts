// ---------------------------------------------------------------------------
// USERNAME ENGINE
//
// Combines multiple keyless techniques instead of one big API:
//   1. Rich JSON APIs (GitHub, GitLab, Keybase, HN, package registries,
//      dev.to, Stack Exchange, Bluesky, fediverse, Chess/Lichess...)
//   2. Generic public-profile HTTP checks over a curated, false-positive-aware
//      site list (HTTP status + page-content markers).
//   3. Avatar extraction from every found profile
//   4. Perceptual hashing + cross-profile comparison
//   5. Name/link correlation
//
// Fault model: every check is independent. Failures/timeouts/rate limits are
// reported per-source and never crash the scan.
// ---------------------------------------------------------------------------

import { safeFetch, mapPool } from "../http";
import { hashImageUrl, imageSimilarity, hashToString, type PerceptualHashes } from "../image";
import { normalizeUsername, nameSimilarity, extractUrls, hostnameOf } from "../normalize";
import { USERNAME_SITES, type UsernameSite } from "../sites";
import type { CheckResult, Correlation, EngineResult, Finding } from "../types";
import { getIntegration } from "../registry";

const MASTODON_INSTANCES = [
  "mastodon.social",
  "mastodon.online",
  "mstdn.social",
  "fosstodon.org",
  "tech.lgbt",
  "mastodon.world",
  "mas.to",
  "infosec.exchange",
  "hachyderm.io",
  "chaos.social",
  "mastodon.xyz",
  "social.coop",
  "c.im",
  "xoxo.zone",
  "kolektiva.social",
];

function r(sourceId: string, patch: Partial<CheckResult> & { status: CheckResult["status"] }): CheckResult {
  const meta = getIntegration(sourceId);
  return {
    sourceId,
    sourceName: meta?.name ?? sourceId,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Rich API checks
// ---------------------------------------------------------------------------

async function checkGitHub(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://api.github.com/users/${encodeURIComponent(u)}`, {
    headers: { Accept: "application/vnd.github+json" },
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("github", { status: "not-found", elapsedMs: Date.now() - started });
    if (res.rateLimited) return r("github", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("github", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  return r("github", {
    status: "found",
    url: j.html_url,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.login,
      displayName: j.name ?? undefined,
      bio: j.bio ?? undefined,
      location: j.location ?? undefined,
      avatarUrl: j.avatar_url ?? undefined,
      joinedAt: j.created_at,
      followers: j.followers,
      links: [j.blog, j.html_url].filter(Boolean) as string[],
      extra: { publicRepos: j.public_repos, company: j.company, twitter: j.twitter_username },
    },
  });
}

async function checkGitHubEvents(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://api.github.com/users/${encodeURIComponent(u)}/events/public`, {
    headers: { Accept: "application/vnd.github+json" },
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("github-events", { status: "not-found", elapsedMs: Date.now() - started });
    return r("github-events", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const events = res.body as any[];
  const repos = [...new Set(events.map((e) => e.repo?.name).filter(Boolean))];
  const lastEvent = events[0]?.created_at;
  const types: Record<string, number> = {};
  for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
  return r("github-events", {
    status: events.length ? "found" : "not-found",
    url: `https://github.com/${u}`,
    elapsedMs: Date.now() - started,
    message: events.length
      ? `${events.length} recent public events; last activity ${lastEvent}; repos: ${repos.slice(0, 5).join(", ")}`
      : "Account exists but no recent public events.",
    profile: {
      extra: { eventCount: events.length, lastEvent, repos: repos.slice(0, 15), eventTypes: types },
    },
  });
}

async function checkGitLab(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`,
    { timeoutMs: 8000, headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    if (res.rateLimited) return r("gitlab", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("gitlab", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const arr = res.body as any[];
  if (!Array.isArray(arr) || arr.length === 0) {
    return r("gitlab", { status: "not-found", elapsedMs: Date.now() - started });
  }
  const j = arr[0];
  return r("gitlab", {
    status: "found",
    url: j.web_url,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.username,
      displayName: j.name ?? undefined,
      bio: j.bio ?? undefined,
      location: j.location ?? undefined,
      avatarUrl: j.avatar_url ?? undefined,
      joinedAt: j.created_at,
      links: [j.web_url, j.website_url].filter(Boolean) as string[],
    },
  });
}

async function checkKeybase(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(u)}`,
    { timeoutMs: 8000 },
  );
  if (!res.ok) {
    if (res.rateLimited) return r("keybase", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("keybase", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (j.status?.code !== 0 || !j.them) {
    return r("keybase", { status: "not-found", elapsedMs: Date.now() - started });
  }
  const t = j.them;
  const proofs = (t.proofs_summary?.all ?? []).map((p: any) => ({
    service: p.presentation_tag ?? p.service,
    nametag: p.nametag,
    url: p.service_url,
  }));
  const links = proofs.map((p: any) => p.url).filter(Boolean);
  return r("keybase", {
    status: "found",
    url: `https://keybase.io/${t.basics?.username ?? u}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: t.basics?.username,
      displayName: t.profile?.full_name ?? undefined,
      bio: t.profile?.bio ?? undefined,
      location: t.profile?.location ?? undefined,
      avatarUrl: t.photos?.[0]?.url ?? undefined,
      joinedAt: t.basics?.ctime ? new Date(t.basics.ctime * 1000).toISOString() : undefined,
      links,
      extra: {
        proofs,
        pgpFingerprint: t.public_keys?.primary?.key_fingerprint,
        keyBits: t.public_keys?.primary?.key_bits,
      },
    },
  });
}

async function checkHackerNews(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(u)}.json`,
    { timeoutMs: 8000 },
  );
  if (!res.ok) return r("hackernews", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  const j = res.body as any;
  if (!j || j === null || j.error) {
    return r("hackernews", { status: "not-found", elapsedMs: Date.now() - started });
  }
  return r("hackernews", {
    status: "found",
    url: `https://news.ycombinator.com/user?id=${j.id}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.id,
      bio: j.about ? j.about.replace(/<[^>]+>/g, " ").slice(0, 400) : undefined,
      joinedAt: new Date((j.created ?? 0) * 1000).toISOString(),
      extra: { karma: j.karma, submissionCount: j.submitted?.length ?? 0 },
    },
  });
}

async function checkCrates(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://crates.io/api/v1/users/${encodeURIComponent(u)}`, {
    timeoutMs: 8000,
    headers: { "User-Agent": "keyless-osint-workbench/1.0 (research)" },
  });
  if (!res.ok) {
    if (res.status === 404) return r("cratesio", { status: "not-found", elapsedMs: Date.now() - started });
    if (res.rateLimited) return r("cratesio", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("cratesio", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const user = (res.body as any).user;
  if (!user) return r("cratesio", { status: "not-found", elapsedMs: Date.now() - started });
  return r("cratesio", {
    status: "found",
    url: `https://crates.io/users/${user.id}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: user.login,
      displayName: user.name ?? undefined,
      avatarUrl: user.avatar ?? undefined,
      joinedAt: user.created_at,
      links: user.url ? [user.url] : [],
    },
  });
}

async function checkRubyGems(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://rubygems.org/api/v1/profiles/${encodeURIComponent(u)}.json`, {
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("rubygems", { status: "not-found", elapsedMs: Date.now() - started });
    if (res.rateLimited) return r("rubygems", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("rubygems", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  return r("rubygems", {
    status: "found",
    url: `https://rubygems.org/profiles/${j.handle ?? u}`,
    elapsedMs: Date.now() - started,
    profile: { username: j.handle, extra: { id: j.id } },
  });
}

async function checkPyPI(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://pypi.org/user/${encodeURIComponent(u)}/`, {
    as: "text",
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("pypi", { status: "not-found", elapsedMs: Date.now() - started });
    return r("pypi", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const html = res.body as unknown as string;
  // PyPI / Fastly occasionally serves an anti-bot "Client Challenge" page.
  if (html.includes("Client Challenge") || (html.length < 6000 && !html.includes("Profile of") && !html.includes("/project/"))) {
    return r("pypi", {
      status: "error",
      error: "Anti-bot challenge page served (or empty response); not interpreted as a result.",
      elapsedMs: Date.now() - started,
    });
  }
  if (html.includes("404") && html.toLowerCase().includes("not found") && !html.includes("projects")) {
    return r("pypi", { status: "not-found", elapsedMs: Date.now() - started });
  }
  const nameMatch = html.match(/<h1[^>]*class="author-profile__name"[^>]*>([^<]+)</) || html.match(/<title>\s*Profile of ([^<]+?) · PyPI/);
  const projects = [...html.matchAll(/href="\/project\/([^"/]+)\/"/g)].map((m) => m[1]);
  const avatar = html.match(/<img[^>]+class="gravatar"[^>]+src="([^"]+)"/)?.[1] ?? html.match(/Avatar for [^"]+"\]\((https?:[^)]+)\)/)?.[1];
  return r("pypi", {
    status: "found",
    url: `https://pypi.org/user/${u}/`,
    elapsedMs: Date.now() - started,
    profile: {
      username: u,
      displayName: nameMatch?.[1]?.trim(),
      avatarUrl: avatar,
      extra: { projectCount: projects.length, projects: [...new Set(projects)].slice(0, 20) },
    },
  });
}

async function checkDockerHub(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://hub.docker.com/v2/users/${encodeURIComponent(u)}/`, {
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("dockerhub", { status: "not-found", elapsedMs: Date.now() - started });
    return r("dockerhub", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  return r("dockerhub", {
    status: "found",
    url: `https://hub.docker.com/u/${j.username ?? u}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.username,
      displayName: j.full_name ?? undefined,
      location: j.location ?? undefined,
      avatarUrl: j.gravatar_url ?? undefined,
      joinedAt: j.date_joined,
    },
  });
}

async function checkDevTo(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://dev.to/api/users/by_username?url=${encodeURIComponent(u)}`, {
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("devto", { status: "not-found", elapsedMs: Date.now() - started });
    if (res.rateLimited) return r("devto", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("devto", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (!j || j.error || !j.id) return r("devto", { status: "not-found", elapsedMs: Date.now() - started });
  const links = [
    j.website_url,
    j.twitter_username ? `https://twitter.com/${j.twitter_username}` : null,
    j.github_username ? `https://github.com/${j.github_username}` : null,
  ].filter(Boolean) as string[];
  return r("devto", {
    status: "found",
    url: `https://dev.to/${j.username ?? u}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.username,
      displayName: j.name ?? undefined,
      bio: j.summary ?? undefined,
      location: j.location ?? undefined,
      avatarUrl: j.profile_image ?? undefined,
      joinedAt: j.joined_at ? new Date(j.joined_at).toISOString() : undefined,
      links,
    },
  });
}

async function checkStackExchange(u: string): Promise<CheckResult> {
  const started = Date.now();
  const url = `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${encodeURIComponent(u)}&site=stackoverflow&pagesize=5`;
  const res = await safeFetch(url, { timeoutMs: 9000 });
  if (!res.ok) {
    if (res.rateLimited) return r("stackexchange", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("stackexchange", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  const items = (j.items ?? []).filter((it: any) =>
    (it.display_name ?? "").toLowerCase().replace(/\s+/g, "").includes(u.toLowerCase().replace(/[._-]/g, "")) ||
    nameSimilarity(it.display_name ?? "", u) > 0.8,
  );
  if (!items.length) return r("stackexchange", { status: "not-found", elapsedMs: Date.now() - started });
  const top = items[0];
  return r("stackexchange", {
    status: "found",
    url: top.link,
    elapsedMs: Date.now() - started,
    profile: {
      displayName: top.display_name,
      location: top.location ?? undefined,
      avatarUrl: top.profile_image ?? undefined,
      joinedAt: top.creation_date ? new Date(top.creation_date * 1000).toISOString() : undefined,
      links: [top.website_url, top.link].filter(Boolean) as string[],
      extra: { reputation: top.reputation, matchCount: items.length, quotaRemaining: j.quota_remaining },
    },
  });
}

async function checkBluesky(u: string): Promise<CheckResult> {
  const started = Date.now();
  const handle = u.includes(".") ? u : `${u}.bsky.social`;
  const res = await safeFetch(
    `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
    { timeoutMs: 8000 },
  );
  if (!res.ok) {
    if (res.status === 400) return r("bluesky", { status: "not-found", elapsedMs: Date.now() - started });
    return r("bluesky", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (j.error || !j.handle) return r("bluesky", { status: "not-found", elapsedMs: Date.now() - started });
  return r("bluesky", {
    status: "found",
    url: `https://bsky.app/profile/${j.did ?? j.handle}`,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.handle,
      displayName: j.displayName ?? undefined,
      bio: j.description ?? undefined,
      avatarUrl: j.avatar ?? undefined,
      joinedAt: j.createdAt,
      followers: j.followersCount,
      extra: { posts: j.postsCount, follows: j.followsCount },
    },
  });
}

async function checkChessCom(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}`, {
    timeoutMs: 8000,
    headers: { "User-Agent": "keyless-osint-workbench/1.0 (research; contact local)" },
  });
  if (!res.ok) {
    if (res.status === 404) return r("chesscom", { status: "not-found", elapsedMs: Date.now() - started });
    if (res.rateLimited) return r("chesscom", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return r("chesscom", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (!j || j.code === 0) return r("chesscom", { status: "not-found", elapsedMs: Date.now() - started });
  const links = [...(j.streaming_platforms ?? []).map((s: any) => s.channel_url)].filter(Boolean);
  return r("chesscom", {
    status: "found",
    url: j.url,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.username,
      displayName: j.name ?? undefined,
      location: j.location ?? undefined,
      avatarUrl: j.avatar ?? undefined,
      joinedAt: j.joined ? new Date(j.joined * 1000).toISOString() : undefined,
      followers: j.followers,
      links,
      extra: { title: j.title, status: j.status, isStreamer: j.is_streamer },
    },
  });
}

async function checkLichess(u: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://lichess.org/api/user/${encodeURIComponent(u)}`, {
    timeoutMs: 8000,
  });
  if (!res.ok) {
    if (res.status === 404) return r("lichess", { status: "not-found", elapsedMs: Date.now() - started });
    return r("lichess", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (!j || j.closed) return r("lichess", { status: "not-found", elapsedMs: Date.now() - started });
  return r("lichess", {
    status: "found",
    url: j.url,
    elapsedMs: Date.now() - started,
    profile: {
      username: j.id,
      displayName: j.username ?? j.id,
      bio: j.profile?.bio ?? undefined,
      location: j.profile?.location ?? undefined,
      avatarUrl: `https://lichess1.org/user/pic/${j.id}?cb=`,
      joinedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      links: extractUrls(`${j.profile?.links ?? ""} ${j.profile?.bio ?? ""}`),
      extra: { seenAt: j.seenAt, playTime: j.playTime?.total },
    },
  });
}

async function checkMastodon(u: string): Promise<CheckResult> {
  const started = Date.now();
  const found: { instance: string; profile: CheckResult["profile"]; url?: string }[] = [];
  // Bounded concurrency across the curated instance list.
  await mapPool(MASTODON_INSTANCES, 6, async (instance) => {
    const res = await safeFetch(
      `https://${instance}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${u}@${instance}`)}`,
      { timeoutMs: 6000, retries: 0 },
    );
    if (!res.ok) return;
    const j = res.body as any;
    if (!j?.subject) return;
    const profileLink = (j.links ?? []).find((l: any) => l.rel === "http://webfinger.net/rel/profile-page")?.href
      ?? (j.links ?? []).find((l: any) => l.rel === "self")?.href;
    const avatar = (j.links ?? []).find((l: any) => l.rel === "http://webfinger.net/rel/avatar")?.href;
    const handle = j.subject.replace(/^acct:/i, "");
    found.push({
      instance,
      url: profileLink ?? `https://${instance}/@${u}`,
      profile: {
        username: handle,
        displayName: undefined,
        avatarUrl: avatar,
        links: [profileLink].filter(Boolean) as string[],
        extra: { instance, aliases: j.aliases },
      },
    });
  });
  if (!found.length) {
    return r("mastodon", { status: "not-found", elapsedMs: Date.now() - started, message: `No account on ${MASTODON_INSTANCES.length} major instances.` });
  }
  const first = found[0];
  return r("mastodon", {
    status: "found",
    url: first.url,
    elapsedMs: Date.now() - started,
    message: `Found on ${found.length} instance(s): ${found.map((f) => f.instance).join(", ")}`,
    profile: {
      ...first.profile,
      extra: { instances: found.map((f) => ({ instance: f.instance, url: f.url })) },
    },
  });
}

// ---------------------------------------------------------------------------
// Generic site checks
// ---------------------------------------------------------------------------

async function checkGenericSite(site: UsernameSite, u: string): Promise<CheckResult> {
  const started = Date.now();
  const url = site.urlTemplate.replace("{u}", encodeURIComponent(u));
  const res = await safeFetch(url, {
    as: "text",
    method: site.method === "HEAD" ? "HEAD" : "GET",
    headers: site.headers,
    timeoutMs: 9000,
    retries: 0,
  });

  if (!res.ok) {
    if (res.rateLimited) {
      return { sourceId: site.id, sourceName: site.name, status: "rate-limited", error: res.error, elapsedMs: Date.now() - started };
    }
    if (res.status === 404 || res.status === 410) {
      return { sourceId: site.id, sourceName: site.name, status: "not-found", elapsedMs: Date.now() - started };
    }
    return { sourceId: site.id, sourceName: site.name, status: "error", error: res.error, elapsedMs: Date.now() - started };
  }

  const body = (res.body as unknown as string) ?? "";
  // Confirm absence even with a 200.
  if (site.absenceHint?.some((hint) => body.includes(hint))) {
    return { sourceId: site.id, sourceName: site.name, status: "not-found", elapsedMs: Date.now() - started };
  }
  // Positive markers give a confirmed hit; otherwise it's "likely" (status-based).
  const confirmed = !site.existenceHint || site.existenceHint.some((hint) => body.includes(hint));
  const avatar = body.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1]
    ?? body.match(/<img[^>]+(?:avatar|profile)[^>]+src="([^"]+)"/i)?.[1];
  return {
    sourceId: site.id,
    sourceName: site.name,
    status: "found",
    url: site.profileUrl?.replace("{u}", u) ?? url,
    elapsedMs: Date.now() - started,
    profile: {
      username: u,
      avatarUrl: avatar?.startsWith("http") ? avatar : undefined,
      displayName: body.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1],
      bio: body.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1]?.slice(0, 300),
    },
    message: confirmed ? undefined : "Likely match (status-based; no positive page marker found)",
  };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

interface ProfileWithHash {
  sourceId: string;
  sourceName: string;
  url?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  links?: string[];
  hashes?: PerceptualHashes;
  hashError?: string;
}

async function correlate(checks: CheckResult[]): Promise<{ correlations: Correlation[]; profiles: ProfileWithHash[] }> {
  const profiles: ProfileWithHash[] = checks
    .filter((c) => c.status === "found" && c.profile)
    .map((c) => ({
      sourceId: c.sourceId,
      sourceName: c.sourceName,
      url: c.url,
      username: c.profile?.username,
      displayName: c.profile?.displayName,
      avatarUrl: c.profile?.avatarUrl,
      links: c.profile?.links,
    }));

  // Hash avatars in parallel.
  await mapPool(profiles.filter((p) => p.avatarUrl), 6, async (p) => {
    if (!p.avatarUrl) return;
    const hashed = await hashImageUrl(p.avatarUrl);
    if (hashed) p.hashes = hashed.hashes;
  });

  const correlations: Correlation[] = [];

  // 1. Same avatar (perceptual hash).
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i];
      const b = profiles[j];
      if (a.hashes && b.hashes) {
        const sim = imageSimilarity(a.hashes, b.hashes);
        if (sim >= 0.72) {
          correlations.push({
            id: `avatar-${a.sourceId}-${b.sourceId}`,
            reason: "same-avatar-phash",
            strength: sim,
            detail: `Profile photos match (${Math.round(sim * 100)}% perceptual similarity; aHash ${hashToString(a.hashes.ahash)} vs ${hashToString(b.hashes.ahash)})`,
            members: [
              { sourceId: a.sourceId, sourceName: a.sourceName, url: a.url, detail: a.displayName ?? a.username ?? "" },
              { sourceId: b.sourceId, sourceName: b.sourceName, url: b.url, detail: b.displayName ?? b.username ?? "" },
            ],
          });
        }
      }
    }
  }

  // 2. Similar display names.
  const named = profiles.filter((p) => p.displayName && p.displayName.length > 1);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const sim = nameSimilarity(named[i].displayName!, named[j].displayName!);
      if (sim >= 0.85) {
        // Skip if these two already correlated by avatar.
        const already = correlations.some(
          (c) =>
            c.reason === "same-avatar-phash" &&
            c.members.some((m) => m.sourceId === named[i].sourceId) &&
            c.members.some((m) => m.sourceId === named[j].sourceId),
        );
        if (!already) {
          correlations.push({
            id: `name-${named[i].sourceId}-${named[j].sourceId}`,
            reason: "similar-display-name",
            strength: sim * 0.8,
            detail: `Display names similar (${Math.round(sim * 100)}%): "${named[i].displayName}" ~ "${named[j].displayName}"`,
            members: [
              { sourceId: named[i].sourceId, sourceName: named[i].sourceName, url: named[i].url, detail: named[i].displayName! },
              { sourceId: named[j].sourceId, sourceName: named[j].sourceName, url: named[j].url, detail: named[j].displayName! },
            ],
          });
        }
      }
    }
  }

  // 3. Shared links across profiles.
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const aLinks = new Set((profiles[i].links ?? []).map(hostnameOf));
      const bLinks = (profiles[j].links ?? []).map(hostnameOf);
      const shared = bLinks.filter((l) => aLinks.has(l) && !["twitter.com", "x.com", "github.com"].includes(l));
      if (shared.length) {
        correlations.push({
          id: `links-${profiles[i].sourceId}-${profiles[j].sourceId}`,
          reason: "shared-links",
          strength: 0.75,
          detail: `Profiles link to the same site(s): ${[...new Set(shared)].join(", ")}`,
          members: [
            { sourceId: profiles[i].sourceId, sourceName: profiles[i].sourceName, url: profiles[i].url, detail: profiles[i].displayName ?? "" },
            { sourceId: profiles[j].sourceId, sourceName: profiles[j].sourceName, url: profiles[j].url, detail: profiles[j].displayName ?? "" },
          ],
        });
      }
    }
  }

  // 4. Keybase proofs link accounts explicitly.
  const keybase = checks.find((c) => c.sourceId === "keybase" && c.status === "found");
  if (keybase?.profile?.extra) {
    const proofs = (keybase.profile.extra as any).proofs as { service: string; nametag: string; url: string }[] | undefined;
    if (proofs?.length) {
      const members = proofs
        .map((p) => ({ sourceId: "keybase-proof", sourceName: `Keybase proof: ${p.service}`, url: p.url, detail: p.nametag }))
        .slice(0, 12);
      correlations.push({
        id: "keybase-proofs",
        reason: "keybase-proofs",
        strength: 1,
        detail: `Keybase account cryptographically proves ownership of ${proofs.length} external account(s): ${proofs
          .map((p) => `${p.service}:${p.nametag}`)
          .join(", ")}`,
        members: [
          { sourceId: "keybase", sourceName: "Keybase", url: keybase.url, detail: keybase.profile?.displayName ?? "" },
          ...members,
        ],
      });
    }
  }

  return { correlations, profiles };
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

export async function scanUsername(rawTarget: string): Promise<EngineResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const u = normalizeUsername(rawTarget);
  const errors: string[] = [];

  if (!u || !/^[a-z0-9][a-z0-9._-]{0,38}$/.test(u)) {
    return {
      engine: "username",
      target: rawTarget,
      normalizedInput: u,
      checks: [],
      findings: [],
      errors: ["Invalid username. Use 1-39 chars: letters, numbers, '.', '_', '-'."],
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
    };
  }

  const apiChecks = [
    checkGitHub,
    checkGitLab,
    checkKeybase,
    checkHackerNews,
    checkCrates,
    checkRubyGems,
    checkPyPI,
    checkDockerHub,
    checkDevTo,
    checkStackExchange,
    checkBluesky,
    checkChessCom,
    checkLichess,
    checkMastodon,
    checkGitHubEvents,
  ];

  const apiResults = await mapPool(apiChecks, 8, (fn) => fn(u));
  const siteResults = await mapPool(USERNAME_SITES, 8, (site) => checkGenericSite(site, u));

  const checks = [...apiResults, ...siteResults];

  // GitHub events only makes sense if GitHub exists; if github 404'd keep events not-found silently.
  const githubFound = checks.some((c) => c.sourceId === "github" && c.status === "found");
  for (const c of checks) {
    if (c.sourceId === "github-events" && !githubFound && c.status !== "error") {
      c.status = "not-found";
    }
  }

  for (const c of checks) {
    if (c.status === "error") errors.push(`${c.sourceName}: ${c.error}`);
  }

  const { correlations, profiles } = await correlate(checks);

  const findings: Finding[] = [];
  for (const c of checks) {
    if (c.status !== "found") continue;
    findings.push({
      sourceId: c.sourceId,
      sourceName: c.sourceName,
      type: "profile",
      value: c.profile?.displayName ? `${c.sourceName}: ${c.profile.displayName} (@${c.profile.username ?? u})` : `${c.sourceName}: profile exists (@${u})`,
      url: c.url,
      confidence: c.message?.includes("Likely") ? 0.55 : 0.9,
      data: { profile: c.profile, message: c.message },
      note: c.message,
    });
  }
  for (const corr of correlations) {
    findings.push({
      sourceId: "correlation",
      sourceName: "Correlation engine",
      type: "correlation",
      value: corr.detail,
      confidence: corr.strength,
      data: corr as unknown as Record<string, unknown>,
    });
  }

  return {
    engine: "username",
    target: rawTarget,
    normalizedInput: u,
    checks,
    findings,
    correlations,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}

export { type ProfileWithHash };
