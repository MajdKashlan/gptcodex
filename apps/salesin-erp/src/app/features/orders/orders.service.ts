import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, switchMap } from 'rxjs';
import { FrappeApiService, Page } from '../../core/api/frappe-api.service';
import { addDaysIso, todayIso } from '../../core/utils/date';
import { SalesOrderItem } from '../../models/sales-order.models';
import { SalesTaxesAndChargesTemplate } from '../../models/sales-tax.models';
import { SalesTaxService } from './sales-tax.service';
import {
  CLOSED_STATUSES,
  doctypeForType,
  listFields,
  mergePage,
  SalesDocumentType,
  SalesListRow,
  SalesListView,
  SalesSource,
  SalesTab,
  searchFilters,
  sourcesForView,
  tabFilter,
  toListRow,
} from './sales-documents';

export interface OrderOptions {
  companies: Array<{ name: string; default_currency?: string }>;
  priceLists: string[];
  warehouses: string[];
  taxTemplates: SalesTaxesAndChargesTemplate[];
}

export interface SalesDocumentInput {
  customer: string;
  company: string;
  /** Order / quote / invoice date. */
  date: string;
  /** Delivery date, valid-till or payment due date depending on the type. */
  due: string;
  currency: string;
  selling_price_list: string;
  set_warehouse?: string;
  taxes_and_charges?: string;
  po_no?: string;
  remarks?: string;
  payment_terms_template?: string;
  items: SalesOrderItem[];
}

export interface SalesDocumentDetails {
  name: string;
  doctype?: string;
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
  status?: string;
  order_type?: string;
  net_total?: number;
  total_taxes_and_charges?: number;
  discount_amount?: number;
  grand_total?: number;
  rounded_total?: number;
  outstanding_amount?: number;
  advance_paid?: number;
  per_billed?: number;
  per_delivered?: number;
  contact_display?: string;
  address_display?: string;
  owner?: string;
  creation?: string;
  modified?: string;
  items: SalesOrderItem[];
  taxes?: Array<{ description?: string; account_head?: string; rate?: number; tax_amount?: number; total?: number }>;
}

export interface ItemPricing {
  item_name?: string;
  uom?: string;
  stock_uom?: string;
  conversion_factor?: number;
  price_list_rate?: number;
  rate?: number;
  discount_percentage?: number;
}

export interface TabCounts {
  all: number;
  open: number;
  closed: number;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly api = inject(FrappeApiService);
  private readonly taxService = inject(SalesTaxService);

  /**
   * One server-side page of a sales view. Single-doctype views use `limit_start`;
   * the combined "All Sales" view fetches the newest `page × pageSize` rows of each
   * doctype and merges them, which is exact for any page.
   */
  listPage(
    view: SalesListView,
    tab: SalesTab,
    query: string,
    page: number,
    pageSize: number,
    customer?: string,
  ): Observable<Page<SalesListRow>> {
    const sources = sourcesForView(view);
    const argsFor = (source: SalesSource) => ({
      fields: listFields(source),
      filters: [
        ...source.filters,
        ...tabFilter(source, tab),
        ...(customer ? [[source.doctype, source.customerField, '=', customer]] : []),
      ],
      orFilters: searchFilters(source, query),
      orderBy: 'modified desc',
    });

    if (sources.length === 1) {
      const source = sources[0];
      return this.api
        .getPage<Record<string, unknown>>(source.doctype, { ...argsFor(source), page, pageSize })
        .pipe(map(({ rows, total }) => ({ rows: rows.map((row) => toListRow(source, row)), total })));
    }

    return forkJoin(sources.map((source) => forkJoin({
      rows: this.api
        .getList<Record<string, unknown>>(source.doctype, { ...argsFor(source), pageLength: page * pageSize })
        .pipe(map((rows) => rows.map((row) => toListRow(source, row)))),
      total: this.api.getCount(source.doctype, argsFor(source).filters, argsFor(source).orFilters),
    }))).pipe(map((results) => ({
      rows: mergePage(results.map((result) => result.rows), page, pageSize),
      total: results.reduce((sum, result) => sum + result.total, 0),
    })));
  }

  /** All / Open / Closed counts for the tabs, one grouped query per doctype. */
  tabCounts(view: SalesListView, query: string): Observable<TabCounts> {
    return forkJoin(sourcesForView(view).map((source) => this.api
      .getList<{ status: string; count: number }>(source.doctype, {
        fields: ['status', 'count(name) as count'],
        filters: source.filters,
        orFilters: searchFilters(source, query),
        groupBy: 'status',
        orderBy: 'status asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows.reduce((counts, row) => {
        const count = Number(row.count) || 0;
        counts.all += count;
        if (CLOSED_STATUSES[source.doctype].includes(row.status)) counts.closed += count;
        else counts.open += count;
        return counts;
      }, { all: 0, open: 0, closed: 0 })))))
      .pipe(map((list) => list.reduce(
        (sum, c) => ({ all: sum.all + c.all, open: sum.open + c.open, closed: sum.closed + c.closed }),
        { all: 0, open: 0, closed: 0 },
      )));
  }

  loadOptions(): Observable<OrderOptions> {
    return forkJoin({
      companies: this.api.getList<{ name: string; default_currency?: string }>('Company', {
        fields: ['name', 'default_currency'], orderBy: 'creation asc', pageLength: 0,
      }),
      priceLists: this.names('Price List', [['Price List', 'selling', '=', 1], ['Price List', 'enabled', '=', 1]]),
      warehouses: this.names('Warehouse', [['Warehouse', 'is_group', '=', 0], ['Warehouse', 'disabled', '=', 0]]),
      taxTemplates: this.taxService.listTemplates(''),
    });
  }

  getDocument(doctype: string, name: string): Observable<SalesDocumentDetails> {
    return this.api.getDoc<SalesDocumentDetails>(doctype, name);
  }

  /** Default currency / price list for a customer. */
  customerDefaults(customer: string): Observable<{ default_currency?: string; default_price_list?: string }> {
    return this.api.getDoc<{ default_currency?: string; default_price_list?: string }>('Customer', customer);
  }

  /**
   * Price, UOM and conversion exactly as ERPNext would set them: price list,
   * customer-specific prices and pricing rules all apply.
   */
  itemPricing(args: {
    itemCode: string;
    doctype: string;
    customer: string;
    company: string;
    currency: string;
    priceList: string;
    date: string;
    qty: number;
    uom?: string;
    warehouse?: string;
  }): Observable<ItemPricing> {
    return this.api.call<ItemPricing>('erpnext.stock.get_item_details.get_item_details', {
      args: {
        item_code: args.itemCode,
        doctype: args.doctype,
        customer: args.customer || undefined,
        company: args.company,
        currency: args.currency,
        conversion_rate: 1,
        price_list: args.priceList,
        price_list_currency: args.currency,
        plc_conversion_rate: 1,
        transaction_date: args.date,
        posting_date: args.date,
        qty: args.qty,
        uom: args.uom || undefined,
        warehouse: args.warehouse || undefined,
        transaction_type: 'selling',
        ignore_pricing_rule: 0,
        is_pos: 0,
        update_stock: 0,
      },
    });
  }

  create(type: SalesDocumentType, input: SalesDocumentInput): Observable<{ name: string }> {
    return this.api.insert(doctypeForType(type), this.payload(type, input));
  }

  update(type: SalesDocumentType, name: string, input: SalesDocumentInput, returnAgainst?: string): Observable<{ name: string }> {
    return this.api.update(doctypeForType(type), name, {
      ...this.payload(type, input),
      ...(type === 'Credit Note' && returnAgainst ? { return_against: returnAgainst } : {}),
    });
  }

  submit(doctype: string, name: string): Observable<void> {
    return this.api.submit(doctype, name);
  }

  cancel(doctype: string, name: string): Observable<void> {
    return this.api.cancel(doctype, name);
  }

  delete(doctype: string, name: string): Observable<void> {
    return this.api.delete(doctype, name);
  }

  assign(doctype: string, name: string, user: string): Observable<unknown> {
    return this.api.call('frappe.desk.form.assign_to.add', { doctype, name, assign_to: JSON.stringify([user]) });
  }

  downloadPdf(doctype: string, name: string): Observable<Blob> {
    return this.api.downloadPdf(doctype, name);
  }

  makeOrderFromQuote(name: string): Observable<{ name: string }> {
    return this.mapped('erpnext.selling.doctype.quotation.quotation.make_sales_order', 'Sales Order', name);
  }

  makeInvoiceFromOrder(name: string): Observable<{ name: string }> {
    return this.mapped('erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice', 'Sales Invoice', name);
  }

  makeCreditNoteFromInvoice(name: string): Observable<{ name: string }> {
    return this.mapped('erpnext.accounts.doctype.sales_invoice.sales_invoice.make_return_doc', 'Sales Invoice', name);
  }

  /** New draft with the same customer and lines, dated today. */
  duplicate(doctype: string, name: string): Observable<{ name: string }> {
    return this.getDocument(doctype, name).pipe(switchMap((doc) => {
      const today = todayIso();
      const due = doctype === 'Sales Invoice' ? today : addDaysIso(today, doctype === 'Quotation' ? 30 : 1);
      const type: SalesDocumentType = doctype === 'Quotation' ? 'Quote' : doctype === 'Sales Order' ? 'Order'
        : doc.is_return ? 'Credit Note' : 'Invoice';
      return this.create(type, {
        customer: doc.customer ?? doc.party_name ?? '',
        company: doc.company,
        date: today,
        due,
        currency: doc.currency ?? '',
        selling_price_list: doc.selling_price_list ?? '',
        set_warehouse: doc.set_warehouse,
        taxes_and_charges: doc.taxes_and_charges,
        po_no: doc.po_no,
        remarks: doc.remarks ?? doc.terms,
        payment_terms_template: doc.payment_terms_template,
        items: doc.items.map((item) => ({
          item_code: item.item_code,
          item_name: item.item_name,
          description: item.description,
          warehouse: item.warehouse,
          uom: item.uom,
          conversion_factor: item.conversion_factor,
          qty: Math.abs(item.qty),
          rate: item.rate,
          discount_percentage: item.discount_percentage,
        })),
      });
    }));
  }

  private payload(type: SalesDocumentType, input: SalesDocumentInput): Record<string, unknown> {
    const common = {
      company: input.company,
      currency: input.currency,
      selling_price_list: input.selling_price_list,
      set_warehouse: input.set_warehouse || undefined,
      taxes_and_charges: input.taxes_and_charges || undefined,
      po_no: input.po_no || undefined,
      payment_terms_template: input.payment_terms_template || undefined,
    };
    const items = input.items.map((item) => ({
      ...item,
      warehouse: item.warehouse || input.set_warehouse || undefined,
      ...(type === 'Order' ? { delivery_date: input.due } : {}),
      qty: type === 'Credit Note' ? -Math.abs(item.qty) : item.qty,
    }));

    if (type === 'Quote') {
      return {
        ...common,
        quotation_to: 'Customer',
        party_name: input.customer,
        transaction_date: input.date,
        valid_till: input.due,
        terms: input.remarks || undefined,
        items,
      };
    }
    if (type === 'Order') {
      return {
        ...common,
        customer: input.customer,
        transaction_date: input.date,
        delivery_date: input.due,
        remarks: input.remarks || undefined,
        items,
      };
    }
    return {
      ...common,
      customer: input.customer,
      posting_date: input.date,
      set_posting_time: 1,
      due_date: input.due,
      remarks: input.remarks || undefined,
      is_return: type === 'Credit Note' ? 1 : 0,
      items,
    };
  }

  /** Runs an ERPNext "make" mapper, then saves the mapped draft. */
  private mapped(method: string, doctype: string, sourceName: string): Observable<{ name: string }> {
    return this.api.call<Record<string, unknown>>(method, { source_name: sourceName }).pipe(
      switchMap((doc) => this.api.insert<{ name: string }>(
        doctype,
        doctype === 'Sales Order' ? withValidDeliveryDate(doc) : doc,
      )),
    );
  }

  private names(doctype: string, filters: unknown[][]): Observable<string[]> {
    return this.api
      .getList<{ name: string }>(doctype, { fields: ['name'], filters, orderBy: 'name asc', pageLength: 0 })
      .pipe(map((rows) => rows.map((row) => row.name)));
  }
}

/** Quote → Order mapping can carry a past delivery date; ERPNext rejects that. */
function withValidDeliveryDate(doc: Record<string, unknown>): Record<string, unknown> {
  const date = typeof doc['transaction_date'] === 'string' && doc['transaction_date'] ? doc['transaction_date'] : todayIso();
  const current = typeof doc['delivery_date'] === 'string' ? doc['delivery_date'] : '';
  const delivery = current >= date ? current : date;
  const items = Array.isArray(doc['items'])
    ? doc['items'].map((value) => {
      const item = value as Record<string, unknown>;
      const itemDate = typeof item['delivery_date'] === 'string' ? item['delivery_date'] : '';
      return { ...item, delivery_date: itemDate >= date ? itemDate : delivery };
    })
    : [];
  return { ...doc, transaction_date: date, delivery_date: delivery, items };
}

