import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, concatMap, finalize, forkJoin, from, map, Observable, of, switchMap, toArray } from 'rxjs';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { NotificationService } from '../../core/http/notification.service';
import { downloadBlob, downloadCsv } from '../../core/utils/csv';
import { addDaysIso, todayIso } from '../../core/utils/date';
import { formatMoney } from '../../core/utils/format';
import { SalesOrderItem } from '../../models/sales-order.models';
import { ConfirmService } from '../../shared/components/confirm-dialog/confirm.service';
import { LinkInputComponent } from '../../shared/components/link-input/link-input.component';
import { PagerComponent } from '../../shared/components/pager/pager.component';
import { AppDatePipe, MoneyPipe } from '../../shared/pipes/format.pipes';
import { PaymentsService } from '../payments/payments.service';
import { OrderOptions, OrdersService, SalesDocumentInput, TabCounts } from './orders.service';
import {
  canMakeCreditNote,
  canMakeInvoice,
  canMakeOrder,
  canReceivePayment,
  doctypeForType,
  isClosedStatus,
  SALES_VIEWS,
  SalesDocumentType,
  SalesListRow,
  SalesListView,
  SalesTab,
} from './sales-documents';

type ToolDialog = 'assign' | 'payment';

const PAGE_SIZES = [10, 20, 50, 100];
const PAGE_SIZE_KEY = 'salesin.sales.page-size';

@Component({
  selector: 'app-orders',
  imports: [ReactiveFormsModule, RouterLink, LinkInputComponent, PagerComponent, AppDatePipe, MoneyPipe],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly ordersService = inject(OrdersService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);

  protected readonly pageSizes = PAGE_SIZES;
  protected readonly view = signal<SalesListView>('all');
  protected readonly viewTitle = computed(() => SALES_VIEWS[this.view()]);
  protected readonly tab = signal<SalesTab>('all');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(readPageSize());
  protected readonly rows = signal<SalesListRow[]>([]);
  protected readonly total = signal(0);
  protected readonly counts = signal<TabCounts>({ all: 0, open: 0, closed: 0 });
  protected readonly options = signal<OrderOptions>({ companies: [], priceLists: [], warehouses: [], taxTemplates: [] });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly busyRowKey = signal<string | null>(null);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly newMenuOpen = signal(false);

  protected readonly selectedRows = computed(() => this.rows().filter((row) => this.selected().has(row.key)));
  protected readonly allSelected = computed(() => this.rows().length > 0 && this.rows().every((row) => this.selected().has(row.key)));
  protected readonly singleSelected = computed(() => (this.selectedRows().length === 1 ? this.selectedRows()[0] : null));
  protected readonly canSubmitSelected = computed(() => this.selectedRows().some((row) => row.docstatus === 0));
  protected readonly canCancelSelected = computed(() => this.selectedRows().some((row) => row.docstatus === 1));
  protected readonly canDeleteSelected = computed(() => this.selectedRows().some((row) => row.docstatus === 0));
  protected readonly canPaySelected = computed(() => {
    const row = this.singleSelected();
    return row !== null && canReceivePayment(row);
  });

  // ---- document form --------------------------------------------------------
  protected readonly dialogOpen = signal(false);
  protected readonly loadingDocument = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly createType = signal<SalesDocumentType>('Order');
  protected readonly editing = signal<{ doctype: string; name: string; returnAgainst?: string } | null>(null);
  protected readonly pricingLine = signal<number | null>(null);
  protected readonly orderForm = this.formBuilder.nonNullable.group({
    customer: ['', Validators.required],
    company: ['', Validators.required],
    date: [todayIso(), Validators.required],
    due: [addDaysIso(todayIso(), 1), Validators.required],
    currency: ['', Validators.required],
    selling_price_list: ['', Validators.required],
    set_warehouse: [''],
    po_no: [''],
    remarks: [''],
    payment_terms_template: [''],
    assigned_to: [''],
    taxes_and_charges: [''],
  });
  protected readonly orderItems = this.formBuilder.array([this.createItemRow()]);

  // ---- tool dialogs ---------------------------------------------------------
  protected readonly toolDialog = signal<ToolDialog | null>(null);
  protected readonly toolError = signal<string | null>(null);
  protected readonly modesOfPayment = signal<string[]>([]);
  protected readonly assignUser = new FormControl('', { nonNullable: true });
  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    posting_date: [todayIso(), Validators.required],
    mode_of_payment: [''],
    reference_no: [''],
    submit_now: [true],
  });

  protected readonly canMakeOrder = canMakeOrder;
  protected readonly canMakeInvoice = canMakeInvoice;
  protected readonly canMakeCreditNote = canMakeCreditNote;
  protected readonly canReceivePayment = canReceivePayment;
  protected readonly isClosedStatus = isClosedStatus;

  private loadedView: SalesListView | null = null;
  private prefillCustomer = '';
  private optionsReady = false;
  private pendingAction: (() => void) | null = null;

  ngOnInit(): void {
    this.ordersService.loadOptions()
      .pipe(finalize(() => {
        this.optionsReady = true;
        this.pendingAction?.();
        this.pendingAction = null;
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (options) => this.options.set(options), error: () => undefined });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const view = parseView(params.get('view'));
      if (view !== this.loadedView) {
        this.loadedView = view;
        this.view.set(view);
        this.tab.set('all');
        this.page.set(1);
        this.load();
      }
      const create = params.get('new');
      if (create) this.prefillCustomer = params.get('customer') ?? '';
      const edit = params.get('edit');
      let action: (() => void) | null = null;
      if (create && ['Quote', 'Order', 'Invoice'].includes(create)) {
        action = () => this.openNewDocument(create as SalesDocumentType);
      } else if (edit && edit.includes(':')) {
        const [doctype, ...rest] = edit.split(':');
        action = () => this.openEdit(doctype, rest.join(':'));
      }
      if (action) {
        // Defaults (company, price list) come from the options, so wait for them.
        if (this.optionsReady) action();
        else this.pendingAction = action;
        this.clearActionParams();
      }
    });
  }

  // ---- list -----------------------------------------------------------------
  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.selected.set(new Set());
    forkJoin({
      page: this.ordersService.listPage(this.view(), this.tab(), this.searchText.value, this.page(), this.pageSize()),
      counts: this.ordersService.tabCounts(this.view(), this.searchText.value).pipe(catchError(() => of(this.counts()))),
    })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ page, counts }) => {
          this.rows.set(page.rows);
          this.total.set(page.total);
          this.counts.set(counts);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  protected setTab(tab: SalesTab): void {
    this.tab.set(tab);
    this.page.set(1);
    this.load();
  }

  protected search(): void {
    this.page.set(1);
    this.load();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected changePageSize(value: string): void {
    const size = Number(value);
    if (!PAGE_SIZES.includes(size)) return;
    this.pageSize.set(size);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      // Private mode: the choice simply is not remembered.
    }
    this.page.set(1);
    this.load();
  }

  protected toggleRow(row: SalesListRow, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(row.key);
    else next.delete(row.key);
    this.selected.set(next);
  }

  protected toggleAll(checked: boolean): void {
    this.selected.set(checked ? new Set(this.rows().map((row) => row.key)) : new Set());
  }

  protected openDetail(row: SalesListRow): void {
    void this.router.navigate(['/sales', row.doctype, row.name]);
  }

  protected statusLabel(row: SalesListRow): string {
    return row.status || (row.docstatus === 0 ? 'Draft' : row.docstatus === 2 ? 'Cancelled' : 'Submitted');
  }

  protected typeLabel(row: SalesListRow): string {
    return row.doctype === 'Sales Order' && row.order_type && row.order_type !== 'Sales' ? row.order_type : row.documentType;
  }

  // ---- bulk actions ---------------------------------------------------------
  protected submitSelected(): void {
    const drafts = this.selectedRows().filter((row) => row.docstatus === 0);
    this.confirm.ask({
      title: `Submit ${drafts.length} document${drafts.length === 1 ? '' : 's'}?`,
      message: 'Submitting posts the documents to ERPNext ledgers. Submitted documents can only be cancelled, not edited.',
      confirmLabel: 'Submit',
    }).subscribe((ok) => {
      if (ok) this.runBulk(drafts, (row) => this.ordersService.submit(row.doctype, row.name), 'submitted');
    });
  }

  protected cancelSelected(): void {
    const submitted = this.selectedRows().filter((row) => row.docstatus === 1);
    this.confirm.ask({
      title: `Cancel ${submitted.length} document${submitted.length === 1 ? '' : 's'}?`,
      message: 'Cancelling reverses the ledger entries. This cannot be undone.',
      confirmLabel: 'Cancel documents',
      cancelLabel: 'Keep',
      danger: true,
    }).subscribe((ok) => {
      if (ok) this.runBulk(submitted, (row) => this.ordersService.cancel(row.doctype, row.name), 'cancelled');
    });
  }

  protected deleteSelected(): void {
    const drafts = this.selectedRows().filter((row) => row.docstatus === 0);
    this.confirm.ask({
      title: `Delete ${drafts.length} draft${drafts.length === 1 ? '' : 's'}?`,
      message: 'Only drafts are deleted; submitted documents are skipped. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    }).subscribe((ok) => {
      if (ok) this.runBulk(drafts, (row) => this.ordersService.delete(row.doctype, row.name), 'deleted');
    });
  }

  protected duplicateSelected(): void {
    const row = this.singleSelected();
    if (!row) return;
    this.busy.set(true);
    this.ordersService.duplicate(row.doctype, row.name)
      .pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.notifications.success(`Draft ${created.name} created from ${row.name}.`);
          this.load();
        },
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  protected downloadSelectedPdf(): void {
    const row = this.singleSelected();
    if (!row) return;
    this.busy.set(true);
    this.ordersService.downloadPdf(row.doctype, row.name)
      .pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pdf) => downloadBlob(`${row.documentType}-${row.name}.pdf`, pdf),
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  protected exportCsv(): void {
    const rows = this.selectedRows().length ? this.selectedRows() : this.rows();
    downloadCsv(
      `sales-${this.view()}-${todayIso()}.csv`,
      ['Document', 'Type', 'Customer', 'Date', 'Due / Delivery', 'Status', 'Currency', 'Total', 'Outstanding'],
      rows.map((row) => [
        row.name, this.typeLabel(row), row.customer_name || row.customer, row.date, row.due ?? '',
        this.statusLabel(row), row.currency ?? '', row.grand_total ?? 0, row.outstanding_amount ?? '',
      ]),
    );
  }

  /** Runs one request per document, sequentially, and reports partial failures. */
  private runBulk(rows: SalesListRow[], action: (row: SalesListRow) => Observable<unknown>, verb: string): void {
    if (!rows.length) return;
    this.busy.set(true);
    from(rows)
      .pipe(
        concatMap((row) => action(row).pipe(
          map(() => null),
          catchError((error: unknown) => of(`${row.name}: ${frappeErrorMessage(error)}`)),
        )),
        toArray(),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        const failures = results.filter((result): result is string => result !== null);
        const done = rows.length - failures.length;
        if (done) this.notifications.success(`${done} document${done === 1 ? '' : 's'} ${verb}.`);
        if (failures.length) this.notifications.error({ message: failures.join(' · ') }, 9000);
        this.load();
      });
  }

  // ---- row workflow ---------------------------------------------------------
  protected makeOrder(row: SalesListRow): void {
    this.transition(row, 'Sales Order', this.ordersService.makeOrderFromQuote(row.name));
  }

  protected makeInvoice(row: SalesListRow): void {
    this.transition(row, 'Sales Invoice', this.ordersService.makeInvoiceFromOrder(row.name));
  }

  protected makeCreditNote(row: SalesListRow): void {
    this.transition(row, 'Credit Note', this.ordersService.makeCreditNoteFromInvoice(row.name));
  }

  private transition(row: SalesListRow, label: string, operation: Observable<{ name: string }>): void {
    this.busyRowKey.set(row.key);
    operation
      .pipe(finalize(() => this.busyRowKey.set(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.notifications.success(`${label} ${created.name} created from ${row.name}.`);
          this.load();
        },
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  // ---- assign & payment dialogs -----------------------------------------------
  protected openAssign(): void {
    this.assignUser.setValue('');
    this.toolError.set(null);
    this.toolDialog.set('assign');
  }

  protected openPayment(row: SalesListRow | null = this.singleSelected()): void {
    if (!row || !canReceivePayment(row)) return;
    this.selected.set(new Set([row.key]));
    this.toolError.set(null);
    this.paymentForm.reset({
      amount: row.outstanding_amount ?? row.grand_total ?? 0,
      posting_date: todayIso(),
      mode_of_payment: this.modesOfPayment()[0] ?? '',
      reference_no: '',
      submit_now: true,
    });
    this.toolDialog.set('payment');
    if (!this.modesOfPayment().length) {
      this.paymentsService.listModesOfPayment().subscribe((modes) => {
        this.modesOfPayment.set(modes);
        if (!this.paymentForm.controls.mode_of_payment.value) {
          this.paymentForm.controls.mode_of_payment.setValue(modes[0] ?? '');
        }
      });
    }
  }

  protected closeToolDialog(): void {
    if (!this.busy()) this.toolDialog.set(null);
  }

  protected saveAssign(): void {
    const user = this.assignUser.value.trim();
    if (!user) {
      this.toolError.set('Choose an ERPNext user.');
      return;
    }
    this.toolDialog.set(null);
    this.runBulk(this.selectedRows(), (row) => this.ordersService.assign(row.doctype, row.name, user), `assigned to ${user}`);
  }

  protected savePayment(): void {
    const row = this.singleSelected();
    const value = this.paymentForm.getRawValue();
    if (!row || !(Number(value.amount) > 0)) {
      this.toolError.set('Enter an amount greater than zero.');
      return;
    }
    this.busy.set(true);
    this.toolError.set(null);
    this.paymentsService
      .createPayment(row.doctype, row.name, Number(value.amount), {
        postingDate: value.posting_date,
        modeOfPayment: value.mode_of_payment || undefined,
        referenceNo: value.reference_no || undefined,
        submit: value.submit_now,
      })
      .pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (name) => {
          this.toolDialog.set(null);
          this.notifications.success(`Payment ${name} ${value.submit_now ? 'submitted' : 'saved as draft'}.`);
          this.load();
        },
        error: (error: unknown) => this.toolError.set(frappeErrorMessage(error)),
      });
  }

  // ---- create / edit form -------------------------------------------------------
  protected openNewDocument(type: SalesDocumentType): void {
    this.newMenuOpen.set(false);
    const company = this.options().companies[0];
    const today = todayIso();
    this.createType.set(type);
    this.editing.set(null);
    this.formError.set(null);
    this.orderForm.reset({
      customer: '',
      company: company?.name ?? '',
      date: today,
      due: type === 'Invoice' ? today : addDaysIso(today, type === 'Quote' ? 30 : 1),
      currency: company?.default_currency ?? '',
      selling_price_list: this.options().priceLists.includes('Standard Selling') ? 'Standard Selling' : this.options().priceLists[0] ?? '',
      set_warehouse: this.options().warehouses[0] ?? '',
      po_no: '',
      remarks: '',
      payment_terms_template: '',
      assigned_to: '',
      taxes_and_charges: this.defaultTaxTemplate(company?.name ?? ''),
    });
    this.orderItems.clear();
    this.addItem();
    this.dialogOpen.set(true);
    if (this.prefillCustomer) {
      this.orderForm.controls.customer.setValue(this.prefillCustomer);
      this.chooseCustomer(this.prefillCustomer);
      this.prefillCustomer = '';
    }
  }

  protected openEdit(doctype: string, name: string): void {
    this.loadingDocument.set(true);
    this.ordersService.getDocument(doctype, name)
      .pipe(finalize(() => this.loadingDocument.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (doc.docstatus !== 0) {
            this.notifications.info(`${name} is submitted and can no longer be edited.`);
            return;
          }
          const type: SalesDocumentType = doctype === 'Quotation' ? 'Quote' : doctype === 'Sales Order' ? 'Order'
            : doc.is_return ? 'Credit Note' : 'Invoice';
          this.createType.set(type);
          this.editing.set({ doctype, name, returnAgainst: doc.return_against });
          this.formError.set(null);
          this.orderForm.reset({
            customer: doc.customer ?? doc.party_name ?? '',
            company: doc.company,
            date: doc.transaction_date ?? doc.posting_date ?? todayIso(),
            due: doc.delivery_date ?? doc.due_date ?? doc.valid_till ?? todayIso(),
            currency: doc.currency ?? '',
            selling_price_list: doc.selling_price_list ?? '',
            set_warehouse: doc.set_warehouse ?? '',
            po_no: doc.po_no ?? '',
            remarks: doc.remarks ?? doc.terms ?? '',
            payment_terms_template: doc.payment_terms_template ?? '',
            assigned_to: '',
            taxes_and_charges: doc.taxes_and_charges ?? '',
          });
          this.orderItems.clear();
          for (const item of doc.items ?? []) this.orderItems.push(this.createItemRow({ ...item, qty: Math.abs(item.qty) }));
          if (!this.orderItems.length) this.addItem();
          this.dialogOpen.set(true);
        },
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  protected closeDialog(): void {
    if (!this.saving()) this.dialogOpen.set(false);
  }

  protected addItem(): void {
    this.orderItems.push(this.createItemRow());
  }

  protected removeItem(index: number): void {
    if (this.orderItems.length > 1) this.orderItems.removeAt(index);
  }

  protected chooseCustomer(customer: string): void {
    this.ordersService.customerDefaults(customer).subscribe({
      next: (defaults) => {
        if (defaults.default_currency) this.orderForm.controls.currency.setValue(defaults.default_currency);
        if (defaults.default_price_list) this.orderForm.controls.selling_price_list.setValue(defaults.default_price_list);
      },
      error: () => undefined,
    });
  }

  protected chooseCompany(companyName: string): void {
    const company = this.options().companies.find((row) => row.name === companyName);
    if (company?.default_currency) this.orderForm.controls.currency.setValue(company.default_currency);
    const selected = this.orderForm.controls.taxes_and_charges.value;
    if (!this.options().taxTemplates.some((t) => t.name === selected && t.company === companyName)) {
      this.orderForm.controls.taxes_and_charges.setValue(this.defaultTaxTemplate(companyName));
    }
  }

  /** Fills name, UOM and the ERPNext price (price list + pricing rules). */
  protected chooseItem(index: number, itemCode: string): void {
    const row = this.orderItems.at(index);
    const form = this.orderForm.getRawValue();
    this.pricingLine.set(index);
    this.ordersService.itemPricing({
      itemCode,
      doctype: doctypeForType(this.createType()),
      customer: form.customer,
      company: form.company,
      currency: form.currency,
      priceList: form.selling_price_list,
      date: form.date,
      qty: Number(row.controls.qty.value) || 1,
      warehouse: form.set_warehouse,
    })
      .pipe(finalize(() => this.pricingLine.set(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pricing) => row.patchValue({
          item_code: itemCode,
          item_name: pricing.item_name ?? itemCode,
          uom: pricing.uom ?? pricing.stock_uom ?? '',
          conversion_factor: pricing.conversion_factor ?? 1,
          price_list_rate: pricing.price_list_rate ?? 0,
          rate: pricing.rate ?? pricing.price_list_rate ?? 0,
        }),
        error: (error: unknown) => this.formError.set(`Could not load the price for ${itemCode}: ${frappeErrorMessage(error)}`),
      });
  }

  protected lineAmount(index: number): number {
    const row = this.orderItems.at(index).getRawValue();
    return Number(row.qty || 0) * Number(row.rate || 0);
  }

  protected orderTotal(): number {
    return this.orderItems.controls.reduce((sum, _row, index) => sum + this.lineAmount(index), 0);
  }

  protected money(value: number): string {
    return formatMoney(value, this.orderForm.controls.currency.value);
  }

  protected taxTemplates() {
    const company = this.orderForm.controls.company.value;
    return this.options().taxTemplates.filter((template) => !company || template.company === company);
  }

  protected dateLabel(): string {
    const type = this.createType();
    return type === 'Quote' ? 'Quote date' : type === 'Order' ? 'Order date' : 'Invoice date';
  }

  protected dueLabel(): string {
    const type = this.createType();
    return type === 'Quote' ? 'Valid until' : type === 'Order' ? 'Delivery date' : 'Payment due';
  }

  protected saveDocument(): void {
    const value = this.orderForm.getRawValue();
    const items = this.orderItems.getRawValue().filter((row) => row.item_code && Number(row.qty) > 0);
    if (this.orderForm.invalid || !items.length) {
      this.orderForm.markAllAsTouched();
      this.orderItems.markAllAsTouched();
      this.formError.set('Choose a customer and add at least one item with a quantity greater than zero.');
      return;
    }
    // ERPNext allows the same day; only an earlier date is invalid.
    if (value.due < value.date) {
      this.formError.set(`${this.dueLabel()} cannot be before the ${this.dateLabel().toLowerCase()}.`);
      return;
    }

    const input: SalesDocumentInput = {
      customer: value.customer.trim(),
      company: value.company,
      date: value.date,
      due: value.due,
      currency: value.currency,
      selling_price_list: value.selling_price_list,
      set_warehouse: value.set_warehouse,
      taxes_and_charges: value.taxes_and_charges,
      po_no: value.po_no,
      remarks: value.remarks,
      payment_terms_template: value.payment_terms_template,
      items: items.map((row): SalesOrderItem => ({
        item_code: row.item_code,
        item_name: row.item_name || undefined,
        qty: Number(row.qty),
        rate: Number(row.rate),
        uom: row.uom || undefined,
        conversion_factor: Number(row.conversion_factor) || 1,
        ...(row.price_list_rate ? { price_list_rate: Number(row.price_list_rate) } : {}),
      })),
    };

    const editing = this.editing();
    const type = this.createType();
    const save$ = editing
      ? this.ordersService.update(type, editing.name, input, editing.returnAgainst)
      : this.ordersService.create(type, input);
    const assignee = value.assigned_to.trim();

    this.saving.set(true);
    this.formError.set(null);
    save$
      .pipe(
        switchMap((saved) => !assignee
          ? of({ saved, assignError: null as string | null })
          : this.ordersService.assign(doctypeForType(type), saved.name, assignee).pipe(
            map(() => ({ saved, assignError: null as string | null })),
            catchError((error: unknown) => of({ saved, assignError: frappeErrorMessage(error) })),
          )),
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ saved, assignError }) => {
          this.dialogOpen.set(false);
          this.notifications.success(`${type} ${saved.name} ${editing ? 'updated' : 'created as draft'}.`);
          if (assignError) this.notifications.error({ message: `Saved, but assignment failed: ${assignError}` });
          this.load();
        },
        error: (error: unknown) => this.formError.set(frappeErrorMessage(error)),
      });
  }

  private defaultTaxTemplate(company: string): string {
    return this.options().taxTemplates.find((t) => t.company === company && t.is_default === 1)?.name ?? '';
  }

  private createItemRow(item?: Partial<SalesOrderItem> & { price_list_rate?: number }) {
    return this.formBuilder.nonNullable.group({
      item_code: [item?.item_code ?? '', Validators.required],
      item_name: [item?.item_name ?? ''],
      qty: [item?.qty ?? 1, [Validators.required, Validators.min(0.000001)]],
      rate: [item?.rate ?? 0, [Validators.required, Validators.min(0)]],
      uom: [item?.uom ?? ''],
      conversion_factor: [item?.conversion_factor ?? 1],
      price_list_rate: [item?.price_list_rate ?? 0],
    });
  }

  private clearActionParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { new: null, edit: null, customer: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

function parseView(value: string | null): SalesListView {
  return value && value in SALES_VIEWS ? (value as SalesListView) : 'all';
}

function readPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(stored) ? stored : 20;
  } catch {
    return 20;
  }
}
