import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';
const columns = [{ key: 'name', label: 'Record', render: (row: { id: string }) => row.id }] as const;
describe('DataTable', () => {
  it('exposes a labelled scroll region and responsive column labels', () => { render(<DataTable caption="Construction records" columns={columns} rows={[{ id: 'RFI-17' }]} rowKey={(row) => row.id} />); expect(screen.getByRole('region', { name: 'Construction records' })).toBeInTheDocument(); expect(screen.getByRole('cell', { name: 'RFI-17' })).toHaveAttribute('data-label', 'Record'); });
  it('explains an empty filtered view', () => { render(<DataTable caption="Construction records" columns={columns} rows={[]} rowKey={(row) => row.id} />); expect(screen.getByText('No records match the current view.')).toBeVisible(); });
});
