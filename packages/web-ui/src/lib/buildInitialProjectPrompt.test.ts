import { describe, expect, it } from "vitest";

import { buildInitialProjectPrompt } from "./buildInitialProjectPrompt";

describe("buildInitialProjectPrompt", () => {
  it("wraps the landing-page brief in explicit project bootstrap instructions", () => {
    const result = buildInitialProjectPrompt("《旧巷来信》青石板被岁月磨得发亮");

    expect(result).toContain("brand-new video project");
    expect(result).toContain("adapt it into a video script");
    expect(result).toContain("<user_brief>");
    expect(result).toContain("《旧巷来信》青石板被岁月磨得发亮");
    expect(result).toContain("</user_brief>");
  });

  it("preserves blank input without adding wrapper noise", () => {
    expect(buildInitialProjectPrompt("   ")).toBe("   ");
  });
});
