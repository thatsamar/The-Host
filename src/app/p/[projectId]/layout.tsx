import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { loadWorkspace } from "@/lib/db/workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectLayout({ children, params }: LayoutProps<"/p/[projectId]">) {
  const { projectId } = await params;
  if (!UUID.test(projectId)) notFound();
  const workspace = await loadWorkspace(projectId);
  if (!workspace) notFound();
  return <AppShell workspace={workspace}>{children}</AppShell>;
}
