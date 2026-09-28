import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, Observable, of } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextSalesOrder, SalesOrderItem } from '../../models/sales-order.models';
import { PageTopbarAction, PageTopbarComponent } from '../../shared/components/page-topbar/page-topbar.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { OrderOptions, OrdersService, SalesOrderData } from './orders.service';

type OrderTab = 'all' | 'open' | 'closed';

@Component({
  selector: 'app-orders',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly ordersService = inject(OrdersService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];
  protected readonly orders = signal<ErpNextSalesOrder[]>([]);
  protected readonly options = signal<OrderOptions>({ customers: [], items: [], companies: [], priceLists: [], warehouses: [] });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadingOrder = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editingOrder = signal<ErpNextSalesOrder | null>(null);
  protected readonly selectedTab = signal<OrderTab>('all');
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly visibleOrders = computed(() => this.orders().filter((order) => {
    const isClosed = ['Closed', 'Completed', 'Cancelled'].includes(order.status ?? '');
    return this.selectedTab() === 'all' || (this.selectedTab() === 'closed' ? isClosed : !isClosed);
  }));
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
    delivery_date: [this.today(), Validators.required],
    currency: ['', Validators.required],
    selling_price_list: ['', Validators.required],
    set_warehouse: [''],
  });
  protected readonly orderItems = this.formBuilder.array([this.createItemRow()]);

  ngOnInit(): void {
    const session$: Observable<unknown> = this.auth.isAuthenticated()
      ? of(null)
      : this.auth.restoreSession();
    session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.loadPage(),
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
    this.selectedTab.set(tab);
  }

  protected search(): void {
    this.loadOrders();
  }

  protected refresh(): void {
    this.loadPage();
  }

  protected openNewOrder(): void {
    this.editingOrder.set(null);
    this.formError.set(null);
    this.orderForm.reset({
      customer: '',
      company: this.options().companies[0]?.name ?? '',
      transaction_date: this.today(),
      delivery_date: this.today(),
      currency: this.options().companies[0]?.default_currency ?? 'USD',
      selling_price_list: this.options().priceLists.includes('Standard Selling')
        ? 'Standard Selling'
        : this.options().priceLists[0] ?? '',
      set_warehouse: this.options().warehouses[0] ?? '',
    });
    this.orderItems.clear();
    this.addOrderItem();
    this.dialogOpen.set(true);
  }

  protected openEditOrder(order: ErpNextSalesOrder): void {
    if (order.docstatus !== 0) {
      return;
    }
    this.loadingOrder.set(true);
    this.formError.set(null);
    this.ordersService.get(order.name)
      .pipe(finalize(() => this.loadingOrder.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (details) => {
          if (details.docstatus !== 0) {
            this.formError.set('Only draft sales orders can be edited.');
            return;
          }
          this.editingOrder.set(details);
          this.orderForm.reset({
            customer: details.customer,
            company: details.company,
            transaction_date: details.transaction_date,
            delivery_date: details.delivery_date ?? details.transaction_date,
            currency: details.currency ?? '',
            selling_price_list: details.selling_price_list ?? '',
            set_warehouse: details.set_warehouse ?? '',
          });
          this.orderItems.clear();
          for (const item of details.items ?? []) {
            this.orderItems.push(this.createItemRow(item));
          }
          if (!this.orderItems.length) {
            this.addOrderItem();
          }
          this.dialogOpen.set(true);
        },
        error: (error: unknown) => this.formError.set(this.errorMessage(error)),
      });
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
    const save$ = current
      ? this.ordersService.update(current.name, details)
      : this.ordersService.create(details);
    save$
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.dialogOpen.set(false);
          this.loadOrders();
        },
        error: (error: unknown) => this.formError.set(this.errorMessage(error)),
      });
  }

  protected formatCurrency(amount: number | undefined, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount ?? 0);
  }

  private loadPage(): void {
    this.loading.set(true);
    forkJoin({ options: this.ordersService.loadOptions(), orders: this.ordersService.list() })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ options, orders }) => {
          this.options.set(options);
          this.orders.set(orders);
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
  }

  private loadOrders(): void {
    this.loading.set(true);
    this.ordersService.list(this.searchText.value)
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (orders) => {
          this.orders.set(orders);
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
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