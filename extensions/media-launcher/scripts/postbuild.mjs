import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

fs.copyFileSync(path.join(root, "package.json"), path.join(dist, "package.json"));
fs.copyFileSync(path.join(root, "background.js"), path.join(dist, "background.js"));

const marketplaceDir = path.join(root, "marketplace");
if (fs.existsSync(marketplaceDir)) {
  const target = path.join(dist, "marketplace");
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(marketplaceDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.copyFileSync(path.join(marketplaceDir, entry.name), path.join(target, entry.name));
    }
  }
}
