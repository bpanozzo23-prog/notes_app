import { expect, it } from "vitest";
import { diffNoteBodies, assembleBody } from "./diff.js";
import { normalizeBody } from "./html.js";
const changes = (a, b) => diffNoteBodies(a, b).filter((run) => run.id);
it("identical bodies have no changes", () => expect(changes('<p>Hello</p>', '<p>Hello</p>')).toEqual([]));
it.each([0, 1, 3])("inserts, deletes and replaces at block %i", (index) => {
  const blocks = ['<p>A</p>', '<p>B</p>', '<p>C</p>'];
  for (const remove of [0, 1]) for (const add of [[], ['<h2>New</h2>']]) {
    const next = [...blocks]; next.splice(index, remove, ...add);
    const runs = diffNoteBodies(blocks.join(''), next.join(''));
    expect(assembleBody(blocks.join(''), runs, runs.map((run) => run.id))).toBe(normalizeBody(next.join('')));
    expect(assembleBody(blocks.join(''), runs, [])).toBe(blocks.join(''));
  }
});
it("all eight partial combinations of three separate changes remain valid", () => {
  const before = '<p>a</p><p>same 1</p><p>b</p><p>same 2</p><p>c</p>', after = '<h2>A</h2><p>same 1</p><p>B</p><p>same 2</p><p>C</p>';
  const runs = diffNoteBodies(before, after), ids = runs.filter((run) => run.id).map((run) => run.id);
  expect(ids).toHaveLength(3);
  for (let mask = 0; mask < 8; mask++) {
    const html = assembleBody(before, runs, ids.filter((_, index) => mask & (1 << index)));
    expect(normalizeBody(html)).toBe(html);
  }
});
it("one list item fix is one change with word differences", () => {
  const [change] = changes('<ul><li><p>tu</p></li><li><p>hola</p></li></ul>', '<ul><li><p>tú</p></li><li><p>hola</p></li></ul>');
  expect(change.words).toContainEqual(expect.objectContaining({ removed: true, value: 'tu' }));
  expect(change.words).toContainEqual(expect.objectContaining({ added: true, value: 'tú' }));
});
it("counts removed image occurrences inside their callout, including duplicates", () => {
  const [change] = changes('<div data-callout="note"><p>Same</p><img data-file="a"><img data-file="a"></div>', '<div data-callout="note"><p>Same</p><img data-file="a"></div>');
  expect(change.effects).toEqual([{ type: 'image-removed', id: 'a' }]);
});
it("gives a standalone image its own change", () => {
  expect(changes('<p>a</p><img data-file="a"><p>b</p>', '<p>new</p>')).toHaveLength(3);
});
it("reports an unchanged-text link retarget, repeated links removed and full web addresses", () => {
  const [change] = changes('<p><a href="note:a">Here</a> <a href="note:a">Here</a></p>', '<p><a href="note:b">Here</a> Here <a href="https://example.com/path">Web</a></p>');
  expect(change.words.length).toBeGreaterThan(0);
  expect(change.effects).toEqual([{ type: 'link-retargeted', before: 'note:a', after: 'note:b' }, { type: 'link-removed', href: 'note:a' }, { type: 'web-link-added', href: 'https://example.com/path' }]);
  expect(changes('<p><a href="note:a">Here</a></p>', '<p><a href="note:b">Here</a></p>')[0].words).toEqual([]);
});
it("uses an empty paragraph for a fully deleted body and refuses mismatched source", () => {
  const runs = [{ id: 'body-1', before: ['<p>A</p>'], after: [] }];
  expect(assembleBody('<p>A</p>', runs, ['body-1'])).toBe('<p></p>');
  expect(() => assembleBody('<p>B</p>', runs, ['body-1'])).toThrow();
});

it("gives each neighbouring paragraph edited in place its own change, but keeps an uneven group together", () => {
  const paired = diffNoteBodies("<p>uno</p><p>dos</p><p>tres</p>", "<p>uno!</p><p>dos!</p><p>tres</p>").filter((run) => run.id);
  expect(paired.map((run) => [run.before.length, run.after.length])).toEqual([[1, 1], [1, 1]]);
  expect(assembleBody("<p>uno</p><p>dos</p><p>tres</p>", diffNoteBodies("<p>uno</p><p>dos</p><p>tres</p>", "<p>uno!</p><p>dos!</p><p>tres</p>"), [paired[1].id]))
    .toBe("<p>uno</p><p>dos!</p><p>tres</p>");
  // One paragraph split into two is a single change: there is no one-to-one pairing.
  const split = diffNoteBodies("<p>uno dos</p>", "<p>uno</p><p>dos</p>").filter((run) => run.id);
  expect(split.map((run) => [run.before.length, run.after.length])).toEqual([[1, 2]]);
});
