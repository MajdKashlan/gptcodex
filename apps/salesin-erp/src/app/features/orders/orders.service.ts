import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { SalesTaxService } from './sales-tax.service';
import { ErpNextCustomer } from '../../models/customer.models';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextItem } from '../../models/item.models';
import { ErpNextSalesOrder } from '../../models/sales-order.models';
import { SalesTaxesAndChargesTemplate } from '../../models/sales-tax.models';

export interface OrderOptions {
  customers: ErpNextCustomer[];
  items: ErpNextItem[];
  companies: Array<{ name: string; default_currency?: string }>;
  priceLists: string[];
  warehouses: string[];
  taxTemplates: SalesTaxesAndChargesTemplate[];
}

export type SalesOrderData = Pick<
  ErpNextSalesOrder,
  'customer' | 'company' | 'transaction_date' | 'delivery_date' | 'currency' | 'selling_price_list' | 'set_warehouse' | 'taxes_and_charges' | 'items'
>;

export type SalesDocumentType = 'Credit Note' | 'Invoice' | 'Order' | 'Quote';
export type SalesListView = 'all' | 'credit-notes' | 'customer-orders' | 'invoices' | 'orders' | 'quotes';

export interface SalesDocumentDetails {
  name: string;
  customer?: string;
  customer_name?: string;
  party_name?: string;
  company: string;
  transaction_date?: string;
  posting_date?: string;
  delivery_date?: string;
  due_date?: string;
  valid_till?: string;
  currency?: string;
  selling_price_list?: string;
  set_warehouse?: string;
  po_no?: string;
  remarks?: string;
  terms?: string;
  payment_terms_template?: string;
  taxes_and_charges?: string;
  return_against?: string;
  is_return?: 0 | 1;
  docstatus?: 0 | 1 | 2;
  items: ErpNextSalesOrder['items'];
}

export interface SalesListRow {
  name: string;
  doctype: string;
  documentType: string;
  customer: string;
  customer_name?: string;
  company: string;
  transaction_date: string;
  delivery_date?: string;
  currency?: string;
  grand_total?: number;
  status?: string;
  docstatus?: 0 | 1 | 2;
  order_type?: string;
  outstanding_amount?: number;
  is_return?: 0 | 1;
  modified?: string;
}

interface SalesListRecord {
  name: string;
  customer?: string;
  customer_name?: string;
  party_name?: string;
  company: string;
  transaction_date?: string;
  posting_date?: string;
  delivery_date?: string;
  due_date?: string;
  valid_till?: string;
  currency?: string;
  grand_total?: number;
  status?: string;
  docstatus?: 0 | 1 | 2;
  order_type?: string;
  outstanding_amount?: number;
  is_return?: 0 | 1;
  modified?: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);
  private readonly taxService = inject(SalesTaxService);

  list(query = '', pageSize = 200): Observable<ErpNextSalesOrder[]> {
    const fields = [
      'name',
      'customer',
      'customer_name',
      'company',
      'transaction_date',
      'delivery_date',
      'currency',
      'grand_total',
      'status',
      'order_type',
      'docstatus',
      'modified',
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(pageSize))
      .set('order_by', 'modified desc');
    if (query.trim()) {
      const term = `%${query.trim()}%`;
      params = params.set('or_filters', JSON.stringify([
        ['Sales Order', 'name', 'like', term],
        ['Sales Order', 'customer', 'like', term],
        ['Sales Order', 'customer_name', 'like', term],
      ]));
    }
    return this.http
      .get<ErpNextListResponse<ErpNextSalesOrder>>(this.auth.apiUrl('/api/resource/Sales Order'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []));
  }

  listByView(view: SalesListView, query = '', pageSize = 20): Observable<SalesListRow[]> {
    const fetchLimit = Math.max(pageSize * 5, 200);
    const salesOrders = () => this.listSalesRows(
      'Sales Order', 'Order', 'transaction_date', 'delivery_date', ['customer', 'customer_name'], query, fetchLimit,
      view === 'customer-orders' ? [['Sales Order', 'order_type', '=', 'Shopping Cart']] : [],
    );
    const invoices = (returns: 0 | 1 | null) => this.listSalesRows(
      'Sales Invoice', 'Invoice', 'posting_date', 'due_date', ['customer', 'customer_name'], query, fetchLimit,
      returns === null ? [] : [['Sales Invoice', 'is_return', '=', returns]],
    );
    const quotes = () => this.listSalesRows(
      'Quotation', 'Quote', 'transaction_date', 'valid_till', ['party_name', 'customer_name'], query, fetchLimit,
    );

    switch (view) {
      case 'credit-notes':
        return invoices(1).pipe(map((rows) => rows.map((row) => ({ ...row, documentType: 'Credit Note' }))));
      case 'customer-orders':
      case 'orders':
        return salesOrders();
      case 'invoices':
        return invoices(0);
      case 'quotes':
        return quotes();
      case 'all':
        return forkJoin({ orders: salesOrders(), invoices: invoices(null), quotes: quotes() }).pipe(
          map(({ orders, invoices: invoiceRows, quotes: quoteRows }) => [...orders, ...invoiceRows, ...quoteRows]
            .sort((left, right) => (right.modified ?? '').localeCompare(left.modified ?? ''))),
        );
    }
  }

  makeOrderFromQuote(name: string): Observable<{ name: string }> {
    return this.createMappedDocument(
      'erpnext.selling.doctype.quotation.quotation.make_sales_order',
      'Sales Order',
      name,
    );
  }

  makeInvoiceFromOrder(name: string): Observable<{ name: string }> {
    return this.createMappedDocument(
      'erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice',
      'Sales Invoice',
      name,
    );
  }

  makeCreditNoteFromInvoice(name: string): Observable<{ name: string }> {
    return this.createMappedDocument(
      'erpnext.accounts.doctype.sales_invoice.sales_invoice.make_return_doc',
      'Sales Invoice',
      name,
    );
  }

  updateField(name: string, fieldname: string, value: unknown): Observable<ErpNextSalesOrder> {
    return this.http.put<{ data: ErpNextSalesOrder }>(
      this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
      { [fieldname]: value },
      { withCredentials: true },
    ).pipe(map((response) => response.data));
  }

  getSalesDocument(doctype: string, name: string): Observable<SalesDocumentDetails> {
    return this.http.get<{ data: SalesDocumentDetails }>(
      this.auth.apiUrl(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
      { withCredentials: true },
    ).pipe(map((response) => response.data));
  }

  updateSalesDocument(
    type: SalesDocumentType,
    doctype: string,
    name: string,
    details: SalesOrderData & { po_no?: string; remarks?: string; payment_terms_template?: string },
    returnAgainst?: string,
  ): Observable<{ name: string }> {
    const items = details.items.map((item) => ({ ...item }));
    let payload: Record<string, unknown>;
    if (type === 'Order') {
      payload = {
        customer: details.customer,
        company: details.company,
        transaction_date: details.transaction_date,
        delivery_date: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        remarks: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        items,
      };
    } else if (type === 'Quote') {
      payload = {
        quotation_to: 'Customer',
        party_name: details.customer,
        customer_name: details.customer,
        company: details.company,
        transaction_date: details.transaction_date,
        valid_till: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        terms: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        items,
      };
    } else {
      payload = {
        customer: details.customer,
        company: details.company,
        posting_date: details.transaction_date,
        due_date: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        remarks: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        is_return: type === 'Credit Note' ? 1 : 0,
        return_against: returnAgainst,
        items: items.map((item) => ({ ...item, qty: type === 'Credit Note' ? -Math.abs(item.qty) : item.qty })),
      };
    }
    return this.http.put<{ data: { name: string } }>(
      this.auth.apiUrl(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
      payload,
      { withCredentials: true },
    ).pipe(map((response) => response.data));
  }

  assign(name: string, user: string, doctype = 'Sales Order'): Observable<unknown> {
    return this.http.post(
      this.auth.apiUrl('/api/method/frappe.desk.form.assign_to.add'),
      { doctype, name, assign_to: JSON.stringify([user]) },
      { withCredentials: true },
    );
  }

  changeStatus(name: string, action: 'submit' | 'cancel'): Observable<unknown> {
    return this.changeDocumentStatus('Sales Order', name, action);
  }

  changeDocumentStatus(doctype: string, name: string, action: 'submit' | 'cancel'): Observable<unknown> {
    return this.getSalesDocument(doctype, name).pipe(switchMap((document) => this.http.post(
      this.auth.apiUrl('/api/method/frappe.client.' + action),
      { doc: JSON.stringify(document) },
      { withCredentials: true },
    )));
  }

  delete(name: string): Observable<unknown> {
    return this.http.delete(
      this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
      { withCredentials: true },
    );
  }

  duplicate(name: string): Observable<ErpNextSalesOrder> {
    return this.get(name).pipe(switchMap((order) => {
      const transactionDate = new Date().toISOString().slice(0, 10);
      const deliveryDate = this.nextDay(transactionDate);
      return this.create({
        customer: order.customer,
        company: order.company,
        transaction_date: transactionDate,
        delivery_date: deliveryDate,
        currency: order.currency ?? 'USD',
        selling_price_list: order.selling_price_list ?? '',
        set_warehouse: order.set_warehouse,
        taxes_and_charges: order.taxes_and_charges,
        items: order.items.map((item) => ({
          item_code: item.item_code,
          item_name: item.item_name,
          description: item.description,
          warehouse: item.warehouse,
          delivery_date: deliveryDate,
          uom: item.uom,
          conversion_factor: item.conversion_factor,
          qty: item.qty,
          rate: item.rate,
          discount_percentage: item.discount_percentage,
          discount_amount: item.discount_amount,
        })),
      });
    }));
  }

  addPayment(doctype: string, name: string, amount: number): Observable<unknown> {
    return this.http.post<{ message: Record<string, unknown> }>(
      this.auth.apiUrl('/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry'),
      { dt: doctype, dn: name, party_amount: amount },
      { withCredentials: true },
    ).pipe(switchMap(({ message }) => {
      const payment = { ...message, paid_amount: amount, received_amount: amount };
      return this.http.post(
        this.auth.apiUrl('/api/resource/Payment Entry'),
        payment,
        { withCredentials: true },
      );
    }));
  }

  loadOptions(): Observable<OrderOptions> {
    return forkJoin({
      customers: this.listRecords<ErpNextCustomer>('Customer', [
        'name', 'customer_name', 'default_currency', 'default_price_list',
      ], [['Customer', 'disabled', '=', 0]]),
      items: this.listRecords<ErpNextItem>('Item', [
        'name', 'item_code', 'item_name', 'stock_uom', 'standard_rate',
      ], [['Item', 'disabled', '=', 0]]),
      companies: this.listRecords<{ name: string; default_currency?: string }>('Company', ['name', 'default_currency']),
      priceLists: this.listNames('Price List', [['Price List', 'selling', '=', 1]]),
      warehouses: this.listNames('Warehouse', [['Warehouse', 'is_group', '=', 0]]),
      taxTemplates: this.taxService.listTemplates(''),
    });
  }

  get(name: string): Observable<ErpNextSalesOrder> {
    return this.http
      .get<{ data: ErpNextSalesOrder }>(
        this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  create(details: SalesOrderData): Observable<ErpNextSalesOrder> {
    return this.http
      .post<{ data: ErpNextSalesOrder }>(this.auth.apiUrl('/api/resource/Sales Order'), details, {
        withCredentials: true,
      })
      .pipe(map((response) => response.data));
  }

  createSalesDocument(type: SalesDocumentType, details: SalesOrderData & {
    po_no?: string;
    remarks?: string;
    payment_terms_template?: string;
  }): Observable<{ name: string }> {
    const items = details.items.map((item) => ({ ...item }));
    let doctype: string;
    let payload: Record<string, unknown>;
    if (type === 'Order') {
      doctype = 'Sales Order';
      payload = {
        customer: details.customer,
        company: details.company,
        transaction_date: details.transaction_date,
        delivery_date: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        remarks: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        items,
      };
    } else if (type === 'Quote') {
      doctype = 'Quotation';
      payload = {
        quotation_to: 'Customer',
        party_name: details.customer,
        customer_name: details.customer,
        company: details.company,
        transaction_date: details.transaction_date,
        valid_till: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        terms: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        items,
      };
    } else {
      doctype = 'Sales Invoice';
      payload = {
        customer: details.customer,
        company: details.company,
        posting_date: details.transaction_date,
        due_date: details.delivery_date,
        currency: details.currency,
        selling_price_list: details.selling_price_list,
        set_warehouse: details.set_warehouse,
        po_no: details.po_no,
        remarks: details.remarks,
        payment_terms_template: details.payment_terms_template,
        taxes_and_charges: details.taxes_and_charges,
        is_return: type === 'Credit Note' ? 1 : 0,
        items: items.map((item) => ({ ...item, qty: type === 'Credit Note' ? -Math.abs(item.qty) : item.qty })),
      };
    }
    return this.http.post<{ data: { name: string } }>(
      this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)),
      payload,
      { withCredentials: true },
    ).pipe(map((response) => response.data));
  }

  update(name: string, details: SalesOrderData): Observable<ErpNextSalesOrder> {
    return this.http
      .put<{ data: ErpNextSalesOrder }>(
        this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
        details,
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  private listNames(doctype: string, filters: unknown[][]): Observable<string[]> {
    return this.listRecords<{ name: string }>(doctype, ['name'], filters)
      .pipe(map((records) => records.map((record) => record.name)));
  }

  private listSalesRows(
    doctype: string,
    documentType: string,
    dateField: string,
    dueDateField: string,
    searchFields: string[],
    query: string,
    pageSize: number,
    filters: unknown[][] = [],
  ): Observable<SalesListRow[]> {
    const fields = [
      'name', ...new Set([...searchFields, 'company', dateField, dueDateField, 'currency', 'grand_total', 'status', 'docstatus', 'modified',
        ...(doctype === 'Sales Invoice' ? ['outstanding_amount', 'is_return'] : []),
        ...(doctype === 'Sales Order' ? ['order_type'] : [])]),
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(pageSize))
      .set('order_by', 'modified desc');
    if (filters.length) params = params.set('filters', JSON.stringify(filters));
    if (query.trim()) {
      const term = `%${query.trim()}%`;
      params = params.set('or_filters', JSON.stringify([
        [doctype, 'name', 'like', term],
        ...searchFields.map((field) => [doctype, field, 'like', term]),
      ]));
    }
    return this.http.get<ErpNextListResponse<SalesListRecord>>(
      this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)),
      {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      },
    ).pipe(map((response) => (response.data ?? []).map((record) => ({
      name: record.name,
      doctype,
      documentType,
      customer: record.customer ?? record.party_name ?? '',
      customer_name: record.customer_name ?? record.party_name,
      company: record.company,
      transaction_date: record.transaction_date ?? record.posting_date ?? '',
      delivery_date: record.delivery_date ?? record.due_date ?? record.valid_till,
      currency: record.currency,
      grand_total: record.grand_total,
      status: record.status,
      docstatus: record.docstatus,
      order_type: record.order_type,
      outstanding_amount: record.outstanding_amount,
      is_return: record.is_return,
      modified: record.modified,
    }))));
  }

  private createMappedDocument(method: string, doctype: string, sourceName: string): Observable<{ name: string }> {
    return this.http.post<{ message: Record<string, unknown> }>(
      this.auth.apiUrl('/api/method/' + method),
      { source_name: sourceName },
      { withCredentials: true },
    ).pipe(switchMap(({ message }) => {
      const payload = doctype === 'Sales Order' ? this.ensureSalesOrderDeliveryDate(message) : message;
      return this.http.post<{ data: { name: string } }>(
        this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)),
        payload,
        { withCredentials: true },
      ).pipe(map((response) => response.data));
    }));
  }

  private ensureSalesOrderDeliveryDate(document: Record<string, unknown>): Record<string, unknown> {
    const transactionDate = typeof document['transaction_date'] === 'string' && document['transaction_date']
      ? document['transaction_date']
      : new Date().toISOString().slice(0, 10);
    const existingDeliveryDate = typeof document['delivery_date'] === 'string' ? document['delivery_date'] : '';
    const deliveryDate = existingDeliveryDate > transactionDate ? existingDeliveryDate : this.nextDay(transactionDate);
    const items = Array.isArray(document['items']) ? document['items'].map((value) => {
      if (!value || typeof value !== 'object') return value;
      const item = value as Record<string, unknown>;
      const itemDeliveryDate = typeof item['delivery_date'] === 'string' ? item['delivery_date'] : '';
      return {
        ...item,
        delivery_date: itemDeliveryDate > transactionDate ? itemDeliveryDate : deliveryDate,
      };
    }) : [];
    return { ...document, transaction_date: transactionDate, delivery_date: deliveryDate, items };
  }

  private nextDay(date: string): string {
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    return nextDate.toISOString().slice(0, 10);
  }

  private listRecords<T>(doctype: string, fields: string[], filters: unknown[][] = []): Observable<T[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }
    return this.http
      .get<ErpNextListResponse<T>>(this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []), catchError(() => of([])));
  }
}