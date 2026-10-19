import { expect, it } from "vitest";
import { textLines, lineChanges, markCounts, effects } from "./diff.js";
import { retargetNoteLinks, extractNoteLinks } from "../lib/text.js";
it('retargets exactly href attributes, with shared entity decoding, whitespace and NOTE casing', () => {
  const html = `<p>note:old <a class='x' HREF = ' NOTE:ol&#100; ' target="_blank">note:old</a><a href=note:other>Other</a></p>`;
  expect(retargetNoteLinks(html, new Map([['old', 'a&"<>']]))).toBe(`<p>note:old <a class='x' href="note:a&amp;&quot;&lt;&gt;" target="_blank">note:old</a><a href=note:other>Other</a></p>`);
  expect(extractNoteLinks(retargetNoteLinks(html, new Map([['old', 'a&"<>']])))).toEqual(['a&"<>', 'other']);
});
it('splits hard breaks, keeps task state and normalises NFC and whitespace in keys only', () => {
  const result = textLines('<p>cafe\u0301  uno<br>dos</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done<br>More</p></li><li data-type="taskItem" data-checked="false"><p>Wait</p></li></ul><pre><code>code\nnext</code></pre>');
  expect(result.map((line) => line.key)).toEqual(['café uno', 'dos', '[x] Done', '[x] More', '[ ] Wait', 'code', 'next']);
  expect(result[0].text).toContain('cafe\u0301');
});
it.each(['See also:', 'Split into:'])('ignores only app-made %s lines', (label) => {
  expect(textLines(`<p>${label} <a href="note:a">A</a> · <a href="note:b"><strong>B</strong></a></p>`)).toEqual([]);
  expect(textLines(`<p>${label} my explanation <a href="note:a">A</a>.</p>`)).toHaveLength(1);
  expect(textLines(`<p>${label} <a href="note:a">A</a><br><a href="note:b">B</a></p>`)).toHaveLength(2);
  expect(textLines(`<p>${label} ordinary prose</p>`)).toHaveLength(1);
});
it('compares sets across all notes, retaining source titles, additions and task changes', () => {
  const before = [{ title: 'A', html: '<p>Same<br>Gone</p><p>Same</p>' }, { title: 'B', html: '<p>Same</p>' }];
  expect(lineChanges(before, [{ title: 'C', html: '<p>Same</p><p>New</p>' }])).toEqual({ missing: [{ from: 'A', text: 'Gone' }], added: [{ in: 'C', text: 'New' }] });
});
it('counts characters per mark and image/link occurrences', () => {
  expect(markCounts('<p><strong>abc<em>de</em></strong><u>fg</u></p>')).toEqual({ bold: 5, italic: 2, underline: 2 });
  expect(effects(['<img data-file="a"><img data-file="a">'], ['<img data-file="a">'])).toEqual([{ type: 'image-removed', id: 'a' }]);
});
