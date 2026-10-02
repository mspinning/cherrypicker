import { zip } from '../../shared/zip';

/** Served from client/chrome-extension (see assets in angular.json) */
const SOURCE = '/chrome-extension/';
const FILES = ['manifest.json', 'background.js', 'bridge.js', 'inbox-reader.js', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'];
const LINKEDIN_PATTERN = 'https://www.linkedin.com/*';

/** Folder the ZIP unpacks to; the install steps name it. */
export const EXTENSION_FOLDER = 'cherrypick-linkedin';

interface Manifest {
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
}

/**
 * The Chrome extension as a ZIP for "Load unpacked". Its bridge runs only on
 * the host this CRM is served from (any port), so the copy fits every installation.
 */
export async function packageExtension(): Promise<Blob> {
  const crmPattern = `${location.protocol}//${location.hostname}/*`;
  const files = await Promise.all(
    FILES.map(async (path) => {
      const response = await fetch(SOURCE + path, { cache: 'no-cache' });
      // Unknown paths fall back to index.html (Caddy, ng serve)
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error(`${path}: ${response.status}`);
      }
      return { path, data: new Uint8Array(await response.arrayBuffer()) };
    }),
  );

  const manifestFile = files.find((f) => f.path === 'manifest.json')!;
  const manifest = JSON.parse(new TextDecoder().decode(manifestFile.data)) as Manifest;
  manifest.host_permissions = [LINKEDIN_PATTERN, crmPattern];
  manifest.content_scripts[0].matches = [crmPattern];
  manifestFile.data = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  return zip(files.map((f) => ({ path: `${EXTENSION_FOLDER}/${f.path}`, data: f.data })));
}
