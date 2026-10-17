const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseJsonc, themeCss } = require('./theme');

let message = { css: '' };  // what the renderer gets: { css, dark } (dark only when painting a chosen theme)

const chosenTheme = () => vscode.workspace.getConfiguration('themedMarkdownNotebookRender').get('theme');
// a chosen theme paints the cell with its own background only when asked; else only text colours change
const paints = () => !!chosenTheme() && vscode.workspace.getConfiguration('themedMarkdownNotebookRender').get('paintBackground');

function themeId() {
  const chosen = chosenTheme();
  if (chosen) return chosen;
  const cfg = vscode.workspace.getConfiguration('workbench');
  if (vscode.workspace.getConfiguration('window').get('autoDetectColorScheme')) {
    const kind = vscode.window.activeColorTheme.kind;
    const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    return cfg.get(dark ? 'preferredDarkColorTheme' : 'preferredLightColorTheme');
  }
  return cfg.get('colorTheme');
}

function themeFile(id) {
  for (const ext of vscode.extensions.all)
    for (const t of ext.packageJSON.contributes?.themes ?? [])
      if (t.id === id || t.label === id) return path.join(ext.extensionPath, t.path);
}

// tokenColors and colors of a theme file and the themes it includes, base first.
function loadTheme(file) {
  const theme = parseJsonc(fs.readFileSync(file, 'utf8'));
  const base = theme.include ? loadTheme(path.join(path.dirname(file), theme.include)) : { rules: [], colors: {} };
  // ponytail: tokenColors given as a path to a .tmTheme (plist) are skipped, parse plist if such a theme matters
  return {
    rules: Array.isArray(theme.tokenColors) ? base.rules.concat(theme.tokenColors) : base.rules,
    colors: { ...base.colors, ...theme.colors },
    type: theme.type ?? base.type,
  };
}

function refresh() {
  const id = themeId(), paint = paints();
  let theme = { rules: [], colors: {} };
  try {
    const file = themeFile(id);
    if (file) theme = loadTheme(file);
    else vscode.window.showWarningMessage(`Themed Markdown: no installed theme named "${id}".`);
  } catch (e) {
    console.error(`themed-markdown-notebook-render: cannot read theme ${id}:`, e);
  }
  // user's customizations apply on top, as in the editor
  const custom = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations') ?? {};
  const rules = theme.rules.concat(custom.textMateRules ?? [], custom[`[${id}]`]?.textMateRules ?? []);
  const customColors = vscode.workspace.getConfiguration('workbench').get('colorCustomizations') ?? {};
  const css = themeCss(rules, { ...theme.colors, ...customColors, ...customColors[`[${id}]`] }, paint);
  message = { css, dark: paint && theme.type ? theme.type === 'dark' || theme.type === 'hc' : undefined };
}

// Gear menu on the extension's page: pick the theme for notebook markdown from the installed ones.
async function selectTheme() {
  const config = vscode.workspace.getConfiguration('themedMarkdownNotebookRender');
  const current = config.get('theme');
  const themes = vscode.extensions.all.flatMap(ext => (ext.packageJSON.contributes?.themes ?? []).map(t => ({
    label: t.id ?? t.label,
    description: t.uiTheme === 'vs' || t.uiTheme === 'hc-light' ? 'light' : 'dark',
  })));
  themes.sort((a, b) => a.label.localeCompare(b.label));
  const follow = { label: 'Follow active theme', description: vscode.workspace.getConfiguration('workbench').get('colorTheme') };
  const isCurrent = i => (i === follow ? !current : i.label === current);
  const items = [follow, { kind: vscode.QuickPickItemKind.Separator, label: 'installed themes' }, ...themes]
    .map(i => (isCurrent(i) ? { ...i, detail: '$(check) current' } : i));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Theme for Markdown cells in notebooks' });
  if (pick) await config.update('theme', pick === follow ? undefined : pick.label, vscode.ConfigurationTarget.Global);
}

function activate(context) {
  refresh();
  const messaging = vscode.notebooks.createRendererMessaging('wiertmir.themed-markdown-notebook-render');
  const update = () => { refresh(); messaging.postMessage(message); };
  context.subscriptions.push(
    vscode.commands.registerCommand('themedMarkdownNotebookRender.selectTheme', selectTheme),
    messaging.onDidReceiveMessage(({ editor }) => messaging.postMessage(message, editor)),  // renderer asks when it loads
    vscode.window.onDidChangeActiveColorTheme(update),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('workbench.colorTheme') || e.affectsConfiguration('themedMarkdownNotebookRender') || e.affectsConfiguration('editor.tokenColorCustomizations') || e.affectsConfiguration('workbench.colorCustomizations')) update();
    }),
  );
}

module.exports = { activate };
