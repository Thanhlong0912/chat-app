import Conversation from "../models/Conversation.js";
import logger from "../utils/logger.js";

/**
 * Danh sách id conversation mà user tham gia, dạng string.
 *
 * Nằm ở service (không phải controller) để tầng socket dùng được mà không phải
 * import controller — controller lại cần `io`, và vòng import đó là thứ
 * `socket/io.js` được tạo ra để phá.
 */
export async function getUserConversationIds(userId) {
  try {
    const conversations = await Conversation.find({ "participants.userId": userId }, { _id: 1 }).lean();

    return conversations.map((c) => c._id.toString());
  } catch (error) {
    // Không để việc join room thất bại làm sập cả kết nối socket.
    logger.error("Lỗi khi fetch conversations của user", error);
    return [];
  }
}
