import type { ReactNode } from "react";

export const metadata = {
  title: "get-contrast",
  description: "Color contrast for code, the CLI, and AI agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
