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
    "",
    "<user_brief>",
    brief,
    "</user_brief>",
  ].join("\n");
}
