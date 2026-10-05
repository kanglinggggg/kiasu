import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Remix Drop — A second life. A first choice.', description: 'Turn surplus into products people have already chosen.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
