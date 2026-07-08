'use client';

/**
 * LogoutButton — subtle sign-out trigger for the sidebar.
 * Uses a native <form> POST to /api/auth/logout so the browser
 * follows the server redirect (Cognito logout URL or /login).
 */
export default function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        className="w-full text-left text-xs text-muted hover:text-fg transition-colors"
      >
        Sign Out
      </button>
    </form>
  );
}
