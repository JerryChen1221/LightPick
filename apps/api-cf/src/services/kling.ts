import * as jose from "jose";

const DEFAULT_BASE_URL = "https://api-beijing.klingai.com";

export interface KlingConfig {
  accessKey: string;
  secretKey: string;
  apiUrl?: string;
}

// ── Auth ────────────────────────────────────────────────────────

async function generateJwtToken(config: KlingConfig): Promise<string> {
  const secret = new TextEncoder().encode(config.secretKey);
  const now = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({
    iss: config.accessKey,
    exp: now + 1800,
    nbf: now - 5,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

function baseUrl(config: KlingConfig): string {
  return (config.apiUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function klingPost(config: KlingConfig, path: string, body: Record<string, unknown>): Promise<unknown> {
  const token = await generateJwtToken(config);
  const resp = await fetch(`${baseUrl(config)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kling API error ${resp.status}: ${text}`);
  }
  const result = await resp.json() as { code: number; message?: string; data?: unknown };
  if (result.code !== 0) {
    throw new Error(`Kling API returned error code ${result.code}: ${result.message ?? JSON.stringify(result)}`);
  }
  return result.data;
}

async function klingGet(config: KlingConfig, path: string): Promise<unknown> {
  const token = await generateJwtToken(config);
  const resp = await fetch(`${baseUrl(config)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kling poll error ${resp.status}: ${text}`);
  }
  const result = await resp.json() as { code: number; message?: string; data?: unknown };
  if (result.code !== 0) {
    throw new Error(`Kling query error code ${result.code}: ${result.message ?? JSON.stringify(result)}`);
  }
  return result.data;
}

// ── Generic poll helper ─────────────────────────────────────────

interface TaskData {
  task_id: string;
  task_status: string;
  task_status_msg?: string;
  task_result?: unknown;
}

async function pollTask(
  config: KlingConfig,
  path: string,
  pollIntervalMs = 5000,
  maxWaitMs = 300_000,
): Promise<TaskData> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = (await klingGet(config, path)) as TaskData;
    if (data.task_status === "succeed") return data;
    if (data.task_status === "failed") {
      throw new Error(`Kling task failed: ${data.task_status_msg ?? JSON.stringify(data)}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Kling task timed out after ${maxWaitMs}ms`);
}

// ── Image Generation ────────────────────────────────────────────

export interface KlingImageParams {
  prompt: string;
  negativePrompt?: string;
  /** Number of images, 1-9. Default 1. */
  n?: number;
  /** e.g. "1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2" */
  aspectRatio?: string;
  modelName?: string;
  /** For image-to-image: base64 or URL of source image */
  image?: string;
  /** 0-1, controls fidelity to source image. Default 0.5. */
  imageFidelity?: number;
  callbackUrl?: string;
}

export interface KlingImageResult {
  taskId: string;
  images: Array<{ url: string; index: number }>;
}

export async function createImageTask(config: KlingConfig, params: KlingImageParams): Promise<string> {
  const payload: Record<string, unknown> = {
    model_name: params.modelName ?? "kling-image-v3",
    prompt: params.prompt,
    n: params.n ?? 1,
    aspect_ratio: params.aspectRatio ?? "16:9",
  };
  if (params.negativePrompt) payload.negative_prompt = params.negativePrompt;
  if (params.image) {
    payload.image = params.image;
    if (params.imageFidelity !== undefined) payload.image_fidelity = params.imageFidelity;
  }
  if (params.callbackUrl) payload.callback_url = params.callbackUrl;

  const data = (await klingPost(config, "/v1/images/generations", payload)) as { task_id: string };
  return data.task_id;
}

export async function pollImageTask(
  config: KlingConfig,
  taskId: string,
  pollIntervalMs = 3000,
  maxWaitMs = 120_000,
): Promise<KlingImageResult> {
  const data = await pollTask(config, `/v1/images/generations/${taskId}`, pollIntervalMs, maxWaitMs);
  const result = data.task_result as { images?: Array<{ url: string; index: number }> } | undefined;
  if (!result?.images?.length) throw new Error("No images in completed Kling result");
  return { taskId: data.task_id, images: result.images };
}

export async function generateImage(
  config: KlingConfig,
  params: KlingImageParams,
): Promise<KlingImageResult> {
  const taskId = await createImageTask(config, params);
  return pollImageTask(config, taskId);
}

// ── Video Generation: text2video ────────────────────────────────

export interface KlingText2VideoParams {
  prompt: string;
  negativePrompt?: string;
  modelName?: string;
  /** "std" or "pro". Default "std". */
  mode?: string;
  /** "5" or "10". Default "5". */
  duration?: string;
  cfgScale?: number;
  aspectRatio?: string;
  callbackUrl?: string;
}

export interface KlingVideoResult {
  taskId: string;
  url: string;
  duration: number;
  coverImageUrl?: string;
}

export async function createText2VideoTask(config: KlingConfig, params: KlingText2VideoParams): Promise<string> {
  const payload: Record<string, unknown> = {
    model_name: params.modelName ?? "kling-v3",
    prompt: params.prompt,
    duration: params.duration ?? "5",
    mode: params.mode ?? "std",
  };
  if (params.negativePrompt) payload.negative_prompt = params.negativePrompt;
  if (params.cfgScale !== undefined) payload.cfg_scale = params.cfgScale;
  if (params.aspectRatio) payload.aspect_ratio = params.aspectRatio;
  if (params.callbackUrl) payload.callback_url = params.callbackUrl;

  const data = (await klingPost(config, "/v1/videos/text2video", payload)) as { task_id: string };
  return data.task_id;
}

export async function pollText2VideoTask(
  config: KlingConfig,
  taskId: string,
  pollIntervalMs = 5000,
  maxWaitMs = 300_000,
): Promise<KlingVideoResult> {
  const data = await pollTask(config, `/v1/videos/text2video/${taskId}`, pollIntervalMs, maxWaitMs);
  const result = data.task_result as { videos?: Array<{ url: string; duration: number; cover_image_url?: string }> } | undefined;
  if (!result?.videos?.length) throw new Error("No videos in completed Kling text2video result");
  const v = result.videos[0];
  return { taskId: data.task_id, url: v.url, duration: v.duration, coverImageUrl: v.cover_image_url };
}

export async function generateText2Video(
  config: KlingConfig,
  params: KlingText2VideoParams,
): Promise<KlingVideoResult> {
  const taskId = await createText2VideoTask(config, params);
  return pollText2VideoTask(config, taskId);
}

// ── Video Generation: image2video ───────────────────────────────

export interface KlingImage2VideoParams {
  image: string;
  prompt?: string;
  modelName?: string;
  mode?: string;
  duration?: string;
  cfgScale?: number;
  negativePrompt?: string;
  isBase64?: boolean;
  callbackUrl?: string;
}

function stripDataUrl(base64Str: string): string {
  if (base64Str.startsWith("data:")) {
    const idx = base64Str.indexOf(",");
    return idx >= 0 ? base64Str.slice(idx + 1) : base64Str;
  }
  return base64Str;
}

export async function createImage2VideoTask(config: KlingConfig, params: KlingImage2VideoParams): Promise<string> {
  const image = params.isBase64 ? stripDataUrl(params.image) : params.image;
  const payload: Record<string, unknown> = {
    model_name: params.modelName ?? "kling-v3",
    image,
    duration: params.duration ?? "5",
    mode: params.mode ?? "std",
  };
  if (params.prompt) payload.prompt = params.prompt;
  if (params.negativePrompt) payload.negative_prompt = params.negativePrompt;
  if (params.cfgScale !== undefined && params.cfgScale !== 0.5) payload.cfg_scale = params.cfgScale;
  if (params.callbackUrl) payload.callback_url = params.callbackUrl;

  const data = (await klingPost(config, "/v1/videos/image2video", payload)) as { task_id: string };
  return data.task_id;
}

export async function pollImage2VideoTask(
  config: KlingConfig,
  taskId: string,
  pollIntervalMs = 5000,
  maxWaitMs = 300_000,
): Promise<KlingVideoResult> {
  const data = await pollTask(config, `/v1/videos/image2video/${taskId}`, pollIntervalMs, maxWaitMs);
  const result = data.task_result as { videos?: Array<{ url: string; duration: number; cover_image_url?: string }> } | undefined;
  if (!result?.videos?.length) throw new Error("No videos in completed Kling image2video result");
  const v = result.videos[0];
  return { taskId: data.task_id, url: v.url, duration: v.duration, coverImageUrl: v.cover_image_url };
}

export async function generateImage2Video(
  config: KlingConfig,
  params: KlingImage2VideoParams,
): Promise<KlingVideoResult> {
  const taskId = await createImage2VideoTask(config, params);
  return pollImage2VideoTask(config, taskId);
}
