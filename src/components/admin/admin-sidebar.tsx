import { NavLink } from "@/components/shared/nav-link";

interface NavLinkItem {
  href: string;
  label: string;
  exact?: boolean;
}

export const adminNavGroups: { heading: string; links: NavLinkItem[] }[] = [
  {
    heading: "Overview",
    links: [{ href: "/admin", label: "Dashboard", exact: true }],
  },
  {
    heading: "Recycling",
    links: [
      { href: "/admin/deposits", label: "Deposit History" },
      { href: "/admin/users", label: "User Directory" },
    ],
  },
  {
    heading: "Rewards",
    links: [
      { href: "/admin/vouchers", label: "Voucher Management" },
      { href: "/admin/rewards", label: "Rewards Management" },
    ],
  },
  {
    heading: "Insights",
    links: [
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/logs", label: "System & Hardware Logs" },
      { href: "/admin/audit-logs", label: "Audit Logs" },
      { href: "/admin/leaderboard", label: "Leaderboard" },
      { href: "/admin/notifications", label: "Notifications" },
    ],
  },
  {
    heading: "Account",
    links: [{ href: "/admin/profile", label: "Profile" }],
  },
];

export function AdminSidebar() {
  return (
    <nav className="space-y-4 p-4">
      {adminNavGroups.map((group) => (
        <div key={group.heading}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.heading}
          </p>
          <div className="space-y-1">
            {group.links.map((link) => (
              <NavLink key={link.href} href={link.href} exact={link.exact}>
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
