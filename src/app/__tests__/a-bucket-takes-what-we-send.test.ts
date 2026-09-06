import fs from 'node:fs';
import path from 'node:path';

/**
 * Every content type this repo uploads has to be one the buckets accept.
 *
 * 20260906110000 puts an allowed_mime_types allowlist on all five storage
 * buckets. Its first draft allowed image/jpeg alone, on the reasoning that
 * every upload in the APP goes through one function that encodes JPEG - which
 * is true, and was not the whole picture. scripts/seed-demo-travelers.mjs PUTs
 * image/png through the same storage path, and twelve of the sixteen objects
 * in the live profile-photos bucket are PNGs because of it.
 *
 * That mistake would have shipped silently. The seed's upload sits in a
 * try/catch that logs `::warning::photo ... skipped`, so a rejected type does
 * not fail the seed - it produces demo travelers with no photos and a map with
 * no avatar markers, while the script exits 0.
 *
 * A source scan, because the two facts that have to agree live in a SQL
 * migration and in JavaScript spread across three directories, and nothing at
 * runtime ever compares them.
 */
const REPO = path.join(__dirname, '..', '..', '..');

/** The types the migration lets in. */
function allowedTypes(): string[] {
  const sql = fs.readFileSync(
    path.join(REPO, 'supabase', 'migrations', '20260906110000_a_bucket_says_what_it_takes.sql'),
    'utf8'
  );
  const m = /allowed_mime_types = array\[([^\]]*)\]/.exec(sql);
  if (!m) throw new Error('no allowed_mime_types array in the bucket migration');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

/** Every content type this repo hands to storage, with where it came from. */
function typesWeSend(): { file: string; type: string }[] {
  const found: { file: string; type: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
      const code = fs.readFileSync(full, 'utf8');
      // Anchored to the STORAGE CALL, not to the file. The first cut of this
      // filtered by "does this file mention storage" and then took every
      // Content-Type in it, which dragged in seed-demo-travelers' REST calls
      // and reported application/json as a rejected upload type. A file-wide
      // scan answers a different question from the one being asked.
      const CALL = /\/storage\/v1\/object|storage\s*\.\s*from\([^)]*\)\s*\.\s*upload\(|\.upload\(/g;
      for (const call of code.matchAll(CALL)) {
        const at = call.index ?? 0;
        const window = code.slice(Math.max(0, at - 200), at + 500);
        for (const m of window.matchAll(/['"]?[Cc]ontent-?[Tt]ype['"]?\s*:\s*['"]([^'"]+)['"]/g)) {
          found.push({ file: path.relative(REPO, full), type: m[1] });
        }
      }
    }
  };
  for (const dir of ['src', 'scripts', 'supabase', 'e2e']) {
    const full = path.join(REPO, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return found.filter(
    (v, i) => found.findIndex((w) => w.file === v.file && w.type === v.type) === i
  );
}

describe('the buckets accept everything this repo uploads', () => {
  it('finds the uploaders at all', () => {
    // A walk that quietly finds nothing passes the assertion below it, which
    // is the whole failure mode this file exists to prevent.
    const sent = typesWeSend();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.map((s) => s.file)).toContain('src/lib/image-upload.ts');
    expect(sent.map((s) => s.file)).toContain('scripts/seed-demo-travelers.mjs');
  });

  it('allows every type any uploader sends', () => {
    const allowed = allowedTypes();
    const rejected = typesWeSend()
      .filter((s) => !allowed.includes(s.type))
      .map((s) => `${s.file} sends ${s.type}, which the buckets refuse`);
    // If this fails: either widen the migration or change the uploader. Do
    // NOT allowlist it here - the point is that the two agree.
    expect(rejected).toEqual([]);
  });

  it('never allows a type that can carry script', () => {
    // The exposure the allowlist closes is a signed URL served as something
    // executable, not "an image format we did not think of". jpeg and png
    // cannot carry script; svg+xml can, and html and js obviously do.
    const dangerous = allowedTypes().filter((t) => /svg|html|javascript|xml|\*/.test(t));
    expect(dangerous).toEqual([]);
  });
});
