import { readFile } from 'node:fs/promises';
import { babelParse, compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';

// Compile the real SFC (including its template), substituting only requested
// boundaries. The memory renderer exercises Vue lifecycle and button handlers
// without adding a DOM dependency or copying production handler logic.
async function evaluate(source, filename, mocks, resultName) {
  const ast = babelParse(source, { sourceType: 'module' });
  const names = [];
  const values = [];
  const removals = [];
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      const specifier = node.source.value;
      const module = mocks[specifier] ?? await import(specifier.startsWith('.') ? new URL(specifier, filename).href : specifier);
      for (const binding of node.specifiers) {
        names.push(binding.local.name);
        values.push(binding.type === 'ImportDefaultSpecifier' ? module.default
          : binding.type === 'ImportNamespaceSpecifier' ? module : module[binding.imported.name]);
      }
      removals.push([node.start, node.end]);
    } else if (node.type === 'ExportNamedDeclaration') {
      removals.push([node.start, node.declaration.start]);
    }
  }
  for (const [start, end] of removals.reverse()) source = source.slice(0, start) + source.slice(end);
  return new Function(...names, `${source}\nreturn ${resultName};`)(...values);
}

const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
  createElement: node,
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (element, text) => { element.text = text; },
  setElementText: (element, text) => { element.text = text; element.children = []; },
  parentNode: (element) => element.parent,
  nextSibling: (element) => element.parent?.children[element.parent.children.indexOf(element) + 1] || null,
  patchProp: (element, key, _previous, value) => { element.props[key] = value; },
  insert(element, parent, anchor) {
    if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, element);
    element.parent = parent;
  },
  remove(element) {
    if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
    element.parent = null;
  },
});
const textOf = (element) => element.type === '#comment' ? '' : String(element.text || '') + element.children.map(textOf).join('');
const descendants = (element) => [element, ...element.children.flatMap(descendants)];
export async function flushPage() { await new Promise((resolve) => setImmediate(resolve)); await nextTick(); }

export async function mountPage(filename, mocks, props = {}) {
  const { descriptor } = parse(await readFile(filename, 'utf8'), { filename: filename.pathname });
  const script = compileScript(descriptor, { id: filename.pathname, genDefaultAs: 'component' });
  const component = await evaluate(script.content, filename, mocks, 'component');
  const template = compileTemplate({
    source: descriptor.template.content, filename: filename.pathname, id: filename.pathname,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (template.errors.length) throw new Error(template.errors.join('\n'));
  component.render = await evaluate(template.code, filename, mocks, 'render');
  const root = node('root');
  const app = renderer.createApp(component, props);
  app.component('RouterLink', { props: ['to'], setup: (_, { slots }) => () => h('a', slots.default?.()) });
  app.mount(root);
  return {
    state: app._instance.setupState,
    text: () => textOf(root),
    button: (label) => descendants(root).find((element) => element.type === 'button' && textOf(element).trim() === label),
    unmount: () => app.unmount(),
  };
}
