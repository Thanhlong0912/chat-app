import { Search, UserRoundX } from "lucide-react";
import type { User } from "@/types/user";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import UserAvatar from "../chat/UserAvatar";

interface SearchFormProps {
  term: string;
  onTermChange: (value: string) => void;
  loading: boolean;
  results: User[];
  /** Đã tìm xong ít nhất một lần cho từ khoá hiện tại. */
  searched: boolean;
  onSelect: (user: User) => void;
}

/**
 * Tìm bạn bè, hiện kết quả ngay khi gõ.
 *
 * Trước đây đây là một <form> phải bấm nút "Tìm", và backend khớp username TUYỆT
 * ĐỐI — nên phải gõ đúng từng ký tự tên người kia mới thấy gì. Giờ mỗi ký tự đều
 * cho ra danh sách gợi ý, và chọn một người sẽ chuyển sang bước viết lời giới
 * thiệu.
 */
const SearchForm = ({
  term,
  onTermChange,
  loading,
  results,
  searched,
  onSelect,
}: SearchFormProps) => {
  const showEmptyState = searched && !loading && term.trim() !== "" && results.length === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="username"
          className="text-sm font-semibold"
        >
          Tìm bằng username hoặc tên
        </Label>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            id="username"
            value={term}
            onChange={(event) => onTermChange(event.target.value)}
            placeholder="Gõ một chữ cái là đủ..."
            className="glass border-border/50 pl-9 pr-9 transition-smooth focus:border-primary/50"
            autoComplete="off"
            // Danh sách kết quả tự cập nhật, screen reader cần được báo.
            aria-describedby="friend-search-results"
          />

          {loading && (
            <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2" />
          )}
        </div>
      </div>

      <div
        id="friend-search-results"
        aria-live="polite"
        className="min-h-[60px]"
      >
        {results.length > 0 && (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
            {results.map((user) => (
              <li key={user._id}>
                <button
                  type="button"
                  onClick={() => onSelect(user)}
                  className="flex w-full items-center gap-3 p-2.5 text-left transition-smooth hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <UserAvatar
                    type="chat"
                    name={user.displayName}
                    avatarUrl={user.avatarUrl}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {user.displayName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{user.username}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showEmptyState && (
          <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <UserRoundX className="size-4" />
            Không tìm thấy ai khớp với “{term.trim()}”
          </p>
        )}

        {!searched && !loading && term.trim() === "" && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Gõ để tìm người bạn muốn kết bạn.
          </p>
        )}
      </div>
    </div>
  );
};

export default SearchForm;
