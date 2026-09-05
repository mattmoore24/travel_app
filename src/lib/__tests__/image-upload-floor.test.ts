/**
 * The resolution floor under a photo that is going to fill a frame.
 *
 * The bug this closes is quiet: `sourceWidth` read the width and threw the
 * height away, so the only question ever asked of a picked file was "is it
 * bigger than 1440" — and a 320px picture saved out of a chat app answers
 * that the same way a perfect photo does. It went through untouched and was
 * stretched to nearly four times its width in a hero, and the person who
 * uploaded it saw the same soft image on their own profile and was told
 * nothing.
 *
 * Three properties, and the third matters as much as the first two: a file
 * whose size cannot be read must still upload. An unreadable size is a
 * property of the phone, not of the photo, and blocking there would turn a
 * soft picture into no picture at all.
 */
import { after } from '@/lib/__tests__/source';
import fs from 'node:fs';
import path from 'node:path';

import { Image } from 'react-native';

import { HERO_MIN_SHORT_EDGE, isPhotoTooSmall, processAndUploadImage } from '@/lib/image-upload';

const mockResize = jest.fn();
const mockUpload = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const context: Record<string, unknown> = {
        resize: (...args: unknown[]) => {
          mockResize(...args);
          return context;
        },
        renderAsync: () =>
          Promise.resolve({ saveAsync: () => Promise.resolve({ uri: 'file:///out.jpg' }) }),
      };
      return context;
    },
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown) => {
          mockUpload(bucket, path, body);
          return Promise.resolve({ error: null });
        },
      }),
    },
  },
}));

/** Answer `Image.getSize` with a size, or with a failure when given null. */
function reports(size: { width: number; height: number } | null) {
  jest
    .spyOn(Image, 'getSize')
    .mockImplementation((_uri: string, onSuccess, onFailure): void | Promise<void> => {
      if (size == null) {
        onFailure?.(new Error('could not read that file'));
        return;
      }
      onSuccess?.(size.width, size.height);
    });
}

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  ) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a photo that has to fill a frame', () => {
  it('refuses a 400x1200 crop, which passes a width test and fails a hero', () => {
    // The exact shape the old width-only check could not see: wider than the
    // floor on one edge, a quarter of a hero on the other.
    reports({ width: 400, height: 1200 });
    return processAndUploadImage('profile-photos', 'u1', 'file:///small.jpg', {
      fillsAFrame: true,
    }).then(
      () => {
        throw new Error('the upload should have been refused');
      },
      (error: unknown) => {
        expect(isPhotoTooSmall(error)).toBe(true);
        expect((error as Error).message).toBe(
          'That one is a bit small to fill the frame. Something straight off your camera will look sharper.'
        );
        expect(mockUpload).not.toHaveBeenCalled();
      }
    );
  });

  it('accepts a 520x520 photo, because a real crop off an older phone lands here', async () => {
    // 512 and not 640 is the whole of this assertion. Refusing a real
    // photograph is worse than accepting a soft one.
    expect(HERO_MIN_SHORT_EDGE).toBe(512);
    reports({ width: 520, height: 520 });
    await expect(
      processAndUploadImage('profile-photos', 'u1', 'file:///ok.jpg', { fillsAFrame: true })
    ).resolves.toMatch(/^u1\/[0-9a-f]{32}\.jpg$/);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // Under 1440 on the long edge, so nothing is enlarged.
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('uploads a file whose size cannot be read, and resizes it as it always did', async () => {
    reports(null);
    await expect(
      processAndUploadImage('profile-photos', 'u1', 'file:///unknown.jpg', { fillsAFrame: true })
    ).resolves.toMatch(/^u1\//);
    expect(mockResize).toHaveBeenCalledWith({ width: 1440 });
  });
});

describe('a photo that does not fill a frame', () => {
  it('takes a small picture into a chat, because a chat photo is not a hero', async () => {
    // A screenshot of a ticket or a map is legitimately small and renders at
    // bubble width. The floor is off by default precisely so this path never
    // gets the frame sentence, which would be honest-sounding and wrong.
    reports({ width: 320, height: 240 });
    await expect(processAndUploadImage('chat-photos', 'u1', 'file:///ticket.png')).resolves.toMatch(
      /^u1\//
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});

/**
 * The floor is worth nothing until somebody passes the flag.
 *
 * `fillsAFrame` is off by default and correctly so - the same pipeline
 * carries chat and group photos, where a small screenshot of a ticket or a
 * map is legitimate and refusing it would put an honest-sounding sentence
 * that is wrong in front of somebody. But a default-off option that no
 * caller ever sets is a feature that ships dark, which is exactly what the
 * batch before this one did with a whole edit screen.
 */
describe('the two callers the floor exists for', () => {
  const src = (file: string): string =>
    fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');

  it('a profile photo is held to it', () => {
    // It fills the card a stranger decides on.
    const code = src('src/features/profile/api.ts');
    const call = after(code, 'export async function uploadPhoto');
    expect(call.slice(0, call.indexOf('supabase'))).toContain('fillsAFrame: true');
  });

  it('a business photo is held to it', () => {
    // The first approved one becomes the cover, drawn at map-card size.
    const code = src('src/features/business/business-photos.tsx');
    expect(code).toContain('fillsAFrame: true');
  });

  it('a chat photo is NOT, and neither is a group photo', () => {
    // A screenshot of a ticket renders at bubble width and is fine there.
    expect(src('src/features/chat/api.ts')).not.toContain('fillsAFrame');
    expect(src('src/features/groups/api.ts')).not.toContain('fillsAFrame');
  });

  it('and neither is a verification selfie, which nobody but the worker sees', () => {
    expect(src('src/features/profile/api.ts')).not.toContain(
      'VERIFICATION_BUCKET, userId, localUri, {'
    );
  });
});
