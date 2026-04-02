/**
 * rpcSafe — Unified RPC wrapper with timeout, standardised error, and retry.
 *
 * Usage:
 *   const rpc = useRpcSafe()
 *   const result = await rpc.call(() => wsStore.rpc.listSessions())
 *   const result = await rpc.call(() => wsStore.rpc.listSessions(), { timeout: 5000 })
 *   const result = await rpc.call(() => wsStore.rpc.listSessions(), { retries: 2 })
 *   const result = await rpc.call(() => wsStore.rpc.listSessions(), { dedupeKey: 'sessions' })
 */

/** Built-in retry delays (ms), applied with exponential back-off. */
const RETRY_DELAYS_MS = [400, 900, 2400]

export interface RpcSafeOptions {
  /** Timeout in ms (default 15000). Set to Infinity to disable. */
  timeout?: number
  /**
   * Number of retries on transient failure (default 0).
   * Retries happen only for network/timeout errors, not business errors.
   */
  retries?: number
  /**
   * Optional deduplication key. If a call with the same key is already
   * in-flight, the same promise is returned instead of creating a duplicate.
   */
  dedupeKey?: string
  /** Human-readable label used in error messages for easier debugging. */
  label?: string
  /**
   * Predicate to decide whether an error is retryable (default retries only
   * on network/timeout). Return false to fail immediately without retry.
   */
  isRetryable?: (error: unknown) => boolean
}

export interface RpcSafe {
  /**
   * Wrap an RPC call with timeout, standardised error, and optional retry.
   * The returned promise resolves with T or throws a plain Error.
   */
  call<T>(rpc: () => Promise<T>, options?: RpcSafeOptions): Promise<T>
}

const DEFAULT_TIMEOUT_MS = 60_000

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('timed out') || msg.includes('timeout')) return true
    if (
      msg.includes('websocket') ||
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket') ||
      msg.includes('aborted')
    )
      return true
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true
    if (msg.includes('not connected') || msg.includes('ws not open')) return true
  }
  if (typeof error === 'string') {
    const lower = error.toLowerCase()
    if (lower.includes('abort') || lower.includes('cancelled') || lower.includes('canceled')) return true
  }
  return false
}

function normalisedError(error: unknown, label?: string): Error {
  if (error instanceof Error) return error
  const prefix = label ? `[${label}] ` : ''
  return new Error(`${prefix}${typeof error === 'string' ? error : JSON.stringify(error)}`)
}

/** In-flight call dedupe registry (shared via module-level Map). */
const dedupeRegistry = new Map<string, Promise<unknown>>()

function clearDedupe(key: string) {
  dedupeRegistry.delete(key)
}

export function useRpcSafe(): RpcSafe {
  async function call<T>(rpc: () => Promise<T>, options?: RpcSafeOptions): Promise<T> {
    const {
      timeout = DEFAULT_TIMEOUT_MS,
      retries = 0,
      dedupeKey,
      label,
      isRetryable = isTransientError,
    } = options ?? {}

    // Deduplication
    if (dedupeKey) {
      const inFlight = dedupeRegistry.get(dedupeKey)
      if (inFlight) return inFlight as Promise<T>
    }

    async function attempt(attemptNumber: number): Promise<T> {
      try {
        const race = Promise.race([
          rpc(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`${label ? `[${label}] ` : ''}Call timed out after ${timeout}ms`)),
              timeout
            )
          ),
        ])
        return await (race as Promise<T>)
      } catch (error) {
        const shouldRetry =
          attemptNumber <= retries &&
          (isRetryable ? isRetryable(error) : isTransientError(error))

        if (shouldRetry) {
          const delay = RETRY_DELAYS_MS[attemptNumber - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 500
          await new Promise((resolve) => setTimeout(resolve, delay))
          return attempt(attemptNumber + 1)
        }
        throw normalisedError(error, label)
      }
    }

    let promise: Promise<T>
    try {
      promise = attempt(1)
    } catch {
      promise = attempt(1)
    }

    if (dedupeKey) {
      const registered = promise.then(
        (v) => { clearDedupe(dedupeKey); return v },
        (e) => { clearDedupe(dedupeKey); throw e }
      ) as Promise<T>
      dedupeRegistry.set(dedupeKey, registered as unknown as Promise<unknown>)
      return registered
    }

    return promise
  }

  return { call }
}
