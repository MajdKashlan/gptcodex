import { ErpNextDocument } from './erpnext-document.models';

export interface ErpNextItem extends ErpNextDocument {
  item_code: string;
  item_name: string;
  description?: string;
  item_group?: string;
  brand?: string;
  barcode?: string;
  image?: string;
  stock_uom: string;
  disabled?: 0 | 1;
  is_sales_item?: 0 | 1;
  has_variants?: 0 | 1;
  standard_rate?: number;
  valuation_rate?: number;

  /** Enriched from ERPNext Bin data; not normally returned by Item. */
  actual_qty?: number;
  warehouse?: string;
}

export interface ErpNextItemPrice extends ErpNextDocument {
  item_code: string;
  price_list: string;
  price_list_rate: number;
  currency: string;
  uom?: string;
  selling?: 0 | 1;
  buying?: 0 | 1;
  valid_from?: string;
  valid_upto?: string;
  customer?: string;
  batch_no?: string;
}
