import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type Column } from './data-table';

type Row = { id: string; name: string };
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', sortable: true }];
const rows: Row[] = [{ id: '1', name: 'Bole ↔ Merkato' }];

describe('DataTable', () => {
  it('renders skeleton rows while loading', () => {
    const { container } = render(<DataTable columns={columns} rows={[]} loading />);
    expect(container.querySelectorAll('[aria-hidden]').length).toBeGreaterThan(0);
  });

  it('renders row data when loaded', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText('Bole ↔ Merkato')).toBeInTheDocument();
  });

  it('disables Next when no cursor and Prev when hasPrev is false', () => {
    render(<DataTable columns={columns} rows={rows} hasPrev={false} />);
    expect(screen.getByText('Prev').closest('button')).toBeDisabled();
    expect(screen.getByText('Next').closest('button')).toBeDisabled();
  });

  it('calls onSort with column key', () => {
    const onSort = vi.fn();
    render(<DataTable columns={columns} rows={rows} onSort={onSort} />);
    fireEvent.click(screen.getByText('Name'));
    expect(onSort).toHaveBeenCalledWith('name');
  });
});
