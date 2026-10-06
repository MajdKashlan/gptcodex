import { ErpNextDocument } from './erpnext-document.models';

/**
 * Stock on hand for one item in one warehouse.
 *
 * Every quantity field is read-only on the server: ERPNext maintains `Bin` as a
 * roll-up of the stock ledger, so the client only ever reads it.
 */
export interface ErpNextBin extends ErpNextDocument {
  item_code: string;
  warehouse: string;
  actual_qty?: number;
  projected_qty?: number;
  reserved_qty?: number;
  ordered_qty?: number;
  planned_qty?: number;
  indented_qty?: number;
  valuation_rate?: number;
  stock_value?: number;
  stock_uom?: string;
}

/** One posted stock movement. Read-only, maintained by ERPNext. */
export interface ErpNextStockLedgerEntry extends ErpNextDocument {
  item_code: string;
  warehouse: string;
  actual_qty?: number;
  qty_after_transaction?: number;
  voucher_type?: string;
  voucher_no?: string;
  posting_date?: string;
  posting_time?: string;
  incoming_rate?: number;
  valuation_rate?: number;
  stock_uom?: string;
  batch_no?: string;
  is_cancelled?: 0 | 1;
}

/** A `Stock Entry Type` record; its `purpose` decides how the entry behaves. */
export interface ErpNextStockEntryType extends ErpNextDocument {
  purpose?: string;
}

/** Purposes this front-end can create. Others exist but need manufacturing setup. */
export type StockEntryPurpose =
  | 'Material Issue'
  | 'Material Receipt'
  | 'Material Transfer';

export interface StockEntryItem {
  item_code: string;
  item_name?: string;
  qty: number;
  uom?: string;
  s_warehouse?: string;
  t_warehouse?: string;
  basic_rate?: number;
  batch_no?: string;
  cost_center?: string;
}

export interface ErpNextStockEntry extends ErpNextDocument {
  naming_series?: string;
  stock_entry_type: string;
  purpose?: string;
  company: string;
  posting_date?: string;
  posting_time?: string;
  from_warehouse?: string;
  to_warehouse?: string;
  items: StockEntryItem[];
  total_outgoing_value?: number;
  total_incoming_value?: number;
  value_difference?: number;
  status?: string;
  docstatus?: 0 | 1 | 2;
}
