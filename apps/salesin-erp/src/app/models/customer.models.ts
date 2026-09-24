import { ErpNextDocument } from './erpnext-document.models';

export interface CustomerCreditLimit {
  company: string;
  credit_limit: number;
  bypass_credit_limit_check?: 0 | 1;
}

export interface ErpNextCustomer extends ErpNextDocument {
  customer_name: string;
  customer_type?: string;
  customer_group?: string;
  territory?: string;
  default_currency?: string;
  default_price_list?: string;
  default_sales_partner?: string;
  disabled?: 0 | 1;
  is_internal_customer?: 0 | 1;
  credit_limits?: CustomerCreditLimit[];
}
