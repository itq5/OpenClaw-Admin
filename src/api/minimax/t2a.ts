/**
 * MiniMax Text-to-Audio (T2A) transport.
 *
 * Provides the regional `/v1/t2a_v2` endpoints, the selectable synthesis
 * models, request field mapping and audio/response parsing shared by the
 * MiniMax TTS provider configuration and callers that synthesize speech.
 */

// ============================================================================
// Regions and endpoints
// ============================================================================

export type MiniMaxT2ARegion = 'global_en' | 'cn_zh'

export interface MiniMaxT2AEndpoint {
  region: MiniMaxT2ARegion
  /** Synchronous text-to-audio endpoint for the region. */
  url: string
  /** Documentation root for the region. */
  docsRoot: string
}

export const MINIMAX_T2A_ENDPOINTS: MiniMaxT2AEndpoint[] = [
  {
    region: 'global_en',
    url: 'https://api.minimax.io/v1/t2a_v2',
    docsRoot: 'https://platform.minimax.io/docs/api-reference/api-overview',
  },
  {
    region: 'cn_zh',
    url: 'https://api.minimaxi.com/v1/t2a_v2',
    docsRoot: 'https://platform.minimaxi.com/docs/api-reference/api-overview',
  },
]

export const MINIMAX_T2A_DEFAULT_REGION: MiniMaxT2ARegion = 'global_en'

/**
 * Text-to-audio operations. Paths are resolved against the origin of the
 * region endpoint so that every region exposes the same operation set.
 */
export const MINIMAX_T2A_OPERATIONS = {
  textToAudioHttp: { method: 'POST', path: '/v1/t2a_v2' },
  textToAudioAsyncCreate: { method: 'POST', path: '/v1/t2a_async_v2' },
  textToAudioAsyncQuery: { method: 'POST', path: '/v1/query/t2a_async_query_v2' },
  textToAudioWebSocket: { method: 'WSS', path: '/ws/v1/t2a_v2' },
} as const

export type MiniMaxT2AOperationId = keyof typeof MINIMAX_T2A_OPERATIONS

export function resolveMiniMaxT2AEndpoint(region?: MiniMaxT2ARegion): MiniMaxT2AEndpoint {
  return (
    MINIMAX_T2A_ENDPOINTS.find((entry) => entry.region === region) ??
    MINIMAX_T2A_ENDPOINTS.find((entry) => entry.region === MINIMAX_T2A_DEFAULT_REGION)!
  )
}

/** Build the absolute URL of an operation for the given region. */
export function resolveMiniMaxT2AUrl(
  region?: MiniMaxT2ARegion,
  operation: MiniMaxT2AOperationId = 'textToAudioHttp',
): string {
  const endpoint = resolveMiniMaxT2AEndpoint(region)
  const { path } = MINIMAX_T2A_OPERATIONS[operation]
  const url = new URL(endpoint.url)
  const scheme = MINIMAX_T2A_OPERATIONS[operation].method === 'WSS' ? 'wss:' : url.protocol
  return `${scheme}//${url.host}${path}`
}

// ============================================================================
// Models and audio formats
// ============================================================================

/** Selectable synthesis models, newest first. */
export const MINIMAX_T2A_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
] as const

export type MiniMaxT2AModel = (typeof MINIMAX_T2A_MODELS)[number]

export const MINIMAX_T2A_DEFAULT_MODEL: MiniMaxT2AModel = 'speech-2.8-hd'

export function isMiniMaxT2AModel(value: unknown): value is MiniMaxT2AModel {
  return typeof value === 'string' && (MINIMAX_T2A_MODELS as readonly string[]).includes(value)
}

/** Container formats supported by `audio_setting.format`. */
export const MINIMAX_T2A_AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'pcm'] as const

export type MiniMaxT2AAudioFormat = (typeof MINIMAX_T2A_AUDIO_FORMATS)[number]

export const MINIMAX_T2A_DEFAULT_AUDIO_FORMAT: MiniMaxT2AAudioFormat = 'mp3'

const MINIMAX_T2A_AUDIO_MIME_TYPES: Record<MiniMaxT2AAudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pcm: 'audio/L16',
}

export function miniMaxT2AAudioMimeType(format?: MiniMaxT2AAudioFormat): string {
  return MINIMAX_T2A_AUDIO_MIME_TYPES[format ?? MINIMAX_T2A_DEFAULT_AUDIO_FORMAT]
}

/** Encoding of `data.audio` requested through `output_format`. */
export type MiniMaxT2AOutputFormat = 'hex' | 'url'

// ============================================================================
// Errors
// ============================================================================

export class MiniMaxT2AError extends Error {
  /** `base_resp.status_code` when the API reported a business error. */
  statusCode?: number
  /** HTTP status when the transport itself failed. */
  httpStatus?: number

  constructor(message: string, options: { statusCode?: number; httpStatus?: number } = {}) {
    super(message)
    this.name = 'MiniMaxT2AError'
    this.statusCode = options.statusCode
    this.httpStatus = options.httpStatus
  }
}

// ============================================================================
// Request mapping
// ============================================================================

export interface MiniMaxT2AVoiceSetting {
  voice_id?: string
  speed?: number
  vol?: number
  pitch?: number
  emotion?: string
  english_normalization?: boolean
}

export interface MiniMaxT2AAudioSetting {
  sample_rate?: number
  bitrate?: number
  format?: MiniMaxT2AAudioFormat
  channel?: number
}

export interface MiniMaxT2AVoiceModify {
  pitch?: number
  intensity?: number
  timbre?: number
  sound_effects?: string
}

export interface MiniMaxT2APronunciationDict {
  tone?: string[]
}

export interface MiniMaxT2ARequestOptions {
  /** Defaults to {@link MINIMAX_T2A_DEFAULT_MODEL}. */
  model?: string
  text: string
  stream?: boolean
  languageBoost?: string
  outputFormat?: MiniMaxT2AOutputFormat
  voiceSetting?: MiniMaxT2AVoiceSetting
  pronunciationDict?: MiniMaxT2APronunciationDict
  audioSetting?: MiniMaxT2AAudioSetting
  voiceModify?: MiniMaxT2AVoiceModify
  subtitleEnable?: boolean
}

/** Request fields accepted by the synchronous text-to-audio operation. */
export const MINIMAX_T2A_REQUEST_FIELDS = [
  'model',
  'text',
  'stream',
  'language_boost',
  'output_format',
  'voice_setting',
  'pronunciation_dict',
  'audio_setting',
  'voice_modify',
  'subtitle_enable',
] as const

/**
 * Map request options onto the wire payload. `model` and `text` are required;
 * every other field is only sent when it was explicitly provided.
 */
export function buildMiniMaxT2ARequest(
  options: MiniMaxT2ARequestOptions,
): Record<string, unknown> {
  const text = options.text?.trim()
  if (!text) {
    throw new MiniMaxT2AError('MiniMax T2A requires non-empty text')
  }

  const model = options.model?.trim() || MINIMAX_T2A_DEFAULT_MODEL
  const body: Record<string, unknown> = { model, text }

  if (options.stream !== undefined) body.stream = options.stream
  if (options.languageBoost !== undefined) body.language_boost = options.languageBoost
  if (options.outputFormat !== undefined) body.output_format = options.outputFormat
  if (options.voiceSetting !== undefined) body.voice_setting = options.voiceSetting
  if (options.pronunciationDict !== undefined) body.pronunciation_dict = options.pronunciationDict
  if (options.audioSetting !== undefined) body.audio_setting = options.audioSetting
  if (options.voiceModify !== undefined) body.voice_modify = options.voiceModify
  if (options.subtitleEnable !== undefined) body.subtitle_enable = options.subtitleEnable

  return body
}

// ============================================================================
// Response parsing
// ============================================================================

export interface MiniMaxT2AResult {
  /** `data.audio`: hex-encoded audio, or a URL when requested. */
  audio: string
  /** `data.status` reported for the synthesis task. */
  status?: number
  /** Container format the audio was requested in. */
  format: MiniMaxT2AAudioFormat
  /** MIME type matching {@link MiniMaxT2AResult.format}. */
  mimeType: string
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Validate `base_resp.status_code` and extract the audio payload.
 * A non-zero status code is reported as a {@link MiniMaxT2AError}.
 */
export function parseMiniMaxT2AResponse(
  payload: unknown,
  format: MiniMaxT2AAudioFormat = MINIMAX_T2A_DEFAULT_AUDIO_FORMAT,
): MiniMaxT2AResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new MiniMaxT2AError('MiniMax T2A returned an unreadable response')
  }

  const root = payload as Record<string, unknown>
  const baseResp = (root.base_resp ?? {}) as Record<string, unknown>
  const statusCode = readNumber(baseResp.status_code)
  if (statusCode !== undefined && statusCode !== 0) {
    const statusMsg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : ''
    throw new MiniMaxT2AError(
      statusMsg || `MiniMax T2A failed with status code ${statusCode}`,
      { statusCode },
    )
  }

  const data = (root.data ?? {}) as Record<string, unknown>
  const audio = typeof data.audio === 'string' ? data.audio : ''
  if (!audio) {
    throw new MiniMaxT2AError('MiniMax T2A response did not contain audio data')
  }

  return {
    audio,
    status: readNumber(data.status),
    format,
    mimeType: miniMaxT2AAudioMimeType(format),
  }
}

/** Decode hex-encoded audio into bytes. */
export function decodeMiniMaxT2AAudioHex(audio: string): Uint8Array {
  const hex = audio.trim()
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new MiniMaxT2AError('MiniMax T2A audio payload is not valid hex')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ============================================================================
// Transport
// ============================================================================

export interface MiniMaxT2ASynthesizeOptions extends MiniMaxT2ARequestOptions {
  apiKey: string
  region?: MiniMaxT2ARegion
  signal?: AbortSignal
}

/**
 * Call the synchronous text-to-audio operation for the selected region and
 * return the parsed audio payload.
 */
export async function synthesizeMiniMaxSpeech(
  options: MiniMaxT2ASynthesizeOptions,
): Promise<MiniMaxT2AResult> {
  const { apiKey, region, signal, ...requestOptions } = options
  if (!apiKey) {
    throw new MiniMaxT2AError('MiniMax T2A requires an API key')
  }

  const body = buildMiniMaxT2ARequest(requestOptions)
  const url = resolveMiniMaxT2AUrl(region, 'textToAudioHttp')

  let response: Response
  try {
    response = await fetch(url, {
      method: MINIMAX_T2A_OPERATIONS.textToAudioHttp.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof MiniMaxT2AError) throw err
    throw new MiniMaxT2AError(
      err instanceof Error ? err.message : 'MiniMax T2A request failed',
    )
  }

  if (!response.ok) {
    throw new MiniMaxT2AError(`MiniMax T2A request failed with HTTP ${response.status}`, {
      httpStatus: response.status,
    })
  }

  const payload: unknown = await response.json()
  return parseMiniMaxT2AResponse(payload, requestOptions.audioSetting?.format)
}
