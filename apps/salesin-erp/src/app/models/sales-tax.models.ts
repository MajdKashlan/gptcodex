import { ErpNextDocument } from './erpnext-document.models';

/**
 * One row of a `Sales Taxes and Charges Template`.
 *
 * Templates are copied into a document by the *server*: when a document is saved
 * with `taxes_and_charges` set and no `taxes` rows, ERPNext expands the template
 * (`get_taxes_and_charges` in `erpnext/controllers/selling_controller.py`, and
 * `set_taxes()` in `sales_invoice.py`). The client therefore never needs to send
 * tax rows or compute tax amounts itself.
 */
export interface SalesTaxesAndChargesRow {
  idx?: number;
  charge_type: string;
  account_head?: string;
  description?: string;
  rate?: number;
  cost_center?: string;
  included_in_print_rate?: 0 | 1;
}

/** A `Sales Taxes and Charges Template` header. */
export interface SalesTaxesAndChargesTemplate extends ErpNextDocument {
  title?: string;
  company: string;
  is_default?: 0 | 1;
  disabled?: 0 | 1;
  taxes?: SalesTaxesAndChargesRow[];
}
