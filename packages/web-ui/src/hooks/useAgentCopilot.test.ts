// @vitest-environment jsdom

import * as React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useAgentCopilot } from "./useAgentCopilot";

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => {}),
}));

vi.mock("agents/react", () => ({
  useAgent: ({ onOpen }: { onOpen?: () => void }) => {
    React.useEffect(() => {
      onOpen?.();
    }, [onOpen]);
    return {};
  },
}));

vi.mock("@cloudflare/ai-chat/react", () => ({
  useAgentChat: () => ({
    messages: [],
    status: "ready",
    sendMessage: sendMessageMock,
    stop: vi.fn(),
  }),
}));

describe("useAgentCopilot", () => {
  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  it("sends the queued first message immediately when the socket is already connected", async () => {
    const { result } = renderHook(() =>
      useAgentCopilot({ projectId: "project-1", threadId: "thread-1" }),
    );

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    act(() => {
      result.current.queueMessageOnOpen("hello world");
    });

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({ text: "hello world" });
    });
  });
});
