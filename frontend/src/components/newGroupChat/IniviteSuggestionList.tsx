import type { Friend } from "@/types/user";
import UserAvatar from "../chat/UserAvatar";

interface InviteSuggestionListProps {
  filteredFriends: Friend[];
  onSelect: (friend: Friend) => void;
}

const IniviteSuggestionList = ({
  filteredFriends,
  onSelect,
}: InviteSuggestionListProps) => {
  if (filteredFriends.length === 0) return null;

  return (
    <div className="border rounded-lg mt-2 max-h-[180px] overflow-y-auto divide-y">
      {filteredFriends.map((friend) => (
        <button
          type="button"
          key={friend._id}
          className="flex w-full items-center gap-3 p-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => onSelect(friend)}
        >
          <UserAvatar
            type="chat"
            name={friend.displayName}
            avatarUrl={friend.avatarUrl}
          />

          <span className="font-medium">{friend.displayName}</span>
        </button>
      ))}
    </div>
  );
};

export default IniviteSuggestionList;
