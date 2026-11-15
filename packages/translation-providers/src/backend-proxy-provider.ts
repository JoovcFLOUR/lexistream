import {
  TranslationResultSchema,
  type TranslationRequest,
  type TranslationResult,
} from '@lexistream/shared-types';
import type { TranslationProvider } from './index';

export interface BackendProxyOptions {
  baseUrl: string;
  getAuthToken?: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Delegates external translation (DeepL, Google Cloud Translation, etc.) to the backend API
 * so private provider credentials are never embedded in the browser extension or web bundle.
 */
export class BackendProxyTranslationProvider implements TranslationProvider {
  readonly id = 'backend-api-proxy';
  private readonly baseUrl: string;
  private readonly getAuthToken?: () => string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BackendProxyOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getAuthToken = options.getAuthToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation aborted', 'AbortError');
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const onExternalAbort = () => timeoutController.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = this.getAuthToken?.();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/translate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        throw new Error(`Backend translation failed with HTTP ${response.status}`);
      }

      const json: unknown = await response.json();
      return TranslationResultSchema.parse(json);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
