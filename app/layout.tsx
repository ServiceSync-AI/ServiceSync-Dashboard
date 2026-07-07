/**
 * Root Layout — Pilot Intelligence Dashboard
 * ==========================================
 * Wires up the brand fonts (Space Grotesk for display, Inter for body), the
 * always-visible sidebar nav, and the dark canvas. Every authenticated page
 * renders inside the sidebar shell. The /login route renders its own minimal
 * shell (see login/layout via route group not used here — login simply hides
 * the sidebar by living above the main content width).
 */
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import Sidebar from '@/components/Sidebar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ServiceSync Dashboard',
  description: 'Unified command center — Intel, Console, Tracker.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="ml-56 flex-1 overflow-x-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
