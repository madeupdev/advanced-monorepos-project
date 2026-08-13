import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';

export function createTarGzip(entries) {
  return new Promise((resolve, reject) => {
    const archive = pack();
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.once('error', reject);
    archive.once('end', () => resolve(gzipSync(Buffer.concat(chunks))));
    for (const entry of entries) {
      const contents = Buffer.from(entry.contents ?? '');
      archive.entry(
        {
          name: entry.name,
          type: entry.type ?? 'file',
          mode: entry.mode ?? 0o644,
          size: contents.length,
          linkname: entry.linkname,
          mtime: new Date(0),
          uid: 0,
          gid: 0,
        },
        contents,
      );
    }
    archive.finalize();
  });
}
