/**
 * ofetch formats every FetchError message as `[METHOD] "<absolute url>": …` and
 * `normalizeError` keeps that text, so passing it straight to a model would hand
 * it the `FORGES_*_BASE_URL` the tool surface deliberately withholds, along with
 * any credentials an operator put in it. The request line goes; a URL left
 * anywhere else in the message becomes a placeholder. Text a provider authored
 * carries no endpoint and survives untouched.
 */
const REQUEST_LINE = /\[[A-Z]+\] "[^"]*":\s*/g;
const ABSOLUTE_URL = /\b[a-z][\w+.-]*:\/\/\S+/gi;

export function redactEndpoint(message: string): string {
  return message.replace(REQUEST_LINE, "").replace(ABSOLUTE_URL, "<endpoint>").trim();
}
