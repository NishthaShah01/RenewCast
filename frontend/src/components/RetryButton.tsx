"use client";

export function RetryButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (onClick) {
          onClick();
        } else {
          window.location.reload();
        }
      }}
      className="cursor-pointer rounded-control bg-[var(--ink-primary)] px-3 py-1.5 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:opacity-100"
    >
      Retry
    </button>
  );
}
