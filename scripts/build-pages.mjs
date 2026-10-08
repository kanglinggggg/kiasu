import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Build a separate, public-only project. Never copy environment files or the database.
const root = process.cwd();
const target = resolve(root, '.pages-build');
if (target !== join(root, '.pages-build')) throw new Error('Unexpected export directory');
if (existsSync(target)) rmSync(target, { recursive: true });
mkdirSync(target, { recursive: true });
for (const path of ['src', 'public', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts']) {
  cpSync(join(root, path), join(target, path), { recursive: true });
}
rmSync(join(target, 'src/app/api'), { recursive: true });
writeFileSync(join(target, 'src/app/page.tsx'), "import StaticDemo from '@/components/static-demo';\nexport default function Page(){return <StaticDemo/>;}\n");
writeFileSync(join(target, 'next.config.ts'), "export default {output:'export',basePath:'/terise',images:{unoptimized:true},turbopack:{root:process.cwd()}};\n");
const css = join(target, 'src/app/globals.css');
writeFileSync(css, readFileSync(css, 'utf8').replaceAll("url('/", "url('/terise/").replaceAll('url("/', 'url("/terise/'));
const layout = join(target, 'src/app/layout.tsx');
writeFileSync(layout, readFileSync(layout, 'utf8').replace("'/favicon.svg'", "'/terise/favicon.svg'"));
const result = spawnSync(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build', target], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(join(target, 'out/.nojekyll'), '');
console.log('Static demo ready in .pages-build/out');
