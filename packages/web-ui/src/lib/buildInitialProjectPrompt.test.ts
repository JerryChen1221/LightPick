import { describe, expect, it } from "vitest";

import { buildInitialProjectPrompt } from "./buildInitialProjectPrompt";

describe("buildInitialProjectPrompt", () => {
  it("wraps the landing-page brief in explicit project bootstrap instructions", () => {
    const result = buildInitialProjectPrompt("《旧巷来信》青石板被岁月磨得发亮");

    expect(result).toContain("brand-new video project");
    expect(result).toContain("adapt it into a video script");
    expect(result).toContain("concept-image plan node");
    expect(result).toContain("2-3 images");
    expect(result).toContain("3-5 images");
    expect(result).toContain("Do not generate more than 6 concept images");
    expect(result).toContain("create and run an image generation node");
    expect(result).toContain("Do not generate video unless the user explicitly asks");
    expect(result).toContain("<user_brief>");
    expect(result).toContain("《旧巷来信》青石板被岁月磨得发亮");
    expect(result).toContain("</user_brief>");
  });

  it("preserves blank input without adding wrapper noise", () => {
    expect(buildInitialProjectPrompt("   ")).toBe("   ");
  });
});
