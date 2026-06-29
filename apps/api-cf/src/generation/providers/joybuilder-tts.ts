import { log } from "../../logger";
import { generateJoyBuilderTts } from "../../services/joybuilder";
import type { GenerationProvider } from "../provider";

export const joyBuilderTtsProvider: GenerationProvider = {
  name: "joybuilder-tts",

  async execute(ctx) {
    const { params, env } = ctx;
    const modelName = params.modelName ?? "joybuilder-doubao-tts";

    const storageKey = await ctx.step(
      "joybuilder-tts-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("JoyBuilder TTS started", { ...ctx.tag, model: modelName });
        const result = await generateJoyBuilderTts(env, {
          prompt: params.prompt ?? "",
          modelName,
          modelParams: params.modelParams,
        });
        log.info("JoyBuilder TTS generated", { ...ctx.tag, model: result.model, bytes: result.data.byteLength });
        return ctx.uploadBytes(result.data, result.mediaType);
      },
    );

    const probe = await ctx.step(
      "probe-audio",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("audio", storageKey),
    );

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "audio",
          srcR2Key: storageKey,
          metadata: probe.metadata,
          sourceModel: modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
