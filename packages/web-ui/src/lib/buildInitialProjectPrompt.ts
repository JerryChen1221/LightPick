export function buildInitialProjectPrompt(userPrompt: string): string {
  const brief = userPrompt.trim();
  if (!brief) return userPrompt;

  return [
    "You are starting a brand-new video project from a single user brief.",
    "Treat the content inside <user_brief> as the project requirement, not as a casual chat message.",
    "Please make a strong first pass without asking clarifying questions.",
    "1. Infer the intended video deliverable.",
    "2. Turn the brief into a production-ready script or scene plan in the same language as the brief.",
    "3. Use the available canvas tools to create the key planning or script nodes needed to continue production.",
    "4. If the brief is a story or prose passage, adapt it into a video script instead of only summarizing it.",
    "5. Create a concept-image plan node that explains the minimum useful set of visual references for this project.",
    "6. Decide how many concept images to generate based on the script complexity:",
    "   - 2-3 images for a simple single-scene idea.",
    "   - 3-5 images for a medium multi-scene story.",
    "   - Up to 6 images for a complex story with multiple locations, characters, or key turning points.",
    "7. Prefer fewer, more useful concept images. Do not generate more than 6 concept images during this initial bootstrap.",
    "8. For each concept image, create and run an image generation node. Each image must have a concrete production purpose, such as key visual, main character, major location, mood reference, or turning-point shot.",
    "9. Do not generate video unless the user explicitly asks for video generation.",
    "",
    "<user_brief>",
    brief,
    "</user_brief>",
  ].join("\n");
}
