/**
 * Every FetchError message reads `[METHOD] "<absolute url>": …` and
 * `normalizeError` keeps that text, so passing it straight to a model would hand
 * it the `FORGES_*_BASE_URL` the tool surface deliberately withholds, along with
 * any credentials an operator put in it. The request line goes, and so does any
 * URL on a forge host or carrying credentials, in userinfo or a signed query. A link
 * a platform or a check run handed back, such as a build dashboard, is the next step
 * for the agent and stays.
 */
const REQUEST_LINE = /\[[A-Z]+\] "[^"]*":\s*/g;
/** Stops at what a URL cannot hold unencoded, so `"a","b"` in JSON reads as two links. */
const ABSOLUTE_URL = /\b[a-z][\w+.-]*:\/\/[^\s"<>`{}|\\^]+/gi;
/** Prose around a link, as in `(https://…)` or `https://…,`, which is not part of it. */
const TRAILING_PUNCTUATION = /[)\]}>"'`,.;:!?]+$/;
/** A hostname a URL parser can hand back with prose glued on, such as `ghe.corp"`, fails this. */
const PLAIN_HOST = /^(?:[a-z\d.-]+|\[[\da-f:.]+\])$/;
const PLACEHOLDER = "<endpoint>";
/** Short secret names that hide inside ordinary ones (`assignee`, `author`), so only a whole word counts. */
const SECRET_WORDS = new Set(["sig", "key", "apikey", "auth", "authorization", "code"]);
/** No ordinary name holds these, so `accesstoken` with nothing to split on still counts. */
const SECRET_PART = /token|secret|password|signature|credential|jwt/;
/** A JSON Web Token, which a link can carry as a path segment as well. */
const JWT = /\beyJ[\w-]+\.[\w-]+\./;

/** `apiKey` splits into `api`, `key` and counts, while `assignee` stays one ordinary word. */
function namesSecret(name: string): boolean {
  const words = name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/);
  return SECRET_PART.test(name.toLowerCase()) || words.some((word) => SECRET_WORDS.has(word));
}

/** True for a query or a fragment that names a secret, as `#access_token=…` does, or a JWT anywhere. */
function signed(url: URL): boolean {
  const names = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  return names.some(namesSecret) || JWT.test(url.href);
}

/** A forge host goes with its subdomains, so `ghe.corp` hides `uploads.ghe.corp.` as well. */
function withheld(text: string, forgeHosts: ReadonlySet<string>): boolean {
  if (!URL.canParse(text) || text.indexOf("://") !== text.lastIndexOf("://")) return true;
  const url = new URL(text);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!PLAIN_HOST.test(host) || url.username !== "" || url.password !== "" || signed(url)) {
    return true;
  }
  for (const forgeHost of forgeHosts) {
    if (host === forgeHost || host.endsWith(`.${forgeHost}`)) return true;
  }
  return false;
}

/**
 * @param forgeHosts - Lowercase hosts the providers call. Undefined hides every URL, for a
 * base URL nobody can read a host from.
 */
export function redactEndpoint(message: string, forgeHosts?: ReadonlySet<string>): string {
  return message
    .replace(REQUEST_LINE, "")
    .replace(ABSOLUTE_URL, (match) => {
      const tail = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
      const link = match.slice(0, match.length - tail.length);
      return forgeHosts === undefined || withheld(link, forgeHosts) ? PLACEHOLDER + tail : match;
    })
    .trim();
}
