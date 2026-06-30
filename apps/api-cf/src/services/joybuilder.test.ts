import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateJoyBuilderKlingVideo,
  generateJoyBuilderTts,
  isJoyBuilderTtsModel,
  type JoyBuilderEnv,
} from "./joybuilder";

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

describe("JoyBuilder Kling video generation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds Kling-V3 Omni content with images, video refs, and string subject ids", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { task_id: "task-omni", status: "pending" },
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_status: "success",
            content: [{ id: "0", video_url: { url: "https://example.test/out.mp4" } }],
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateJoyBuilderKlingVideo(
      { JOYBUILDER_API_KEY: "test-key", JOYBUILDER_MODEL_SERVICE_URL: "https://modelservice.test" },
      {
        modelName: "Kling-V3-omni",
        prompt: "<<<image_1>>>遇到<<<element_1>>>，参考<<<video_1>>>的运镜。",
        duration: "7",
        aspectRatio: "1:1",
        resolution: "1080P",
        sound: "on",
        keepOriginalSound: true,
        videoRole: "reference_video",
        imageUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"],
        videoUrls: ["https://example.test/ref.mp4"],
        subjectIds: "864895146134495263, 814623846757576722",
      },
    );

    expect(result).toMatchObject({ taskId: "task-omni", url: "https://example.test/out.mp4", duration: 7 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://modelservice.test/v1/task/submit");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "Kling-V3-omni",
      content: [
        {
          type: "text",
          text: "<<<image_1>>>遇到<<<element_1>>>，参考<<<video_1>>>的运镜。",
          role: "omni_video",
        },
        { type: "image_url", image_url: { url: "https://example.test/a.jpg" } },
        { type: "image_url", image_url: { url: "https://example.test/b.jpg" } },
        { type: "video_url", role: "reference_video", video_url: { url: "https://example.test/ref.mp4" } },
        { type: "subject", subject: "864895146134495263" },
        { type: "subject", subject: "814623846757576722" },
      ],
      parameters: {
        mode: "pro",
        duration: 7,
        keep_original_sound: "yes",
        aspect_ratio: "1:1",
      },
    });
  });

  it("wraps natural-language Omni prompts with connected asset placeholders", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { task_id: "task-natural", status: "pending" },
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_status: "success",
            content: [{ id: "0", video_url: { url: "https://example.test/natural.mp4" } }],
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await generateJoyBuilderKlingVideo(
      { JOYBUILDER_API_KEY: "test-key", JOYBUILDER_MODEL_SERVICE_URL: "https://modelservice.test" },
      {
        modelName: "Kling-V3-omni",
        prompt: "给人物戴上这顶王冠",
        duration: "7",
        aspectRatio: "1:1",
        keepOriginalSound: true,
        videoUrls: ["https://example.test/source.mp4"],
        imageUrls: ["https://example.test/crown.jpg"],
      },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).content[0]).toMatchObject({
      type: "text",
      role: "omni_video",
      text: "对<<<video_1>>>进行如下编辑：给人物戴上这顶王冠。参考图片 <<<image_1>>>。",
    });
  });

  it("wraps camera-reference Omni prompts without exposing placeholder syntax to users", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { task_id: "task-camera", status: "pending" },
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_status: "success",
            content: [{ id: "0", video_url: { url: "https://example.test/camera.mp4" } }],
            error: { code: 0, type: "", message: "" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await generateJoyBuilderKlingVideo(
      { JOYBUILDER_API_KEY: "test-key", JOYBUILDER_MODEL_SERVICE_URL: "https://modelservice.test" },
      {
        modelName: "Kling-V3-omni",
        prompt: "一个人在东京街头慢慢走过，电影感，暖色调",
        duration: "7",
        aspectRatio: "1:1",
        videoRole: "reference_video",
        videoUrls: ["https://example.test/reference.mp4"],
        subjectIds: "864895146134495263",
      },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).content[0]).toMatchObject({
      type: "text",
      role: "omni_video",
      text: "参考<<<video_1>>>的运镜、节奏和视觉风格，生成一段新视频：一个人在东京街头慢慢走过，电影感，暖色调。参考主体 <<<element_1>>>。",
    });
  });
});
