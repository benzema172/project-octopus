import Link from "next/link";
import { Brain, FolderKanban, LogOut, Octagon } from "lucide-react";

type AppShellProps = {
  userEmail: string;
  children: React.ReactNode;
};

export function AppShell({ userEmail, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/workspace" className="sidebar-brand" aria-label="Project Octopus">
          <span className="sidebar-brand__mark">
            <Octagon size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Project Octopus</strong>
            <small>PureInvest</small>
          </span>
        </Link>

        <nav className="sidebar-nav" aria-label="Główna nawigacja">
          <Link href="/workspace">
            <FolderKanban size={18} aria-hidden="true" />
            Inwestycje
          </Link>
          <Link href="/workspace/brain">
            <Brain size={18} aria-hidden="true" />
            Octopus Brain
          </Link>
        </nav>

        <div className="sidebar-footer">
          <span title={userEmail}>{userEmail}</span>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="ghost-icon-button" aria-label="Wyloguj">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>
      <div className="app-content" id="main-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
