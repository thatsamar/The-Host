import { Studio } from "@/components/studio";
import { copyOf, currentCompanion } from "@/lib/companions";

export default function Home() {
  return <Studio companion={copyOf(currentCompanion())} />;
}
