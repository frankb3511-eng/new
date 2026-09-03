// ---------------------------------------------------------------------------
// Curated list of sites for the generic keyless username checker.
//
// Methodology (false positives are the classic failure of username tools):
//   - Each entry uses the site's documented public profile URL scheme.
//   - existenceHint: response text that PROVES the account exists when present.
//   - absenceHint:   response text that PROVES the account is missing when the
//                    site answers 200 even for unknown profiles.
//   - Sites that require auth, return JS-only shells with no server-side
//     marker, or whose terms prohibit automation are NOT listed here.
//   - Confidence is reported honestly: "confirmed" only when a hint matches,
//     otherwise "likely" (status based).
//
// Sites with rich JSON APIs are handled in dedicated engines instead (GitHub,
// GitLab, Keybase, HN, crates.io, RubyGems, npm, Docker Hub, dev.to,
// Stack Exchange, Mastodon, Bluesky, Chess.com, Lichess, PyPI via HTML).
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "HEAD";

export interface UsernameSite {
  id: string;
  name: string;
  category: "social" | "dev" | "media" | "gaming" | "blog" | "creative" | "other";
  urlTemplate: string; // {u} replaced with URL-encoded username
  method: HttpMethod;
  /** Text that, when present in a 2xx body, confirms the profile exists. */
  existenceHint?: string[];
  /** Text that indicates a "not found" even with status 200. */
  absenceHint?: string[];
  /** Headers needed by the endpoint. */
  headers?: Record<string, string>;
  profileUrl?: string; // human profile link (defaults to urlTemplate)
  /** Note shown to users about reliability. */
  note?: string;
  /** Sites verified live are marked; others rely on published URL schemes. */
  verifiedLive?: boolean;
}

const ua = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export const USERNAME_SITES: UsernameSite[] = [
  // ---- Developer / code sites --------------------------------------------
  {
    id: "bitbucket",
    name: "Bitbucket",
    category: "dev",
    urlTemplate: "https://bitbucket.org/{u}/",
    method: "GET",
    existenceHint: ["Profile", "followers", "repositories"],
    absenceHint: ["Repository not found", "This page doesn’t exist", "404"],
    headers: ua,
    verifiedLive: false,
    note: "Bitbucket usernames are UUIDs internally; vanity URL works for legacy accounts.",
  },
  {
    id: "codeberg",
    name: "Codeberg",
    category: "dev",
    urlTemplate: "https://codeberg.org/{u}",
    method: "GET",
    existenceHint: [`<span class="item-title">`],
    absenceHint: ["Not Found", "The page you are trying to reach"],
    headers: ua,
  },
  {
    id: "gitea",
    name: "Gitea (gitea.com)",
    category: "dev",
    urlTemplate: "https://gitea.com/{u}",
    method: "GET",
    absenceHint: ["Not Found"],
    headers: ua,
  },
  {
    id: "gitlab-ce-gnome",
    name: "GNOME GitLab",
    category: "dev",
    urlTemplate: "https://gitlab.gnome.org/{u}",
    method: "GET",
    absenceHint: ["You need to sign in", "Page Not Found"],
    headers: ua,
  },
  {
    id: "launchpad",
    name: "Launchpad",
    category: "dev",
    urlTemplate: "https://launchpad.net/~{u}",
    method: "GET",
    existenceHint: ["Person information", "Homepage", "Member since"],
    absenceHint: ["does not exist", "No such person or team"],
    headers: ua,
  },
  {
    id: "savannah",
    name: "GNU Savannah",
    category: "dev",
    urlTemplate: "https://savannah.gnu.org/users/{u}",
    method: "GET",
    absenceHint: ["Invalid User", "No such user"],
    headers: ua,
  },
  {
    id: "replit",
    name: "Replit",
    category: "dev",
    urlTemplate: "https://replit.com/@{u}",
    method: "GET",
    absenceHint: ["404", "This Repl could not be found"],
    headers: ua,
    note: "JS-heavy; status code is primary signal.",
  },
  {
    id: "codepen",
    name: "CodePen",
    category: "dev",
    urlTemplate: "https://codepen.io/{u}",
    method: "GET",
    absenceHint: ["404 - Page Not Found", "This page doesn't exist"],
    headers: ua,
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    category: "dev",
    urlTemplate: "https://huggingface.co/api/users/{u}",
    method: "GET",
    existenceHint: ['"type":', "user"],
    absenceHint: ["Sorry, we can't find the page", '"error"'],
    headers: { Accept: "application/json" },
    note: "JSON API; 404 JSON for unknown users.",
  },
  {
    id: "aur",
    name: "Arch User Repository (AUR)",
    category: "dev",
    urlTemplate: "https://aur.archlinux.org/account/{u}",
    method: "GET",
    absenceHint: ["No such account", "Page not found"],
    headers: ua,
  },
  {
    id: "hackage",
    name: "Hackage (Haskell)",
    category: "dev",
    urlTemplate: "https://hackage.haskell.org/user/{u}",
    method: "GET",
    absenceHint: ["Page not found"],
    headers: ua,
  },
  {
    id: "pastebin",
    name: "Pastebin",
    category: "dev",
    urlTemplate: "https://pastebin.com/u/{u}",
    method: "GET",
    existenceHint: ["Public Pastes", "Profile views", "Join Date"],
    absenceHint: ["No such user", "user does not exist"],
    headers: ua,
  },
  {
    id: "disqus",
    name: "Disqus",
    category: "dev",
    urlTemplate: "https://disqus.com/by/{u}/",
    method: "GET",
    absenceHint: ["Page not found", "404"],
    headers: ua,
  },

  // ---- Social --------------------------------------------------------------
  {
    id: "vk",
    name: "VK",
    category: "social",
    urlTemplate: "https://vk.com/{u}",
    method: "GET",
    existenceHint: ['"profile"', "pageAvatar"],
    absenceHint: ["404 Not Found", "This page doesn't exist"],
    headers: ua,
    note: "Russian platform; profiles may be regionally gated.",
  },
  {
    id: "minds",
    name: "Minds",
    category: "social",
    urlTemplate: "https://www.minds.com/{u}",
    method: "GET",
    absenceHint: ["channel not found", "Page not found"],
    headers: ua,
  },
  {
    id: "gab",
    name: "Gab",
    category: "social",
    urlTemplate: "https://gab.com/{u}",
    method: "GET",
    absenceHint: ["The page you are looking for isn't here", "not found"],
    headers: ua,
  },
  {
    id: "mewe",
    name: "MeWe",
    category: "social",
    urlTemplate: "https://mewe.com/i/{u}",
    method: "GET",
    absenceHint: ["not found", "404"],
    headers: ua,
  },

  // ---- Media / video / audio ----------------------------------------------
  {
    id: "vimeo",
    name: "Vimeo",
    category: "media",
    urlTemplate: "https://vimeo.com/{u}",
    method: "GET",
    existenceHint: ['"user"', "Followers"],
    absenceHint: ["Sorry, We Couldn't Find That Page", "Page not found"],
    headers: ua,
    note: "Vanity URLs collide with video IDs; treat hits as 'likely'.",
  },
  {
    id: "soundcloud",
    name: "SoundCloud",
    category: "media",
    urlTemplate: "https://soundcloud.com/{u}",
    method: "GET",
    existenceHint: ['"@context"', "Followers", "sounds"],
    absenceHint: ["We can’t find that page", "404"],
    headers: ua,
  },
  {
    id: "lastfm",
    name: "Last.fm",
    category: "media",
    urlTemplate: "https://www.last.fm/user/{u}",
    method: "GET",
    existenceHint: ["Scrobbles", "Recent Listening"],
    absenceHint: ["Whoops! Sorry, but this page doesn't exist", "404"],
    headers: ua,
  },
  {
    id: "bandcamp",
    name: "Bandcamp",
    category: "media",
    urlTemplate: "https://{u}.bandcamp.com/",
    method: "GET",
    absenceHint: ["Sorry, that something isn’t here", "404"],
    headers: ua,
    note: "Subdomain scheme; common words may collide with artist subdomains.",
  },
  {
    id: "mixcloud",
    name: "Mixcloud",
    category: "media",
    urlTemplate: "https://www.mixcloud.com/{u}/",
    method: "GET",
    absenceHint: ["Page not found", "404"],
    headers: ua,
  },

  // ---- Blogging / writing --------------------------------------------------
  {
    id: "medium",
    name: "Medium",
    category: "blog",
    urlTemplate: "https://medium.com/@{u}",
    method: "GET",
    existenceHint: ["Follow", "Following"],
    absenceHint: ["PAGE NOT FOUND", "404"],
    headers: ua,
    note: "Medium responds 404 with a branded page; status is the primary signal.",
  },
  {
    id: "hashnode",
    name: "Hashnode",
    category: "blog",
    urlTemplate: "https://hashnode.com/@{u}",
    method: "GET",
    absenceHint: ["404", "Blog not found"],
    headers: ua,
  },
  {
    id: "wordpresscom",
    name: "WordPress.com",
    category: "blog",
    urlTemplate: "https://{u}.wordpress.com/",
    method: "GET",
    absenceHint: ["Do you want to register", "doesn’t exist"],
    headers: ua,
    note: "Subdomain scheme.",
  },
  {
    id: "tumblr",
    name: "Tumblr",
    category: "blog",
    urlTemplate: "https://{u}.tumblr.com/",
    method: "GET",
    absenceHint: ["There's nothing here", "Whatever you were looking for doesn't currently exist"],
    headers: ua,
    note: "Subdomain scheme.",
  },
  {
    id: "blogger",
    name: "Blogspot (Blogger)",
    category: "blog",
    urlTemplate: "https://{u}.blogspot.com/",
    method: "GET",
    absenceHint: ["Blog not found", "The blog you’re looking for has not been registered"],
    headers: ua,
  },

  // ---- Creative / design ---------------------------------------------------
  {
    id: "behance",
    name: "Behance",
    category: "creative",
    urlTemplate: "https://www.behance.net/{u}",
    method: "GET",
    absenceHint: ["Page Not Found", "Oops"],
    headers: ua,
  },
  {
    id: "dribbble",
    name: "Dribbble",
    category: "creative",
    urlTemplate: "https://dribbble.com/{u}",
    method: "GET",
    absenceHint: ["Whoops, that page is gone", "404"],
    headers: ua,
  },
  {
    id: "artstation",
    name: "ArtStation",
    category: "creative",
    urlTemplate: "https://www.artstation.com/{u}",
    method: "GET",
    absenceHint: ["Page Not Found", "404"],
    headers: ua,
  },
  {
    id: "patreon",
    name: "Patreon",
    category: "creative",
    urlTemplate: "https://www.patreon.com/{u}",
    method: "GET",
    absenceHint: ["page you requested was not found", "404"],
    headers: ua,
  },
  {
    id: "newgrounds",
    name: "Newgrounds",
    category: "creative",
    urlTemplate: "https://{u}.newgrounds.com/",
    method: "GET",
    absenceHint: ["404", "not found"],
    headers: ua,
  },

  // ---- Gaming --------------------------------------------------------------
  {
    id: "steam",
    name: "Steam",
    category: "gaming",
    urlTemplate: "https://steamcommunity.com/id/{u}",
    method: "GET",
    existenceHint: ["steamcommunity", "persona"],
    absenceHint: ["The specified profile could not be found", "error_ctn"],
    headers: ua,
    note: "Only covers custom vanity URLs, not numeric Steam IDs.",
  },
  {
    id: "speedrun",
    name: "Speedrun.com",
    category: "gaming",
    urlTemplate: "https://www.speedrun.com/users/{u}",
    method: "GET",
    absenceHint: ["404", "Page not found"],
    headers: ua,
  },
  {
    id: "osu",
    name: "osu!",
    category: "gaming",
    urlTemplate: "https://osu.ppy.sh/users/{u}",
    method: "GET",
    absenceHint: ["User not found", "Page not found"],
    headers: ua,
  },
  {
    id: "twitch-tracker",
    name: "Twitch (via Twitch Tracker)",
    category: "gaming",
    urlTemplate: "https://twitchtracker.com/{u}",
    method: "GET",
    absenceHint: ["User not found", "404"],
    headers: ua,
    note: "Third-party tracker; used because Twitch's own API requires an app key.",
  },

  // ---- Forums / Q&A / other -----------------------------------------------
  {
    id: "kaggle",
    name: "Kaggle",
    category: "other",
    urlTemplate: "https://www.kaggle.com/{u}",
    method: "GET",
    absenceHint: ["404", "This page could not be found"],
    headers: ua,
    note: "JS-heavy; status is the primary signal.",
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    category: "other",
    urlTemplate: "https://www.openstreetmap.org/user/{u}",
    method: "GET",
    existenceHint: ["Mapper since", "Changesets"],
    absenceHint: ["The user is not known", "not been registered"],
    headers: ua,
  },
  {
    id: "tripadvisor",
    name: "Tripadvisor (profile)",
    category: "other",
    urlTemplate: "https://www.tripadvisor.com/Profile/{u}",
    method: "GET",
    absenceHint: ["This page is on vacation", "404"],
    headers: ua,
  },
];
