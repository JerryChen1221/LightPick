import { afterEach, describe, expect, it, vi } from "vitest";

import { generateJoyBuilderTts, isJoyBuilderTtsModel, type JoyBuilderEnv } from "./joybuilder";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const env = {
  JOYBUILDER_API_KEY: "test-key",
  JOYBUILDER_BASE_URL: "https://joybuilder.test/v1",
} satisfies JoyBuilderEnv;

describe("JoyBuilder TTS generation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes JoyBuilder TTS model cards and provider model ids", () => {
    expect(isJoyBuilderTtsModel("joybuilder-doubao-tts")).toBe(true);
    expect(isJoyBuilderTtsModel("joybuilder-gemini-2.5-pro-tts")).toBe(true);
    expect(isJoyBuilderTtsModel("Doubao-TTS")).toBe(true);
    expect(isJoyBuilderTtsModel("gemini-2.5-pro-tts")).toBe(false);
  });

  it("calls the JoyBuilder base64 endpoint and decodes Doubao audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reqid: "test-req",
          code: 0,
          sequence: -1,
          data: base64(new Uint8Array([1, 2, 3, 4])),
          addition: { duration: "100" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateJoyBuilderTts(env, {
      prompt: "请帮我生成一段语音消息",
      modelName: "joybuilder-doubao-tts",
      modelParams: {
        voice_type: "zh_male_M392_conversation_wvae_bigtts",
        encoding: "mp3",
        speed_ratio: 1.1,
      },
    });

    expect(result.model).toBe("Doubao-TTS");
    expect(result.mediaType).toBe("audio/mpeg");
    expect([...result.data]).toEqual([1, 2, 3, 4]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://joybuilder.test/v1/tts/base64");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      Accept: "*/*",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "Doubao-TTS",
      text: "请帮我生成一段语音消息",
      stream: false,
      params: {
        user: { uid: "lightpick" },
        audio: {
          voice_type: "zh_male_M392_conversation_wvae_bigtts",
          encoding: "mp3",
          speed_ratio: 1.1,
        },
        request: {
          text: "请帮我生成一段语音消息",
          text_type: "plain",
          operation: "query",
        },
      },
    });
  });

  it("uses the JoyBuilder base64 endpoint for Gemini TTS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: base64(new Uint8Array([5, 6, 7])) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateJoyBuilderTts(env, {
      prompt: "测试 Gemini TTS",
      modelName: "joybuilder-gemini-2.5-pro-tts",
      modelParams: { encoding: "mp3" },
    });

    expect(result.model).toBe("Gemini-2.5-Pro-TTS");
    expect(result.mediaType).toBe("audio/wav");
    expect(new TextDecoder().decode(result.data.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(result.data.slice(8, 12))).toBe("WAVE");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://joybuilder.test/v1/tts/base64");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "Gemini-2.5-Pro-TTS",
      params: {
        voice_config: {
          prebuilt_voice_config: { voice_name: "Kore" },
        },
      },
    });
  });
});
