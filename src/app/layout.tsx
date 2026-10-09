import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'terise | Clothing from recovered materials', description: 'Explore fashion drops using recovered materials. Review clothing returns and preorder before production.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
