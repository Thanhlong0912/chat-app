import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageItem from "./MessageItem";
import { useAuthStore } from "@/stores/useAuthStore";
import type { Attachment, Conversation, Message } from "@/types/chat";

const conversation = {
  _id: "convo-1",
  type: "direct",
  group: null,
  participants: [
    { _id: "me", displayName: "Tôi", avatarUrl: null, role: null, joinedAt: null, lastReadAt: null },
    { _id: "ban", displayName: "Bạn", avatarUrl: null, role: null, joinedAt: null, lastReadAt: null },
  ],
  lastMessage: null,
  lastMessageAt: null,
  unreadCounts: {},
  unreadCount: 0,
  myRole: null,
  seenBy: [],
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as Conversation;

const makeMessage = (attachments: Attachment[]): Message =>
  ({
    _id: "msg-1",
    conversationId: "convo-1",
    senderId: "ban",
    sender: { _id: "ban", displayName: "Bạn", avatarUrl: null },
    kind: attachments[0]?.kind === "video" ? "video" : "image",
    content: null,
    attachments,
    replyTo: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
    clientMessageId: null,
  }) as unknown as Message;

const image: Attachment = {
  url: "https://res.cloudinary.com/demo/image/upload/v1/anh.png",
  kind: "image",
  originalName: "anh.png",
};

const video: Attachment = {
  url: "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4",
  kind: "video",
  originalName: "clip.mp4",
  mimeType: "video/mp4",
};

const renderMessage = (attachments: Attachment[]) => {
  const message = makeMessage(attachments);

  render(
    <MessageItem
      message={message}
      index={0}
      messages={[message]}
      selectedConvo={conversation}
    />,
  );

  return userEvent.setup();
};

beforeEach(() => {
  useAuthStore.setState({ user: { _id: "me" } } as never);

  // jsdom không cài đặt phát video; MediaPreviewModal dùng `autoPlay`.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

describe("tệp đính kèm trong tin nhắn", () => {
  it("vẽ ảnh bằng <img>", () => {
    renderMessage([image]);

    expect(screen.getByAltText("anh.png")).toBeInTheDocument();
  });

  it("vẽ video bằng <video>, KHÔNG phải <img>", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage([video])}
        index={0}
        messages={[makeMessage([video])]}
        selectedConvo={conversation}
      />,
    );

    // Trước đây mọi attachment đều được vẽ bằng <img>, nên một video ra khung trống.
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img[src*='clip.mp4']")).toBeNull();
  });

  it("ảnh bấm được để xem cỡ lớn", async () => {
    const user = await renderMessage([image]);

    await user.click(screen.getByRole("button", { name: "Xem ảnh cỡ lớn" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("video bấm được để mở khung xem", async () => {
    const user = await renderMessage([video]);

    await user.click(screen.getByRole("button", { name: "Xem video" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("khung xem đóng lại được", async () => {
    const user = await renderMessage([image]);

    await user.click(screen.getByRole("button", { name: "Xem ảnh cỡ lớn" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Đóng" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("không mở khung xem khi chưa bấm gì", () => {
    renderMessage([image]);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
