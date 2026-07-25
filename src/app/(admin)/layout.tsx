import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { MobileNav } from "@/components/shared/mobile-nav";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="flex flex-1">
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r bg-sidebar text-sidebar-foreground sm:block">
        <div className="border-b px-4 py-4">
          <span className="text-lg font-semibold">Fibott Admin</span>
        </div>
        <AdminSidebar />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav title="Fibott Admin">
              <AdminSidebar />
            </MobileNav>
            <span className="text-lg font-semibold sm:hidden">Fibott Admin</span>
          </div>
          <span className="hidden truncate text-sm text-muted-foreground sm:block">
            Signed in as {session.user.name ?? session.user.email}
          </span>
          <SignOutButton />
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
