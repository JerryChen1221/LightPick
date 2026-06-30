import { describe, expect, it } from "vitest";
import { PIPELINE_MENU_OPTIONS } from "./pipelineMenuOptions";

describe("PIPELINE_MENU_OPTIONS", () => {
    it("exposes built-in image, video, audio, and text generation chains", () => {
        expect(PIPELINE_MENU_OPTIONS.map((option) => option.id)).toEqual(
            expect.arrayContaining(["image-gen", "video-gen", "audio-gen", "text-gen"]),
        );
    });

    it("builds audio generation action-badge payloads", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "audio-gen");

        expect(option?.nodeType).toBe("action-badge");
        expect(option?.getNodeData()).toMatchObject({
            label: "Audio Prompt",
            actionType: "audio-gen",
            modelId: "gemini-3.1-flash-tts",
            model: "gemini-3.1-flash-tts",
            content: "# Prompt\nEnter your prompt here...",
        });
    });

    it("builds text generation action-badge payloads", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "text-gen");

        expect(option?.nodeType).toBe("action-badge");
        expect(option?.getNodeData()).toMatchObject({
            label: "Text Prompt",
            actionType: "text-gen",
            modelId: "gpt-5.5",
            model: "gpt-5.5",
            content: "# Prompt\nEnter your prompt here...",
        });
    });

    it("keeps text generation on the prompt-first JoyBuilder default for video sources", () => {
        const option = PIPELINE_MENU_OPTIONS.find((item) => item.id === "text-gen");

        expect(option?.getNodeData("video" as any)).toMatchObject({
            modelId: "gpt-5.5",
            model: "gpt-5.5",
        });
    });

    it("keeps downstream options compatible for text source nodes", () => {
        for (const option of PIPELINE_MENU_OPTIONS) {
            expect(() => option.isCompatibleWithSource("text" as any)).not.toThrow();
        }
        expect(PIPELINE_MENU_OPTIONS.map((option) => option.id)).toEqual(
            expect.arrayContaining(["image-gen", "video-gen", "audio-gen", "text-gen", "video-editor"]),
        );
    });

    it("exposes Kling Omni video edit and camera-reference actions for video sources", () => {
        const videoOptions = PIPELINE_MENU_OPTIONS.filter((option) => option.isCompatibleWithSource("video" as any));
        expect(videoOptions.map((option) => option.id)).toEqual(
            expect.arrayContaining(["video-edit", "camera-ref"]),
        );

        expect(PIPELINE_MENU_OPTIONS.find((option) => option.id === "video-edit")?.getNodeData("video" as any)).toMatchObject({
            label: "Edit Video",
            actionType: "video-gen",
            modelId: "joybuilder-kling-v3-omni",
            model: "joybuilder-kling-v3-omni",
            modelParams: {
                video_role: "input_video",
                keep_original_sound: true,
                sound: false,
            },
        });

        expect(PIPELINE_MENU_OPTIONS.find((option) => option.id === "camera-ref")?.getNodeData("video" as any)).toMatchObject({
            label: "Camera Reference",
            actionType: "video-gen",
            modelId: "joybuilder-kling-v3-omni",
            model: "joybuilder-kling-v3-omni",
            modelParams: {
                video_role: "reference_video",
                keep_original_sound: true,
                sound: false,
            },
        });
    });
});
