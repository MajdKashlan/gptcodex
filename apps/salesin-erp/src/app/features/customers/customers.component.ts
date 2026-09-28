import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, Observable, of } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextCustomer } from '../../models/customer.models';
import { PageTopbarAction, PageTopbarComponent } from '../../shared/components/page-topbar/page-topbar.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { CustomerFormData, CustomerOptions, CustomersService } from './customers.service';

@Component({
  selector: 'app-customers',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
})
export class CustomersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly customersService = inject(CustomersService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];
  protected readonly customers = signal<ErpNextCustomer[]>([]);
  protected readonly options = signal<CustomerOptions>({ groups: [], territories: [], currencies: [], priceLists: [] });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadingCustomer = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editingCustomer = signal<ErpNextCustomer | null>(null);
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly customerTypes = ['Company', 'Individual'];
  protected readonly customerForm = this.formBuilder.nonNullable.group({
    customer_name: ['', Validators.required],
    customer_type: ['Company', Validators.required],
    customer_group: ['', Validators.required],
    territory: ['', Validators.required],
    default_currency: [''],
    default_price_list: [''],
    disabled: [false],
  });

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
      this.auth.logout().subscribe({ next: () => void this.router.navigate(['/login']) });
    }
  }

  protected search(): void {
    this.loadCustomers();
  }

  protected refresh(): void {
    this.loadPage();
  }

  protected openNewCustomer(): void {
    this.editingCustomer.set(null);
    this.formError.set(null);
    this.customerForm.reset({
      customer_name: '',
      customer_type: 'Company',
      customer_group: this.options().groups[0] ?? '',
      territory: this.options().territories[0] ?? '',
      default_currency: this.options().currencies.includes('USD') ? 'USD' : this.options().currencies[0] ?? '',
      default_price_list: this.options().priceLists.includes('Standard Selling')
        ? 'Standard Selling'
        : this.options().priceLists[0] ?? '',
      disabled: false,
    });
    this.dialogOpen.set(true);
  }

  protected openEditCustomer(customer: ErpNextCustomer): void {
    this.loadingCustomer.set(true);
    this.formError.set(null);
    this.customersService.get(customer.name)
      .pipe(finalize(() => this.loadingCustomer.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (details) => {
          this.editingCustomer.set(details);
          this.customerForm.reset({
            customer_name: details.customer_name ?? '',
            customer_type: details.customer_type ?? 'Company',
            customer_group: details.customer_group ?? '',
            territory: details.territory ?? '',
            default_currency: details.default_currency ?? '',
            default_price_list: details.default_price_list ?? '',
            disabled: details.disabled === 1,
          });
          this.dialogOpen.set(true);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
  }

  protected closeDialog(): void {
    if (!this.saving()) {
      this.dialogOpen.set(false);
    }
  }

  protected saveCustomer(): void {
    if (this.customerForm.invalid) {
      this.customerForm.markAllAsTouched();
      return;
    }

    const formValue = this.customerForm.getRawValue();
    const details: CustomerFormData = {
      ...formValue,
      customer_name: formValue.customer_name.trim(),
      disabled: formValue.disabled ? 1 : 0,
    };
    const current = this.editingCustomer();
    this.saving.set(true);
    this.formError.set(null);
    const save$ = current
      ? this.customersService.update(current.name, details)
      : this.customersService.create(details);
    save$
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.dialogOpen.set(false);
          this.loadCustomers();
        },
        error: (error: unknown) => this.formError.set(this.errorMessage(error)),
      });
  }

  protected signOut(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/login']) });
  }

  private loadPage(): void {
    this.loading.set(true);
    forkJoin({ options: this.customersService.loadOptions(), customers: this.customersService.list() })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ options, customers }) => {
          this.options.set(options);
          this.customers.set(customers);
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
  }

  private loadCustomers(): void {
    this.loading.set(true);
    this.customersService.list(this.searchText.value)
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customers) => {
          this.customers.set(customers);
          this.error.set(null);
        },
        error: (error: unknown) => this.error.set(this.errorMessage(error)),
      });
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
        return 'ERPNext could not complete this customer operation.';
      }
    }
    return details.error?.message ?? 'ERPNext could not complete this customer operation.';
  }
}