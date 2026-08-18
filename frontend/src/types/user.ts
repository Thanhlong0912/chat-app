/**
 * Tuỳ chọn của người dùng, lưu ở server để đồng bộ giữa các thiết bị.
 * Tất cả đều optional vì tài khoản cũ có thể chưa có field này.
 */
export interface UserPreferences {
  inAppNotifications?: boolean;
  browserNotifications?: boolean;
  showPresence?: boolean;
  enterToSend?: boolean;
}

export interface User {
  _id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  phone?: string;
  preferences?: UserPreferences;
  createdAt?: string;
  updatedAt?: string;
}

export interface Friend {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export interface FriendRequest {
  _id: string;
  from?: {
    _id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  to?: {
    _id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  message: string;
  createdAt: string;
  updatedAt: string;
}
