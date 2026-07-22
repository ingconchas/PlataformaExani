import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SidebarNav role="admin" userName="Administradora" userRole="Administrador" />
      {/* En móvil la top bar del SidebarNav es fija (56px): el padding superior
          la despeja. En ≥md, idéntico al layout previo. */}
      <main className="flex-1 overflow-auto p-8 max-md:p-4 max-md:pt-20">
        {children}
      </main>
    </div>
  );
}
