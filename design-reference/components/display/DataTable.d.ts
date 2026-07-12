/** Tabla de datos UNX — encabezado ordenable, hover, paginación y estado vacío. */
export interface DataTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  /** Alineación de la columna (encabezado y celdas); default 'left'. Usa 'right' para cifras */
  align?: 'left' | 'right' | 'center';
}
export interface DataTableProps {
  columns?: DataTableColumn[];
  /** Cada fila es un objeto cuyas claves coinciden con columns[].key; las celdas pueden ser nodos */
  rows?: Record<string, React.ReactNode>[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyText?: string;
  emptyAction?: React.ReactNode;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
