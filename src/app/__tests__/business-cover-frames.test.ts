import { after, between, source } from '@/lib/__tests__/source';

/**
 * The owner-side business photos go through the one frame that knows how to
 * wait (components/ui/remote-image), and each site branches on whether a
 * photo EXISTS rather than on whether its URL has come back.
 *
 * Source scans, because these three screens need most of the app mounted to
 * render: My business reads eleven queries, the post composer seeds itself
 * from storage, and the signup preview is step twelve of thirteen. What is
 * pinned is the shape of the call site, which is where each of them went
 * wrong: `cover.data ? <Image/> : <glyph>` says "no photo" for the whole of
 * a signing round trip, and a bare `<Image>` draws nothing at all while the
 * bytes download and nothing forever if they fail.
 */

const MY_BUSINESS = 'src/app/(tabs)/my-business.tsx';
const POST = 'src/app/business-post.tsx';
const SIGNUP = 'src/app/business-signup.tsx';

describe('the My business hero', () => {
  const code = source(MY_BUSINESS);

  it('keeps the public cover read the dashboard test pins, and pairs it with the cache key', () => {
    expect(code).toContain('useBusinessPhotoUrl(detail?.photos[0]?.storage_path ?? null)');
    expect(code).toContain('photoSourceState(cover, coverPath)');
  });

  it('branches on the storage path, and gives the band back only when the signing fails', () => {
    expect(code).toContain('const coverComing = coverPath != null && !cover.isError;');
    const hero = between(code, '{coverComing ? (', 'CATEGORY_ICON[business.category]');
    expect(hero).toContain('<RemoteImage');
    expect(hero).toContain('source={coverState.source}');
    expect(hero).toContain('pending={coverState.pending}');
    expect(hero).toContain('style={StyleSheet.absoluteFill}');
    // The scrim still rides over the photo for the status bar.
    expect(hero).toContain('<LinearGradient');
    expect(code).not.toContain('{cover.data ? (');
  });

  it('draws no bare Image for a remote photo', () => {
    expect(code).not.toContain("from 'expo-image'");
  });
});

describe('the photo on a business post', () => {
  const code = source(POST);

  it('waits in its frame with the chips still drawn over it', () => {
    const field = after(code, 'function PostPhotoField(');
    const frame = between(field, '<RemoteImage', "'Removed' : 'In review'");
    expect(frame).toContain('source={source}');
    expect(frame).toContain('pending={pending}');
    expect(frame).toContain('style={styles.photoFill}');
    expect(field).toContain('photoSourceState(useBusinessPhotoUrl(path), path)');
    expect(code).not.toContain("from 'expo-image'");
  });
});

describe('the listing preview on the sign-up review step', () => {
  const code = source(SIGNUP);

  it('says "No photo yet" only once that is known', () => {
    const preview = after(code, 'function ListingPreview(');
    expect(preview).toContain('photoSourceState(useBusinessPhotoUrl(coverPath), coverPath)');
    const frame = between(preview, '<RemoteImage', '/>');
    expect(frame).toContain('pending={cover.pending}');
    expect(frame).toContain('No photo yet');
    expect(frame).toContain('fallback={');
    expect(code).not.toContain("from 'expo-image'");
  });
});
