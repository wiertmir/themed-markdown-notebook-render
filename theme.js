// Pure part: theme tokenColors -> CSS for notebook markdown cells. No vscode import, so test.js can run it in plain node.

// Rendered element -> TextMate scope stack the markdown grammar gives it in the editor, innermost first
// (the text.html.markdown root is added by themeCss).
const P = 'meta.paragraph.markdown';
const ELEMENTS = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n =>
    [`h${n}`, ['entity.name.section.markdown', `heading.${n}.markdown`, 'markup.heading.markdown']])),
  'strong, b': ['markup.bold.markdown', P],
  'em, i': ['markup.italic.markdown', P],
  'del, s': ['markup.strikethrough.markdown', P],
  ':not(pre) > code': ['markup.inline.raw.string.markdown', P],
  'pre code': ['markup.fenced_code.block.markdown'],
  'a': ['string.other.link.title.markdown', 'meta.link.inline.markdown', P],
  'blockquote': [P, 'markup.quote.markdown'],
  'li::marker': ['punctuation.definition.list.begin.markdown', 'markup.list.unnumbered.markdown'],
};

// Element -> scopes whose colour goes on its border: the `>` and `|` you see in the editor.
const BORDERS = {
  'blockquote': ['punctuation.definition.quote.begin.markdown', 'markup.quote.markdown'],
  'table, th, td': ['punctuation.separator.table.markdown', 'markup.table.markdown'],
  'hr': ['meta.separator.markdown'],
};

// JSON with comments and trailing commas, as theme files are.
function parseJsonc(text) {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '');
  return JSON.parse(noComments.replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, str, end) => str ?? end));
}

const prefixOf = (sel, scope) => scope === sel || scope.startsWith(sel + '.');

// Specificity of `selector` for stack[i] (stack innermost first), 0 if it doesn't match: like VS Code,
// its last part must match stack[i] and its parent parts the scopes around it, in order.
// Deeper last part wins, then more parent parts.
function score(selector, stack, i) {
  const parts = selector.trim().split(/\s+/);
  const last = parts.pop();
  if (!last || !prefixOf(last, stack[i])) return 0;
  let j = i + 1;
  for (const parent of parts.reverse()) {
    while (j < stack.length && !prefixOf(parent, stack[j])) j++;
    if (j++ >= stack.length) return 0;
  }
  return last.split('.').length * 100 + parts.length;
}

// Theme value of `prop` ('foreground' | 'fontStyle') for a scope stack, as the editor would pick it.
function resolve(rules, stack, prop) {
  for (let i = 0; i < stack.length; i++) {
    let best = 0, value;
    for (const rule of rules) {
      if (rule.settings?.[prop] === undefined || !rule.scope) continue;
      const selectors = Array.isArray(rule.scope) ? rule.scope : rule.scope.split(',');
      const s = Math.max(...selectors.map(sel => score(sel, stack, i)));
      if (s && s >= best) [best, value] = [s, rule.settings[prop]];  // later rule wins a tie
    }
    if (value !== undefined) return value;
  }
}

function declarations(fg, fontStyle) {
  const out = [];
  if (fg) out.push(`color: ${fg}`);
  if (fontStyle !== undefined) {
    const f = fontStyle.split(/\s+/);
    out.push(`font-weight: ${f.includes('bold') ? 'bold' : 'normal'}`,
      `font-style: ${f.includes('italic') ? 'italic' : 'normal'}`,
      `text-decoration: ${['underline', 'strikethrough'].filter(x => f.includes(x)).map(x => x === 'strikethrough' ? 'line-through' : x).join(' ') || 'none'}`);
  }
  return out;
}

const scoped = selector => selector.split(',').map(s => `#preview ${s.trim()}`).join(', ');

// Table look from optional theme colours (`colors` in the theme file, or workbench.colorCustomizations):
// themedMarkdown.tableBorder (outline and header line), .tableInnerBorder (grid inside, defaults to tableBorder),
// .tableHeaderBackground, .tableHeaderForeground, .tableStripeBackground.
// Each one present switches on its part; a theme without them keeps VS Code's plain grid.
function tableCss(colors) {
  const c = name => colors[`themedMarkdown.table${name}`];
  const outer = c('Border'), inner = c('InnerBorder') ?? outer;
  let css = '';
  if (outer) css += `#preview table { border-collapse: separate !important; border-spacing: 0; border: 1px solid ${outer} !important; border-radius: 6px; overflow: hidden; }
#preview th, #preview td { border: none !important; border-left: 1px solid ${inner} !important; border-top: 1px solid ${inner} !important; }
#preview tr > :first-child { border-left: none !important; }
#preview thead th { border-top: none !important; }
#preview thead + tbody > tr:first-child > td { border-top-color: ${outer} !important; }\n`;
  if (c('HeaderBackground')) css += `#preview thead th { background: ${c('HeaderBackground')} !important; }\n`;
  if (c('HeaderForeground')) css += `#preview thead th { color: ${c('HeaderForeground')} !important; }\n`;
  if (c('StripeBackground')) css += `#preview tbody tr:nth-child(even) { background: ${c('StripeBackground')} !important; }\n`;
  // <mark>: themedMarkdown.markBackground, else the browser's yellow
  const markBg = colors['themedMarkdown.markBackground'];
  if (markBg) css += `#preview mark { background: ${markBg} !important; border-radius: 3px; padding: 0 2px; }\n`;
  return css;
}

// A theme other than VS Code's also paints the cell: its background and text, and VS Code's --vscode-* colour
// variables re-pointed at its colours, so what VS Code styles inside the cell (inline code, links, errors) follows.
function paintCss(colors) {
  const vars = Object.entries(colors).filter(([k, v]) => typeof v === 'string' && /^[\w.-]+$/.test(k))
    .map(([k, v]) => `--vscode-${k.replace(/\./g, '-')}: ${v}`);
  const bg = colors['notebook.editorBackground'] ?? colors['editor.background'];
  const fg = colors['editor.foreground'] ?? colors.foreground;
  if (bg) vars.push(`background: ${bg} !important`, `box-shadow: 0 0 0 12px ${bg}`, 'border-radius: 1px');  // shadow pads without moving text
  if (fg) vars.push(`color: ${fg} !important`);
  return vars.length ? `#preview { ${vars.join('; ')}; }\n` : '';
}

function themeCss(rules, colors = {}, paint = false) {
  let css = paint ? paintCss(colors) : '';
  for (const [selector, scopes] of Object.entries(ELEMENTS)) {
    const stack = [...scopes, 'text.html.markdown'];
    const decls = declarations(resolve(rules, stack, 'foreground'), resolve(rules, stack, 'fontStyle'));
    if (decls.length) css += `${scoped(selector)} { ${decls.map(d => d + ' !important').join('; ')}; }\n`;
  }
  for (const [selector, scopes] of Object.entries(BORDERS)) {
    const fg = resolve(rules, [...scopes, 'text.html.markdown'], 'foreground');
    if (fg) css += `${scoped(selector)} { border-color: ${fg} !important; }\n`;
  }
  return css + tableCss(colors);
}

module.exports = { parseJsonc, resolve, themeCss };
