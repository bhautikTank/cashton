import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const rootDir = path.resolve(process.cwd());

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;

  // Handle @/ alias
  if (target.startsWith("@/")) {
    const relativePath = target.slice(2);
    target = pathToFileURL(path.join(rootDir, relativePath)).href;
  }

  try {
    return await nextResolve(target, context);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "ERR_UNSUPPORTED_DIR_IMPORT") {
      let baseFilePath = null;
      if (target.startsWith("file://")) {
        baseFilePath = fileURLToPath(target);
      } else if (context.parentURL) {
        try {
          const resolvedUrl = new URL(target, context.parentURL);
          baseFilePath = fileURLToPath(resolvedUrl);
        } catch {}
      }

      if (baseFilePath) {
        const candidates = [
          baseFilePath + ".ts",
          baseFilePath + ".js",
          baseFilePath + ".mjs",
          path.join(baseFilePath, "index.ts"),
          path.join(baseFilePath, "index.js"),
        ];
        for (const cand of candidates) {
          try {
            await access(cand);
            return {
              url: pathToFileURL(cand).href,
              shortCircuit: true,
            };
          } catch {}
        }
      }
    }
    throw err;
  }
}
