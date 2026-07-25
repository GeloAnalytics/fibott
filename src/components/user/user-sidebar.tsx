import { NavLink } from "@/components/shared/nav-link";

export const userNavLinks = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/history", label: "Scan & Deposit History" },
  { href: "/dashboard/wallet", label: "Points Wallet" },
  { href: "/dashboard/leaderboard", label: "Leaderboard" },
  { href: "/dashboard/profile", label: "Profile" },
];

export function UserSidebar() {
  return (
    <nav className="space-y-1 p-4">
      {userNavLinks.map((link) => (
        <NavLink key={link.href} href={link.href} exact={link.exact}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
