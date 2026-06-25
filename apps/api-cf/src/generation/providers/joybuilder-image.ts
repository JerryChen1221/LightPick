import { log } from "../../logger";
import { generateGptImage } from "../../services/joybuilder";
import type { GenerationProvider } from "../provider";

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sizeFromAspectRatio(aspectRatio?: string): string {
  if (aspectRatio === "2:3" || aspectRatio === "9:16" || aspectRatio === "3:4") return "1024x1536";
  if (aspectRatio === "3:2" || aspectRatio === "16:9" || aspectRatio === "4:3") return "1536x1024";
  return "1024x1024";
}

export const joyBuilderImageProvider: GenerationProvider = {
  name: "joybuilder-image",

  async execute(ctx) {
    const { params, env } = ctx;

    const storageKey = await ctx.step(
      "joybuilder-gpt-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        const modelParams = params.modelParams ?? {};
        const size = stringParam(modelParams.size, sizeFromAspectRatio(params.aspectRatio));
        const quality = stringParam(modelParams.quality, "medium");
        const outputFormat = stringParam(modelParams.output_format, "PNG");
        const outputCompression = numberParam(modelParams.output_compression, 100);

        if (params.referenceImageR2Keys?.length) {
          throw new Error("JoyBuilder GPT-Image text-to-image does not support reference images in the documented API.");
        }

        log.info("JoyBuilder GPT-Image generate started", {
          ...ctx.tag,
          model: params.modelName,
          size,
          quality,
          outputFormat,
        });
        const result = await generateGptImage(env, {
          prompt: params.prompt ?? "",
          size,
          quality,
          outputFormat,
          outputCompression,
          n: 1,
        });
        log.info("JoyBuilder GPT-Image generated", { ...ctx.tag });
        return ctx.uploadBytes(result.data, result.mediaType);
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
