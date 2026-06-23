import { log } from "../../logger";
import {
  generateText2Video,
  generateImage2Video,
  type KlingConfig,
} from "../../services/kling";
import type { GenerationProvider } from "../provider";

function klingConfig(env: { KLING_ACCESS_KEY: string; KLING_SECRET_KEY: string; KLING_API_URL?: string }): KlingConfig {
  return {
    accessKey: env.KLING_ACCESS_KEY,
    secretKey: env.KLING_SECRET_KEY,
    apiUrl: env.KLING_API_URL,
  };
}

async function r2ToPublicUrl(bucket: R2Bucket, key: string, publicBase?: string): Promise<string> {
  if (publicBase) return `${publicBase.replace(/\/$/, "")}/${key}`;
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  const buf = await obj.arrayBuffer();
  return `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
}

export const klingVideoProvider: GenerationProvider = {
  name: "kling-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const config = klingConfig(env);
    const model = params.videoModel ?? params.modelName;

    const hasStartFrame = !!params.startFrameR2Key;
    const hasRefImage = !!params.referenceImageR2Keys?.length;
    const isImage2Video = hasStartFrame || hasRefImage;

    const { storageKey, providerCoverKey, duration } = await ctx.step(
      "kling-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        log.info("kling-video generate started", { ...ctx.tag, model, mode: isImage2Video ? "i2v" : "t2v" });

        if (isImage2Video) {
          const imageR2Key = params.startFrameR2Key ?? params.referenceImageR2Keys![0];
          const imageUrl = await r2ToPublicUrl(env.R2_BUCKET, imageR2Key, env.R2_PUBLIC_URL);
          const result = await generateImage2Video(config, {
            image: imageUrl,
            prompt: params.prompt,
            modelName: mapVideoModel(model),
            mode: mapMode(model),
            duration: params.duration ? String(params.duration) : "5",
            isBase64: !env.R2_PUBLIC_URL,
          });
          log.info("kling-video i2v completed", { ...ctx.tag });
          const key = await ctx.uploadFromUrl(result.url, "video/mp4");
          let coverKey: string | undefined;
          if (result.coverImageUrl) {
            try {
              coverKey = await ctx.uploadFromUrl(result.coverImageUrl, "image/jpeg", "-cover");
            } catch (e) {
              log.error("kling-video cover upload failed", { ...ctx.tag, error: String(e) });
            }
          }
          return { storageKey: key, providerCoverKey: coverKey, duration: result.duration };
        }

        const result = await generateText2Video(config, {
          prompt: params.prompt ?? "",
          modelName: mapVideoModel(model),
          mode: mapMode(model),
          duration: params.duration ? String(params.duration) : "5",
          aspectRatio: params.aspectRatio,
        });
        log.info("kling-video t2v completed", { ...ctx.tag });
        const key = await ctx.uploadFromUrl(result.url, "video/mp4");
        let coverKey: string | undefined;
        if (result.coverImageUrl) {
          try {
            coverKey = await ctx.uploadFromUrl(result.coverImageUrl, "image/jpeg", "-cover");
          } catch (e) {
            log.error("kling-video cover upload failed", { ...ctx.tag, error: String(e) });
          }
        }
        return { storageKey: key, providerCoverKey: coverKey, duration: result.duration };
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey, { skipVideoCover: !!providerCoverKey }),
    );

    const durationMs =
      probe.metadata.durationMs ??
      (typeof duration === "number" ? Math.round(duration * 1000) : undefined);

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "video",
          srcR2Key: storageKey,
          coverR2Key: providerCoverKey ?? probe.coverR2Key,
          metadata: { ...probe.metadata, durationMs },
          sourceModel: model,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};

function mapVideoModel(model?: string): string {
  switch (model) {
    case "kling-3-turbo": return "kling-3.0-turbo";
    case "kling-3": return "kling-v3";
    case "kling-3-omni": return "kling-v3-omni";
    case "kling-o1": return "kling-video-o1";
    case "kling-2.6": return "kling-v2-6";
    case "kling-2.5-turbo": return "kling-v2-5-turbo";
    case "kling-2.1": return "kling-v2-5-turbo";
    default: return "kling-v3";
  }
}

function mapMode(model?: string): string {
  return model === "kling-3" || model === "kling-3-omni" || model === "kling-o1" ? "pro" : "std";
}
