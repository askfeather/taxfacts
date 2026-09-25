/**
 * One POST helper for both backends, because both need the same two things.
 *
 * Retries on rate limits and overload. Providers here really do throttle - a
 * new OpenRouter account is capped at 20 requests per minute per model, which
 * a benchmark run hits within seconds.
 *
 * The thrown message never contains the key. The official JS SDK echoes it
 * into exception text, which then lands in logs (typesafe-sdk-js#14), and a
 * key is the only credential this library ever holds.
 */
const RETRY_ON = new Set([408, 429, 500, 502, 503, 529]);
const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wall clock of the last successful call, read by the backends. Retries are
 *  excluded: a throttled call measures the provider's queue, not the model. */
export let lastMs = 0;

export async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  /** Anthropic authenticates with `x-api-key` and needs a version header. */
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  let wait = 2000;
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      lastMs = Date.now() - t0;
      return res;
    }

    const text = await res.text().catch(() => '');
    if (!RETRY_ON.has(res.status) || attempt >= MAX_ATTEMPTS) {
      // Documented status codes do not match observed ones - a bad key returns
      // 403 where the spec says 401, and body validation returns 400 for 422 -
      // so callers must branch on the number, never on a documented name.
      throw new Error(`http ${res.status}: ${text.slice(0, 200)}`);
    }

    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : wait);
    wait = Math.min(wait * 2, MAX_BACKOFF_MS);
  }
}
