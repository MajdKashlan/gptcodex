import { ErpNextDocument } from './erpnext-document.models';

export interface SalesOrderItem {
  name?: string;
  idx?: number;
  item_code: string;
  item_name?: string;
  description?: string;
  image?: string;
  warehouse?: string;
  uom?: string;
  conversion_factor?: number;
  qty: number;
  rate: number;
  amount?: number;
  base_rate?: number;
  base_amount?: number;
  discount_percentage?: number;
  discount_amount?: number;
}

export interface SalesTaxesAndCharges {
  charge_type: string;
  account_head?: string;
  description?: string;
  rate?: number;
  tax_amount?: number;
  total?: number;
}

export interface ErpNextSalesOrder extends ErpNextDocument {
  naming_series?: string;
  customer: string;
  customer_name?: string;
  company: string;
  transaction_date: string;
  delivery_date?: string;
  currency?: string;
  selling_price_list?: string;
  price_list_currency?: string;
  set_warehouse?: string;
  taxes_and_charges?: string;
  items: SalesOrderItem[];
  taxes?: SalesTaxesAndCharges[];
  net_total?: number;
  total_taxes_and_charges?: number;
  grand_total?: number;
  rounded_total?: number;
  status?: string;
}
