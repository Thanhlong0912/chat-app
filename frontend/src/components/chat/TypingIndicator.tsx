import { useTypingNames } from "@/stores/useSocketStore";

/**
 * Ba dấu chấm "đang nhập".
 *
 * Đăng ký hẹp vào đúng conversation này, nên người khác gõ ở cuộc trò chuyện khác
 * không làm component này render.
 */
const TypingIndicator = ({ conversationId }: { conversationId: string }) => {
  const names = useTypingNames(conversationId);

  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} đang nhập`
      : names.length === 2
        ? `${names[0]} và ${names[1]} đang nhập`
        : `${names[0]} và ${names.length - 1} người khác đang nhập`;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <span className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
};

export default TypingIndicator;
