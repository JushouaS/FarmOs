import { useAvatar } from "@/lib/avatar";
import type { AuthUser } from "@/lib/auth-context";

/** The signed-in person's photo, or their initial on the brand gradient.
 *  Fills its parent: the parent sets the size, `className` the initial's text size. */
export function UserAvatar({ user, className = "text-xs" }: { user: AuthUser | null; className?: string }) {
  const photo = useAvatar(user?.id ?? user?.email ?? null);
  const initial = (user?.fullName ?? user?.email ?? "U").trim()[0]?.toUpperCase() ?? "U";

  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        draggable={false}
        className="h-full w-full rounded-full object-cover select-none"
        style={{ border: "1px solid rgba(52,211,153,0.3)" }}
      />
    );
  }
  return (
    <span
      className={`flex h-full w-full items-center justify-center rounded-full font-bold text-white select-none ${className}`}
      style={{
        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
        border: "1px solid rgba(52,211,153,0.3)",
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
