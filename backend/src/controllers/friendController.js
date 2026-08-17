import Friend from "../models/Friend.js";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

export const sendFriendRequest = async (req, res) => {
  const { to, message } = req.body;

  const from = req.user._id;

  // So sánh dạng string: `from` là ObjectId còn `to` đến từ JSON là string, nên
  // phép so sánh trực tiếp trước đây luôn false và user tự kết bạn được với mình.
  if (String(from) === String(to)) {
    throw badRequest("SELF_FRIEND_REQUEST", "Không thể gửi lời mời kết bạn cho chính mình");
  }

  const userExists = await User.exists({ _id: to });

  if (!userExists) {
    throw notFound("USER_NOT_FOUND", "Người dùng không tồn tại");
  }

  let userA = from.toString();
  let userB = to.toString();

  if (userA > userB) {
    [userA, userB] = [userB, userA];
  }

  const [alreadyFriends, existingRequest] = await Promise.all([
    Friend.findOne({ userA, userB }),
    FriendRequest.findOne({
      $or: [
        { from, to },
        { from: to, to: from },
      ],
    }),
  ]);

  if (alreadyFriends) {
    throw badRequest("ALREADY_FRIENDS", "Hai người đã là bạn bè");
  }

  if (existingRequest) {
    throw badRequest("REQUEST_PENDING", "Đã có lời mời kết bạn đang chờ");
  }

  const request = await FriendRequest.create({ from, to, message });

  return res.status(201).json({ message: "Gửi lời mời kết bạn thành công", request });
};

export const acceptFriendRequest = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user._id;

  const request = await FriendRequest.findById(requestId);

  if (!request) {
    throw notFound("REQUEST_NOT_FOUND", "Không tìm thấy lời mời kết bạn");
  }

  if (request.to.toString() !== userId.toString()) {
    throw forbidden("NOT_REQUEST_RECIPIENT", "Bạn không có quyền chấp nhận lời mời này");
  }

  await Friend.create({ userA: request.from, userB: request.to });
  await FriendRequest.findByIdAndDelete(requestId);

  const from = await User.findById(request.from).select("_id displayName avatarUrl").lean();

  return res.status(200).json({
    message: "Chấp nhận lời mời kết bạn thành công",
    newFriend: {
      _id: from?._id,
      displayName: from?.displayName,
      avatarUrl: from?.avatarUrl,
    },
  });
};

export const declineFriendRequest = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user._id;

  const request = await FriendRequest.findById(requestId);

  if (!request) {
    throw notFound("REQUEST_NOT_FOUND", "Không tìm thấy lời mời kết bạn");
  }

  if (request.to.toString() !== userId.toString()) {
    throw forbidden("NOT_REQUEST_RECIPIENT", "Bạn không có quyền từ chối lời mời này");
  }

  await FriendRequest.findByIdAndDelete(requestId);

  return res.sendStatus(204);
};

export const getAllFriends = async (req, res) => {
  const userId = req.user._id;

  const friendships = await Friend.find({
    $or: [{ userA: userId }, { userB: userId }],
  })
    .populate("userA", "_id displayName avatarUrl username")
    .populate("userB", "_id displayName avatarUrl username")
    .lean();

  const friends = friendships
    // Bỏ qua quan hệ mà user ở đầu kia đã bị xoá — populate trả về null.
    .filter((f) => f.userA && f.userB)
    .map((f) => (f.userA._id.toString() === userId.toString() ? f.userB : f.userA));

  return res.status(200).json({ friends });
};

export const getFriendRequests = async (req, res) => {
  const userId = req.user._id;

  const populateFields = "_id username displayName avatarUrl";

  const [sent, received] = await Promise.all([
    FriendRequest.find({ from: userId }).populate("to", populateFields),
    FriendRequest.find({ to: userId }).populate("from", populateFields),
  ]);

  return res.status(200).json({ sent, received });
};
