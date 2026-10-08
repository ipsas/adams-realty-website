import { SiteMain } from "@/components/layout/site-main";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <SiteMain>{children}</SiteMain>;
}
