/**
 * Sinh `src/swagger.json`.
 *
 * Vì sao là một script chứ không sửa tay: bản trước được ghi lại từ một client
 * REST nên path chứa ObjectId thật (`/friends/requests/68faed19.../accept`) thay
 * vì tham số, và không có schema nào. Sửa tay một file JSON 300+ dòng là cách
 * chắc chắn để nó lại lệch tiếp. Chạy lại:
 *
 *   node scripts/build-swagger.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Đọc thẳng từ model, nên tài liệu không thể liệt kê một bộ emoji khác với bộ
// mà server thực sự chấp nhận.
import { REACTION_EMOJIS } from "../src/models/Message.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "swagger.json");

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const errRef = (name) => ({ $ref: `#/components/responses/${name}` });

/** Tham số path dùng lại nhiều lần. */
const pathParam = (name, description) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", example: "6a83cfd55df7471cac7f192a" },
  description,
});

const conversationId = pathParam("conversationId", "Id cuộc trò chuyện");
const userIdParam = pathParam("userId", "Id người dùng trong nhóm");
const messageIdParam = pathParam("messageId", "Id tin nhắn");

const json = (schema) => ({ content: { "application/json": { schema } } });

const body = (schema, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

/** Bộ lỗi mà mọi endpoint đã xác thực đều có thể trả về. */
const authed = { 401: errRef("Unauthorized") };
const member = { ...authed, 403: errRef("Forbidden"), 404: errRef("NotFound") };
const validated = { 400: errRef("ValidationError") };

const spec = {
  openapi: "3.0.3",

  info: {
    title: "Moji API",
    version: "2.0.0",
    description: [
      "REST API của Moji. Realtime đi qua Socket.IO và **không** được mô tả ở đây —",
      "hợp đồng event nằm ở `src/socket/events.js`, có contract test đối chiếu với",
      "`frontend/src/types/socket.ts`.",
      "",
      "**Xác thực.** Access token là JWT đặt ở header `Authorization: Bearer <token>`,",
      "sống 15 phút. Refresh token là chuỗi ngẫu nhiên đặt trong cookie `refreshToken`",
      "(httpOnly), được xoay vòng ở mỗi lần dùng; dùng lại một token đã xoay sẽ thu hồi",
      "toàn bộ phiên của người đó.",
      "",
      "**Lỗi.** Mọi lỗi đều có cùng hình dạng `{ code, message, requestId }`. `code` là",
      "chuỗi ổn định để client rẽ nhánh; `message` là tiếng Việt để hiển thị và có thể",
      "đổi bất cứ lúc nào.",
    ].join("\n"),
  },

  servers: [
    { url: "http://localhost:5001/api", description: "Máy phát triển" },
    { url: "https://{host}/api", description: "Triển khai", variables: { host: { default: "moji.example.com" } } },
  ],

  tags: [
    { name: "Auth", description: "Đăng ký, đăng nhập, xoay refresh token, quản lý phiên" },
    { name: "Users", description: "Hồ sơ và tuỳ chọn cá nhân" },
    { name: "Friends", description: "Lời mời kết bạn và danh sách bạn bè" },
    { name: "Conversations", description: "Danh sách hội thoại, tin nhắn, con trỏ đã đọc" },
    { name: "Messages", description: "Gửi, sửa, xoá tin nhắn" },
    { name: "Groups", description: "Quản lý nhóm: thông tin, thành viên, vai trò" },
  ],

  security: [{ bearerAuth: [] }],

  paths: {
    // --- Auth ---------------------------------------------------------------
    "/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Đăng ký tài khoản",
        security: [],
        requestBody: body({
          type: "object",
          required: ["username", "password", "email", "firstName", "lastName"],
          properties: {
            username: { type: "string", example: "long" },
            password: {
              type: "string",
              minLength: 8,
              description: "Tối thiểu 8 ký tự, tối đa 72 **byte** — bcrypt cắt âm thầm ở đó.",
            },
            email: { type: "string", format: "email" },
            firstName: { type: "string" },
            lastName: { type: "string" },
          },
        }),
        responses: {
          204: { description: "Tạo thành công, không có nội dung trả về" },
          ...validated,
          409: {
            description: "Username hoặc email đã tồn tại",
            ...json(ref("Error")),
          },
          429: errRef("RateLimited"),
        },
      },
    },

    "/auth/signin": {
      post: {
        tags: ["Auth"],
        summary: "Đăng nhập",
        description: "Đặt cookie `refreshToken` (httpOnly) và trả access token trong body.",
        security: [],
        requestBody: body({
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string", format: "password" },
          },
        }),
        responses: {
          200: {
            description: "Đăng nhập thành công",
            headers: {
              "Set-Cookie": {
                description: "`refreshToken=<opaque>; HttpOnly; Path=/`",
                schema: { type: "string" },
              },
            },
            ...json({
              type: "object",
              properties: {
                message: { type: "string" },
                accessToken: { type: "string" },
              },
            }),
          },
          401: {
            description: "Sai tên đăng nhập hoặc mật khẩu",
            ...json(ref("Error")),
          },
          ...validated,
          429: errRef("RateLimited"),
        },
      },
    },

    "/auth/signout": {
      post: {
        tags: ["Auth"],
        summary: "Đăng xuất phiên hiện tại",
        security: [],
        description: "Thu hồi phiên gắn với cookie và xoá cookie đó.",
        responses: { 204: { description: "Đã đăng xuất" } },
      },
    },

    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Đổi refresh token lấy access token mới",
        security: [],
        description: [
          "Xoay vòng: refresh token cũ bị đánh dấu đã dùng và một token mới được đặt",
          "vào cookie. Gọi lại bằng token đã xoay (ngoài khoảng ân hạn ngắn dành cho",
          "race của client) được coi là token bị đánh cắp và thu hồi cả họ phiên.",
        ].join(" "),
        responses: {
          200: { description: "Access token mới", ...json({ type: "object", properties: { accessToken: { type: "string" } } }) },
          401: { description: "Thiếu hoặc sai refresh token", ...json(ref("Error")) },
          403: {
            description: "`REFRESH_TOKEN_REUSED` — đã thu hồi toàn bộ phiên, phải đăng nhập lại",
            ...json(ref("Error")),
          },
          429: errRef("RateLimited"),
        },
      },
    },

    "/auth/sessions": {
      get: {
        tags: ["Auth"],
        summary: "Danh sách phiên đang hoạt động",
        responses: {
          200: {
            description: "Các phiên chưa bị xoay vòng, mới dùng gần nhất trước",
            ...json({
              type: "object",
              properties: { sessions: { type: "array", items: ref("Session") } },
            }),
          },
          ...authed,
        },
      },
    },

    "/auth/signout-all": {
      post: {
        tags: ["Auth"],
        summary: "Đăng xuất khỏi mọi thiết bị",
        responses: {
          200: {
            description: "Số phiên đã thu hồi",
            ...json({ type: "object", properties: { revoked: { type: "integer" } } }),
          },
          ...authed,
        },
      },
    },

    // --- Users --------------------------------------------------------------
    "/users/me": {
      get: {
        tags: ["Users"],
        summary: "Hồ sơ của chính mình",
        responses: {
          200: { description: "Hồ sơ", ...json({ type: "object", properties: { user: ref("User") } }) },
          ...authed,
        },
      },
      patch: {
        tags: ["Users"],
        summary: "Cập nhật hồ sơ và tuỳ chọn",
        description: [
          "Chỉ những field liệt kê dưới đây được ghi — controller có allow-list tường",
          "minh và không bao giờ spread `req.body`, nên không thể sửa `role`, `hashedPassword`",
          "hay bất cứ field nào khác. Mỗi tuỳ chọn được ghi riêng lẻ (`preferences.<key>`),",
          "nên cập nhật một tuỳ chọn không xoá các tuỳ chọn còn lại.",
        ].join(" "),
        requestBody: body({
          type: "object",
          description: "Mọi field đều tuỳ chọn; gửi phần nào thì cập nhật phần đó.",
          properties: {
            displayName: { type: "string", maxLength: 50 },
            bio: { type: "string", maxLength: 500, nullable: true },
            phone: { type: "string", nullable: true, pattern: "^[0-9+\\-\\s()]{6,20}$" },
            preferences: ref("UserPreferences"),
          },
        }),
        responses: {
          200: { description: "Hồ sơ sau khi cập nhật", ...json({ type: "object", properties: { user: ref("User") } }) },
          ...validated,
          ...authed,
        },
      },
    },

    "/users/search": {
      get: {
        tags: ["Users"],
        summary: "Tìm người dùng theo username hoặc tên hiển thị",
        description: [
          "Khớp MỘT PHẦN, không phân biệt hoa thường, tối đa 10 kết quả, loại chính",
          "người đang gọi. Bản trước khớp username tuyệt đối nên phải gõ đúng từng ký",
          "tự mới ra kết quả.",
          "`user` là trường tương thích ngược: kết quả khớp tuyệt đối, hoặc null.",
        ].join(" "),
        parameters: [
          {
            name: "username",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Từ khoá, một ký tự là đủ",
          },
        ],
        responses: {
          200: {
            description: "Danh sách người dùng khớp",
            ...json({
              type: "object",
              properties: {
                users: { type: "array", items: ref("User") },
                user: {
                  ...ref("User"),
                  nullable: true,
                  description: "@deprecated — khớp tuyệt đối, dùng `users`",
                },
              },
            }),
          },
          ...validated,
          ...authed,
        },
      },
    },

    "/users/uploadAvatar": {
      post: {
        tags: ["Users"],
        summary: "Đổi ảnh đại diện",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "URL ảnh mới",
            ...json({ type: "object", properties: { avatarUrl: { type: "string" } } }),
          },
          400: { description: "Sai định dạng tệp", ...json(ref("Error")) },
          413: { description: "Tệp quá lớn (giới hạn 1 MB cho avatar)", ...json(ref("Error")) },
          ...authed,
        },
      },
    },

    // --- Friends ------------------------------------------------------------
    "/friends": {
      get: {
        tags: ["Friends"],
        summary: "Danh sách bạn bè",
        responses: {
          200: {
            description: "Bạn bè",
            ...json({ type: "object", properties: { friends: { type: "array", items: ref("User") } } }),
          },
          ...authed,
        },
      },
    },

    "/friends/requests": {
      get: {
        tags: ["Friends"],
        summary: "Lời mời đã gửi và đã nhận",
        responses: {
          200: {
            description: "Hai danh sách lời mời",
            ...json({
              type: "object",
              properties: {
                sent: { type: "array", items: ref("FriendRequest") },
                received: { type: "array", items: ref("FriendRequest") },
              },
            }),
          },
          ...authed,
        },
      },
      post: {
        tags: ["Friends"],
        summary: "Gửi lời mời kết bạn",
        requestBody: body({
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string", description: "Id người nhận" },
            message: { type: "string" },
          },
        }),
        responses: {
          201: {
            description: "Đã gửi",
            ...json({
              type: "object",
              properties: { message: { type: "string" }, request: ref("FriendRequest") },
            }),
          },
          400: { description: "`SELF_FRIEND_REQUEST` hoặc id không hợp lệ", ...json(ref("Error")) },
          404: errRef("NotFound"),
          409: { description: "Đã là bạn hoặc đã có lời mời", ...json(ref("Error")) },
          ...authed,
        },
      },
    },

    "/friends/requests/{requestId}/accept": {
      post: {
        tags: ["Friends"],
        summary: "Chấp nhận lời mời",
        parameters: [pathParam("requestId", "Id lời mời")],
        responses: {
          200: {
            description: "Đã kết bạn",
            ...json({
              type: "object",
              properties: { message: { type: "string" }, newFriend: ref("User") },
            }),
          },
          ...member,
        },
      },
    },

    "/friends/requests/{requestId}/decline": {
      post: {
        tags: ["Friends"],
        summary: "Từ chối lời mời",
        parameters: [pathParam("requestId", "Id lời mời")],
        responses: { 204: { description: "Đã từ chối" }, ...member },
      },
    },

    // --- Conversations ------------------------------------------------------
    "/conversations": {
      get: {
        tags: ["Conversations"],
        summary: "Danh sách hội thoại của mình",
        responses: {
          200: {
            description: "Sắp theo `lastMessageAt` giảm dần",
            ...json({
              type: "object",
              properties: { conversations: { type: "array", items: ref("Conversation") } },
            }),
          },
          ...authed,
        },
      },
      post: {
        tags: ["Conversations"],
        summary: "Tạo hội thoại",
        description: "Chỉ tạo được với người đã là bạn. Hội thoại 1-1 trùng sẽ trả lại bản đã có.",
        requestBody: body({
          type: "object",
          required: ["type", "memberIds"],
          properties: {
            type: { type: "string", enum: ["direct", "group"] },
            name: { type: "string", maxLength: 100, description: "Bắt buộc khi `type=group`" },
            memberIds: {
              type: "array",
              items: { type: "string" },
              maxItems: 256,
              description: "Không gồm chính mình. `direct` phải có đúng một id.",
            },
          },
        }),
        responses: {
          201: { description: "Đã tạo", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...validated,
          403: { description: "Có người trong danh sách không phải bạn bè", ...json(ref("Error")) },
          ...authed,
        },
      },
    },

    "/conversations/{conversationId}": {
      get: {
        tags: ["Conversations"],
        summary: "Chi tiết một hội thoại",
        parameters: [conversationId],
        responses: {
          200: { description: "Chi tiết", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...member,
        },
      },
      delete: {
        tags: ["Groups"],
        summary: "Xoá nhóm",
        description: "Chỉ owner. Xoá mềm; mọi thành viên nhận `conversation:removed` qua socket.",
        parameters: [conversationId],
        responses: {
          200: { description: "Đã xoá", ...json({ type: "object", properties: { deleted: { type: "boolean" } } }) },
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/messages": {
      get: {
        tags: ["Conversations"],
        summary: "Tin nhắn, phân trang lùi",
        description: [
          "Cursor là opaque (base64url của `{createdAt, _id}`). Dùng cặp khoá kép chứ",
          "không chỉ `createdAt`, để các tin nhắn trùng mili-giây không bị nhảy cóc hay",
          "lặp lại giữa hai trang. Tin nhắn đã xoá VẪN được trả về với `deleted: true`",
          "và `content: null`, để bia mộ và trích dẫn trả lời không bị hụt.",
        ].join(" "),
        parameters: [
          conversationId,
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "`nextCursor` của trang trước" },
        ],
        responses: {
          200: {
            description: "Một trang, thứ tự cũ → mới",
            ...json({
              type: "object",
              properties: {
                messages: { type: "array", items: ref("Message") },
                nextCursor: { type: "string", nullable: true, description: "`null` khi đã hết" },
              },
            }),
          },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/messages/since": {
      get: {
        tags: ["Conversations"],
        summary: "Tin nhắn mới hơn một cursor, phân trang xuôi",
        description: [
          "Dùng để đồng bộ lại sau khi mất kết nối. Trần cứng 200 tin mỗi lần gọi;",
          "`truncated: true` nghĩa là khoảng trống quá lớn — client nên bỏ cache và tải",
          "lại từ đầu thay vì cố vá.",
        ].join(" "),
        parameters: [
          conversationId,
          { name: "after", in: "query", schema: { type: "string" }, description: "Cursor của tin nhắn cuối mà client đang có" },
        ],
        responses: {
          200: {
            description: "Tin nhắn mới hơn cursor",
            ...json({
              type: "object",
              properties: {
                messages: { type: "array", items: ref("Message") },
                truncated: { type: "boolean" },
                nextCursor: { type: "string", nullable: true },
              },
            }),
          },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/settings": {
      patch: {
        tags: ["Conversations"],
        summary: "Ghim, lưu trữ, tắt thông báo",
        description: [
          "Ba tuỳ chọn RIÊNG CỦA TỪNG NGƯỜI: một người lưu trữ nhóm không làm nhóm đó biến",
          "mất khỏi hộp thư của người khác. Vì vậy kết quả chỉ được phát về các thiết bị của",
          "chính người gọi, không phát ra room của conversation.",
          "Cả ba field đều optional và độc lập — client gửi đúng thứ nó đổi, nên hai tab",
          "không ghi đè lẫn nhau bằng trạng thái cũ.",
        ].join(" "),
        parameters: [conversationId],
        requestBody: body({
          type: "object",
          properties: {
            pinned: { type: "boolean" },
            archived: { type: "boolean" },
            muteMinutes: {
              type: "integer",
              nullable: true,
              description: "`null` để bật lại thông báo. Trần 1 năm.",
            },
          },
        }),
        responses: {
          200: {
            description: "Conversation sau khi cập nhật, theo góc nhìn người gọi",
            ...json({
              type: "object",
              properties: { conversation: ref("Conversation") },
            }),
          },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/seen": {
      patch: {
        tags: ["Conversations"],
        summary: "Đẩy con trỏ đã đọc",
        description: [
          "Server tự suy `lastReadAt` từ `createdAt` đã lưu của tin nhắn được chỉ định —",
          "client không gửi thời điểm, nếu không lệch đồng hồ sẽ cho phép đánh dấu đã đọc",
          "cả tin nhắn trong tương lai. Con trỏ chỉ đi tới (`$max`), nên một gói tin đến",
          "muộn từ tab cũ không kéo lùi được.",
          "Đây là bản dự phòng của socket event `read:advance`; cả hai dùng chung service.",
        ].join(" "),
        parameters: [conversationId],
        requestBody: body(
          {
            type: "object",
            properties: {
              lastReadMessageId: { type: "string", description: "Bỏ trống thì đánh dấu tới tin nhắn cuối" },
            },
          },
          false,
        ),
        responses: {
          200: {
            description: "Con trỏ sau khi đẩy",
            ...json({
              type: "object",
              properties: {
                message: { type: "string" },
                lastReadAt: { type: "string", format: "date-time" },
                myUnreadCount: { type: "integer" },
              },
            }),
          },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/attachments": {
      post: {
        tags: ["Messages"],
        summary: "Tải tệp đính kèm lên (ảnh hoặc video)",
        description: [
          "Tách khỏi việc gửi tin nhắn: tải lên trước, rồi gửi một tin nhắn tham chiếu",
          "descriptor trả về. Nhờ vậy tiến trình tải và việc thử lại độc lập với việc gửi.",
          "Nhận `image/png|jpeg|webp|gif|avif` (tối đa 8 MB) và",
          "`video/mp4|webm|quicktime` (tối đa 25 MB).",
        ].join(" "),
        parameters: [conversationId],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: { type: "object", properties: { file: { type: "string", format: "binary" } } },
            },
          },
        },
        responses: {
          201: {
            description: "Descriptor của tệp",
            ...json({ type: "object", properties: { attachment: ref("UploadedAttachment") } }),
          },
          400: { description: "Sai định dạng tệp", ...json(ref("Error")) },
          413: { description: "Tệp quá lớn — ảnh tối đa 8 MB, video tối đa 25 MB", ...json(ref("Error")) },
          ...member,
        },
      },
    },

    // --- Groups -------------------------------------------------------------
    "/conversations/{conversationId}/group": {
      patch: {
        tags: ["Groups"],
        summary: "Đổi tên hoặc mô tả nhóm",
        description: "Owner hoặc admin.",
        parameters: [conversationId],
        requestBody: body({
          type: "object",
          properties: {
            name: { type: "string", maxLength: 100 },
            description: { type: "string", maxLength: 500, nullable: true },
          },
        }),
        responses: {
          200: { description: "Nhóm sau khi sửa", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/group/avatar": {
      post: {
        tags: ["Groups"],
        summary: "Đổi ảnh nhóm",
        description: "Owner hoặc admin.",
        parameters: [conversationId],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: { type: "object", properties: { file: { type: "string", format: "binary" } } },
            },
          },
        },
        responses: {
          200: { description: "Nhóm sau khi sửa", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          413: { description: "Tệp quá lớn", ...json(ref("Error")) },
          ...member,
        },
      },
      delete: {
        tags: ["Groups"],
        summary: "Xoá ảnh nhóm",
        description: "Owner hoặc admin. Xoá luôn asset trên Cloudinary theo `publicId`.",
        parameters: [conversationId],
        responses: {
          200: { description: "Nhóm sau khi sửa", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/members": {
      post: {
        tags: ["Groups"],
        summary: "Thêm thành viên",
        description: "Owner hoặc admin, và chỉ thêm được người đã là bạn của người thêm. Thêm người đã ở trong nhóm là no-op.",
        parameters: [conversationId],
        requestBody: body({
          type: "object",
          required: ["memberIds"],
          properties: { memberIds: { type: "array", items: { type: "string" }, maxItems: 256 } },
        }),
        responses: {
          200: {
            description: "Nhóm sau khi thêm",
            ...json({
              type: "object",
              properties: {
                conversation: ref("Conversation"),
                added: { type: "array", items: { type: "string" }, description: "Những id thực sự được thêm" },
              },
            }),
          },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/members/{userId}": {
      delete: {
        tags: ["Groups"],
        summary: "Xoá thành viên",
        description: [
          "Quyền phụ thuộc vai trò của **người bị xoá**: owner xoá được bất kỳ ai không",
          "phải owner; admin chỉ xoá được member; member không xoá được ai.",
          "Người bị xoá nhận `conversation:removed` và bị rời room ngay lập tức.",
        ].join(" "),
        parameters: [conversationId, userIdParam],
        responses: {
          200: { description: "Nhóm sau khi xoá", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/members/{userId}/role": {
      patch: {
        tags: ["Groups"],
        summary: "Đổi vai trò thành viên",
        description: "Chỉ owner. Đặt `role: \"owner\"` sẽ chuyển quyền sở hữu.",
        parameters: [conversationId, userIdParam],
        requestBody: body({
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["owner", "admin", "member"] } },
        }),
        responses: {
          200: { description: "Nhóm sau khi đổi", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/transfer-ownership": {
      post: {
        tags: ["Groups"],
        summary: "Chuyển quyền sở hữu",
        description: "Chỉ owner. Nhóm luôn có đúng một owner.",
        parameters: [conversationId],
        requestBody: body({
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        }),
        responses: {
          200: { description: "Nhóm sau khi chuyển", ...json({ type: "object", properties: { conversation: ref("Conversation") } }) },
          ...validated,
          ...member,
        },
      },
    },

    "/conversations/{conversationId}/leave": {
      post: {
        tags: ["Groups"],
        summary: "Rời nhóm",
        description: [
          "Owner phải chuyển quyền trước khi rời, TRỪ khi là thành viên cuối cùng —",
          "khi đó nhóm được xoá mềm và trả về `deleted: true`.",
        ].join(" "),
        parameters: [conversationId],
        responses: {
          200: {
            description: "Đã rời",
            ...json({
              type: "object",
              properties: {
                deleted: { type: "boolean" },
                conversation: { allOf: [ref("Conversation")], nullable: true },
              },
            }),
          },
          403: { description: "`OWNER_MUST_TRANSFER` — owner còn thành viên khác thì phải chuyển quyền trước", ...json(ref("Error")) },
          ...member,
        },
      },
    },

    // --- Messages -----------------------------------------------------------
    "/messages/direct": {
      post: {
        tags: ["Messages"],
        summary: "Gửi tin nhắn 1-1",
        description: [
          "Đường dự phòng khi socket không kết nối được; đường chính là event",
          "`message:send`. Cả hai đi qua cùng một `messageService.createMessage`.",
          "`clientMessageId` làm cho việc gửi trở nên idempotent: gửi lại cùng id sau khi",
          "mất kết nối trả về đúng tin nhắn cũ chứ không tạo bản sao.",
        ].join(" "),
        requestBody: body({
          type: "object",
          required: ["recipientId"],
          properties: {
            recipientId: { type: "string" },
            conversationId: { type: "string", description: "Bỏ trống thì tìm hoặc tạo hội thoại 1-1" },
            content: { type: "string", maxLength: 4000 },
            clientMessageId: { type: "string", maxLength: 64 },
            replyToMessageId: { type: "string" },
            attachment: ref("AttachmentInput"),
            imgUrl: {
              type: "string",
              format: "uri",
              deprecated: true,
              description: "@deprecated — dùng `attachment`. URL trần làm mất `kind` và `publicId`.",
            },
          },
        }),
        responses: {
          201: { description: "Tin nhắn đã tạo", ...json({ type: "object", properties: { message: ref("Message") } }) },
          ...validated,
          403: { description: "Không phải bạn bè, hoặc `recipientId` không thuộc hội thoại", ...json(ref("Error")) },
          ...authed,
        },
      },
    },

    "/messages/group": {
      post: {
        tags: ["Messages"],
        summary: "Gửi tin nhắn nhóm",
        requestBody: body({
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string" },
            content: { type: "string", maxLength: 4000 },
            clientMessageId: { type: "string", maxLength: 64 },
            replyToMessageId: { type: "string" },
            attachment: ref("AttachmentInput"),
            imgUrl: {
              type: "string",
              format: "uri",
              deprecated: true,
              description: "@deprecated — dùng `attachment`. URL trần làm mất `kind` và `publicId`.",
            },
          },
        }),
        responses: {
          201: { description: "Tin nhắn đã tạo", ...json({ type: "object", properties: { message: ref("Message") } }) },
          ...validated,
          ...member,
        },
      },
    },

    "/messages/{messageId}/reactions": {
      put: {
        tags: ["Messages"],
        summary: "Thả hoặc gỡ một biểu cảm",
        description: [
          "TOGGLE, không phải add/remove: thao tác của người dùng là bấm vào một chip, và",
          "một client không đồng bộ có thể tưởng mình chưa thả trong khi đã thả rồi.",
          "`emoji` phải nằm trong bộ cố định — nếu cho tự do, field này thành một ô text",
          "tuỳ ý gắn lên tin nhắn của người khác.",
          "Đây là bản dự phòng của socket event `reaction:toggle`; cả hai dùng chung service.",
        ].join(" "),
        parameters: [messageIdParam],
        requestBody: body({
          type: "object",
          required: ["emoji"],
          properties: {
            emoji: { type: "string", enum: [...REACTION_EMOJIS] },
          },
        }),
        responses: {
          200: {
            description: "Tổng hợp biểu cảm sau khi đổi",
            ...json({
              type: "object",
              properties: {
                conversationId: { type: "string" },
                messageId: { type: "string" },
                reactions: { type: "array", items: ref("ReactionGroup") },
                active: { type: "boolean", description: "`true` nếu vừa thả, `false` nếu vừa gỡ" },
              },
            }),
          },
          400: { description: "`MESSAGE_DELETED` hoặc `TOO_MANY_REACTIONS`", ...json(ref("Error")) },
          ...member,
        },
      },
    },

    "/messages/{messageId}": {
      patch: {
        tags: ["Messages"],
        summary: "Sửa tin nhắn",
        description: "Chỉ người gửi, chỉ tin nhắn `kind: text`, trong vòng 15 phút kể từ khi gửi.",
        parameters: [messageIdParam],
        requestBody: body({
          type: "object",
          required: ["content"],
          properties: { content: { type: "string", maxLength: 4000 } },
        }),
        responses: {
          200: { description: "Tin nhắn sau khi sửa", ...json({ type: "object", properties: { message: ref("Message") } }) },
          400: { description: "`EDIT_WINDOW_EXPIRED` hoặc tin nhắn không phải text", ...json(ref("Error")) },
          ...member,
        },
      },
      delete: {
        tags: ["Messages"],
        summary: "Xoá tin nhắn",
        description: [
          "Xoá mềm: đặt `deletedAt`, và serializer bỏ `content` cùng `attachments` nên nội",
          "dung đã xoá không bao giờ lên đường truyền. Người gửi xoá được tin của mình;",
          "owner và admin của nhóm xoá được tin của bất kỳ ai.",
        ].join(" "),
        parameters: [messageIdParam],
        responses: {
          200: { description: "Bia mộ", ...json({ type: "object", properties: { message: ref("Message") } }) },
          ...member,
        },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },

    responses: {
      Unauthorized: {
        description: "Thiếu access token, hoặc token sai/hết hạn (`TOKEN_EXPIRED`)",
        ...json(ref("Error")),
      },
      Forbidden: {
        description: "Đã đăng nhập nhưng không đủ quyền (`NOT_A_MEMBER`, `INSUFFICIENT_ROLE`)",
        ...json(ref("Error")),
      },
      NotFound: { description: "Không tìm thấy", ...json(ref("Error")) },
      ValidationError: {
        description: "`VALIDATION_ERROR` — body, query hoặc param không hợp lệ",
        ...json(ref("ValidationError")),
      },
      RateLimited: { description: "Quá nhiều request", ...json(ref("Error")) },
    },

    schemas: {
      Error: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Mã ổn định để client rẽ nhánh, không đổi theo ngôn ngữ hiển thị",
            example: "NOT_A_MEMBER",
          },
          message: { type: "string", description: "Câu tiếng Việt để hiển thị; có thể đổi bất cứ lúc nào" },
          requestId: { type: "string", description: "Đối chiếu với log server" },
        },
      },

      ValidationError: {
        allOf: [
          ref("Error"),
          {
            type: "object",
            properties: {
              details: {
                type: "object",
                properties: {
                  fields: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description: "Tên field → lý do, để form gắn lỗi vào đúng ô",
                  },
                },
              },
            },
          },
        ],
      },

      UserPreferences: {
        type: "object",
        properties: {
          inAppNotifications: { type: "boolean", default: true },
          browserNotifications: { type: "boolean", default: false },
          showPresence: { type: "boolean", default: true },
          enterToSend: { type: "boolean", default: true },
        },
      },

      User: {
        type: "object",
        properties: {
          _id: { type: "string" },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          avatarUrl: { type: "string", nullable: true },
          bio: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          lastSeenAt: { type: "string", format: "date-time", nullable: true },
          preferences: ref("UserPreferences"),
        },
      },

      Session: {
        type: "object",
        properties: {
          _id: { type: "string" },
          userAgent: { type: "string", nullable: true },
          ip: { type: "string", nullable: true },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          current: { type: "boolean", description: "Đúng với phiên đang gọi request này" },
        },
      },

      FriendRequest: {
        type: "object",
        properties: {
          _id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          message: { type: "string", nullable: true },
          status: { type: "string", enum: ["pending", "accepted", "declined"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      Participant: {
        type: "object",
        properties: {
          _id: { type: "string", description: "Id người dùng" },
          displayName: { type: "string", nullable: true },
          avatarUrl: { type: "string", nullable: true },
          joinedAt: { type: "string", format: "date-time", nullable: true },
          role: { type: "string", enum: ["owner", "admin", "member"], nullable: true },
          lastReadAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: [
              "Nguồn sự thật của trạng thái đã đọc. Biên nhận từng tin được SUY RA từ đây",
              "(`lastReadAt >= message.createdAt`) chứ không lưu mảng `readBy` trên mỗi tin —",
              "mảng đó sẽ ghi O(số tin × số thành viên) mỗi lần mở một hội thoại tồn đọng.",
            ].join(" "),
          },
        },
      },

      Conversation: {
        type: "object",
        properties: {
          _id: { type: "string" },
          type: { type: "string", enum: ["direct", "group"] },
          participants: { type: "array", items: ref("Participant") },
          group: {
            nullable: true,
            type: "object",
            properties: {
              name: { type: "string", nullable: true },
              description: { type: "string", nullable: true },
              avatarUrl: { type: "string", nullable: true },
              createdBy: { type: "string", nullable: true },
            },
          },
          lastMessage: {
            nullable: true,
            type: "object",
            properties: {
              _id: { type: "string", nullable: true },
              content: { type: "string", nullable: true },
              createdAt: { type: "string", format: "date-time", nullable: true },
              sender: {
                nullable: true,
                type: "object",
                properties: {
                  _id: { type: "string" },
                  displayName: { type: "string", nullable: true },
                  avatarUrl: { type: "string", nullable: true },
                },
              },
            },
          },
          lastMessageAt: { type: "string", format: "date-time", nullable: true },
          unreadCounts: {
            type: "object",
            additionalProperties: { type: "integer" },
            description: "Số chưa đọc theo từng thành viên",
          },
          unreadCount: {
            type: "integer",
            description: "Số chưa đọc của riêng người gọi — client khỏi phải tra map bằng id của chính mình",
          },
          myRole: { type: "string", enum: ["owner", "admin", "member"], nullable: true },
          pinned: { type: "boolean", description: "Riêng của người gọi" },
          archived: { type: "boolean", description: "Riêng của người gọi" },
          mutedUntil: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Riêng của người gọi. Mốc đã qua được server lọc thành `null`.",
          },
          seenBy: {
            type: "array",
            items: { type: "string" },
            deprecated: true,
            description: "Đã thay bằng `participants[].lastReadAt`. Còn trả về thêm một release rồi bỏ.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      Attachment: {
        type: "object",
        description: "`publicId` cố tình không trả ra — đó là chi tiết nội bộ của Cloudinary.",
        properties: {
          url: { type: "string" },
          kind: { type: "string", enum: ["image", "video", "file"] },
          mimeType: { type: "string", nullable: true },
          bytes: { type: "integer", nullable: true },
          width: { type: "integer", nullable: true },
          height: { type: "integer", nullable: true },
          duration: { type: "number", nullable: true, description: "Giây, chỉ video mới có" },
          originalName: { type: "string", nullable: true },
        },
      },

      /**
       * Tệp đính kèm khi GỬI tin nhắn — client trả lại nguyên descriptor mà
       * endpoint tải lên đã cấp, kèm `publicId`.
       */
      AttachmentInput: {
        type: "object",
        required: ["url"],
        description: [
          "Gửi lại nguyên descriptor nhận được từ",
          "`POST /conversations/{conversationId}/attachments`.",
          "`publicId` phải được giữ lại, nếu không server không dọn được tệp trên",
          "Cloudinary khi tin nhắn bị xoá.",
        ].join(" "),
        properties: {
          url: { type: "string", format: "uri", description: "Chỉ http/https" },
          publicId: { type: "string" },
          kind: { type: "string", enum: ["image", "video", "file"], default: "image" },
          mimeType: { type: "string" },
          bytes: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
          duration: { type: "number" },
          originalName: { type: "string" },
        },
      },

      UploadedAttachment: {
        allOf: [
          ref("Attachment"),
          {
            type: "object",
            properties: {
              publicId: { type: "string", description: "Trả về đúng một lần, để tin nhắn tham chiếu tới" },
            },
          },
        ],
      },

      Message: {
        type: "object",
        properties: {
          _id: { type: "string" },
          conversationId: { type: "string" },
          senderId: { type: "string" },
          sender: {
            type: "object",
            properties: {
              _id: { type: "string" },
              displayName: { type: "string" },
              avatarUrl: { type: "string", nullable: true },
            },
          },
          kind: { type: "string", enum: ["text", "image", "file", "system"] },
          content: { type: "string", nullable: true, description: "`null` khi tin nhắn đã bị xoá" },
          attachments: { type: "array", items: ref("Attachment") },
          replyTo: {
            nullable: true,
            type: "object",
            description: "Ảnh chụp tại thời điểm trả lời, không phải tham chiếu — nhờ vậy một trang 50 tin không cần populate thêm lần nữa, và tin gốc bị xoá cũng không để lại tham chiếu treo.",
            properties: {
              messageId: { type: "string" },
              senderId: { type: "string", nullable: true },
              contentSnapshot: { type: "string", nullable: true, maxLength: 140 },
              kindSnapshot: { type: "string", nullable: true },
            },
          },
          systemEvent: {
            nullable: true,
            type: "object",
            description: "Có khi `kind: system`. Mọi thay đổi thành viên đều ghi một tin hệ thống, nên có sẵn nhật ký ngay trong luồng chat.",
            properties: {
              type: { type: "string" },
              actorId: { type: "string", nullable: true },
              targetIds: { type: "array", items: { type: "string" } },
              meta: { type: "object", nullable: true },
            },
          },
          reactions: {
            type: "array",
            items: ref("ReactionGroup"),
            description:
              "Đã gom theo emoji ở server. Tin nhắn đã xoá luôn trả mảng rỗng.",
          },
          clientMessageId: { type: "string", nullable: true },
          editedAt: { type: "string", format: "date-time", nullable: true },
          deleted: { type: "boolean" },
          deletedAt: { type: "string", format: "date-time", nullable: true },
          isOwn: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      ReactionGroup: {
        type: "object",
        description: [
          "Một emoji và số lượt thả. Server gom sẵn thay vì trả mảng thô: một tin nhắn",
          "trong nhóm đông có thể có hàng trăm lượt, và client chỉ cần biết emoji nào,",
          "bao nhiêu lượt, mình đã thả chưa.",
        ].join(" "),
        properties: {
          emoji: { type: "string", enum: [...REACTION_EMOJIS] },
          count: { type: "integer" },
          reactedByMe: {
            type: "boolean",
            description:
              "Chỉ có ở response HTTP. Bản broadcast qua socket cố tình bỏ field này vì nó theo từng người xem.",
          },
        },
      },
    },
  },
};

writeFileSync(OUT, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`swagger.json: ${Object.keys(spec.paths).length} path, ${Object.keys(spec.components.schemas).length} schema`);
