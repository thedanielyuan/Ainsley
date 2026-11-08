import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { APPEARANCE_SCRIPT, DEFAULT_ACCENT, DEFAULT_THEME, THEME_BACKGROUNDS } from "@/lib/appearance";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ainsley",
  description:
    "A personal tutor that understands your courses, adapts to how you learn, and helps you reach genuine mastery.",
};

export const viewport: Viewport = {
  themeColor: THEME_BACKGROUNDS.dark,
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The saved theme and accent are applied before the first paint (see lib/appearance.ts), so
    // React keeps whatever the script set on <html>.
    <html
      lang="en"
      data-theme={DEFAULT_THEME === "light" ? "light" : "dark"}
      data-accent={DEFAULT_ACCENT}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden bg-bg font-sans text-fg">{children}</body>
    </html>
  );
}
