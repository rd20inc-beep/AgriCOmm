import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Accounting › Rates — month-end FX revaluation panel (G-7): defaults to last
 * month and offers Preview; the history lists past runs with their status.
 */
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [{ id: 1, month_end: '2026-09-30', rate: 281.5, total_unrealised_pkr: -1250, status: 'posted' }] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../accounting/api/services', () => ({ accountingApi: {} }));

const { default: FxRevaluationPanel, lastMonth } = await import('../components/FxRevaluationPanel');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('FX revaluation panel', () => {
  it('lastMonth is the month before today (year wrap included)', () => {
    expect(lastMonth(new Date(2026, 9, 9))).toBe('2026-09');
    expect(lastMonth(new Date(2027, 0, 15))).toBe('2026-12');
  });

  it('renders the month picker, Preview action and the history', () => {
    const html = renderToStaticMarkup(<FxRevaluationPanel />);
    expect(html).toContain('data-action="fx-revaluation-preview"');
    expect(html).toContain('type="month"');
    const t = text(html);
    expect(t).toContain('Revalue month (USD)');
    expect(t).toMatch(/281\.50/);
    expect(t).toContain('posted');
  });
});
