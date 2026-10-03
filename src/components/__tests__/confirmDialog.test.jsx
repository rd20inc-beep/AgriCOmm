import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfirmDialog from '../ConfirmDialog';

/**
 * The point of replacing window.confirm is that the dialog can state the figure
 * and the consequence. These assert it actually does, because a prop quietly
 * dropped from the markup would look fine in review and show the user nothing.
 *
 * Static markup only — the test environment is node, with no DOM to click.
 */
const html = (props) => renderToStaticMarkup(<ConfirmDialog open {...props} />);

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<ConfirmDialog open={false} title="Reverse?" />)).toBe('');
  });

  it('states the title, the consequence and the amount', () => {
    const out = html({
      title: 'Reverse payment PAY-0007?',
      consequence: 'The payable goes back to outstanding and the bank balance is restored.',
      amount: 'Rs 221,000.00',
    });
    expect(out).toContain('Reverse payment PAY-0007?');
    expect(out).toContain('the bank balance is restored');
    expect(out).toContain('Rs 221,000.00');
  });

  it('omits the amount block when there is no figure to show', () => {
    expect(html({ title: 'Delete template?' })).not.toContain('Amount');
  });

  it('labels its own buttons', () => {
    const out = html({ title: 'Void?', confirmLabel: 'Void invoice', cancelLabel: 'Keep it' });
    expect(out).toContain('Void invoice');
    expect(out).toContain('Keep it');
  });

  it('offers a reason box only when one is asked for, and marks it optional', () => {
    expect(html({ title: 'X' })).not.toContain('textarea');
    expect(html({ title: 'X', reason: 'required' })).toContain('<textarea');
    expect(html({ title: 'X', reason: 'required' })).not.toContain('(optional)');
    expect(html({ title: 'X', reason: 'optional' })).toContain('(optional)');
  });

  it('blocks confirmation until a required reason is typed', () => {
    const attr = /disabled=""/g;
    // Empty on first render, so the confirm button must start disabled.
    expect((html({ title: 'X', reason: 'required' }).match(attr) || []).length).toBe(1);
    expect(html({ title: 'X', reason: 'optional' }).match(attr)).toBe(null);
    expect(html({ title: 'X' }).match(attr)).toBe(null);
  });

  it('disables both buttons while the action is running', () => {
    expect((html({ title: 'X', busy: true }).match(/disabled=""/g) || []).length).toBe(2);
  });

  it('is a modal dialog labelled by its own title', () => {
    const out = html({ title: 'X' });
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-labelledby="confirm-title"');
    expect(out).toContain('id="confirm-title"');
  });
});
