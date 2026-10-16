/**
 * a11y-lite — a minimal local stand-in for eslint-plugin-jsx-a11y (P5-14).
 *
 * jsx-a11y is not installed in this repo (no network installs in the build
 * pipeline), so the two checks that matter most for this codebase are here:
 *
 *  - click-events-have-key-events: an onClick on a non-interactive element
 *    (div, span, tr, td, li, p, img, h1-h6, section…) needs a keyboard
 *    equivalent (onKeyDown/onKeyUp) and to be focusable (tabIndex) — or be a
 *    decorative click-catcher marked role="presentation"/"none" or
 *    aria-hidden="true". `{...clickableProps(fn)}` (src/shared/utils/a11y.js)
 *    satisfies it. An onClick that only stops propagation is ignored.
 *  - label-has-associated-control: a <label> needs htmlFor, or must wrap its
 *    control (an input/select/textarea or a component).
 *
 * If jsx-a11y is added later, replace these with its recommended set.
 */

const NON_INTERACTIVE = new Set([
  'div', 'span', 'tr', 'td', 'th', 'li', 'ul', 'ol', 'p', 'img', 'section', 'article', 'header', 'footer',
  'main', 'aside', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'small', 'tbody', 'table', 'form', 'fieldset',
]);
const STOP_ONLY = /^\{\s*\(?\s*(\w+)\s*\)?\s*=>\s*\{?\s*\1\.stopPropagation\(\);?\s*\}?\s*\}$/;
const CONTROLS = new Set(['input', 'select', 'textarea', 'meter', 'output', 'progress']);

const elementName = (node) => (node.name && node.name.type === 'JSXIdentifier' ? node.name.name : null);
const attr = (node, name) => node.attributes.find((a) => a.type === 'JSXAttribute' && a.name && a.name.name === name);
const literal = (a) => {
  if (!a || !a.value) return a ? true : undefined;
  if (a.value.type === 'Literal') return a.value.value;
  if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type === 'Literal') return a.value.expression.value;
  return '<expr>';
};
const hasSpread = (node) => node.attributes.some((a) => a.type === 'JSXSpreadAttribute');

const clickEventsHaveKeyEvents = {
  meta: {
    type: 'problem',
    docs: { description: 'onClick on a non-interactive element needs keyboard support' },
    messages: {
      noKey: '<{{name}}> has onClick but no keyboard equivalent. Use a <button>/<Link>, or spread clickableProps(fn) (onKeyDown + tabIndex), or mark a decorative backdrop role="presentation".',
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode || context.getSourceCode();
    return {
      JSXOpeningElement(node) {
        const name = elementName(node);
        if (!name || !NON_INTERACTIVE.has(name)) return;
        const onClick = attr(node, 'onClick');
        if (!onClick) return;
        const role = literal(attr(node, 'role'));
        if (role === 'presentation' || role === 'none') return;
        const hidden = literal(attr(node, 'aria-hidden'));
        if (hidden === true || hidden === 'true') return;
        // `onClick={(e) => e.stopPropagation()}` on a panel is not an action.
        if (onClick.value && STOP_ONLY.test(source.getText(onClick.value))) return;
        const key = attr(node, 'onKeyDown') || attr(node, 'onKeyUp') || attr(node, 'onKeyPress');
        const focusable = attr(node, 'tabIndex');
        if (key && focusable) return;
        if (hasSpread(node)) return; // the spread may carry them (clickableProps)
        context.report({ node, messageId: 'noKey', data: { name } });
      },
    };
  },
};

function wrapsControl(jsxElement) {
  for (const child of jsxElement.children || []) {
    if (child.type !== 'JSXElement') {
      if (child.type === 'JSXExpressionContainer' && child.expression && child.expression.type !== 'JSXEmptyExpression') {
        // {cond && <input/>} / {render()} — can't see inside reliably; accept a JSX element inside.
        const e = child.expression;
        if (e.type === 'JSXElement' && wrapsControl({ children: [e] })) return true;
        if (e.type === 'LogicalExpression' && e.right && e.right.type === 'JSXElement' && wrapsControl({ children: [e.right] })) return true;
      }
      continue;
    }
    const n = child.openingElement.name;
    const nm = n.type === 'JSXIdentifier' ? n.name : (n.type === 'JSXMemberExpression' ? 'Member' : '');
    if (CONTROLS.has(nm) || /^[A-Z]/.test(nm)) return true;
    if (wrapsControl(child)) return true;
  }
  return false;
}

const labelHasAssociatedControl = {
  meta: {
    type: 'problem',
    docs: { description: '<label> must be tied to a control' },
    messages: {
      noControl: '<label> is not tied to a control. Add htmlFor (useId) matching the control id, wrap the control, or use <FormField>.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const open = node.openingElement;
        if (elementName(open) !== 'label') return;
        if (attr(open, 'htmlFor') || hasSpread(open)) return;
        if (wrapsControl(node)) return;
        context.report({ node: open, messageId: 'noControl' });
      },
    };
  },
};

export default {
  meta: { name: 'a11y-lite', version: '1.0.0' },
  rules: {
    'click-events-have-key-events': clickEventsHaveKeyEvents,
    'label-has-associated-control': labelHasAssociatedControl,
  },
};
