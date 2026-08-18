import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import type { Conversation } from "@/types/chat";
import { useGroupActions } from "@/hooks/useGroupActions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import GroupChatAvatar from "../chat/GroupChatAvatar";

/**
 * Sửa tên, mô tả và ảnh nhóm.
 *
 * Chỉ render khi người dùng là owner/admin. Đó là để giao diện gọn — server vẫn từ
 * chối request của member thường bằng 403, nên việc ẩn nút không phải lớp bảo vệ.
 */
const GroupSettingsForm = ({ conversation }: { conversation: Conversation }) => {
  const actions = useGroupActions(conversation._id);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(conversation.group?.name ?? "");
  const [description, setDescription] = useState(conversation.group?.description ?? "");

  const nameChanged = name.trim() !== (conversation.group?.name ?? "");
  const descriptionChanged = description.trim() !== (conversation.group?.description ?? "");

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void actions.uploadAvatar(file);
    // Cho phép chọn lại đúng tệp vừa chọn.
    event.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {conversation.group?.avatarUrl ? (
          <img
            src={conversation.group.avatarUrl}
            alt=""
            className="size-12 rounded-full object-cover"
          />
        ) : (
          <GroupChatAvatar
            participants={conversation.participants}
            type="chat"
          />
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={actions.pending}
        >
          <ImagePlus className="size-4" />
          Đổi ảnh nhóm
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleFile}
          aria-label="Chọn ảnh nhóm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="group-name">Tên nhóm</Label>
        <div className="flex gap-2">
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
          <Button
            onClick={() => actions.rename(name.trim())}
            disabled={!nameChanged || !name.trim() || actions.pending}
          >
            {actions.pending ? <Loader2 className="size-4 animate-spin" /> : "Lưu"}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="group-description">Mô tả</Label>
        <Textarea
          id="group-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Nhóm này để làm gì?"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => actions.updateDescription(description.trim())}
          disabled={!descriptionChanged || actions.pending}
        >
          Lưu mô tả
        </Button>
      </div>
    </div>
  );
};

export default GroupSettingsForm;
