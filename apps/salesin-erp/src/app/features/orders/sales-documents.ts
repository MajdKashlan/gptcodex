import { FrappeFilter } from '../../core/api/frappe-api.service';

export type SalesDoctype = 'Quotation' | 'Sales Order' | 'Sales Invoice';
export type SalesDocumentType = 'Quote' | 'Order' | 'Invoice' | 'Credit Note';
export type SalesListView = 'all' | 'quotes' | 'orders' | 'customer-orders' | 'invoices' | 'credit-notes';
export type SalesTab = 'all' | 'open' | 'closed';

export const SALES_VIEWS: Record<SalesListView, string> = {
  all: 'All Sales',
  quotes: 'Quotes',
  orders: 'Orders',
  'customer-orders': 'Customer Orders',
  invoices: 'Invoices',
  'credit-notes': 'Credit Notes',
};

/** Field names differ between the three sales doctypes; this table hides that. */
export interface SalesSource {
  doctype: SalesDoctype;
  documentType: SalesDocumentType;
  customerField: 'customer' | 'party_name';
  dateField: 'transaction_date' | 'posting_date';
  dueField: 'delivery_date' | 'due_date' | 'valid_till';
  filters: FrappeFilter[];
}

const QUOTES: SalesSource = {
  doctype: 'Quotation', documentType: 'Quote', customerField: 'party_name',
  dateField: 'transaction_date', dueField: 'valid_till', filters: [],
};
const ORDERS: SalesSource = {
  doctype: 'Sales Order', documentType: 'Order', customerField: 'customer',
  dateField: 'transaction_date', dueField: 'delivery_date', filters: [],
};
const INVOICES: SalesSource = {
  doctype: 'Sales Invoice', documentType: 'Invoice', customerField: 'customer',
  dateField: 'posting_date', dueField: 'due_date', filters: [['Sales Invoice', 'is_return', '=', 0]],
};
const CREDIT_NOTES: SalesSource = {
  ...INVOICES, documentType: 'Credit Note', filters: [['Sales Invoice', 'is_return', '=', 1]],
};

export function sourcesForView(view: SalesListView): SalesSource[] {
  switch (view) {
    case 'quotes': return [QUOTES];
    case 'orders': return [ORDERS];
    case 'customer-orders':
      return [{ ...ORDERS, filters: [['Sales Order', 'order_type', '=', 'Shopping Cart']] }];
    case 'invoices': return [INVOICES];
    case 'credit-notes': return [CREDIT_NOTES];
    default: return [QUOTES, ORDERS, { ...INVOICES, filters: [] }];
  }
}

export function sourceForDoctype(doctype: string, isReturn = false): SalesSource {
  if (doctype === 'Quotation') return QUOTES;
  if (doctype === 'Sales Order') return ORDERS;
  return isReturn ? CREDIT_NOTES : INVOICES;
}

export function doctypeForType(type: SalesDocumentType): SalesDoctype {
  return type === 'Quote' ? 'Quotation' : type === 'Order' ? 'Sales Order' : 'Sales Invoice';
}

/** Statuses that count as "closed" for the Open / Closed tabs, per doctype. */
export const CLOSED_STATUSES: Record<SalesDoctype, string[]> = {
  Quotation: ['Ordered', 'Lost', 'Cancelled', 'Expired'],
  'Sales Order': ['Closed', 'Completed', 'Cancelled'],
  'Sales Invoice': ['Paid', 'Cancelled', 'Credit Note Issued', 'Return'],
};

export function isClosedStatus(doctype: string, status: string | undefined): boolean {
  return (CLOSED_STATUSES[doctype as SalesDoctype] ?? []).includes(status ?? '');
}

export function tabFilter(source: SalesSource, tab: SalesTab): FrappeFilter[] {
  if (tab === 'all') return [];
  return [[source.doctype, 'status', tab === 'closed' ? 'in' : 'not in', CLOSED_STATUSES[source.doctype]]];
}

export function searchFilters(source: SalesSource, query: string): FrappeFilter[] {
  const term = query.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return [
    [source.doctype, 'name', 'like', like],
    [source.doctype, source.customerField, 'like', like],
    [source.doctype, 'customer_name', 'like', like],
  ];
}

/** A row of the combined sales list. */
export interface SalesListRow {
  key: string;
  name: string;
  doctype: SalesDoctype;
  documentType: SalesDocumentType;
  customer: string;
  customer_name?: string;
  company?: string;
  date: string;
  due?: string;
  currency?: string;
  grand_total?: number;
  outstanding_amount?: number;
  status?: string;
  docstatus?: 0 | 1 | 2;
  order_type?: string;
  is_return?: 0 | 1;
  modified?: string;
}

export function listFields(source: SalesSource): string[] {
  return [
    'name', source.customerField, 'customer_name', 'company', source.dateField, source.dueField,
    'currency', 'grand_total', 'status', 'docstatus', 'modified',
    ...(source.doctype === 'Sales Invoice' ? ['outstanding_amount', 'is_return'] : []),
    ...(source.doctype === 'Sales Order' ? ['order_type'] : []),
  ];
}

export function toListRow(source: SalesSource, record: Record<string, unknown>): SalesListRow {
  const isReturn = record['is_return'] === 1;
  const documentType = source.doctype === 'Sales Invoice' ? (isReturn ? 'Credit Note' : 'Invoice') : source.documentType;
  const name = String(record['name']);
  return {
    key: `${source.doctype}:${name}`,
    name,
    doctype: source.doctype,
    documentType,
    customer: String(record[source.customerField] ?? ''),
    customer_name: record['customer_name'] as string | undefined,
    company: record['company'] as string | undefined,
    date: String(record[source.dateField] ?? ''),
    due: record[source.dueField] as string | undefined,
    currency: record['currency'] as string | undefined,
    grand_total: record['grand_total'] as number | undefined,
    outstanding_amount: record['outstanding_amount'] as number | undefined,
    status: record['status'] as string | undefined,
    docstatus: record['docstatus'] as 0 | 1 | 2 | undefined,
    order_type: record['order_type'] as string | undefined,
    is_return: record['is_return'] as 0 | 1 | undefined,
    modified: record['modified'] as string | undefined,
  };
}

/** Merges per-doctype lists (each sorted newest first) and returns one page. */
export function mergePage(lists: SalesListRow[][], page: number, pageSize: number): SalesListRow[] {
  const merged = lists.flat().sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''));
  const start = (Math.max(1, page) - 1) * pageSize;
  return merged.slice(start, start + pageSize);
}

/** Workflow helpers shared by the list and the detail page. */
export function canMakeOrder(row: Pick<SalesListRow, 'doctype' | 'docstatus' | 'status'>): boolean {
  return row.doctype === 'Quotation' && row.docstatus === 1 && !['Ordered', 'Expired', 'Lost', 'Cancelled'].includes(row.status ?? '');
}

export function canMakeInvoice(row: Pick<SalesListRow, 'doctype' | 'docstatus' | 'status'>): boolean {
  return row.doctype === 'Sales Order' && row.docstatus === 1 && !['Closed', 'Cancelled', 'Completed', 'To Deliver'].includes(row.status ?? '');
}

export function canMakeCreditNote(row: Pick<SalesListRow, 'doctype' | 'docstatus' | 'is_return'>): boolean {
  return row.doctype === 'Sales Invoice' && row.docstatus === 1 && row.is_return !== 1;
}

export function canReceivePayment(row: Pick<SalesListRow, 'doctype' | 'docstatus' | 'status' | 'is_return' | 'outstanding_amount'>): boolean {
  if (row.docstatus !== 1) return false;
  if (row.doctype === 'Sales Order') return !['Closed', 'Cancelled', 'Completed', 'On Hold'].includes(row.status ?? '');
  return row.doctype === 'Sales Invoice' && row.is_return !== 1 && (row.outstanding_amount ?? 0) > 0;
}
