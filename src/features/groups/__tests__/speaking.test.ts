import fs from 'node:fs';
import path from 'node:path';

import { SPEAKING_OPTIONS } from '@/features/groups/speaking';

const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

describe('who may post, said the same way everywhere', () => {
  it('reads as a sentence, not a typo', () => {
    expect(SPEAKING_OPTIONS.map((o) => o.label)).toEqual(['Everyone', 'Only people I pick']);
  });

  it('is one constant with two importers, so the labels cannot drift', () => {
    // The pair used to be duplicated in both screens, and a label edited in
    // one place would have split the same control into two vocabularies.
    for (const screen of ['src/app/new-group.tsx', 'src/app/group/[id].tsx']) {
      const code = src(screen);
      expect(code).toContain("import { SPEAKING_OPTIONS } from '@/features/groups/speaking'");
      expect(code).not.toContain('const SPEAKING_OPTIONS');
    }
  });
});
