import { log } from "../../logger";
import { generateImage, type KlingConfig } from "../../services/kling";
import type { GenerationProvider } from "../provider";

function klingConfig(env: { KLING_ACCESS_KEY: string; KLING_SECRET_KEY: string; KLING_API_URL?: string }): KlingConfig {
  return {
    accessKey: env.KLING_ACCESS_KEY,
    secretKey: env.KLING_SECRET_KEY,
    apiUrl: env.KLING_API_URL,
  };
}

export const klingImageProvider: GenerationProvider = {
  name: "kling-image",

  async execute(ctx) {
    const { params, env } = ctx;
    const config = klingConfig(env);

    const storageKey = await ctx.step(
      "kling-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("kling-image generate started", { ...ctx.tag, model: params.modelName });
        const apiModel = mapImageModel(params.modelName);
        const result = await generateImage(config, {
          prompt: params.prompt ?? "",
          aspectRatio: params.aspectRatio,
          modelName: apiModel,
          n: 1,
        });
        log.info("kling-image generated", { ...ctx.tag, images: result.images.length });
        return ctx.uploadFromUrl(result.images[0].url, "image/png");
      },
    );

    const probe = await ctx.step(
      "probe-image",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "1 minute" },
      async () => ctx.probe("image", storageKey),
    );

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "image",
          srcR2Key: storageKey,
          metadata: probe.metadata,
          sourceModel: params.modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};

function mapImageModel(model?: string): string {
  switch (model) {
    case "kling-image-3": return "kling-image-v3";
    case "kling-image-3-omni": return "kling-image-v3-omni";
    case "kling-image-o1": return "kling-image-o1";
    case "kling-image-2.1": return "kling-image-v2-1";
    default: return "kling-image-v3";
  }
}
