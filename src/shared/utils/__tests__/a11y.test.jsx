import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuleTester } from 'eslint';
import a11yLite from '../../../../eslint-rules/a11y-lite.js';
import FormField from '../../components/FormField';
import SupplierPicker from '../../../components/SupplierPicker';
import SearchSelect from '../../components/SearchSelect';
import { activateOnKey, clickableProps } from '../a11y';

describe('label association (P5-14)', () => {
  it('FormField ties the label to its control and announces hint + error', () => {
    const html = renderToStaticMarkup(
      <FormField label="Quantity (kg)" required hint="Net weight" error="Required">
        <input type="number" />
      </FormField>,
    );
    const forId = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`<input type="number" id="${forId}"`);
    expect(html).toContain(`aria-describedby="${forId}-hint ${forId}-error"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
  });

  it('FormField keeps an id the control already has', () => {
    const html = renderToStaticMarkup(<FormField label="Date"><input id="due" /></FormField>);
    expect(html).toContain('<label for="due"');
    expect(html).toContain('id="due"');
  });

  it('a picker label names its search box', () => {
    const html = renderToStaticMarkup(<SupplierPicker label="Supplier" value="" onChange={() => {}} suppliers={[]} />);
    const forId = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input id="${forId}" type="text"`));
  });

  it('SearchSelect without a visible label falls back to an aria-label', () => {
    const html = renderToStaticMarkup(<SearchSelect value="" onChange={() => {}} options={[]} placeholder="Search lot…" />);
    expect(html).toContain('aria-label="Search lot…"');
    const withId = renderToStaticMarkup(<SearchSelect id="lot" value="" onChange={() => {}} options={[]} placeholder="x" />);
    expect(withId).toContain('id="lot"');
    expect(withId).not.toContain('aria-label=');
  });
});

describe('keyboard activation for clickable rows', () => {
  it('Enter and Space on the row itself activate it', () => {
    const fn = vi.fn();
    const h = activateOnKey(fn);
    const row = {};
    const ev = (key, target = row) => ({ key, target, currentTarget: row, preventDefault: vi.fn() });
    h(ev('Enter')); h(ev(' '));
    expect(fn).toHaveBeenCalledTimes(2);
    h(ev('a'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('Enter on a button inside the row is left to that button', () => {
    const fn = vi.fn();
    const row = {};
    activateOnKey(fn)({ key: 'Enter', target: { tag: 'button' }, currentTarget: row, preventDefault: vi.fn() });
    expect(fn).not.toHaveBeenCalled();
  });

  it('clickableProps makes the element focusable', () => {
    const p = clickableProps(() => {}, { expanded: false, label: 'Open' });
    expect(p.tabIndex).toBe(0);
    expect(p['aria-expanded']).toBe(false);
    expect(p['aria-label']).toBe('Open');
  });
});

describe('a11y-lite eslint rules', () => {
  RuleTester.describe = describe;
  RuleTester.it = it;
  const tester = new RuleTester({
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  });

  tester.run('click-events-have-key-events', a11yLite.rules['click-events-have-key-events'], {
    valid: [
      '<button onClick={go}>x</button>',
      '<tr {...clickableProps(go)}>x</tr>',
      '<div onClick={go} onKeyDown={key} tabIndex={0}>x</div>',
      '<div className="backdrop" role="presentation" onClick={close} />',
      '<div aria-hidden="true" onClick={close} />',
      '<div onClick={(e) => e.stopPropagation()}>panel</div>',
      '<Card onClick={go} />',
    ],
    invalid: [
      { code: '<tr onClick={go}>x</tr>', errors: [{ messageId: 'noKey' }] },
      { code: '<div onClick={go} tabIndex={0}>x</div>', errors: [{ messageId: 'noKey' }] },
      { code: '<span onClick={() => { a(); b(); }}>x</span>', errors: [{ messageId: 'noKey' }] },
    ],
  });

  tester.run('label-has-associated-control', a11yLite.rules['label-has-associated-control'], {
    valid: [
      '<label htmlFor={id}>Name</label>',
      '<label><input type="checkbox" /> Keep</label>',
      '<label>Pick <SupplierPicker /></label>',
      '<label>{show && <input />}</label>',
    ],
    invalid: [
      { code: '<label className="x">Name</label>', errors: [{ messageId: 'noControl' }] },
    ],
  });
});
