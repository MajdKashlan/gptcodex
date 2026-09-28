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
import {
  CustomerAddressData,
  CustomerContactData,
  CustomerFormData,
  CustomerOptions,
  CustomersService,
} from './customers.service';

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
  protected readonly options = signal<CustomerOptions>({
    groups: [], territories: [], currencies: [], priceLists: [], countries: [], taxCategories: [],
    paymentTerms: [], itemGroups: [], users: [], paymentMethods: [],
  });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadingCustomer = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editingCustomer = signal<ErpNextCustomer | null>(null);
  protected readonly customerFormTab = signal<'profile' | 'addresses' | 'details' | 'settings'>('profile');
  private readonly editingContactName = signal('');
  private readonly editingAddressName = signal('');
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly customerTypes = ['Company', 'Individual'];
  protected readonly customerForm = this.formBuilder.nonNullable.group({
    customer_name: ['', Validators.required],
    alias: [''],
    tax_id: [''],
    customer_type: ['Company', Validators.required],
    customer_group: ['', Validators.required],
    territory: ['', Validators.required],
    first_name: [''],
    last_name: [''],
    email: [''],
    business_phone: [''],
    home_phone: [''],
    mobile_phone: [''],
    fax: [''],
    address_type: ['Billing'],
    address_line1: [''],
    address_line2: [''],
    city: [''],
    state: [''],
    pincode: [''],
    country: [''],
    tax_applies: [false],
    tax_category: [''],
    is_frozen: [false],
    on_hold: [false],
    default_location: [''],
    discount_group: [''],
    minimum_order_value: [0],
    payment_terms: [''],
    default_payment_method: [''],
    default_currency: [''],
    default_price_list: [''],
    comments: [''],
    watchout_notes: [''],
    portal_users: [''],
    allowed_item_categories: [''],
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

  protected setCustomerFormTab(tab: 'profile' | 'addresses' | 'details' | 'settings'): void {
    this.customerFormTab.set(tab);
  }

  protected isPortalUserSelected(user: string): boolean {
    return this.customerForm.controls.portal_users.value.split(',').includes(user);
  }

  protected togglePortalUser(user: string): void {
    const users = new Set(this.customerForm.controls.portal_users.value.split(',').filter(Boolean));
    if (users.has(user)) {
      users.delete(user);
    } else {
      users.add(user);
    }
    this.customerForm.controls.portal_users.setValue([...users].join(','));
  }

  protected isItemGroupAllowed(group: string): boolean {
    return this.customerForm.controls.allowed_item_categories.value.split(',').includes(group);
  }

  protected toggleItemGroup(group: string): void {
    const groups = new Set(this.customerForm.controls.allowed_item_categories.value.split(',').filter(Boolean));
    if (groups.has(group)) {
      groups.delete(group);
    } else {
      groups.add(group);
    }
    this.customerForm.controls.allowed_item_categories.setValue([...groups].join(','));
  }

  protected search(): void {
    this.loadCustomers();
  }

  protected refresh(): void {
    this.loadPage();
  }

  protected openNewCustomer(): void {
    this.editingCustomer.set(null);
    this.editingContactName.set('');
    this.editingAddressName.set('');
    this.customerFormTab.set('profile');
    this.formError.set(null);
    this.customerForm.reset({
      customer_name: '',
      alias: '',
      tax_id: '',
      customer_type: 'Company',
      customer_group: this.options().groups[0] ?? '',
      territory: this.options().territories[0] ?? '',
      first_name: '',
      last_name: '',
      email: '',
      business_phone: '',
      home_phone: '',
      mobile_phone: '',
      fax: '',
      address_type: 'Billing',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      pincode: '',
      country: this.options().countries[0] ?? '',
      tax_applies: false,
      tax_category: '',
      is_frozen: false,
      on_hold: false,
      default_location: '',
      discount_group: '',
      minimum_order_value: 0,
      payment_terms: '',
      default_payment_method: '',
      default_currency: this.options().currencies.includes('USD') ? 'USD' : this.options().currencies[0] ?? '',
      default_price_list: this.options().priceLists.includes('Standard Selling')
        ? 'Standard Selling'
        : this.options().priceLists[0] ?? '',
      comments: '',
      watchout_notes: '',
      portal_users: '',
      allowed_item_categories: '',
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
        next: (editor) => {
          const details = editor.customer;
          this.editingCustomer.set(details);
          this.editingContactName.set(editor.contactName);
          this.editingAddressName.set(editor.addressName);
          this.customerFormTab.set('profile');
          this.customerForm.reset({
            customer_name: details.customer_name ?? '',
            alias: details.alias ?? '',
            tax_id: details.tax_id ?? '',
            customer_type: details.customer_type ?? 'Company',
            customer_group: details.customer_group ?? '',
            territory: details.territory ?? '',
            first_name: editor.contact.first_name,
            last_name: editor.contact.last_name,
            email: editor.contact.email,
            business_phone: editor.contact.business_phone,
            home_phone: editor.contact.home_phone,
            mobile_phone: editor.contact.mobile_phone,
            fax: editor.address.fax,
            address_type: editor.address.address_type,
            address_line1: editor.address.address_line1,
            address_line2: editor.address.address_line2,
            city: editor.address.city,
            state: editor.address.state,
            pincode: editor.address.pincode,
            country: editor.address.country,
            tax_applies: Boolean(details.tax_category),
            tax_category: details.tax_category ?? '',
            is_frozen: details.is_frozen === 1,
            on_hold: details.on_hold === 1,
            default_location: '',
            discount_group: '',
            minimum_order_value: 0,
            payment_terms: details.payment_terms ?? '',
            default_payment_method: '',
            default_currency: details.default_currency ?? '',
            default_price_list: details.default_price_list ?? '',
            comments: details.customer_details ?? '',
            watchout_notes: '',
            portal_users: details.portal_users?.map((portalUser) => portalUser.user).join(',') ?? '',
            allowed_item_categories: '',
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
    const contact: CustomerContactData = {
      first_name: formValue.first_name,
      last_name: formValue.last_name,
      email: formValue.email,
      business_phone: formValue.business_phone,
      home_phone: formValue.home_phone,
      mobile_phone: formValue.mobile_phone,
      fax: formValue.fax,
    };
    const address: CustomerAddressData = {
      address_type: formValue.address_type,
      address_line1: formValue.address_line1,
      address_line2: formValue.address_line2,
      city: formValue.city,
      state: formValue.state,
      pincode: formValue.pincode,
      country: formValue.country,
      fax: formValue.fax,
    };
    const additionalNotes = [
      formValue.comments.trim(),
      formValue.watchout_notes.trim() ? `Watchout Notes: ${formValue.watchout_notes.trim()}` : '',
      formValue.default_location.trim() ? `Default Location: ${formValue.default_location.trim()}` : '',
      formValue.discount_group.trim() ? `Discount Group: ${formValue.discount_group.trim()}` : '',
      formValue.minimum_order_value > 0 ? `Minimum Order Value: ${formValue.minimum_order_value}` : '',
      formValue.default_payment_method.trim() ? `Default Payment Method: ${formValue.default_payment_method.trim()}` : '',
      formValue.allowed_item_categories.trim() ? `Allowed Item Categories: ${formValue.allowed_item_categories.trim()}` : '',
      formValue.tax_applies ? 'Tax Applies: Yes' : '',
    ].filter(Boolean);
    const details: CustomerFormData = {
      customer_name: formValue.customer_name.trim(),
      alias: formValue.alias.trim(),
      customer_type: formValue.customer_type,
      customer_group: formValue.customer_group,
      territory: formValue.territory,
      default_currency: formValue.default_currency,
      default_price_list: formValue.default_price_list,
      tax_id: formValue.tax_id.trim(),
      tax_category: formValue.tax_category,
      payment_terms: formValue.payment_terms,
      customer_details: additionalNotes.join('\n'),
      is_frozen: formValue.is_frozen ? 1 : 0,
      on_hold: formValue.on_hold ? 1 : 0,
      disabled: formValue.disabled ? 1 : 0,
      portal_users: formValue.portal_users.split(/[\n,;]/).map((user) => user.trim()).filter(Boolean).map((user) => ({ user })),
    };
    const current = this.editingCustomer();
    this.saving.set(true);
    this.formError.set(null);
    const save$ = current
      ? this.customersService.update(
        current.name,
        details,
        contact,
        address,
        this.editingContactName(),
        this.editingAddressName(),
      )
      : this.customersService.create(details, contact, address);
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