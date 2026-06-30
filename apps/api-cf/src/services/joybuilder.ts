const DEFAULT_JOYBUILDER_BASE_URL = "http://ai-api.jdcloud.com/v1";
const DEFAULT_JOYBUILDER_MODEL_SERVICE_URL = "https://modelservice.jdcloud.com";
const DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_JOYBUILDER_KLING_MODEL = "Kling-V2-5-Turbo";
const DEFAULT_JOYBUILDER_TTS_MODEL = "Doubao-TTS";

export interface JoyBuilderEnv {
  JOYBUILDER_API_KEY?: string;
  JOYBUILDER_BASE_URL?: string;
  JOYBUILDER_MODEL_SERVICE_URL?: string;
  KLING_ACCESS_KEY?: string;
  CF_AIG_TOKEN?: string;
  CF_AIG_OPENAI_URL?: string;
}

export interface JoyBuilderOpenAIConfig {
  apiKey: string;
  baseURL: string;
}

export function joyBuilderOpenAIConfig(env: JoyBuilderEnv): JoyBuilderOpenAIConfig {
  const apiKey = env.JOYBUILDER_API_KEY ?? env.KLING_ACCESS_KEY ?? env.CF_AIG_TOKEN ?? "";
  const baseURL = env.JOYBUILDER_BASE_URL ?? env.CF_AIG_OPENAI_URL ?? DEFAULT_JOYBUILDER_BASE_URL;
  if (!apiKey) {
    throw new Error("JOYBUILDER_API_KEY is required for JoyBuilder model calls");
  }
  return { apiKey, baseURL: baseURL.replace(/\/$/, "") };
}

function joyBuilderApiKey(env: JoyBuilderEnv): string {
  const apiKey = env.JOYBUILDER_API_KEY ?? env.KLING_ACCESS_KEY ?? env.CF_AIG_TOKEN ?? "";
  if (!apiKey) {
    throw new Error("JOYBUILDER_API_KEY is required for JoyBuilder model calls");
  }
  return apiKey;
}

function joyBuilderBearer(env: JoyBuilderEnv): string {
  const apiKey = joyBuilderApiKey(env);
  return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function joyBuilderModelServiceBaseUrl(env: JoyBuilderEnv): string {
  return (env.JOYBUILDER_MODEL_SERVICE_URL ?? DEFAULT_JOYBUILDER_MODEL_SERVICE_URL).replace(/\/$/, "");
}

export interface GptImageGenerateParams {
  prompt: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  outputCompression?: number;
  n?: number;
}

export interface GptImageGenerateResult {
  data: Uint8Array;
  mediaType: string;
  usage?: unknown;
}

interface GptImageResponse {
  data?: Array<{ b64_json?: string }>;
  usage?: unknown;
}

function normalizeSize(size?: string): "1024x1024" | "1024x1536" | "1536x1024" {
  if (size === "1024x1536" || size === "1536x1024") return size;
  return "1024x1024";
}

function normalizeQuality(quality?: string): "low" | "medium" | "high" {
  if (quality === "low" || quality === "high") return quality;
  return "medium";
}

function normalizeOutputFormat(format?: string): "PNG" | "JPEG" {
  return format?.toUpperCase() === "JPEG" ? "JPEG" : "PNG";
}

function normalizeCompression(value?: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value ?? 100)));
}

function decodeBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) out[offset + i] = value.charCodeAt(i);
}

function pcm16ToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);

  writeAscii(out, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(out, 36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function hasAudioContainerHeader(data: Uint8Array): boolean {
  const header = new TextDecoder().decode(data.slice(0, 4));
  return header === "RIFF" || header === "OggS" || header === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
}

export async function generateGptImage(
  env: JoyBuilderEnv,
  params: GptImageGenerateParams,
): Promise<GptImageGenerateResult> {
  const { apiKey, baseURL } = joyBuilderOpenAIConfig(env);
  const outputFormat = normalizeOutputFormat(params.outputFormat);
  const resp = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_GPT_IMAGE_MODEL,
      prompt: params.prompt,
      size: normalizeSize(params.size),
      quality: normalizeQuality(params.quality),
      output_compression: normalizeCompression(params.outputCompression),
      output_format: outputFormat,
      n: Math.max(1, Math.min(10, Math.round(params.n ?? 1))),
    }),
  });

  const bodyText = await resp.text();
  let body: GptImageResponse | Record<string, unknown> | null = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`JoyBuilder GPT-Image returned non-JSON response ${resp.status}: ${bodyText}`);
  }

  if (!resp.ok) {
    throw new Error(`JoyBuilder GPT-Image error ${resp.status}: ${JSON.stringify(body)}`);
  }

  const first = (body as GptImageResponse | null)?.data?.[0]?.b64_json;
  if (!first) {
    throw new Error(`JoyBuilder GPT-Image response missing data[0].b64_json: ${JSON.stringify(body)}`);
  }

  return {
    data: decodeBase64(first),
    mediaType: outputFormat === "JPEG" ? "image/jpeg" : "image/png",
    usage: (body as GptImageResponse).usage,
  };
}

// ── JoyBuilder TTS ─────────────────────────────────────────────

export const JOYBUILDER_TTS_MODELS = new Set([
  "joybuilder-doubao-tts",
  "joybuilder-gemini-2.5-pro-tts",
  "Doubao-TTS",
  "Gemini-2.5-Pro-TTS",
]);

const JOYBUILDER_TTS_MODEL_MAP: Record<string, string> = {
  "joybuilder-doubao-tts": "Doubao-TTS",
  "joybuilder-gemini-2.5-pro-tts": "Gemini-2.5-Pro-TTS",
};

const JOYBUILDER_TTS_AUDIO_KEYS = [
  "voice_type",
  "emotion",
  "enable_emotion",
  "emotion_scale",
  "encoding",
  "speed_ratio",
  "rate",
  "bitrate",
  "explicit_language",
  "context_language",
  "loudness_ratio",
] as const;

const JOYBUILDER_TTS_REQUEST_KEYS = [
  "text_type",
  "silence_duration",
  "with_timestamp",
  "enable_trailing_silence_audio",
  "extra_param",
] as const;

export interface JoyBuilderTtsParams {
  prompt: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
}

export interface JoyBuilderTtsResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

interface JoyBuilderTtsResponse {
  reqid?: string;
  code?: number;
  message?: string;
  sequence?: number;
  data?: string;
  addition?: {
    duration?: string;
  };
}

export function isJoyBuilderTtsModel(modelName: string | undefined): boolean {
  return !!modelName && JOYBUILDER_TTS_MODELS.has(modelName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== "")) as Partial<T>;
}

function joyBuilderTtsProviderModel(modelName?: string): string {
  if (!modelName) return DEFAULT_JOYBUILDER_TTS_MODEL;
  return JOYBUILDER_TTS_MODEL_MAP[modelName] ?? modelName;
}

function joyBuilderTtsPath(modelName: string): string {
  return /gemini|doubao-tts/i.test(modelName) ? "/tts/base64" : "/tts/byteStream";
}

function mediaTypeFromTtsEncoding(encoding: unknown): string {
  switch (String(encoding ?? "mp3").toLowerCase()) {
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    case "ogg_opus":
      return "audio/ogg";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

function buildJoyBuilderTtsParams(
  prompt: string,
  modelName: string,
  modelParams: Record<string, unknown> | undefined,
  reqid: string,
) {
  const source = modelParams ?? {};
  const nestedParams = isRecord(source.params) ? source.params : {};
  const nestedAudio = isRecord(nestedParams.audio) ? nestedParams.audio : {};
  const nestedRequest = isRecord(nestedParams.request) ? nestedParams.request : {};
  const nestedUser = isRecord(nestedParams.user) ? nestedParams.user : {};

  const audio: Record<string, unknown> = {
    ...nestedAudio,
    encoding: source.encoding ?? nestedAudio.encoding ?? "mp3",
    speed_ratio: source.speed_ratio ?? nestedAudio.speed_ratio ?? 1,
  };
  for (const key of JOYBUILDER_TTS_AUDIO_KEYS) {
    if (source[key] !== undefined) audio[key] = source[key];
  }

  const request: Record<string, unknown> = {
    ...nestedRequest,
    reqid: source.reqid ?? nestedRequest.reqid ?? reqid,
    text: prompt,
    text_type: source.text_type ?? nestedRequest.text_type ?? "plain",
    operation: source.operation ?? nestedRequest.operation ?? "query",
  };
  for (const key of JOYBUILDER_TTS_REQUEST_KEYS) {
    if (source[key] !== undefined) request[key] = source[key];
  }

  const params = compactRecord({
    ...nestedParams,
    ...(isRecord(nestedParams.app) ? { app: nestedParams.app } : {}),
    user: compactRecord({
      ...nestedUser,
      uid: source.uid ?? nestedUser.uid ?? "lightpick",
    }),
    audio: compactRecord(audio),
    request: compactRecord(request),
  });

  if (/gemini/i.test(modelName) && !params.voice_config && !params.multi_speaker_voice_config) {
    params.voice_config = isRecord(source.voice_config)
      ? source.voice_config
      : {
          prebuilt_voice_config: {
            voice_name: typeof source.voice_name === "string" && source.voice_name.trim() ? source.voice_name.trim() : "Kore",
          },
        };
  }

  return params;
}

function collectTtsChunks(value: unknown, chunks: string[] = []): string[] {
  if (!isRecord(value)) return chunks;
  const code = typeof value.code === "number" ? value.code : 0;
  if (code !== 0 && code !== 3000) {
    throw new Error(`JoyBuilder TTS returned error: ${value.message ?? JSON.stringify(value)}`);
  }
  if (typeof value.data === "string" && value.data) chunks.push(value.data);
  for (const nested of Object.values(value)) {
    if (isRecord(nested)) collectTtsChunks(nested, chunks);
    else if (Array.isArray(nested)) nested.forEach((item) => collectTtsChunks(item, chunks));
  }
  return chunks;
}

function parseJoyBuilderTtsText(text: string): unknown[] {
  try {
    return [JSON.parse(text)];
  } catch {
    const values: unknown[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/^data:\s*/, "");
      if (!line || line === "[DONE]") continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        // Ignore keepalive / non-JSON streaming delimiters.
      }
    }
    return values;
  }
}

export async function generateJoyBuilderTts(
  env: JoyBuilderEnv,
  params: JoyBuilderTtsParams,
): Promise<JoyBuilderTtsResult> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Prompt is required for JoyBuilder TTS generation.");
  if (new TextEncoder().encode(prompt).length > 1024) {
    throw new Error("JoyBuilder TTS prompt exceeds the 1024-byte UTF-8 limit.");
  }

  const { baseURL } = joyBuilderOpenAIConfig(env);
  const model = joyBuilderTtsProviderModel(params.modelName);
  const reqid = `lightpick-${crypto.randomUUID()}`;
  const requestParams = buildJoyBuilderTtsParams(prompt, model, params.modelParams, reqid);
  const encoding = isRecord(requestParams.audio) ? requestParams.audio.encoding : "mp3";

  const resp = await fetch(`${baseURL}${joyBuilderTtsPath(model)}`, {
    method: "POST",
    headers: {
      Authorization: joyBuilderBearer(env),
      "Content-Type": "application/json",
      Accept: "*/*",
      "Trace-Id": reqid,
    },
    body: JSON.stringify({
      model,
      text: prompt,
      params: requestParams,
      stream: false,
    }),
  });

  const contentType = resp.headers.get("content-type") ?? "";
  if (resp.ok && contentType.startsWith("audio/")) {
    return {
      data: new Uint8Array(await resp.arrayBuffer()),
      mediaType: contentType.split(";")[0] || mediaTypeFromTtsEncoding(encoding),
      model,
    };
  }

  const text = await resp.text();
  const values = parseJoyBuilderTtsText(text);
  if (!resp.ok) {
    throw new Error(`JoyBuilder TTS error ${resp.status}: ${text || resp.statusText}`);
  }

  const chunks = values.flatMap((value) => collectTtsChunks(value as JoyBuilderTtsResponse));
  if (chunks.length === 0) {
    throw new Error(`JoyBuilder TTS response missing audio data: ${text}`);
  }

  let data = decodeBase64(chunks.join(""));
  let mediaType = mediaTypeFromTtsEncoding(encoding);
  if (/gemini/i.test(model) && !hasAudioContainerHeader(data)) {
    data = pcm16ToWav(data);
    mediaType = "audio/wav";
  }

  return { data, mediaType, model };
}

// ── JoyBuilder Kling Video ─────────────────────────────────────

type JoyBuilderTaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

interface JoyBuilderSubmitResponse {
  result?: {
    task_id?: string;
    status?: JoyBuilderTaskStatus;
    message?: string;
  } | null;
  error?: unknown;
}

interface JoyBuilderQueryResponse {
  task_status?: JoyBuilderTaskStatus;
  content?: Array<{
    id?: string;
    video_url?: { url?: string };
  }>;
  error?: {
    code?: number;
    type?: string;
    message?: string;
  } | null;
}

interface JoyBuilderTextContent {
  type: "text" | "negative_text";
  text: string;
  role?: "omni_video";
  duration?: string;
}

interface JoyBuilderImageContent {
  type: "image_url";
  role?: "first_frame" | "last_frame";
  image_url: { url: string };
}

interface JoyBuilderVideoUrlContent {
  type: "video_url";
  role?: "reference_video";
  video_url: { url: string };
}

interface JoyBuilderSubjectContent {
  type: "subject";
  subject: string;
}

type JoyBuilderVideoContent =
  | JoyBuilderTextContent
  | JoyBuilderImageContent
  | JoyBuilderVideoUrlContent
  | JoyBuilderSubjectContent;

export interface JoyBuilderKlingVideoParams {
  prompt?: string;
  negativePrompt?: string;
  modelName?: string;
  mode?: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  sound?: string | boolean;
  imageUrl?: string;
  endImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  videoRole?: string;
  subjectIds?: string | string[];
  keepOriginalSound?: string | boolean;
  callbackUrl?: string;
}

export interface JoyBuilderKlingVideoResult {
  taskId: string;
  url: string;
  duration: number;
}

function hasJoyBuilderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; type?: unknown; message?: unknown; cause?: unknown };
  const code = typeof e.code === "number" ? e.code : undefined;
  const type = typeof e.type === "string" ? e.type.trim() : "";
  const message = typeof e.message === "string" ? e.message.trim() : "";
  const cause = typeof e.cause === "string" ? e.cause.trim() : "";
  return (code !== undefined && code !== 0) || !!type || !!message || !!cause;
}

function normalizeKlingDuration(duration?: string): number {
  const parsed = Number(duration);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(3, Math.min(15, Math.round(parsed)));
}

function normalizeKlingMode(mode?: string, resolution?: string): "std" | "pro" | "4k" {
  if (mode === "std" || mode === "pro" || mode === "4k") return mode;
  const upper = resolution?.toUpperCase();
  if (upper === "4K") return "4k";
  if (upper === "1080P") return "pro";
  return "std";
}

function normalizeKlingAspectRatio(aspectRatio?: string): "16:9" | "9:16" | "1:1" {
  return aspectRatio === "9:16" || aspectRatio === "1:1" ? aspectRatio : "16:9";
}

function normalizeKlingResolution(resolution?: string): "720P" | "1080P" | "4K" | undefined {
  if (!resolution) return undefined;
  const upper = resolution.toUpperCase();
  if (upper === "720P" || upper === "1080P" || upper === "4K") return upper;
  return undefined;
}

function normalizeKlingSound(sound?: string | boolean): "on" | "off" | undefined {
  if (sound === true) return "on";
  if (sound === false) return "off";
  if (typeof sound !== "string") return undefined;
  const normalized = sound.trim().toLowerCase();
  if (normalized === "on" || normalized === "true") return "on";
  if (normalized === "off" || normalized === "false") return "off";
  return undefined;
}

function normalizeKeepOriginalSound(value?: string | boolean): "yes" | "no" | undefined {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "true" || normalized === "on") return "yes";
  if (normalized === "no" || normalized === "false" || normalized === "off") return "no";
  return undefined;
}

function isJoyBuilderOmniModel(modelName: string | undefined): boolean {
  return modelName === "Kling-V3-omni";
}

function parseSubjectIds(input: string | string[] | undefined): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,，;；]+/)
      : [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function hasOmniPlaceholder(prompt: string): boolean {
  return /<<<(?:image|video|element)_\d+>>>/.test(prompt);
}

function joinPlaceholders(kind: "image" | "video" | "element", count: number): string {
  return Array.from({ length: count }, (_, idx) => `<<<${kind}_${idx + 1}>>>`).join("、");
}

function buildOmniPrompt(params: JoyBuilderKlingVideoParams): string {
  const userPrompt = (params.prompt ?? "").trim();
  if (!isJoyBuilderOmniModel(params.modelName) || !userPrompt || hasOmniPlaceholder(userPrompt)) {
    return userPrompt;
  }

  const videoCount = params.videoUrls?.filter(Boolean).length ?? 0;
  const imageCount = [
    params.imageUrl,
    params.endImageUrl,
    ...(params.imageUrls ?? []),
  ].filter(Boolean).length;
  const subjectCount = parseSubjectIds(params.subjectIds).length;
  const references: string[] = [];
  if (imageCount > 0) references.push(`参考图片 ${joinPlaceholders("image", imageCount)}`);
  if (subjectCount > 0) references.push(`参考主体 ${joinPlaceholders("element", subjectCount)}`);

  if (params.videoRole === "reference_video" && videoCount > 0) {
    return [
      `参考${joinPlaceholders("video", videoCount)}的运镜、节奏和视觉风格，生成一段新视频：${userPrompt}`,
      references.length ? `${references.join("，")}。` : "",
    ].filter(Boolean).join("。");
  }

  if (videoCount > 0) {
    return [
      `对${joinPlaceholders("video", videoCount)}进行如下编辑：${userPrompt}`,
      references.length ? `${references.join("，")}。` : "",
    ].filter(Boolean).join("。");
  }

  if (references.length > 0) {
    return `${userPrompt}。${references.join("，")}。`;
  }

  return userPrompt;
}

function videoContent(prompt?: string, negativePrompt?: string, role?: "omni_video"): JoyBuilderVideoContent[] {
  const content: JoyBuilderVideoContent[] = [{ type: "text", text: prompt ?? "", ...(role ? { role } : {}) }];
  if (negativePrompt) content.push({ type: "negative_text", text: negativePrompt });
  return content;
}

async function modelServicePost(env: JoyBuilderEnv, path: string, body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${joyBuilderModelServiceBaseUrl(env)}${path}`, {
    method: "POST",
    headers: {
      Authorization: joyBuilderBearer(env),
      "Content-Type": "application/json",
      "Trace-id": `lightpick-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  const json = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    throw new Error(`JoyBuilder Kling error ${resp.status}: ${JSON.stringify(json)}`);
  }
  if (hasJoyBuilderError(json?.error)) {
    throw new Error(`JoyBuilder Kling returned error: ${JSON.stringify(json.error)}`);
  }
  return json;
}

async function modelServiceGet(env: JoyBuilderEnv, path: string): Promise<any> {
  const resp = await fetch(`${joyBuilderModelServiceBaseUrl(env)}${path}`, {
    headers: {
      Authorization: joyBuilderBearer(env),
      "Trace-id": `lightpick-${crypto.randomUUID()}`,
    },
  });
  const text = await resp.text();
  const json = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    throw new Error(`JoyBuilder Kling poll error ${resp.status}: ${JSON.stringify(json)}`);
  }
  if (hasJoyBuilderError(json?.error)) {
    throw new Error(`JoyBuilder Kling query returned error: ${JSON.stringify(json.error)}`);
  }
  return json;
}

function taskIdFromSubmit(result: JoyBuilderSubmitResponse): string {
  const taskId = result.result?.task_id;
  if (!taskId) throw new Error(`JoyBuilder Kling submit response missing task_id: ${JSON.stringify(result)}`);
  return taskId;
}

function resultFromQuery(
  taskId: string,
  result: JoyBuilderQueryResponse,
  duration: number,
): JoyBuilderKlingVideoResult | null {
  const status = result.task_status;
  if (status === "failed" || status === "cancelled") {
    throw new Error(`JoyBuilder Kling task ${status}: ${result.error?.message ?? JSON.stringify(result.error ?? result)}`);
  }
  if (status !== "success") return null;

  const url = result.content?.find((item) => item.video_url?.url)?.video_url?.url;
  if (!url) throw new Error(`No video_url in completed JoyBuilder Kling result: ${JSON.stringify(result)}`);
  return { taskId, url, duration };
}

async function pollKlingTask(
  env: JoyBuilderEnv,
  taskId: string,
  duration: number,
  pollIntervalMs = 15_000,
  maxWaitMs = 900_000,
): Promise<JoyBuilderKlingVideoResult> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = (await modelServiceGet(env, `/v1/task/${encodeURIComponent(taskId)}`)) as JoyBuilderQueryResponse;
    const done = resultFromQuery(taskId, data, duration);
    if (done) return done;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`JoyBuilder Kling task timed out after ${maxWaitMs}ms`);
}

export async function generateJoyBuilderKlingVideo(
  env: JoyBuilderEnv,
  params: JoyBuilderKlingVideoParams,
): Promise<JoyBuilderKlingVideoResult> {
  const isOmni = isJoyBuilderOmniModel(params.modelName);
  const duration = normalizeKlingDuration(params.duration);
  const resolution = normalizeKlingResolution(params.resolution);
  const mode = normalizeKlingMode(params.mode, resolution);
  const sound = normalizeKlingSound(params.sound);
  const keepOriginalSound = normalizeKeepOriginalSound(params.keepOriginalSound);
  const hasVideoInput = (params.videoUrls ?? []).some(Boolean);
  const prompt = buildOmniPrompt(params);
  const content = videoContent(prompt, params.negativePrompt, isOmni ? "omni_video" : undefined);

  if (params.imageUrl) {
    content.push({
      type: "image_url",
      role: params.endImageUrl ? "first_frame" : undefined,
      image_url: { url: params.imageUrl },
    });
    if (params.endImageUrl) {
      content.push({
        type: "image_url",
        role: "last_frame",
        image_url: { url: params.endImageUrl },
      });
    }
  }
  for (const imageUrl of params.imageUrls ?? []) {
    if (!imageUrl || imageUrl === params.imageUrl || imageUrl === params.endImageUrl) continue;
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  for (const videoUrl of params.videoUrls ?? []) {
    if (!videoUrl) continue;
    content.push({
      type: "video_url",
      ...(params.videoRole === "reference_video" ? { role: "reference_video" as const } : {}),
      video_url: { url: videoUrl },
    });
  }
  for (const subject of parseSubjectIds(params.subjectIds)) {
    content.push({ type: "subject", subject });
  }

  const payload: Record<string, unknown> = {
    model: params.modelName ?? DEFAULT_JOYBUILDER_KLING_MODEL,
    content,
    parameters: {
      mode,
      duration,
      ...(!hasVideoInput && sound ? { sound } : {}),
      ...(keepOriginalSound ? { keep_original_sound: keepOriginalSound } : {}),
      ...(!params.imageUrl ? { aspect_ratio: normalizeKlingAspectRatio(params.aspectRatio) } : {}),
    },
  };
  if (params.callbackUrl) payload.callback_url = params.callbackUrl;

  const taskId = taskIdFromSubmit((await modelServicePost(env, "/v1/task/submit", payload)) as JoyBuilderSubmitResponse);
  return pollKlingTask(env, taskId, duration);
}
