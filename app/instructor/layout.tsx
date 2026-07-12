import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SidebarNav role="instructor" userName="Instructor" userRole="Instructor" />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
