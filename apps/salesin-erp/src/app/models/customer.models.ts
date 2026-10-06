import { ErpNextDocument } from './erpnext-document.models';

export interface CustomerCreditLimit {
  company: string;
  credit_limit: number;
  bypass_credit_limit_check?: 0 | 1;
}

export interface ErpNextCustomer extends ErpNextDocument {
  customer_name: string;
  alias?: string;
  customer_type?: string;
  customer_group?: string;
  territory?: string;
  default_currency?: string;
  default_price_list?: string;
  default_sales_partner?: string;
  tax_id?: string;
  tax_category?: string;
  payment_terms?: string;
  customer_details?: string;
  customer_primary_contact?: string;
  customer_primary_address?: string;
  portal_users?: Array<{ user: string }>;
  is_frozen?: 0 | 1;
  on_hold?: 0 | 1;
  disabled?: 0 | 1;
  is_internal_customer?: 0 | 1;
  credit_limits?: CustomerCreditLimit[];
}
