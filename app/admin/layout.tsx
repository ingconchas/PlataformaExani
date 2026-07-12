import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SidebarNav role="admin" userName="Administradora" userRole="Administrador" />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
