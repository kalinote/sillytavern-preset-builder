import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

interface PreviewAsset {
  path: string;
  contentType: string;
}

const require = createRequire(import.meta.url);
const jsYamlRoot = dirname(require.resolve("js-yaml"));
const zodLibRoot = dirname(require.resolve("zod"));
const ejsRoot = dirname(dirname(require.resolve("ejs")));

const PREVIEW_ASSETS = new Map<string, PreviewAsset>([
  ["/preview-assets/jquery-3.7.1.min.js", {
    path: require.resolve("jquery/dist/jquery.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/lodash-4.17.21.min.js", {
    path: require.resolve("lodash/lodash.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/js-yaml-4.1.0.min.js", {
    path: join(jsYamlRoot, "dist", "js-yaml.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/showdown-2.1.0.min.js", {
    path: require.resolve("showdown/dist/showdown.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/toastr-2.1.4.min.js", {
    path: require.resolve("toastr/build/toastr.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/toastr-2.1.4.min.css", {
    path: require.resolve("toastr/build/toastr.min.css"),
    contentType: "text/css; charset=utf-8",
  }],
  ["/preview-assets/zod-3.24.2.umd.js", {
    path: join(zodLibRoot, "index.umd.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
  ["/preview-assets/ejs-3.1.10.min.js", {
    path: join(ejsRoot, "ejs.min.js"),
    contentType: "text/javascript; charset=utf-8",
  }],
]);

const cache = new Map<string, Promise<Buffer>>();

export function isPreviewAssetPath(pathname: string): boolean {
  return PREVIEW_ASSETS.has(pathname);
}

export async function readPreviewAsset(pathname: string): Promise<{
  content: Buffer;
  contentType: string;
}> {
  const asset = PREVIEW_ASSETS.get(pathname);
  if (!asset) throw new Error(`Unknown preview asset: ${pathname}`);
  let pending = cache.get(pathname);
  if (!pending) {
    pending = readFile(asset.path);
    cache.set(pathname, pending);
  }
  return { content: await pending, contentType: asset.contentType };
}
