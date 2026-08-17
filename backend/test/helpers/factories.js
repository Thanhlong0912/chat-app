import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../../src/models/User.js";
import Friend from "../../src/models/Friend.js";
import Conversation from "../../src/models/Conversation.js";
import Message from "../../src/models/Message.js";

let counter = 0;
const unique = (prefix) => `${prefix}${++counter}-${Date.now().toString(36)}`;

export const makeUser = async (overrides = {}) => {
  const name = overrides.username ?? unique("user");

  return User.create({
    username: name,
    email: overrides.email ?? `${name}@example.com`,
    displayName: overrides.displayName ?? `Người dùng ${name}`,
    // Cost 4 thay vì 10: test không cần chống brute force, và cost 10 làm suite
    // chậm rõ rệt khi tạo nhiều user.
    hashedPassword: await bcrypt.hash(overrides.password ?? "password123", 4),
    ...overrides,
  });
};

/** Kết bạn hai user. Model tự chuẩn hoá thứ tự cặp trong hook pre-save. */
export const makeFriendship = async (a, b) =>
  Friend.create({ userA: String(a._id), userB: String(b._id) });

export const makeDirectConversation = async (a, b, overrides = {}) =>
  Conversation.create({
    type: "direct",
    participants: [{ userId: a._id }, { userId: b._id }],
    lastMessageAt: new Date(),
    ...overrides,
  });

export const makeGroupConversation = async (creator, members = [], overrides = {}) =>
  Conversation.create({
    type: "group",
    participants: [{ userId: creator._id }, ...members.map((m) => ({ userId: m._id }))],
    group: { name: overrides.name ?? unique("Nhóm "), createdBy: creator._id },
    lastMessageAt: new Date(),
    ...overrides,
  });

export const makeMessage = async (conversation, sender, overrides = {}) =>
  Message.create({
    conversationId: conversation._id,
    senderId: sender._id,
    content: overrides.content ?? unique("tin nhắn "),
    ...overrides,
  });

/**
 * Nhiều tin nhắn có `createdAt` do ta chỉ định.
 *
 * Dùng để dựng trường hợp nhiều tin nhắn trùng millisecond — thứ mà cursor chỉ
 * dựa trên timestamp không phân biệt được.
 */
export const makeMessagesAt = async (conversation, sender, timestamps) =>
  Message.insertMany(
    timestamps.map((createdAt, index) => ({
      _id: new mongoose.Types.ObjectId(),
      conversationId: conversation._id,
      senderId: sender._id,
      content: `tin nhắn ${index}`,
      createdAt,
      updatedAt: createdAt,
    })),
    // Bỏ qua timestamps tự động để `createdAt` chỉ định được tôn trọng.
    { timestamps: false },
  );
