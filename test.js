// node test.js
const assert = require('assert');
const { parseJsonc, resolve, themeCss } = require('./theme');

assert.deepStrictEqual(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1, 2,], }'), { a: 'x//y', b: [1, 2] });

const rules = [
  { scope: 'markup.heading', settings: { foreground: '#111', fontStyle: 'bold' } },
  { scope: ['entity.name.section', 'x'], settings: { foreground: '#222' } },
  { scope: 'markup.bold, markup.italic', settings: { fontStyle: '' } },
  { scope: 'text.html.markdown markup.inline.raw', settings: { foreground: '#333' } },
  { scope: 'keyword', settings: { foreground: '#444' } },
  { scope: 'keyword.control', settings: { foreground: '#555' } },
  { scope: 'keyword.control', settings: { foreground: '#666' } },
];
const h1 = ['entity.name.section.markdown', 'heading.1.markdown', 'markup.heading.markdown'];
assert.strictEqual(resolve(rules, h1, 'foreground'), '#222');            // innermost scope wins
assert.strictEqual(resolve(rules, h1, 'fontStyle'), 'bold');             // per property, from the outer scope
assert.strictEqual(resolve(rules, ['markup.bold.markdown'], 'fontStyle'), '');
assert.strictEqual(resolve(rules, ['markup.inline.raw.string.markdown', 'text.html.markdown'], 'foreground'), '#333');
assert.strictEqual(resolve(rules, ['markup.inline.raw.string.markdown'], 'foreground'), undefined);  // parent missing

// parent selectors pick per level, as Tokyo Night does for headings
const levels = [1, 2].map(n => ({ scope: `heading.${n}.markdown entity.name`, settings: { foreground: `#${n}${n}${n}` } }));
const heading = n => ['entity.name.section.markdown', `heading.${n}.markdown`, 'markup.heading.markdown', 'text.html.markdown'];
assert.strictEqual(resolve(levels, heading(1), 'foreground'), '#111');
assert.strictEqual(resolve(levels, heading(2), 'foreground'), '#222');
// a parent selector beats a bare one of the same depth, whatever the order
assert.strictEqual(resolve([{ scope: 'markup.quote punctuation', settings: { foreground: '#a' } },
  { scope: 'punctuation', settings: { foreground: '#b' } }], ['punctuation.x', 'markup.quote'], 'foreground'), '#a');
assert.strictEqual(resolve([{ scope: 'markup.bold punctuation', settings: { foreground: '#a' } },
  { scope: 'punctuation', settings: { foreground: '#b' } }], ['punctuation.x', 'markup.list'], 'foreground'), '#b');
assert.strictEqual(resolve(rules, ['keyword.control'], 'foreground'), '#666');  // deeper selector, then later rule
assert.strictEqual(resolve(rules, ['keywords'], 'foreground'), undefined);      // segment, not string, prefix

const css = themeCss(rules);
assert.match(css, /#preview h1 \{ color: #222 !important; font-weight: bold !important/);
assert.match(css, /#preview strong, #preview b \{ font-weight: normal !important/);
assert.match(css, /#preview :not\(pre\) > code \{ color: #333/);
assert.doesNotMatch(css, /marker/);                                      // no rule, no CSS
const quote = themeCss([{ scope: 'punctuation.definition.quote', settings: { foreground: '#777' } }]);
assert.match(quote, /#preview blockquote \{ border-color: #777/);   // the `>` colours the quote bar
// table colours switch on only the parts a theme gives
assert.doesNotMatch(themeCss([]), /table/);
const table = themeCss([], { 'themedMarkdown.tableHeaderBackground': '#123', 'themedMarkdown.tableStripeBackground': '#456' });
assert.match(table, /#preview thead th \{ background: #123/);
assert.match(table, /tr:nth-child\(even\) \{ background: #456/);
assert.doesNotMatch(table, /border-radius/);                             // no tableBorder, grid unchanged
const grid = themeCss([], { 'themedMarkdown.tableBorder': '#aaa', 'themedMarkdown.tableInnerBorder': '#bbb' });
assert.match(grid, /border: 1px solid #aaa/);                                 // outline
assert.match(grid, /border-left: 1px solid #bbb !important; border-top: 1px solid #bbb/);  // inner grid
assert.match(themeCss([], { 'themedMarkdown.tableBorder': '#aaa' }), /border-left: 1px solid #aaa/);  // inner defaults to outer
assert.doesNotMatch(themeCss([]), /mark \{/);                                 // no colour, browser default
assert.match(themeCss([], { 'themedMarkdown.markBackground': '#ccc' }), /#preview mark \{ background: #ccc/);
// another theme than VS Code's paints the cell and re-points VS Code's colour variables
assert.doesNotMatch(themeCss([], { 'editor.background': '#fff' }), /#preview \{/);
const painted = themeCss([], { 'editor.background': '#fff', 'editor.foreground': '#000', 'textLink.foreground': '#00f', '[X]': { a: 1 } }, true);
assert.match(painted, /--vscode-textLink-foreground: #00f/);
assert.match(painted, /background: #fff !important/);
assert.match(painted, /color: #000 !important/);
assert.doesNotMatch(painted, /\[X\]/);                                        // per-theme customization blocks skipped
console.log('ok');
