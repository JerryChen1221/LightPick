const DEFAULT_JOYBUILDER_BASE_URL = "http://ai-api.jdcloud.com/v1";
const DEFAULT_JOYBUILDER_MODEL_SERVICE_URL = "https://modelservice.jdcloud.com";
const DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_JOYBUILDER_KLING_MODEL = "Kling-V2-5-Turbo";

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
}

interface JoyBuilderImageContent {
  type: "image_url";
  role?: "first_frame" | "last_frame";
  image_url: { url: string };
}

type JoyBuilderVideoContent = JoyBuilderTextContent | JoyBuilderImageContent;

export interface JoyBuilderKlingVideoParams {
  prompt?: string;
  negativePrompt?: string;
  modelName?: string;
  mode?: string;
  duration?: string;
  aspectRatio?: string;
  imageUrl?: string;
  endImageUrl?: string;
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

function normalizeKlingDuration(duration?: string): 5 | 10 {
  return duration === "10" ? 10 : 5;
}

function normalizeKlingMode(mode?: string): "std" | "pro" {
  return mode === "pro" ? "pro" : "std";
}

function normalizeKlingAspectRatio(aspectRatio?: string): "16:9" | "9:16" | "1:1" {
  return aspectRatio === "9:16" || aspectRatio === "1:1" ? aspectRatio : "16:9";
}

function videoContent(prompt?: string, negativePrompt?: string): JoyBuilderVideoContent[] {
  const content: JoyBuilderVideoContent[] = [{ type: "text", text: prompt ?? "" }];
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
  const duration = normalizeKlingDuration(params.duration);
  const content = videoContent(params.prompt, params.negativePrompt);

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

  const payload: Record<string, unknown> = {
    model: params.modelName ?? DEFAULT_JOYBUILDER_KLING_MODEL,
    content,
    parameters: {
      mode: normalizeKlingMode(params.mode),
      duration,
      ...(!params.imageUrl ? { aspect_ratio: normalizeKlingAspectRatio(params.aspectRatio) } : {}),
    },
  };
  if (params.callbackUrl) payload.callback_url = params.callbackUrl;

  const taskId = taskIdFromSubmit((await modelServicePost(env, "/v1/task/submit", payload)) as JoyBuilderSubmitResponse);
  return pollKlingTask(env, taskId, duration);
}
