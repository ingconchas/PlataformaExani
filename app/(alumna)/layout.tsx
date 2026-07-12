import { StudentHeader } from "@/components/layout/student-header";
import { BottomNav } from "@/components/layout/bottom-nav";

export default function AlumnaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-[430px] pb-20">
      <StudentHeader nombre="Alumna" />
      <div className="px-5">{children}</div>
      <BottomNav />
    </div>
  );
}
