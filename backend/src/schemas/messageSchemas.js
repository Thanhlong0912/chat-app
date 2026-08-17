import { z } from "zod";
import { messageContent, objectId } from "./common.js";

export const sendDirectMessageSchema = {
  body: z.object({
    recipientId: objectId,
    content: messageContent,
    conversationId: objectId.optional(),
    imgUrl: z.string().url().optional(),
  }),
};

export const sendGroupMessageSchema = {
  body: z.object({
    conversationId: objectId,
    content: messageContent,
    imgUrl: z.string().url().optional(),
  }),
};
