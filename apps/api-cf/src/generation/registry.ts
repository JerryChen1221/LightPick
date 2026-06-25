import { isGoogleAudioModel, isGoogleImageModel, isGoogleTextModel, isGoogleVideoModel } from "../services/google-gen";
import type { GenerationParams } from "./params";
import type { GenerationProvider } from "./provider";
import { veoProvider } from "./providers/veo";
import { falVideoProvider } from "./providers/fal-video";
import { joyBuilderVideoProvider } from "./providers/joybuilder-video";
import { googleImageProvider } from "./providers/google-image";
import { joyBuilderImageProvider } from "./providers/joybuilder-image";
import { falImageProvider } from "./providers/fal-image";
import { klingImageProvider } from "./providers/kling-image";
import { klingVideoProvider } from "./providers/kling-video";
import { geminiTtsProvider } from "./providers/gemini-tts";
import { videoRenderProvider } from "./providers/render";
import { customActionProvider } from "./providers/custom-action";
import { textGenProvider } from "./providers/text-gen";
import { googleTextProvider } from "./providers/google-text";
import { understandProvider } from "./providers/understand";
import { describeProvider } from "./providers/describe";

function isKlingVideoModel(model?: string): boolean {
  if (!model) return false;
  return model.startsWith("kling-") && !model.startsWith("kling-image");
}

function isJoyBuilderVideoModel(model?: string): boolean {
  if (!model) return false;
  return model.startsWith("joybuilder-kling-");
}

function isKlingImageModel(model?: string): boolean {
  if (!model) return false;
  return model.startsWith("kling-image");
}

function isJoyBuilderImageModel(model?: string): boolean {
  return model === "gpt-image-2";
}

export function resolveProvider(params: GenerationParams): GenerationProvider {
  switch (params.type) {
    case "video_gen": {
      const model = params.videoModel ?? params.modelName;
      if (isGoogleVideoModel(model)) return veoProvider;
      if (isJoyBuilderVideoModel(model)) return joyBuilderVideoProvider;
      if (isKlingVideoModel(model)) return klingVideoProvider;
      return falVideoProvider;
    }
    case "image_gen": {
      if (isJoyBuilderImageModel(params.modelName)) return joyBuilderImageProvider;
      if (isGoogleImageModel(params.modelName)) return googleImageProvider;
      if (isKlingImageModel(params.modelName)) return klingImageProvider;
      return falImageProvider;
    }
    case "audio_gen": {
      if (!isGoogleAudioModel(params.modelName ?? "gemini-3.1-flash-tts")) {
        throw new Error(`Unsupported audio model: ${params.modelName}`);
      }
      return geminiTtsProvider;
    }
    case "video_render":
      return videoRenderProvider;
    case "custom_action":
      return customActionProvider;
    case "text_gen":
      return isGoogleTextModel(params.modelName) ? googleTextProvider : textGenProvider;
    case "understand":
      return understandProvider;
    case "image_desc":
    case "video_desc":
      return describeProvider;
    default:
      throw new Error(`Unknown generation type: ${(params as { type: string }).type}`);
  }
}
