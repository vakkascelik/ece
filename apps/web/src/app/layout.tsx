import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ECE Platform',
  description: 'Administration for New Zealand early learning services.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ">
      <body
        style={{
          margin: 0,
          fontFamily: '-apple-system, Segoe UI, Helvetica, Arial, sans-serif',
          background: '#fafaf9',
          color: '#1a1a1a',
        }}
      >
        {children}
      </body>
    </html>
  );
}
