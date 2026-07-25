import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
for (const relativePath of ["dist-electron", "dist-renderer"]) {
  const target = resolve(root, relativePath);
  if (dirname(target) !== root) throw new Error(`Refusing to clean outside project root: ${target}`);
  rmSync(target, { recursive: true, force: true });
}
