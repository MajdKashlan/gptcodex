import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { FrappeApiService, FrappeFilter, Page } from '../../core/api/frappe-api.service';
import { ErpNextCustomer } from '../../models/customer.models';

export interface CustomerFormData {
  customer_name: string;
  alias: string;
  customer_type: string;
  customer_group: string;
  territory: string;
  default_currency: string;
  default_price_list: string;
  tax_id: string;
  tax_category: string;
  payment_terms: string;
  customer_details: string;
  is_frozen: 0 | 1;
  on_hold: 0 | 1;
  disabled: 0 | 1;
  portal_users: Array<{ user: string }>;
}

export interface CustomerOptions {
  groups: string[];
  territories: string[];
  currencies: string[];
  priceLists: string[];
  countries: string[];
  taxCategories: string[];
  paymentTerms: string[];
  itemGroups: string[];
  users: string[];
  paymentMethods: string[];
}

export interface CustomerContactData {
  first_name: string;
  last_name: string;
  email: string;
  business_phone: string;
  home_phone: string;
  mobile_phone: string;
  fax: string;
}

export interface CustomerAddressData {
  address_type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  fax: string;
}

interface CustomerContactRecord {
  first_name?: string;
  last_name?: string;
  email_ids?: Array<{ email_id: string; is_primary?: 0 | 1 }>;
  phone_nos?: Array<{ phone: string; is_primary_phone?: 0 | 1; is_primary_mobile_no?: 0 | 1 }>;
}

interface CustomerAddressRecord {
  address_type?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  fax?: string;
}

export interface CustomerEditorData {
  customer: ErpNextCustomer;
  contact: CustomerContactData;
  contactName: string;
  address: CustomerAddressData;
  addressName: string;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly api = inject(FrappeApiService);

  /** One server page of customers matching the search. */
  page(query: string, page: number, pageSize: number, includeDisabled = true): Observable<Page<ErpNextCustomer>> {
    const term = query.trim();
    const filters: FrappeFilter[] = includeDisabled ? [] : [['Customer', 'disabled', '=', 0]];
    return this.api.getPage<ErpNextCustomer>('Customer', {
      fields: ['name', 'customer_name', 'customer_type', 'customer_group', 'territory', 'default_currency', 'default_price_list', 'disabled', 'modified'],
      filters,
      orFilters: term ? [
        ['Customer', 'name', 'like', `%${term}%`],
        ['Customer', 'customer_name', 'like', `%${term}%`],
        ['Customer', 'mobile_no', 'like', `%${term}%`],
        ['Customer', 'email_id', 'like', `%${term}%`],
      ] : [],
      orderBy: 'customer_name asc',
      page,
      pageSize,
    });
  }

  loadOptions(): Observable<CustomerOptions> {
    return forkJoin({
      groups: this.listNames('Customer Group', [['Customer Group', 'is_group', '=', 0]]),
      territories: this.listNames('Territory', [['Territory', 'is_group', '=', 0]]),
      currencies: this.listNames('Currency', [['Currency', 'enabled', '=', 1]]),
      priceLists: this.listNames('Price List', [['Price List', 'selling', '=', 1]]),
      countries: this.listNames('Country'),
      taxCategories: this.listNames('Tax Category'),
      paymentTerms: this.listNames('Payment Terms Template'),
      itemGroups: this.listNames('Item Group', [['Item Group', 'is_group', '=', 0]]),
      users: this.listNames('User', [['User', 'enabled', '=', 1], ['User', 'user_type', '=', 'Website User']]),
      paymentMethods: this.listNames('Mode of Payment'),
    });
  }

  getCustomer(name: string): Observable<ErpNextCustomer> {
    return this.api.getDoc<ErpNextCustomer>('Customer', name);
  }

  get(name: string): Observable<CustomerEditorData> {
    return this.getCustomer(name).pipe(
      switchMap((customer) => forkJoin({
        customer: of(customer),
        contactName: of(customer.customer_primary_contact ?? ''),
        addressName: of(customer.customer_primary_address ?? ''),
        contact: customer.customer_primary_contact
          ? this.getContact(customer.customer_primary_contact).pipe(catchError(() => of(this.emptyContact())))
          : of(this.emptyContact()),
        address: customer.customer_primary_address
          ? this.getAddress(customer.customer_primary_address).pipe(catchError(() => of(this.emptyAddress())))
          : of(this.emptyAddress()),
      })),
    );
  }

  create(details: CustomerFormData, contact: CustomerContactData, address: CustomerAddressData): Observable<ErpNextCustomer> {
    return this.api
      .insert<ErpNextCustomer>('Customer', details)
      .pipe(switchMap((customer) => this.saveLinkedRecords(customer, contact, address, '', '')));
  }

  update(
    name: string,
    details: CustomerFormData,
    contact: CustomerContactData,
    address: CustomerAddressData,
    contactName: string,
    addressName: string,
  ): Observable<ErpNextCustomer> {
    return this.api
      .update<ErpNextCustomer>('Customer', name, details)
      .pipe(switchMap((customer) => this.saveLinkedRecords(customer, contact, address, contactName, addressName)));
  }

  private getContact(name: string): Observable<CustomerContactData> {
    return this.api.getDoc<CustomerContactRecord>('Contact', name).pipe(map((data) => ({
      first_name: data.first_name ?? '',
      last_name: data.last_name ?? '',
      email: data.email_ids?.find((email) => email.is_primary)?.email_id ?? data.email_ids?.[0]?.email_id ?? '',
      business_phone: data.phone_nos?.find((phone) => phone.is_primary_phone)?.phone ?? '',
      home_phone: data.phone_nos?.find((phone) => !phone.is_primary_phone && !phone.is_primary_mobile_no)?.phone ?? '',
      mobile_phone: data.phone_nos?.find((phone) => phone.is_primary_mobile_no)?.phone ?? '',
      fax: '',
    })));
  }

  private getAddress(name: string): Observable<CustomerAddressData> {
    return this.api.getDoc<CustomerAddressRecord>('Address', name).pipe(map((data) => ({
      address_type: data.address_type ?? 'Billing',
      address_line1: data.address_line1 ?? '',
      address_line2: data.address_line2 ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
      pincode: data.pincode ?? '',
      country: data.country ?? '',
      fax: data.fax ?? '',
    })));
  }
  private saveLinkedRecords(
    customer: ErpNextCustomer,
    contact: CustomerContactData,
    address: CustomerAddressData,
    contactName: string,
    addressName: string,
  ): Observable<ErpNextCustomer> {
    return this.saveContact(customer.name, contact, contactName).pipe(
      switchMap((savedContactName) => this.saveAddress(customer.name, address, addressName).pipe(
        map((savedAddressName) => ({ savedContactName, savedAddressName })),
      )),
      switchMap(({ savedContactName, savedAddressName }) => {
        const links: Record<string, string> = {};
        if (savedContactName && savedContactName !== contactName) {
          links['customer_primary_contact'] = savedContactName;
        }
        if (savedAddressName && savedAddressName !== addressName) {
          links['customer_primary_address'] = savedAddressName;
        }
        if (!Object.keys(links).length) {
          return of(customer);
        }
        return this.api.update<ErpNextCustomer>('Customer', customer.name, links);
      }),
    );
  }

  private saveContact(customerName: string, contact: CustomerContactData, contactName: string): Observable<string> {
    const hasContact = Object.values(contact).some((value) => value.trim());
    if (!hasContact) {
      return of(contactName);
    }

    const phoneNumbers = [
      ...(contact.business_phone.trim() ? [{ phone: contact.business_phone.trim(), is_primary_phone: 1 as const }] : []),
      ...(contact.home_phone.trim() ? [{ phone: contact.home_phone.trim() }] : []),
      ...(contact.mobile_phone.trim() ? [{ phone: contact.mobile_phone.trim(), is_primary_mobile_no: 1 as const }] : []),
    ];
    const payload = {
      first_name: contact.first_name.trim() || contact.email.trim() || 'Customer contact',
      last_name: contact.last_name.trim(),
      email_ids: contact.email.trim() ? [{ email_id: contact.email.trim(), is_primary: 1 }] : [],
      phone_nos: phoneNumbers,
      links: [{ link_doctype: 'Customer', link_name: customerName }],
      is_primary_contact: 1,
    };

    if (contactName) {
      return this.api.update('Contact', contactName, payload).pipe(map(() => contactName));
    }
    return this.api.insert<{ name: string }>('Contact', payload).pipe(map((created) => created.name));
  }

  private saveAddress(customerName: string, address: CustomerAddressData, addressName: string): Observable<string> {
    if (!address.address_line1.trim() || !address.city.trim() || !address.country.trim()) {
      return of(addressName);
    }

    const payload = {
      address_title: customerName,
      address_type: address.address_type,
      address_line1: address.address_line1.trim(),
      address_line2: address.address_line2.trim(),
      city: address.city.trim(),
      state: address.state.trim(),
      pincode: address.pincode.trim(),
      country: address.country,
      fax: address.fax.trim(),
      links: [{ link_doctype: 'Customer', link_name: customerName }],
      is_primary_address: 1,
    };

    if (addressName) {
      return this.api.update('Address', addressName, payload).pipe(map(() => addressName));
    }
    return this.api.insert<{ name: string }>('Address', payload).pipe(map((created) => created.name));
  }

  private emptyContact(): CustomerContactData {
    return { first_name: '', last_name: '', email: '', business_phone: '', home_phone: '', mobile_phone: '', fax: '' };
  }

  private emptyAddress(): CustomerAddressData {
    return { address_type: 'Billing', address_line1: '', address_line2: '', city: '', state: '', pincode: '', country: '', fax: '' };
  }

  /** Optional lookup tables: a role without access gets an empty list. */
  private listNames(doctype: string, filters: unknown[][] = []): Observable<string[]> {
    return this.api
      .getList<{ name: string }>(doctype, { fields: ['name'], filters, orderBy: 'name asc', pageLength: 0 })
      .pipe(map((rows) => rows.map((row) => row.name)), catchError(() => of([])));
  }
}
