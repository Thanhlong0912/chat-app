import { loadMembership } from "../services/membershipService.js";
import {
  createMessage,
  findOrCreateDirectConversation,
} from "../services/messageService.js";
import { isMember } from "../domain/groupPermissions.js";
import { badRequest } from "../utils/errors.js";

/**
 * Gửi tin nhắn 1-1 qua HTTP.
 *
 * Đây là adapter mỏng trên `messageService.createMessage` — cùng một service mà
 * socket handler dùng, nên chỉ có một chỗ ghi tin nhắn. HTTP được giữ lại làm
 * đường dự phòng khi socket không kết nối được.
 */
export const sendDirectMessage = async (req, res) => {
  const { recipientId, content, conversationId, clientMessageId, replyToMessageId, imgUrl } =
    req.body;
  const sender = req.user;

  let conversation;

  if (conversationId) {
    // `conversationId` đến từ client nên phải kiểm tra quyền. Trước đây nó được
    // tin tưởng hoàn toàn — `checkFriendship` chỉ xác minh `recipientId` là bạn
    // bè — nên chỉ cần gửi kèm id của một conversation bất kỳ là chèn được tin
    // nhắn vào đó, kể cả group mà mình không tham gia.
    const { conversation: found } = await loadMembership(sender._id, conversationId);

    if (found.type !== "direct") {
      throw badRequest("WRONG_CONVERSATION_TYPE", "Đây không phải cuộc trò chuyện 1-1");
    }

    // Người nhận phải đúng là phía còn lại của conversation này. Nếu không khớp
    // thì từ chối thay vì âm thầm rơi xuống nhánh tìm/tạo bên dưới — sai lệch ở
    // đây là bug của client, và che nó đi sẽ khiến tin nhắn đến sai người.
    if (!isMember(found, recipientId)) {
      throw badRequest("RECIPIENT_MISMATCH", "recipientId không thuộc cuộc trò chuyện này");
    }

    conversation = found;
  } else {
    conversation = await findOrCreateDirectConversation(sender._id, recipientId);
  }

  const { serialized } = await createMessage({
    conversation,
    sender,
    content,
    clientMessageId,
    replyToMessageId,
    attachments: imgUrl ? [{ url: imgUrl, kind: "image" }] : undefined,
  });

  return res.status(201).json({ message: serialized });
};

export const sendGroupMessage = async (req, res) => {
  const { content, clientMessageId, replyToMessageId, imgUrl } = req.body;

  // Do requireMembership gắn vào, đã xác nhận người gửi là thành viên của group.
  const conversation = req.conversation;

  const { serialized } = await createMessage({
    conversation,
    sender: req.user,
    content,
    clientMessageId,
    replyToMessageId,
    attachments: imgUrl ? [{ url: imgUrl, kind: "image" }] : undefined,
  });

  return res.status(201).json({ message: serialized });
};
