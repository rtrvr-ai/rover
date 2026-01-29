// utilities/table-analyzer.ts
import { winOf } from './dom-utilities.js';
import { hasElementTag, isHTMLNode } from './element-analysis.js';

export function inspectTableRow(table: HTMLTableElement, requestedCell: HTMLTableCellElement): boolean {
  const tableGrid = constructTableGrid(table);
  const { minY, maxY } = tableGrid.getCellBounds(requestedCell);
  return tableGrid
    .getRows()
    .slice(minY, maxY + 1)
    .some(row => row.some(isDataTableCell));
}

export function inspectTableColumn(table: HTMLTableElement, requestedCell: HTMLTableCellElement): boolean {
  const tableGrid = constructTableGrid(table);
  const { minX, maxX } = tableGrid.getCellBounds(requestedCell);
  return tableGrid.getRows().some(row => row.slice(minX, maxX + 1).some(isDataTableCell));
}

interface CellBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

class TableGrid {
  constructor(private cells: Array<Array<HTMLTableCellElement | undefined>> = []) {}

  get rowCount() {
    return this.cells.length;
  }

  get columnCount() {
    return Math.max(...this.cells.map(row => row.length));
  }

  getCellAt = (x: number, y: number): HTMLTableCellElement | undefined => this.getRowAt(y)[x];

  setCellAt = (x: number, y: number, element: HTMLTableCellElement) => {
    this.getRowAt(y)[x] = element;
  };

  getRowAt = (y: number): Array<HTMLTableCellElement | undefined> => {
    if (this.cells[y] === undefined) {
      this.cells[y] = [];
    }
    return this.cells[y];
  };

  getRows = () => this.cells;

  getCellBounds = (requestedCell: HTMLTableCellElement): CellBounds => {
    let minX = this.columnCount;
    let minY = this.rowCount;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.rowCount; y++) {
      const row = this.getRowAt(y);
      const x = row.indexOf(requestedCell);
      if (x !== -1) {
        maxX = Math.max(maxX, row.lastIndexOf(requestedCell));
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
      }
    }
    return { minX, minY, maxX, maxY };
  };

  merge = (other: TableGrid) => {
    this.cells = this.getRows().concat(other.getRows());
  };
}

function constructTableGrid(table: HTMLTableElement): TableGrid {
  const winEl = winOf(table);
  const winTableGrid = (winEl as any).TableGrid || TableGrid;
  const tableGrid = new winTableGrid();

  if (table.tHead !== null) {
    tableGrid.merge(constructGridFromRows(table.tHead.rows));
  }

  Array.from(table.tBodies).forEach(body => {
    tableGrid.merge(constructGridFromRows(body.rows));
  });

  const directRows: HTMLTableRowElement[] = [];
  for (const child of Array.from(table.children)) {
    if (isHTMLNode(child) && hasElementTag(child, 'tr')) {
      directRows.push(child as HTMLTableRowElement);
    }
  }

  tableGrid.merge(constructGridFromRows(directRows));

  if (table.tFoot !== null) {
    tableGrid.merge(constructGridFromRows(table.tFoot.rows));
  }

  return tableGrid;
}

function constructGridFromRows(rows: ArrayLike<HTMLTableRowElement>): TableGrid {
  const tableGrid = new TableGrid();
  const fullHeightColumns: HTMLTableCellElement[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    let nextFreeColumn = 0;

    for (const cell of Array.from(rows[rowIndex].cells)) {
      while (tableGrid.getCellAt(nextFreeColumn, rowIndex) || fullHeightColumns[nextFreeColumn]) {
        if (!isDataTableCell(tableGrid.getCellAt(nextFreeColumn, rowIndex)) && fullHeightColumns[nextFreeColumn]) {
          tableGrid.setCellAt(nextFreeColumn, rowIndex, fullHeightColumns[nextFreeColumn]);
        }
        nextFreeColumn++;
      }

      for (let x = nextFreeColumn; x < nextFreeColumn + cell.colSpan; x++) {
        if (extractRowSpan(cell) === 0) {
          fullHeightColumns[x] = cell;
          tableGrid.setCellAt(x, rowIndex, cell);
        }
        for (let y = rowIndex; y < rowIndex + extractRowSpan(cell); y++) {
          if (!isDataTableCell(tableGrid.getCellAt(x, y))) {
            tableGrid.setCellAt(x, y, cell);
          }
        }
      }
      nextFreeColumn += cell.colSpan;
    }

    for (let x = nextFreeColumn; x < tableGrid.columnCount; x++) {
      const fillerCell = fullHeightColumns[x];
      if (fillerCell !== undefined && !isDataTableCell(tableGrid.getCellAt(x, rowIndex))) {
        tableGrid.setCellAt(x, rowIndex, fillerCell);
      }
    }
  }
  return tableGrid;
}

function extractRowSpan(element: HTMLTableCellElement): number {
  const attr = element.getAttribute('rowSpan');
  if (attr === null || attr.trim() === '') {
    return 1;
  }
  const parsed = Number(attr);
  return isNaN(parsed) ? 1 : parsed;
}

function isDataTableCell(cell: HTMLTableCellElement | undefined): boolean {
  return cell !== undefined && hasElementTag(cell, 'td');
}
