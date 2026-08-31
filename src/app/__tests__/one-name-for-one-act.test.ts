import fs from 'node:fs';
import path from 'node:path';

/**
 * One name for one act: the verb is "say hi" and the noun is "first message".
 *
 * "Hello" is internal jargon that leaked out of the code comments into
 * user-facing strings, worst on the pin form where "No hello to answer" sat
 * against "They send a hello and you decide" - the screen where the choice
 * decides whether strangers can walk into your chat, unreadable to a
 * non-native speaker. The identifiers keep the jargon (usePushPrimer's
 * 'hello-sent' reason, helloCapped, the sent-hello row); only the words a
 * person reads are held here.
 */
const SRC = path.join(__dirname, '..', '..');

const stripped = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every string literal and every run of JSX text, comments already gone. */
function readableText(code: string): string[] {
  const literals = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = code.match(/>[^<>{}]+</g) ?? [];
  return [...literals, ...jsxText];
}

/** The two spellings that are not the noun: an email placeholder, and the
 *  PrimerReason literal a test elsewhere pins. */
const allowed = (text: string): boolean => /hello@|hello-sent/i.test(text);

it('never shows a person the word "hello"', () => {
  const offenders = walk(SRC).flatMap((file) => {
    const hits = readableText(stripped(fs.readFileSync(file, 'utf8'))).filter(
      (text) => /hello/i.test(text) && !allowed(text)
    );
    return hits.length > 0 ? [{ file: path.relative(SRC, file), hits }] : [];
  });
  expect(offenders).toEqual([]);
});
