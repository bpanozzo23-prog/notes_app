import { SearchHighlight } from "./nodes/SearchHighlight.js";
import Image from "./nodes/Image.js";
import { ImagePlaceholders } from "./imageInsertion.js";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Document from "@tiptap/extension-document";
import Callout, { CALLOUT_TYPES } from "./nodes/Callout.js";
import Divider, { DIVIDER_STYLES } from "./nodes/Divider.js";
import LineSpacing, { LINE_SPACINGS } from "./nodes/LineSpacing.js";
import { Collapsible, CollapsibleListItem } from "./nodes/Collapsible.js";
import { STARTER_HIGHLIGHT_COLORS } from "./formatting.js";

export const extensions = [
  StarterKit.configure({
    document: false,
    horizontalRule: false,
    listItem: false,
    trailingNode: { notAfter: ["callout"] },
    heading: { levels: [1, 2, 3] },
    link: {
      protocols: ["note"], openOnClick: false, autolink: false,
      isAllowedUri: (uri) => /^(https:|mailto:|note:)/i.test(uri) && !/[\u0000-\u0020\u007f]/.test(uri),
    },
  }),
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  Document.extend({ content: "(block | callout)+" }),
  Callout, Divider, LineSpacing, Image, ImagePlaceholders,
  TaskList,
  TaskItem.configure({ nested: true }),
  CollapsibleListItem, Collapsible, SearchHighlight,
];

export const SUPPORTED_HTML_SAMPLES = [
  '<img data-file="sample-image" width="480" height="270" alt="">',
  ...STARTER_HIGHLIGHT_COLORS.map(({ color }) => `<p><mark data-color="${color}" style="background-color: ${color}; color: inherit">Highlight</mark></p>`),
  ...LINE_SPACINGS.flatMap((value) => ["p", "h2"].map((tag) => `<${tag} style="line-height: ${value}">Spacing</${tag}>`)),
  ...CALLOUT_TYPES.map((type) => `<div data-callout="${type}"><h2>Heading</h2><ul><li><p>Item</p></li></ul></div>`),
  ...DIVIDER_STYLES.slice(1).map((style) => `<hr data-style="${style}">`),
  "<p>Paragraph</p>",
  "<h1>Heading one</h1>", "<h2>Heading two</h2>", "<h3>Heading three</h3>",
  "<p><strong>Bold</strong></p>", "<p><em>Italic</em></p>", "<p><u>Underline</u></p>",
  "<p><s>Strike</s></p>", "<p><mark>Highlight</mark></p>",
  '<p><span style="color: #dc2626">Colour</span></p>',
  '<p><span style="font-size: 17pt">Size</span></p>',
  '<p><span style="font-family: serif">Font</span></p>',
  '<p><span style="background-color: #fde68a">Background</span></p>',
  '<p><span style="line-height: 2">Line height</span></p>',
  "<ul><li><p>Bullet</p><ul><li><p>Nested</p></li></ul></li></ul>",
  '<ol start="3"><li><p>Numbered</p></li></ol>',
  '<ul><li data-collapsed="true"><p>Collapsed</p><ul><li><p>Hidden</p></li></ul></li></ul>',
  '<ol><li data-collapsed="true"><p>Collapsed</p><ol><li><p>Hidden</p></li></ol></li></ol>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-collapsed="true"><p>Collapsed task</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Hidden task</p></li></ul></li></ul>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Nested task</p></li></ul></li></ul>',
  "<blockquote><p>Quote</p></blockquote>", "<hr>",
  "<p><code>Inline code</code></p>", '<pre><code class="language-js">const n = 1;</code></pre>',
  "<p>Hard<br>break</p>",
  '<p><a href="https://example.com">Web link</a></p>',
  '<p><a href="mailto:owner@example.com">Mail link</a></p>',
  '<p><a href="note:12345678-1234-4234-8234-123456789abc">Note link</a></p>',
];
