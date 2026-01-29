import type { TupleToUnion } from 'type-fest';

export type * from 'type-fest';
export type ExcludeValuesFromBaseArrayType<B extends string[], E extends (string | number)[]> = Exclude<
  TupleToUnion<B>,
  TupleToUnion<E>
>[];

export interface SheetProperties {
  sheetId: number;
  title: string;
  index: number;
  sheetType: string;
  gridProperties: {
    rowCount: number;
    columnCount: number;
  };
}

export interface SpreadsheetSheet {
  properties: SheetProperties;
}
