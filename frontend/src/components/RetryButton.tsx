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
      className="btn-primary text-12 px-3 py-1.5"
    >
      Retry
    </button>
  );
}
