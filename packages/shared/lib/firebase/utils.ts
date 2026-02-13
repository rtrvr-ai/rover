// utils/storageRefs.ts

export type ParsedStorageRef = {
  bucket?: string;
  storagePath: string; // decoded object path (no leading slash)
};

function stripLeadingSlash(s: string): string {
  return s.replace(/^\/+/, '');
}

export function parseGcsUri(gcsUri: string): ParsedStorageRef | null {
  // gs://bucket/path/to/object
  const m = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], storagePath: stripLeadingSlash(m[2]) };
}

export function parseFirebaseStorageUrl(urlStr: string): ParsedStorageRef | null {
  try {
    const url = new URL(urlStr);

    // 1) Firebase download URL:
    // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const bucketMatch = url.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!bucketMatch) return null;

      const bucket = bucketMatch[1];
      const encodedPath = bucketMatch[2];
      const decodedPath = decodeURIComponent(encodedPath);
      return { bucket, storagePath: stripLeadingSlash(decodedPath) };
    }

    // 2) Google Cloud Storage public/signed URL forms:
    // a) https://storage.googleapis.com/{bucket}/{object}
    if (url.hostname === 'storage.googleapis.com') {
      const parts = stripLeadingSlash(url.pathname).split('/');
      if (parts.length < 2) return null;
      const bucket = parts[0];
      const storagePath = decodeURIComponent(parts.slice(1).join('/'));
      return { bucket, storagePath: stripLeadingSlash(storagePath) };
    }

    // b) https://{bucket}.storage.googleapis.com/{object}
    if (url.hostname.endsWith('.storage.googleapis.com')) {
      const bucket = url.hostname.replace('.storage.googleapis.com', '');
      const storagePath = decodeURIComponent(stripLeadingSlash(url.pathname));
      if (!bucket || !storagePath) return null;
      return { bucket, storagePath: stripLeadingSlash(storagePath) };
    }

    return null;
  } catch {
    return null;
  }
}

export function parseAnyStorageRef(input: {
  gcsUri?: string;
  storageUrl?: string;
  downloadUrl?: string;
  storagePath?: string;
}): ParsedStorageRef | null {
  if (input.storagePath) {
    return { storagePath: stripLeadingSlash(input.storagePath) };
  }
  if (input.gcsUri) {
    const parsed = parseGcsUri(input.gcsUri);
    if (parsed) return parsed;
  }
  const url = input.storageUrl ?? input.downloadUrl;
  if (url) {
    const parsed = parseFirebaseStorageUrl(url);
    if (parsed) return parsed;
  }
  return null;
}

export function toGcsUri(bucket: string, storagePath: string): string {
  return `gs://${bucket}/${stripLeadingSlash(storagePath)}`;
}
