const EXTENSION_CONFIG_PATTERN = /^extensions\/ext-([A-Za-z0-9_-]*)\.json$/;

export const EXTENSIONS_DIRECTORY = "extensions";

export function extensionConfigPath(extensionKey: string): string {
  const encoded = Buffer.from(extensionKey, "utf8").toString("base64url");
  return `${EXTENSIONS_DIRECTORY}/ext-${encoded}.json`;
}

export function extensionKeyFromConfigPath(path: string): string | undefined {
  const match = EXTENSION_CONFIG_PATTERN.exec(path);
  if (!match) return undefined;
  const extensionKey = Buffer.from(match[1] ?? "", "base64url").toString("utf8");
  return extensionConfigPath(extensionKey) === path ? extensionKey : undefined;
}
