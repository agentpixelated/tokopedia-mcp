export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchPolicy {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  retries?: number;
  timeoutMs?: number;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36';

export async function fetchWithPolicy(
  url: string,
  init: RequestInit = {},
  policy: FetchPolicy = {},
): Promise<Response> {
  const fetchImpl = policy.fetchImpl ?? fetch;
  const sleep = policy.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const retries = policy.retries ?? 2;
  const timeoutMs = policy.timeoutMs ?? 20_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
          ...Object.fromEntries(new Headers(init.headers).entries()),
        },
      });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        throw new HttpError(`HTTP ${response.status} from ${url}`, response.status, url);
      }
      lastError = new HttpError(`HTTP ${response.status} from ${url}`, response.status, url);
    } catch (error) {
      if (error instanceof HttpError && error.status !== 429 && (error.status ?? 0) < 500) throw error;
      lastError = error;
      if (attempt === retries) break;
    }
    await sleep(200 * 2 ** attempt);
  }

  if (lastError instanceof Error) throw lastError;
  throw new HttpError(`Request failed for ${url}`, null, url);
}
