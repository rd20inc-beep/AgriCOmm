import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoleOptions } from '../pages/admin/UsersRolesTab';

// P1-17 / ADM-02: the role picker lists the roles the database has (names and
// ids from GET /api/admin/roles-with-permissions), not a hard-coded 1–7 list.
const render = (props) => renderToStaticMarkup(<select defaultValue=""><RoleOptions {...props} /></select>);

describe('RoleOptions', () => {
  it('renders DB role names with their DB ids', () => {
    const html = render({
      roles: [{ id: 1, name: 'Super Admin' }, { id: 9, name: 'Owner' }, { id: 12, name: 'Read-Only Auditor' }, { id: 14, name: 'Mill Operator' }],
    });
    expect(html).toContain('<option value="9">Owner</option>');
    expect(html).toContain('<option value="12">Read-Only Auditor</option>');
    expect(html).toContain('<option value="14">Mill Operator</option>');
    expect(html).not.toContain('Documentation Officer');
    expect(html).not.toContain('>Viewer<');
    expect(html).toContain('Select a role');
  });

  it('shows loading / error placeholders and no fake roles', () => {
    expect(render({ roles: [], loading: true })).toContain('Loading roles');
    const err = render({ roles: [], error: true });
    expect(err).toContain('Could not load roles');
    expect((err.match(/<option/g) || []).length).toBe(1);
  });
});
