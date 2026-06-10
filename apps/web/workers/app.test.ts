import { describe, expect, it } from "vitest";

import worker from "./app";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("assets"),
    },
    API_CF: {
      fetch: async () => new Response("ok"),
    },
    DB: {
      prepare: () => {
        throw new Error("DB should not be touched when SKIP_LOGIN is enabled");
      },
    },
    SKIP_LOGIN: "true",
    ...overrides,
  } as any;
}

describe("web worker dev auth bypass", () => {
  it("returns a synthetic session for get-session when SKIP_LOGIN is enabled", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/better-auth/get-session"),
      makeEnv(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      user: { id: "dev-user", email: "dev@local" },
    });
  });

  it("injects dev-user into /api/v1 requests when SKIP_LOGIN is enabled", async () => {
    let seenUserId: string | null = null;
    const env = makeEnv({
      API_CF: {
        fetch: async (request: Request) => {
          seenUserId = request.headers.get("x-user-id");
          return new Response("proxied");
        },
      },
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/v1/sessions", { method: "POST" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(seenUserId).toBe("dev-user");
  });
});
