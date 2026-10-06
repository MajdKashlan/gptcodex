import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, distinctUntilChanged, finalize, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { SalesOrderItem } from '../../models/sales-order.models';
import { PageTopbarAction, PageTopbarComponent } from '../../shared/components/page-topbar/page-topbar.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { getPageCount, paginateCollection } from './orders-pagination';
import { OrderOptions, OrdersService, SalesDocumentType, SalesListRow, SalesListView, SalesOrderData } from './orders.service';

type OrderTab = 'all' | 'open' | 'closed';
type OrderToolDialog = 'status' | 'type' | 'assigned' | 'payment' | 'settings';

@Component({
  selector: 'app-orders',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly ordersService = inject(OrdersService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];
  protected readonly orders = signal<SalesListRow[]>([]);
  protected readonly options = signal<OrderOptions>({ customers: [], items: [], companies: [], priceLists: [], warehouses: [] });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly workflowBusyName = signal<string | null>(null);
  protected readonly loadingOrder = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly toolError = signal<string | null>(null);
  protected readonly toolMessage = signal<string | null>(null);
  protected readonly toolBusy = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly pageReady = signal(false);
  protected readonly addMenuOpen = signal(false);
  protected readonly createType = signal<SalesDocumentType>('Order');
  protected readonly salesView = signal<SalesListView>('all');
  protected readonly toolDialog = signal<OrderToolDialog | null>(null);
  protected readonly editingOrder = signal<SalesListRow | null>(null);
  protected readonly editingReturnAgainst = signal<string | undefined>(undefined);
  protected readonly selectedTab = signal<OrderTab>('all');
  protected readonly selectedOrderNames = signal<Set<string>>(new Set());
  protected readonly pageSize = signal(20);
  protected readonly currentPage = signal(1);
  protected readonly hideSearch = signal(false);
  protected readonly compactRows = signal(false);
  protected readonly toolValue = new FormControl('', { nonNullable: true });
  protected readonly pageSizeControl = new FormControl('20', { nonNullable: true });
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly visibleOrders = computed(() => this.orders().filter((order) => {
    const isClosed = ['Closed', 'Completed', 'Cancelled'].includes(order.status ?? '');
    return this.selectedTab() === 'all' || (this.selectedTab() === 'closed' ? isClosed : !isClosed);
  }));
  protected readonly pageCount = computed(() => getPageCount(this.visibleOrders(), this.pageSize()));
  protected readonly pagedOrders = computed(() => paginateCollection(this.visibleOrders(), this.currentPage(), this.pageSize()));
  protected readonly selectedOrders = computed(() => this.visibleOrders().filter((order) => this.selectedOrderNames().has(this.salesRowKey(order))));
  protected readonly selectedSalesOrders = computed(() => this.selectedOrders().filter((order) => order.doctype === 'Sales Order'));
  protected readonly canChangeSelectedStatus = computed(() => {
    const selected = this.selectedOrders();
    return selected.length > 0 && selected.every((order) => order.doctype === selected[0].doctype);
  });
  protected readonly canPaySelected = computed(() => this.selectedOrders().length === 1 && this.canReceivePayment(this.selectedOrders()[0]));
  protected readonly canManageSalesOrders = computed(() => this.selectedOrders().length > 0 &&
    this.selectedOrders().every((order) => order.doctype === 'Sales Order'));
  protected readonly allVisibleSelected = computed(() => this.visibleOrders().length > 0 &&
    this.visibleOrders().every((order) => this.selectedOrderNames().has(this.salesRowKey(order))));
  protected readonly salesViewTitle = computed(() => ({
    all: 'All Sales', 'credit-notes': 'Credit Notes', 'customer-orders': 'Customer Orders',
    invoices: 'Invoices', orders: 'Orders', quotes: 'Quotes',
  })[this.salesView()]);
  protected readonly openOrderCount = computed(() => this.orders().filter((order) =>
    !['Closed', 'Completed', 'Cancelled'].includes(order.status ?? ''),
  ).length);
  protected readonly closedOrderCount = computed(() => this.orders().filter((order) =>
    ['Closed', 'Completed', 'Cancelled'].includes(order.status ?? ''),
  ).length);
  protected readonly orderForm = this.formBuilder.nonNullable.group({
    customer: ['', Validators.required],
    company: ['', Validators.required],
    transaction_date: [this.today(), Validators.required],
    delivery_date: [this.tomorrow(), Validators.required],
    currency: ['', Validators.required],
    selling_price_list: ['', Validators.required],
    set_warehouse: [''],
    po_no: [''],
    remarks: [''],
    payment_terms_template: [''],
    assigned_to: [''],
  });
  protected readonly orderItems = this.formBuilder.array([this.createItemRow()]);

  ngOnInit(): void {
    this.restorePageSettings();
    this.route.queryParamMap.pipe(
      map((params) => this.parseSalesView(params.get('view'))),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((view) => {
      if (view === this.salesView()) return;
      this.salesView.set(view);
      this.currentPage.set(1);
      this.selectedOrderNames.set(new Set());
      if (this.pageReady()) this.loadOrders();
    });
    const session$: Observable<unknown> = this.auth.isAuthenticated()
      ? of(null)
      : this.auth.restoreSession();
    session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.pageReady.set(true);
        this.loadPage();
      },
      error: () => void this.router.navigate(['/login']),
    });
  }

  protected handleTopbarAction(actionId: string): void {
    if (actionId === 'logout') {
      this.signOut();
    }
  }

  protected signOut(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/login']) });
  }

  protected setTab(tab: OrderTab): void {
    this.currentPage.set(1);
    this.selectedTab.set(tab);
  }

  protected search(): void {
    this.currentPage.set(1);
    this.loadOrders();
  }

  protected refresh(): void {
    this.currentPage.set(1);
    this.loadOrders();
  }

  protected goToPage(page: number): void {
    const nextPage = Math.min(Math.max(1, page), this.pageCount());
    this.currentPage.set(nextPage);
  }

  protected toggleOrder(order: SalesListRow, checked: boolean): void {
    const selected = new Set(this.selectedOrderNames());
    const key = this.salesRowKey(order);
    if (checked) {
      selected.add(key);
    } else {
      selected.delete(key);
    }
    this.selectedOrderNames.set(selected);
  }

  protected toggleAllVisible(checked: boolean): void {
    const selected = new Set(this.selectedOrderNames());
    for (const order of this.visibleOrders()) {
      const key = this.salesRowKey(order);
      if (checked) {
        selected.add(key);
      } else {
        selected.delete(key);
      }
    }
    this.selectedOrderNames.set(selected);
  }

  protected openToolDialog(dialog: OrderToolDialog): void {
    this.toolError.set(null);
    this.toolMessage.set(null);
    this.toolDialog.set(dialog);
    if (dialog === 'status') this.toolValue.setValue('submit');
    if (dialog === 'type') this.toolValue.setValue('Sales');
    if (dialog === 'assigned') this.toolValue.setValue('');
    if (dialog === 'payment') {
      const order = this.selectedOrders()[0];
      this.toolValue.setValue(String(order?.outstanding_amount ?? order?.grand_total ?? ''));
    }
    if (dialog === 'settings') this.pageSizeControl.setValue(String(this.pageSize()));
  }

  protected closeToolDialog(): void {
    if (!this.toolBusy()) this.toolDialog.set(null);
  }

  protected runToolAction(): void {
    const selected = this.selectedSalesOrders();
    const selectedDocuments = this.selectedOrders();
    const dialog = this.toolDialog();
    if (dialog === 'settings') {
      this.savePageSettings();
      return;
    }

    let operations: Observable<unknown>[] = [];
    if (dialog === 'status') {
      const action = this.toolValue.value as 'submit' | 'cancel';
      const eligible = selectedDocuments.filter((order) => action === 'submit' ? order.docstatus === 0 : order.docstatus === 1);
      if (!eligible.length) {
        this.toolError.set(action === 'submit' ? 'Select at least one draft document to submit.' : 'Select at least one submitted document to cancel.');
        return;
      }
      operations = eligible.map((order) => this.ordersService.changeDocumentStatus(order.doctype, order.name, action));
    } else if (dialog === 'type') {
      operations = selected.map((order) => this.ordersService.updateField(order.name, 'order_type', this.toolValue.value));
    } else if (dialog === 'assigned') {
      const user = this.toolValue.value.trim();
      if (!user) {
        this.toolError.set('Enter the ERPNext user email or user ID to assign.');
        return;
      }
      operations = selected.map((order) => this.ordersService.assign(order.name, user));
    } else if (dialog === 'payment') {
      const amount = Number(this.toolValue.value);
      const payableDocument = this.selectedOrders()[0];
      if (!payableDocument || this.selectedOrders().length !== 1 || !Number.isFinite(amount) || amount <= 0) {
        this.toolError.set('Choose one payable sales document and enter an amount greater than zero.');
        return;
      }
      if (!this.canReceivePayment(payableDocument)) {
        this.toolError.set('Payment can only be added to a submitted Sales Order or an unpaid submitted Sales Invoice.');
        return;
      }
      operations = [this.ordersService.addPayment(payableDocument.doctype, payableDocument.name, amount)];
    }
    this.completeToolAction(operations);
  }

  protected exportExcel(): void {
    const rows = this.selectedOrders();
    const columns = ['Sale ID', 'Customer', 'Order Date', 'Delivery Date', 'Type', 'Status', 'Currency', 'Total'];
    const values = rows.map((order) => [
      order.name, order.customer_name || order.customer, order.transaction_date, order.delivery_date ?? '',
      order.doctype === 'Sales Order' ? order.order_type ?? order.documentType : order.documentType,
      order.status ?? '', order.currency ?? '', String(order.grand_total ?? 0),
    ]);
    const csv = [columns, ...values].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    this.downloadFile(`sales-${this.salesView()}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  }

  protected downloadPdf(): void {
    const rows = this.selectedOrders();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.toolMessage.set('Allow pop-ups to print the selected sales orders as PDF.');
      return;
    }
    const body = rows.map((order) => `<tr><td>${this.escapeHtml(order.name)}</td><td>${this.escapeHtml(order.customer_name || order.customer)}</td><td>${this.escapeHtml(order.transaction_date)}</td><td>${this.escapeHtml(order.status ?? '')}</td><td>${this.escapeHtml(this.formatCurrency(order.grand_total, order.currency))}</td></tr>`).join('');
    printWindow.document.write(`<html><head><title>Sales Orders</title><style>body{font:14px Arial,sans-serif;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eef3f5}@media print{body{padding:0}}</style></head><body><h1>Sales Orders</h1><table><thead><tr><th>Sale ID</th><th>Customer</th><th>Order Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  }

  protected emailSelected(): void {
    const references = this.selectedOrders().map((order) => order.name).join(', ');
    const subject = encodeURIComponent(`Sales orders ${references}`);
    const body = encodeURIComponent(`Please see the following sales orders: ${references}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  protected duplicateSelected(): void {
    const order = this.selectedSalesOrders()[0];
    if (!order || this.selectedOrders().length !== 1) return;
    if (!window.confirm(`Create a new draft based on ${order.name}?`)) return;
    this.completeToolAction([this.ordersService.duplicate(order.name)]);
  }

  protected deleteSelected(): void {
    const orders = this.selectedSalesOrders();
    const drafts = orders.filter((order) => order.docstatus === 0);
    if (!drafts.length) {
      this.toolMessage.set('Only draft sales orders can be deleted.');
      return;
    }
    if (!window.confirm(`Delete ${drafts.length} selected draft sales order${drafts.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    this.completeToolAction(drafts.map((order) => this.ordersService.delete(order.name)));
  }

  protected canMakeOrder(order: SalesListRow): boolean {
    return order.doctype === 'Quotation' && order.docstatus === 1 && !['Ordered', 'Expired', 'Lost', 'Cancelled'].includes(order.status ?? '');
  }

  protected canMakeInvoice(order: SalesListRow): boolean {
    return order.doctype === 'Sales Order' && order.docstatus === 1 && !['Closed', 'Cancelled', 'Completed'].includes(order.status ?? '');
  }

  protected canMakeCreditNote(order: SalesListRow): boolean {
    return order.doctype === 'Sales Invoice' && order.docstatus === 1 && order.is_return !== 1;
  }

  protected canReceivePayment(order: SalesListRow | undefined): boolean {
    if (!order || order.docstatus !== 1) return false;
    if (order.doctype === 'Sales Order') return !['Closed', 'Cancelled', 'Completed'].includes(order.status ?? '');
    return order.doctype === 'Sales Invoice' && order.is_return !== 1 && (order.outstanding_amount ?? 0) > 0;
  }

  protected makeOrderFromQuote(order: SalesListRow): void {
    this.runDocumentTransition(order, 'Sales Order', () => this.ordersService.makeOrderFromQuote(order.name));
  }

  protected makeInvoiceFromOrder(order: SalesListRow): void {
    this.runDocumentTransition(order, 'Sales Invoice', () => this.ordersService.makeInvoiceFromOrder(order.name));
  }

  protected makeCreditNoteFromInvoice(order: SalesListRow): void {
    this.runDocumentTransition(order, 'Credit Note', () => this.ordersService.makeCreditNoteFromInvoice(order.name));
  }

  protected openPaymentFor(order: SalesListRow): void {
    if (!this.canReceivePayment(order)) return;
    this.selectedOrderNames.set(new Set([this.salesRowKey(order)]));
    this.openToolDialog('payment');
  }

  protected openNewOrder(): void {
    this.openNewDocument('Order');
  }

  protected openNewDocument(type: SalesDocumentType): void {
    if (type === 'Credit Note') {
      this.addMenuOpen.set(false);
      this.toolMessage.set('Create a Credit Note from a submitted invoice using its Create Credit Note action.');
      return;
    }
    this.addMenuOpen.set(false);
    this.createType.set(type);
    this.editingOrder.set(null);
    this.editingReturnAgainst.set(undefined);
    this.formError.set(null);
    this.orderForm.reset({
      customer: '',
      company: this.options().companies[0]?.name ?? '',
      transaction_date: this.today(),
      delivery_date: this.tomorrow(),
      currency: this.options().companies[0]?.default_currency ?? 'USD',
      selling_price_list: this.options().priceLists.includes('Standard Selling')
        ? 'Standard Selling'
        : this.options().priceLists[0] ?? '',
      set_warehouse: this.options().warehouses[0] ?? '',
      po_no: '',
      remarks: '',
      payment_terms_template: '',
      assigned_to: '',
    });
    this.orderItems.clear();
    this.addOrderItem();
    this.dialogOpen.set(true);
  }

  protected openEditOrder(order: SalesListRow): void {
    if (order.docstatus !== 0) {
      return;
    }
    this.createType.set(order.documentType as SalesDocumentType);
    this.loadingOrder.set(true);
    this.formError.set(null);
    this.ordersService.getSalesDocument(order.doctype, order.name)
      .pipe(finalize(() => this.loadingOrder.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (details) => {
          if (details.docstatus !== 0) {
            this.formError.set(`Only draft ${order.documentType.toLowerCase()} documents can be edited.`);
            return;
          }
          this.editingOrder.set(order);
          this.editingReturnAgainst.set(details.return_against);
          this.orderForm.reset({
            customer: details.customer ?? details.party_name ?? order.customer,
            company: details.company,
            transaction_date: details.transaction_date ?? details.posting_date ?? order.transaction_date,
            delivery_date: details.delivery_date ?? details.due_date ?? details.valid_till ?? order.delivery_date ?? order.transaction_date,
            currency: details.currency ?? '',
            selling_price_list: details.selling_price_list ?? '',
            set_warehouse: details.set_warehouse ?? '',
            po_no: details.po_no ?? '',
            remarks: details.remarks ?? details.terms ?? '',
            payment_terms_template: details.payment_terms_template ?? '',
            assigned_to: '',
          });
          this.orderItems.clear();
          for (const item of details.items ?? []) {
            this.orderItems.push(this.createItemRow({ ...item, qty: Math.abs(item.qty) }));
          }
          if (!this.orderItems.length) {
            this.addOrderItem();
          }
          this.dialogOpen.set(true);
        },
        error: (error: unknown) => this.formError.set(this.errorMessage(error)),
      });
  }

  protected editAvailability(order: SalesListRow): string {
    if (order.docstatus === 1) return `Submitted ${order.documentType}s cannot be edited.`;
    if (order.docstatus === 2) return `Cancelled ${order.documentType}s cannot be edited.`;
    return `Only draft ${order.documentType}s can be edited.`;
  }

  protected closeDialog(): void {
    if (!this.saving()) {
      this.dialogOpen.set(false);
    }
  }

  protected addOrderItem(): void {
    this.orderItems.push(this.createItemRow());
  }

  protected removeOrderItem(index: number): void {
    if (this.orderItems.length > 1) {
      this.orderItems.removeAt(index);
    }
  }

  protected chooseCustomer(event: Event): void {
    const customerName = (event.target as HTMLSelectElement).value;
    const customer = this.options().customers.find((row) => row.name === customerName);
    if (customer?.default_currency) {
      this.orderForm.controls.currency.setValue(customer.default_currency);
    }
    if (customer?.default_price_list) {
      this.orderForm.controls.selling_price_list.setValue(customer.default_price_list);
    }
  }

  protected chooseItem(index: number, event: Event): void {
    const itemCode = (event.target as HTMLSelectElement).value;
    const item = this.options().items.find((row) => row.item_code === itemCode);
    if (!item) {
      return;
    }
    this.orderItems.at(index).patchValue({
      item_code: item.item_code,
      item_name: item.item_name ?? item.item_code,
      uom: item.stock_uom ?? '',
      rate: item.standard_rate ?? 0,
    });
  }

  protected lineAmount(index: number): number {
    const row = this.orderItems.at(index).getRawValue();
    return Number(row.qty || 0) * Number(row.rate || 0);
  }

  protected orderTotal(): number {
    return this.orderItems.controls.reduce((sum, _row, index) => sum + this.lineAmount(index), 0);
  }

  protected saveOrder(): void {
    const rows = this.orderItems.getRawValue().filter((row) => row.item_code && Number(row.qty) > 0);
    if (this.orderForm.controls.delivery_date.value <= this.orderForm.controls.transaction_date.value) {
      this.formError.set('Delivery Date must be after Order Date.');
      return;
    }
    if (this.orderForm.invalid || this.orderItems.invalid || !rows.length) {
      this.orderForm.markAllAsTouched();
      this.orderItems.markAllAsTouched();
      this.formError.set('Choose a customer and add at least one item with a quantity greater than zero.');
      return;
    }

    const details: SalesOrderData = {
      ...this.orderForm.getRawValue(),
      delivery_date: this.orderForm.controls.delivery_date.value,
      items: rows.map((row) => ({
        item_code: row.item_code,
        item_name: row.item_name,
        qty: Number(row.qty),
        rate: Number(row.rate),
        uom: row.uom || undefined,
        warehouse: this.orderForm.controls.set_warehouse.value || undefined,
        amount: Number(row.qty) * Number(row.rate),
      })),
    };
    const current = this.editingOrder();
    this.saving.set(true);
    this.formError.set(null);
    const assignedTo = this.orderForm.controls.assigned_to.value.trim();
    const additionalDetails = {
      ...details,
      po_no: this.orderForm.controls.po_no.value || undefined,
      remarks: this.orderForm.controls.remarks.value || undefined,
      payment_terms_template: this.orderForm.controls.payment_terms_template.value || undefined,
    };
    const save$ = current
      ? this.ordersService.updateSalesDocument(
        this.createType(), current.doctype, current.name, additionalDetails, this.editingReturnAgainst(),
      )
      : this.ordersService.createSalesDocument(this.createType(), additionalDetails);
    save$.pipe(switchMap((created) => {
      if (current || !assignedTo) {
        return of({ created, assignmentError: null as string | null });
      }
      const doctype = this.createType() === 'Quote'
        ? 'Quotation'
        : this.createType() === 'Invoice' || this.createType() === 'Credit Note'
          ? 'Sales Invoice'
          : 'Sales Order';
      return this.ordersService.assign(created.name, assignedTo, doctype).pipe(
        map(() => ({ created, assignmentError: null as string | null })),
        catchError((error: unknown) => of({ created, assignmentError: this.errorMessage(error) })),
      );
    }))
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ created, assignmentError }) => {
          this.dialogOpen.set(false);
          if (assignmentError) {
            this.toolMessage.set(`${this.createType()} ${created.name} created, but assignment failed: ${assignmentError}`);
          } else if (!current && this.createType() !== 'Order') {
            this.toolMessage.set(`${this.createType()} ${created.name} created.`);
          }
          if (current || this.createType() === 'Order') {
            this.loadOrders();
          }
        },
        error: (error: unknown) => this.formError.set(this.errorMessage(error)),
      });
  }

  protected formatCurrency(amount: number | undefined, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount ?? 0);
  }

  protected salesRowKey(order: SalesListRow): string {
    return `${order.doctype}:${order.name}`;
  }

  private loadPage(): void {
    this.loading.set(true);
    forkJoin({ options: this.ordersService.loadOptions(), orders: this.ordersService.listByView(this.salesView(), this.searchText.value, this.pageSize()) })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ options, orders }) => {
          this.options.set(options);
          this.orders.set(orders);
          this.currentPage.set(Math.min(this.currentPage(), this.pageCount()));
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
  }

  private parseSalesView(value: string | null): SalesListView {
    const views: SalesListView[] = ['all', 'credit-notes', 'customer-orders', 'invoices', 'orders', 'quotes'];
    return views.includes(value as SalesListView) ? value as SalesListView : 'all';
  }

  private runDocumentTransition(
    source: SalesListRow,
    targetLabel: string,
    operation: () => Observable<{ name: string }>,
  ): void {
    this.workflowBusyName.set(this.salesRowKey(source));
    this.toolError.set(null);
    operation()
      .pipe(finalize(() => this.workflowBusyName.set(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.toolMessage.set(`${targetLabel} ${created.name} created from ${source.name}.`);
          this.loadOrders();
        },
        error: (error: unknown) => this.toolMessage.set(this.errorMessage(error)),
      });
  }

  private loadOrders(): void {
    this.loading.set(true);
    this.ordersService.listByView(this.salesView(), this.searchText.value, this.pageSize())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (orders) => {
          this.orders.set(orders);
          this.currentPage.set(Math.min(this.currentPage(), this.pageCount()));
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
  }

  private completeToolAction(operations: Observable<unknown>[]): void {
    if (!operations.length) return;
    this.toolBusy.set(true);
    forkJoin(operations)
      .pipe(finalize(() => this.toolBusy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const action = this.toolDialog();
          this.toolDialog.set(null);
          this.selectedOrderNames.set(new Set());
          this.toolMessage.set(action === 'payment' ? 'Payment Entry created.' : 'Sales document action completed.');
          this.loadOrders();
        },
        error: (error: unknown) => this.toolError.set(this.errorMessage(error)),
      });
  }

  private restorePageSettings(): void {
    try {
      const settings = JSON.parse(localStorage.getItem('sales-order-page-settings') ?? '{}') as {
        pageSize?: number; hideSearch?: boolean; compactRows?: boolean;
      };
      if (settings.pageSize && [10, 20, 50, 100, 200].includes(settings.pageSize)) this.pageSize.set(settings.pageSize);
      this.hideSearch.set(settings.hideSearch ?? false);
      this.compactRows.set(settings.compactRows ?? false);
    } catch {
      this.pageSize.set(20);
      this.hideSearch.set(false);
      this.compactRows.set(false);
    }
  }

  private savePageSettings(): void {
    const pageSize = Number(this.pageSizeControl.value);
    if (![10, 20, 50, 100, 200].includes(pageSize)) {
      this.toolError.set('Choose a page size from the list.');
      return;
    }
    this.pageSize.set(pageSize);
    this.currentPage.set(1);
    try {
      localStorage.setItem('sales-order-page-settings', JSON.stringify({
        pageSize,
        hideSearch: this.hideSearch(),
        compactRows: this.compactRows(),
      }));
    } catch {
      this.toolError.set('Browser storage is unavailable, so page settings could not be saved.');
      return;
    }
    this.toolDialog.set(null);
    this.loadOrders();
  }

  private downloadFile(filename: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
  }

  private createItemRow(item?: SalesOrderItem) {
    return this.formBuilder.nonNullable.group({
      item_code: [item?.item_code ?? '', Validators.required],
      item_name: [item?.item_name ?? ''],
      qty: [item?.qty ?? 1, [Validators.required, Validators.min(0.000001)]],
      rate: [item?.rate ?? 0, [Validators.required, Validators.min(0)]],
      uom: [item?.uom ?? ''],
    });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private tomorrow(): string {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  private errorMessage(error: unknown): string {
    const details = error as { error?: { _server_messages?: string; message?: string } };
    if (details.error?._server_messages) {
      try {
        const messages = JSON.parse(details.error._server_messages) as string[];
        const firstMessage = messages[0] ? JSON.parse(messages[0]) as { message?: string } : null;
        if (firstMessage?.message) {
          return firstMessage.message.replace(/<[^>]+>/g, '');
        }
      } catch {
        return 'ERPNext could not complete this sales order operation.';
      }
    }
    return details.error?.message ?? 'ERPNext could not complete this sales order operation.';
  }

}