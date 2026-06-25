import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { Env } from "./config";
import { joyBuilderOpenAIConfig } from "./services/joybuilder";

export type ProviderType = "openai" | "anthropic" | "google";

/**
 * Create the AI model from environment config.
 *
 * Supports:
 * - `openai` (default): uses JoyBuilder's OpenAI-compatible gateway
 * - `anthropic`: uses @ai-sdk/anthropic with explicit cache_control breakpoints (90% savings)
 * - `google`: uses AI Studio / Gemini via @ai-sdk/google
 *
 * Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY in env to use Anthropic.
 */
export function createModel(env: Env): { model: LanguageModel; provider: ProviderType } {
  const providerType = (env.AI_PROVIDER as ProviderType) || "openai";

  if (providerType === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: env.ANTHROPIC_API_KEY!,
      ...(env.CF_AIG_ANTHROPIC_URL ? { baseURL: env.CF_AIG_ANTHROPIC_URL } : {}),
    });
    return {
      model: anthropic(env.AI_MODEL || "claude-sonnet-4-20250514"),
      provider: "anthropic",
    };
  }

  if (providerType === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: env.GOOGLE_API_KEY,
      ...(env.GOOGLE_AI_STUDIO_BASE_URL
        ? { baseURL: env.GOOGLE_AI_STUDIO_BASE_URL }
        : {}),
    });
    return {
      model: google(env.AI_MODEL || "gemini-2.5-flash"),
      provider: "google",
    };
  }

  // Default: OpenAI-compatible chat via JoyBuilder.
  const openai = createOpenAI(joyBuilderOpenAIConfig(env));
  return {
    model: openai.chat(env.AI_MODEL || "gpt-5.5"),
    provider: "openai",
  };
}
