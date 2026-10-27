import { BotAvatarStyles } from "@cloudfarm/bot-avatar";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Madimi_One } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Wordmark only.
const madimiOne = Madimi_One({
  variable: "--font-madimi",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "cloudfarm",
  description: "cloudfarm web app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${madimiOne.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col overflow-hidden">
        <BotAvatarStyles />
        {children}
      </body>
    </html>
  );
}
