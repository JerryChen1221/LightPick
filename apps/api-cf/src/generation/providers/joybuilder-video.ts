import { log } from "../../logger";
import { generateJoyBuilderKlingVideo } from "../../services/joybuilder";
import type { GenerationProvider } from "../provider";

async function r2ToPublicUrl(bucket: R2Bucket, key: string, publicBase?: string): Promise<string> {
  if (publicBase) return `${publicBase.replace(/\/$/, "")}/${key}`;
  await bucket.head(key);
  throw new Error("R2_PUBLIC_URL is required for JoyBuilder Kling image-to-video; image inputs must be publicly reachable URLs.");
}

function mapJoyBuilderKlingModel(model?: string): string {
  switch (model) {
    case "joybuilder-kling-v3":
      return "kling-v3";
    case "joybuilder-kling-2.5-turbo":
    default:
      return "Kling-V2-5-Turbo";
  }
}

function joyBuilderKlingSound(model: string | undefined, sound: unknown): string | undefined {
  if (sound === true) return "on";
  if (sound === false) return "off";
  if (typeof sound === "string" && (sound === "on" || sound === "off")) return sound;
  return model === "joybuilder-kling-v3" ? "on" : undefined;
}

export const joyBuilderVideoProvider: GenerationProvider = {
  name: "joybuilder-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const model = params.videoModel ?? params.modelName;
    const hasStartFrame = !!params.startFrameR2Key;
    const hasRefImage = !!params.referenceImageR2Keys?.length;
    const isImage2Video = hasStartFrame || hasRefImage;

    const { storageKey, duration } = await ctx.step(
      "joybuilder-kling-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "20 minutes" },
      async () => {
        log.info("joybuilder-video generate started", {
          ...ctx.tag,
          model,
          mode: isImage2Video ? "i2v" : "t2v",
        });

        const imageR2Key = params.startFrameR2Key ?? params.referenceImageR2Keys?.[0];
        const imageUrl = imageR2Key
          ? await r2ToPublicUrl(env.R2_BUCKET, imageR2Key, env.R2_PUBLIC_URL)
          : undefined;
        const endImageUrl = params.endFrameR2Key
          ? await r2ToPublicUrl(env.R2_BUCKET, params.endFrameR2Key, env.R2_PUBLIC_URL)
          : undefined;

        const result = await generateJoyBuilderKlingVideo(env, {
          prompt: params.prompt,
          negativePrompt: typeof params.modelParams?.negative_prompt === "string" ? params.modelParams.negative_prompt : undefined,
          modelName: mapJoyBuilderKlingModel(model),
          duration: params.duration ? String(params.duration) : "5",
          aspectRatio: params.aspectRatio,
          resolution: typeof params.resolution === "string" ? params.resolution : undefined,
          sound: joyBuilderKlingSound(model, params.modelParams?.sound),
          imageUrl,
          endImageUrl,
        });

        log.info("joybuilder-video completed", { ...ctx.tag });
        return {
          storageKey: await ctx.uploadFromUrl(result.url, "video/mp4"),
          duration: result.duration,
        };
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
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
          coverR2Key: probe.coverR2Key,
          metadata: { ...probe.metadata, durationMs },
          sourceModel: model,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
